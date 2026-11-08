// Game import: the pure part. Builds the public API requests for Chess.com
// and Lichess, and turns their responses into one game shape the archive
// viewer can open. No network or DOM here, so scripts/validate-game-import.js
// runs it in Node; game-import.js does the fetching, engine review and UI.
(function(root) {
  'use strict';
  const LIMIT = 20;
  const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/;

  function validUsername(name) { return USERNAME.test(String(name || '').trim()); }

  const SOURCES = {
    chesscom: { label: 'Chess.com', host: 'https://api.chess.com' },
    lichess: { label: 'Lichess', host: 'https://lichess.org' }
  };

  function archivesUrl(username) {
    return `${SOURCES.chesscom.host}/pub/player/${encodeURIComponent(String(username).trim().toLowerCase())}/games/archives`;
  }
  // Chess.com lists one archive URL per month, oldest first. Only ever
  // fetch the newest two, and only from Chess.com itself.
  function latestArchives(json, count) {
    const list = json && Array.isArray(json.archives) ? json.archives : [];
    return list.filter(url => typeof url === 'string' && url.indexOf(SOURCES.chesscom.host + '/pub/player/') === 0)
      .slice(-(count || 2)).reverse();
  }
  function lichessUrl(username, max) {
    const perf = 'ultraBullet,bullet,blitz,rapid,classical,correspondence';
    return `${SOURCES.lichess.host}/api/games/user/${encodeURIComponent(String(username).trim())}?max=${max || LIMIT}` +
      `&pgnInJson=true&opening=true&clocks=false&evals=false&perfType=${perf}`;
  }

  const WIN_REASON = { checkmated: 'Checkmate', resigned: 'Resignation', timeout: 'Time', abandoned: 'Abandoned', lose: 'Game over' };
  const DRAW_TEXT = {
    stalemate: 'Stalemate.', agreed: 'Draw by agreement.', repetition: 'Draw by repetition.',
    insufficient: 'Draw: insufficient material.', '50move': 'Draw: 50-move rule.',
    timevsinsufficient: 'Draw: time ran out with insufficient material.'
  };
  // Result text in the same form Coach uses ("Checkmate — White wins.",
  // "Draw by …"), so the archive's win/loss/draw reading works unchanged.
  function winText(reason, winner) { return `${reason} — ${winner === 'white' ? 'White' : 'Black'} wins.`; }

  function header(pgn, name) {
    const m = String(pgn || '').match(new RegExp('\\[' + name + ' "([^"]*)"\\]'));
    return m ? m[1] : '';
  }
  function startFenOf(pgn) {
    return header(pgn, 'SetUp') === '1' && header(pgn, 'FEN') ? header(pgn, 'FEN') : '';
  }

  function chessComResult(game) {
    const w = game.white && game.white.result, b = game.black && game.black.result;
    if (w === 'win') return winText(WIN_REASON[b] || 'Game over', 'white');
    if (b === 'win') return winText(WIN_REASON[w] || 'Game over', 'black');
    return DRAW_TEXT[w] || DRAW_TEXT[b] || 'Draw.';
  }

  function sameUser(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }

  // One Chess.com monthly archive → games, newest first. Only standard
  // chess the user actually played.
  function parseChessCom(json, username) {
    const games = json && Array.isArray(json.games) ? json.games : [];
    return games.map(game => {
      if (!game || game.rules !== 'chess' || typeof game.pgn !== 'string') return null;
      const white = game.white || {}, black = game.black || {};
      const side = sameUser(white.username, username) ? 'white' : sameUser(black.username, username) ? 'black' : null;
      if (!side) return null;
      const opp = side === 'white' ? black : white;
      const id = 'chesscom-' + String(game.uuid || String(game.url || '').split('/').pop() || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
      if (id === 'chesscom-') return null;
      return {
        source: 'chesscom', id, url: typeof game.url === 'string' && game.url.indexOf('https://www.chess.com/') === 0 ? game.url : '',
        at: Number(game.end_time) * 1000 || 0, side,
        opponent: String(opp.username || '?').slice(0, 40), opponentRating: Number(opp.rating) || 0,
        userRating: Number((side === 'white' ? white : black).rating) || 0,
        speed: String(game.time_class || '').slice(0, 20), timeControl: String(game.time_control || '').slice(0, 20),
        rated: !!game.rated, result: chessComResult(game),
        opening: header(game.pgn, 'ECOUrl').split('/').pop().replace(/-/g, ' ').slice(0, 80),
        pgn: game.pgn, startFen: startFenOf(game.pgn)
      };
    }).filter(Boolean).sort((a, b) => b.at - a.at);
  }

  function lichessResult(game) {
    const status = game.status;
    const winner = game.winner;
    const reason = { mate: 'Checkmate', resign: 'Resignation', outoftime: 'Time', timeout: 'Abandoned', cheat: 'Game over', variantEnd: 'Game over' }[status];
    if (winner === 'white' || winner === 'black') return winText(reason || 'Game over', winner);
    if (status === 'stalemate') return 'Stalemate.';
    return 'Draw.';
  }

  // Lichess NDJSON: one game per line.
  function parseLichess(text, username) {
    return String(text || '').split('\n').map(line => {
      line = line.trim();
      if (!line) return null;
      let game;
      try { game = JSON.parse(line); } catch (e) { return null; }
      if (!game || game.variant !== 'standard' || typeof game.pgn !== 'string') return null;
      if (['aborted', 'noStart', 'created', 'started', 'unknownFinish'].includes(game.status)) return null;
      const players = game.players || {};
      const name = p => (p && p.user && p.user.name) || (p && p.aiLevel ? 'Stockfish level ' + p.aiLevel : '?');
      const side = sameUser(name(players.white), username) ? 'white' : sameUser(name(players.black), username) ? 'black' : null;
      if (!side) return null;
      const opp = side === 'white' ? players.black : players.white;
      const id = 'lichess-' + String(game.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
      if (id === 'lichess-') return null;
      return {
        source: 'lichess', id, url: 'https://lichess.org/' + id.slice(8),
        at: Number(game.lastMoveAt || game.createdAt) || 0, side,
        opponent: String(name(opp)).slice(0, 40), opponentRating: Number(opp && opp.rating) || 0,
        userRating: Number((players[side] || {}).rating) || 0,
        speed: String(game.speed || '').slice(0, 20),
        timeControl: game.clock ? `${game.clock.initial}+${game.clock.increment}` : '',
        rated: !!game.rated, result: lichessResult(game),
        opening: String((game.opening && game.opening.name) || '').slice(0, 80),
        pgn: game.pgn, startFen: startFenOf(game.pgn)
      };
    }).filter(Boolean).sort((a, b) => b.at - a.at);
  }

  // Replays a game's PGN. Returns the plies the user played as
  // { ply, fenBefore, uci, fenAfter, san } (ply = moves played after it),
  // or null when the PGN cannot be read.
  function userMoves(ChessCtor, game) {
    const parsed = new ChessCtor();
    // Chess.com PGNs carry clock comments; chess.js reads past them.
    if (!parsed.load_pgn(String(game.pgn), { sloppy: true })) return null;
    const moves = parsed.history({ verbose: true });
    const replay = new ChessCtor();
    if (game.startFen && !replay.load(game.startFen)) return null;
    const mine = game.side === 'black' ? 'b' : 'w';
    const out = [];
    for (let i = 0; i < moves.length; i++) {
      const fenBefore = replay.fen();
      const color = replay.turn();
      const move = replay.move({ from: moves[i].from, to: moves[i].to, promotion: moves[i].promotion });
      if (!move) return null;
      const previous = i > 0 ? moves[i - 1] : null;
      if (color === mine) out.push({ ply: i + 1, fenBefore, uci: move.from + move.to + (move.promotion || ''), fenAfter: replay.fen(), san: move.san,
        previousCaptureSquare: previous && previous.captured ? previous.to : null });
    }
    return { plies: moves.length, moves: out, cleanPgn: cleanPgn(ChessCtor, game, moves) };
  }

  // A compact PGN without clock comments, with the headers the viewer needs.
  function cleanPgn(ChessCtor, game, moves) {
    const g = new ChessCtor();
    if (game.startFen) g.load(game.startFen);
    moves.forEach(m => g.move({ from: m.from, to: m.to, promotion: m.promotion }));
    const keep = ['Event', 'Site', 'Date', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'TimeControl', 'ECO', 'Termination'];
    keep.forEach(name => { const v = header(game.pgn, name); if (v) g.header(name, v); });
    if (game.startFen) { g.header('SetUp', '1'); g.header('FEN', game.startFen); }
    return g.pgn();
  }

  const api = { LIMIT, SOURCES, validUsername, archivesUrl, latestArchives, lichessUrl, parseChessCom, parseLichess, userMoves, header };
  root.GameImportCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
