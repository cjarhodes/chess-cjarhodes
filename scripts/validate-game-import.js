#!/usr/bin/env node
// Game import: request URLs stay on the two public APIs, both response
// formats parse into the archive's game shape, the user's side and the
// result are read correctly, and every imported PGN replays.
// scripts/fixtures/lichess-games.ndjson is a real Lichess export (game
// q7ZvsdUF); the Chess.com month below follows its published format.
const fs = require('fs');
const path = require('path');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');
const G = require(path.join(__dirname, '..', 'game-import-core.js'));
let checks = 0;
const failures = [];
const expect = (actual, wanted, message) => { checks++; if (JSON.stringify(actual) !== JSON.stringify(wanted)) failures.push(`${message}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`); };

// ── Usernames and URLs ──
expect(G.validUsername('Hikaru'), true, 'a plain username is valid');
expect(G.validUsername('a_b-c9'), true, 'underscores, hyphens and digits are valid');
['', 'a', 'x'.repeat(31), '../etc', 'a b', 'name?x=1', '_lead'].forEach(name => expect(G.validUsername(name), false, `"${name}" is rejected`));
expect(G.archivesUrl('Hikaru'), 'https://api.chess.com/pub/player/hikaru/games/archives', 'Chess.com archives URL is lower-cased');
expect(G.lichessUrl('DrNykterstein').indexOf('https://lichess.org/api/games/user/DrNykterstein?max=20&pgnInJson=true'), 0, 'Lichess URL asks for PGN in JSON');
expect(/perfType=[^&]*classical/.test(G.lichessUrl('x')) && !/chess960|crazyhouse/.test(G.lichessUrl('x')), true, 'Lichess URL asks for standard speeds only');
expect(G.latestArchives({ archives: [
  'https://api.chess.com/pub/player/x/games/2026/09',
  'https://evil.example/pub/player/x/games/2026/10',
  'https://api.chess.com/pub/player/x/games/2026/10',
  'https://api.chess.com/pub/player/x/games/2026/11'
] }), ['https://api.chess.com/pub/player/x/games/2026/11', 'https://api.chess.com/pub/player/x/games/2026/10'], 'newest two Chess.com months, Chess.com URLs only');
expect(G.latestArchives(null), [], 'a missing archive list gives no months');

// ── Lichess ──
const lichessText = fs.readFileSync(path.join(__dirname, 'fixtures', 'lichess-games.ndjson'), 'utf8');
const extra = [
  { id: 'abort001', variant: 'standard', status: 'aborted', players: { white: { user: { name: 'Me' } }, black: { user: { name: 'X' } } }, pgn: '1. e4 *' },
  { id: 'var00001', variant: 'chess960', status: 'mate', players: { white: { user: { name: 'Me' } }, black: { user: { name: 'X' } } }, pgn: '1. e4 *' },
  { id: 'ai000001', variant: 'standard', status: 'mate', winner: 'black', rated: false, speed: 'blitz', lastMoveAt: 1700000000000,
    players: { white: { user: { name: 'me' }, rating: 1500 }, black: { aiLevel: 3 } },
    pgn: '[White "me"]\n[Black "?"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1' }
].map(g => JSON.stringify(g)).join('\n');
const asWhite = G.parseLichess(lichessText, 'lance5500');
expect(asWhite.length, 1, 'the Lichess export parses one game');
const lg = asWhite[0];
expect([lg.source, lg.id, lg.url, lg.side, lg.opponent, lg.opponentRating, lg.userRating, lg.speed, lg.timeControl, lg.rated],
  ['lichess', 'lichess-q7ZvsdUF', 'https://lichess.org/q7ZvsdUF', 'white', 'TryingHard87', 2498, 2389, 'blitz', '300+3', true], 'Lichess game fields');
expect(lg.result, 'Draw.', 'a Lichess draw reads as a draw');
expect(lg.opening, 'Semi-Slav Defense: Marshall Gambit', 'Lichess opening name is kept');
expect(G.parseLichess(lichessText, 'TRYINGHARD87')[0].side, 'black', 'usernames match without case');
expect(G.parseLichess(lichessText, 'someoneelse'), [], 'games the user did not play are dropped');
const mine = G.parseLichess(extra + '\nnot json\n', 'Me');
expect(mine.map(g => g.id), ['lichess-ai000001'], 'aborted and variant games and bad lines are dropped');
expect([mine[0].opponent, mine[0].result], ['Stockfish level 3', 'Checkmate — Black wins.'], 'a game against the Lichess AI names it and reads the mate');

// ── Chess.com ──
const ccPgn = (white, black, result, moves) => `[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2026.11.05"]\n[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n[ECO "C50"]\n[ECOUrl "https://www.chess.com/openings/Italian-Game"]\n[TimeControl "600"]\n[Termination "${black} won by checkmate"]\n\n${moves}`;
const month = { games: [
  { url: 'https://www.chess.com/game/live/111', uuid: 'aaaa-1111', rules: 'chess', rated: true, time_class: 'rapid', time_control: '600', end_time: 1762300000,
    white: { username: 'Alex', rating: 1210, result: 'checkmated' }, black: { username: 'Opp1', rating: 1250, result: 'win' },
    pgn: ccPgn('Alex', 'Opp1', '0-1', '1. f3 {[%clk 0:09:58.1]} 1... e5 {[%clk 0:09:57.3]} 2. g4 {[%clk 0:09:50]} 2... Qh4# {[%clk 0:09:49]} 0-1') },
  { url: 'https://www.chess.com/game/live/222', uuid: 'bbbb-2222', rules: 'chess', rated: true, time_class: 'blitz', time_control: '180+2', end_time: 1762400000,
    white: { username: 'Opp2', rating: 1300, result: 'agreed' }, black: { username: 'alex', rating: 1220, result: 'agreed' },
    pgn: ccPgn('Opp2', 'alex', '1/2-1/2', '1. d4 d5 2. c4 e6 1/2-1/2') },
  { url: 'https://www.chess.com/game/live/333', uuid: 'cccc-3333', rules: 'chess960', time_class: 'blitz', end_time: 1762500000,
    white: { username: 'Alex', result: 'win' }, black: { username: 'X', result: 'resigned' }, pgn: '1. e4 *' },
  { url: 'https://www.chess.com/game/live/444', uuid: 'dddd-4444', rules: 'chess', time_class: 'blitz', end_time: 1762600000,
    white: { username: 'Other', result: 'win' }, black: { username: 'Someone', result: 'resigned' }, pgn: '1. e4 *' },
  { url: 'https://www.chess.com/game/live/555', uuid: 'eeee-5555', rules: 'chess', time_class: 'bullet', time_control: '60', end_time: 1762350000,
    white: { username: 'alex', rating: 1100, result: 'win' }, black: { username: 'Opp3', rating: 1090, result: 'timeout' },
    pgn: ccPgn('alex', 'Opp3', '1-0', '1. e4 e5 1-0') }
] };
const cc = G.parseChessCom(month, 'ALEX');
expect(cc.map(g => g.id), ['chesscom-bbbb-2222', 'chesscom-eeee-5555', 'chesscom-aaaa-1111'], 'Chess.com games: standard, mine, newest first');
expect([cc[0].side, cc[0].opponent, cc[0].result, cc[0].speed, cc[0].timeControl], ['black', 'Opp2', 'Draw by agreement.', 'blitz', '180+2'], 'a Chess.com draw by agreement');
expect(cc[1].result, 'Time — White wins.', 'a Chess.com win on time');
const loss = cc[2];
expect([loss.side, loss.result, loss.opening, loss.at, loss.url], ['white', 'Checkmate — Black wins.', 'Italian Game', 1762300000000, 'https://www.chess.com/game/live/111'], 'a Chess.com loss by mate');
expect(G.parseChessCom({ games: [{ rules: 'chess', uuid: 'x', url: 'javascript:alert(1)', pgn: '1. e4 *', white: { username: 'alex', result: 'win' }, black: { username: 'b', result: 'resigned' } }] }, 'alex')[0].url, '', 'only chess.com game links are kept');
expect(G.parseChessCom({}, 'alex'), [], 'an empty month gives no games');

// ── Replays ──
const lm = G.userMoves(Chess, lg);
expect(lm !== null, true, 'the Lichess PGN replays');
expect(lm.moves.every(m => m.ply % 2 === 1), true, 'White moves are the odd plies');
expect(lm.moves[0].uci, 'd2d4', 'the first White move is d4');
const blackSide = G.userMoves(Chess, G.parseLichess(lichessText, 'TryingHard87')[0]);
expect(blackSide.moves.every(m => m.ply % 2 === 0) && blackSide.moves[0].uci === 'd7d5', true, 'Black moves are the even plies');
const lossMoves = G.userMoves(Chess, loss);
expect(lossMoves !== null && lossMoves.plies, 4, 'a Chess.com PGN with clock comments replays');
expect(lossMoves.moves.map(m => m.san), ['f3', 'g4'], 'only the user\'s moves are listed');
expect(/clk/.test(lossMoves.cleanPgn), false, 'the stored PGN drops clock comments');
const reparsed = new Chess();
expect(reparsed.load_pgn(lossMoves.cleanPgn), true, 'the stored PGN loads again');
expect(reparsed.header().White, 'Alex', 'the stored PGN keeps the player names');
const fromFen = { side: 'white', startFen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', pgn: '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Kd7 2. e5 *' };
const ff = G.userMoves(Chess, fromFen);
expect(ff && ff.moves.map(m => m.uci), ['e2e4', 'e4e5'], 'a game from a set-up position replays from its FEN');
expect(G.userMoves(Chess, { side: 'white', startFen: '', pgn: '1. e4 e5 2. Ke3 Ke6 3. Qh8 *' }), null, 'an illegal PGN is refused');
const recapture = G.userMoves(Chess, { side: 'white', startFen: '', pgn: '1. e4 d5 2. Nc3 dxe4 3. Nxe4 *' });
expect(recapture.moves.map(m => m.previousCaptureSquare), [null, null, 'e4'], 'each move records the square the opponent just captured on, for missed-recapture tagging');

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Game import validation passed (${checks} checks).`);
