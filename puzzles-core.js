// Puzzle trainer logic: rating, selection, solution checking, Rush and Vision.
// Pure functions with no DOM access, so scripts/validate-puzzles.js can run
// them in Node. puzzles.js owns the view and storage.
(function(root) {
  'use strict';

  const STATE_VERSION = 1;
  const START_RATING = 1200;
  const START_DEVIATION = 220;
  const MIN_DEVIATION = 60;
  const MAX_DEVIATION = 350;
  const PUZZLE_DEVIATION = 75;
  // Deviation grows back as days pass without puzzles, as in Glicko.
  const DEVIATION_DRIFT_PER_DAY = 12;
  const HISTORY_LIMIT = 400;
  const RECENT_EXCLUSION = 300;
  const DAY_MS = 86400000;

  // Lichess theme keys → plain names and one-line teaching notes. Unlisted
  // keys fall back to a split camelCase label.
  const THEMES = {
    mate: ['Checkmate', 'Finish the game.'],
    mateIn1: ['Mate in 1', 'One move ends the game. Check every check.'],
    mateIn2: ['Mate in 2', 'A forcing first move leaves no defence to mate.'],
    mateIn3: ['Mate in 3', 'Keep checking or threatening until the net closes.'],
    mateIn4: ['Mate in 4+', 'A longer forcing sequence ends in mate.'],
    mateIn5: ['Mate in 5+', 'A longer forcing sequence ends in mate.'],
    fork: ['Fork', 'One piece attacks two targets at once.'],
    pin: ['Pin', 'A piece cannot move without exposing something more valuable behind it.'],
    skewer: ['Skewer', 'Attack a valuable piece so that the one behind it falls.'],
    discoveredAttack: ['Discovered attack', 'Moving one piece unmasks an attack by another.'],
    discoveredCheck: ['Discovered check', 'Moving one piece unmasks a check by another.'],
    doubleCheck: ['Double check', 'Two pieces give check; only a king move helps.'],
    sacrifice: ['Sacrifice', 'Give material to gain something bigger.'],
    deflection: ['Deflection', 'Lure a defender away from the square it guards.'],
    attraction: ['Attraction', 'Force a piece, often the king, onto a bad square.'],
    decoy: ['Decoy', 'Force a piece onto a bad square.'],
    clearance: ['Clearance', 'Move a piece out of the way to open a line or square.'],
    interference: ['Interference', 'Block the line between a defender and what it protects.'],
    intermezzo: ['In-between move', 'Insert a forcing move before the expected recapture.'],
    xRayAttack: ['X-ray', 'A piece attacks or defends through another piece.'],
    hangingPiece: ['Hanging piece', 'Something is undefended. Take it.'],
    trappedPiece: ['Trapped piece', 'A piece has no safe squares; win it.'],
    capturingDefender: ['Remove the defender', 'Capture the piece that holds the position together.'],
    exposedKing: ['Exposed king', 'Attack a king with little cover.'],
    kingsideAttack: ['Kingside attack', 'Attack the castled king.'],
    queensideAttack: ['Queenside attack', 'Attack on the queenside.'],
    attackingF2F7: ['Attacking f2/f7', 'The pawn next to the uncastled king is weak.'],
    backRankMate: ['Back-rank mate', 'The king is boxed in by its own pawns.'],
    smotheredMate: ['Smothered mate', 'A knight mates a king surrounded by its own pieces.'],
    anastasiaMate: ['Anastasia’s mate', 'Knight and rook trap the king on the edge.'],
    arabianMate: ['Arabian mate', 'Knight and rook mate in the corner.'],
    bodenMate: ['Boden’s mate', 'Two bishops on crossing diagonals.'],
    doubleBishopMate: ['Double-bishop mate', 'Two bishops on adjacent diagonals.'],
    dovetailMate: ['Dovetail mate', 'The queen mates a king whose escape squares are blocked.'],
    hookMate: ['Hook mate', 'Rook, knight and pawn together.'],
    cornerMate: ['Corner mate', 'A king in the corner with no air.'],
    epauletteMate: ['Epaulette mate', 'The king’s own rooks block its escape.'],
    balestraMate: ['Balestra mate', 'Bishop and queen trap the king.'],
    blindSwineMate: ['Blind swine mate', 'Two rooks on the seventh rank.'],
    killBoxMate: ['Kill-box mate', 'Rook and queen box in the king.'],
    pillsburysMate: ['Pillsbury’s mate', 'Rook and bishop mate.'],
    morphysMate: ['Morphy’s mate', 'Bishop and rook mate in the corner.'],
    operaMate: ['Opera mate', 'Rook and bishop mate on the back rank.'],
    triangleMate: ['Triangle mate', 'Queen and rook in a triangle.'],
    vukovicMate: ['Vuković mate', 'Rook and knight mate on the edge.'],
    advancedPawn: ['Advanced pawn', 'A pawn close to promotion decides the game.'],
    promotion: ['Promotion', 'Promote a pawn.'],
    underPromotion: ['Underpromotion', 'Promote to something other than a queen.'],
    enPassant: ['En passant', 'Capture a pawn that just moved two squares.'],
    castling: ['Castling', 'Castle as part of the solution.'],
    quietMove: ['Quiet move', 'No check or capture, but it sets up an unstoppable threat.'],
    defensiveMove: ['Defensive move', 'Stop the opponent’s threat precisely.'],
    zugzwang: ['Zugzwang', 'The opponent must move and every move makes things worse.'],
    equality: ['Equality', 'Save a worse position.'],
    advantage: ['Advantage', 'Win a decisive advantage.'],
    crushing: ['Crushing', 'Win decisively.'],
    opening: ['Opening', 'From the first moves of a game.'],
    middlegame: ['Middlegame', 'From the middle of a game.'],
    endgame: ['Endgame', 'From an endgame.'],
    pawnEndgame: ['Pawn endgame', 'Only kings and pawns.'],
    rookEndgame: ['Rook endgame', 'Rooks and pawns.'],
    bishopEndgame: ['Bishop endgame', 'Bishops and pawns.'],
    knightEndgame: ['Knight endgame', 'Knights and pawns.'],
    queenEndgame: ['Queen endgame', 'Queens and pawns.'],
    queenRookEndgame: ['Queen and rook endgame', 'Queens, rooks and pawns.'],
    oneMove: ['One move', 'A one-move puzzle.'],
    short: ['Short', 'A two-move puzzle.'],
    long: ['Long', 'A three-move puzzle.'],
    veryLong: ['Very long', 'Four moves or more.'],
    master: ['Master game', 'From a game between titled players.'],
    masterVsMaster: ['Master vs master', 'From a game between two titled players.'],
    superGM: ['Super GM', 'From a game between elite players.'],
    collinearMove: ['Collinear move', 'The move lies along the same line as the threat.']
  };

  // Lesson-sized groups shown as filters. Each matches any of its keys.
  const THEME_GROUPS = [
    { id: 'all', label: 'All themes', keys: [] },
    { id: 'mate', label: 'Checkmates', keys: ['mate'] },
    { id: 'fork', label: 'Forks', keys: ['fork'] },
    { id: 'pin-skewer', label: 'Pins and skewers', keys: ['pin', 'skewer', 'xRayAttack'] },
    { id: 'discovered', label: 'Discovered attacks', keys: ['discoveredAttack', 'discoveredCheck', 'doubleCheck'] },
    { id: 'sacrifice', label: 'Sacrifices', keys: ['sacrifice'] },
    { id: 'defender', label: 'Defenders and decoys', keys: ['deflection', 'attraction', 'capturingDefender', 'interference', 'clearance'] },
    { id: 'hanging', label: 'Loose pieces', keys: ['hangingPiece', 'trappedPiece'] },
    { id: 'quiet', label: 'Quiet and defensive moves', keys: ['quietMove', 'defensiveMove', 'intermezzo', 'zugzwang'] },
    { id: 'pawns', label: 'Pawns and promotion', keys: ['advancedPawn', 'promotion', 'underPromotion', 'enPassant'] },
    { id: 'opening', label: 'Opening traps', keys: ['opening'] },
    { id: 'endgame', label: 'Endgames', keys: ['endgame'] },
    { id: 'attack', label: 'King attacks', keys: ['kingsideAttack', 'queensideAttack', 'exposedKing', 'attackingF2F7'] }
  ];

  // Themes that describe length, phase or result rather than a skill. They
  // are shown after solving but not used for strengths and weaknesses.
  const DESCRIPTIVE = new Set(['oneMove', 'short', 'long', 'veryLong', 'master', 'masterVsMaster', 'superGM',
    'advantage', 'crushing', 'equality', 'middlegame', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5']);

  function themeLabel(key) {
    if (THEMES[key]) return THEMES[key][0];
    const words = String(key || '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function themeNote(key) {
    return THEMES[key] ? THEMES[key][1] : '';
  }

  function parsePuzzle(row) {
    if (!Array.isArray(row) || row.length < 5) return null;
    const moves = String(row[2]).trim().split(/\s+/).filter(Boolean);
    if (moves.length < 2) return null;
    return {
      id: String(row[0]),
      fen: String(row[1]),
      moves,
      rating: Number(row[3]) || 1500,
      themes: String(row[4]).trim().split(/\s+/).filter(Boolean)
    };
  }

  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

  function emptyState() {
    return {
      v: STATE_VERSION,
      rating: START_RATING,
      deviation: START_DEVIATION,
      lastRatedAt: 0,
      history: [],
      rush: { best: {}, runs: [] },
      vision: { best: {}, runs: [] },
      daily: {},
      updatedAt: 0
    };
  }

  function finiteOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeAttempt(row) {
    if (!row || typeof row.id !== 'string' || !Number.isFinite(row.at)) return null;
    return {
      id: row.id,
      at: row.at,
      puzzleRating: clamp(finiteOr(row.puzzleRating, 1500), 100, 3500),
      win: !!row.win,
      rated: row.rated !== false,
      hinted: !!row.hinted,
      delta: clamp(finiteOr(row.delta, 0), -400, 400),
      ratingAfter: clamp(finiteOr(row.ratingAfter, START_RATING), 100, 3500),
      themes: Array.isArray(row.themes) ? row.themes.filter(t => typeof t === 'string').slice(0, 12) : [],
      ms: clamp(Math.round(finiteOr(row.ms, 0)), 0, 3600000)
    };
  }

  function normalizeRun(row) {
    if (!row || !Number.isFinite(row.at) || typeof row.mode !== 'string') return null;
    return { at: row.at, mode: row.mode, score: clamp(Math.floor(finiteOr(row.score, 0)), 0, 9999),
      mistakes: clamp(Math.floor(finiteOr(row.mistakes, 0)), 0, 9999) };
  }

  function normalizeBest(best) {
    const out = {};
    if (best && typeof best === 'object' && !Array.isArray(best)) {
      Object.keys(best).forEach(mode => {
        const n = Math.floor(Number(best[mode]));
        if (Number.isFinite(n) && n >= 0) out[mode] = Math.min(9999, n);
      });
    }
    return out;
  }

  function normalizeState(value) {
    const base = emptyState();
    if (!value || typeof value !== 'object' || value.v !== STATE_VERSION) return base;
    base.rating = clamp(finiteOr(value.rating, START_RATING), 100, 3500);
    base.deviation = clamp(finiteOr(value.deviation, START_DEVIATION), MIN_DEVIATION, MAX_DEVIATION);
    base.lastRatedAt = Math.max(0, finiteOr(value.lastRatedAt, 0));
    base.updatedAt = Math.max(0, finiteOr(value.updatedAt, 0));
    base.history = (Array.isArray(value.history) ? value.history : [])
      .map(normalizeAttempt).filter(Boolean).sort((a, b) => a.at - b.at).slice(-HISTORY_LIMIT);
    ['rush', 'vision'].forEach(kind => {
      const raw = value[kind] || {};
      base[kind] = {
        best: normalizeBest(raw.best),
        runs: (Array.isArray(raw.runs) ? raw.runs : []).map(normalizeRun).filter(Boolean).sort((a, b) => a.at - b.at).slice(-50)
      };
    });
    if (value.daily && typeof value.daily === 'object' && !Array.isArray(value.daily)) {
      Object.keys(value.daily).filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort().slice(-120).forEach(key => {
        const day = value.daily[key];
        if (day && typeof day.id === 'string') base.daily[key] = { id: day.id, solved: !!day.solved, firstTry: !!day.firstTry };
      });
    }
    return base;
  }

  // Merge two copies of the same player's puzzle state (another browser, or
  // an imported backup). Attempts are unioned by id+time; the rating comes
  // from whichever copy rated a puzzle most recently.
  // A bounded copy for syncing inside the account's training profile, which
  // the database caps at 128 KB alongside everything else.
  function compactState(value, limit) {
    const state = normalizeState(value);
    state.history = state.history.slice(-(limit || 120)).map(row => Object.assign({}, row, {
      // Keep the skill themes the stats use; length and result tags sort
      // first alphabetically and would otherwise crowd them out.
      ms: 0, ratingAfter: Math.round(row.ratingAfter), themes: row.themes.filter(t => !DESCRIPTIVE.has(t)).slice(0, 6)
    }));
    state.rush.runs = state.rush.runs.slice(-10);
    state.vision.runs = state.vision.runs.slice(-10);
    const days = Object.keys(state.daily).sort().slice(-60);
    const daily = {};
    days.forEach(day => { daily[day] = state.daily[day]; });
    state.daily = daily;
    return state;
  }

  function mergeStates(a, b) {
    const left = normalizeState(a), right = normalizeState(b);
    const newer = right.lastRatedAt > left.lastRatedAt ? right : left;
    const out = normalizeState(newer);
    const seen = new Map();
    left.history.concat(right.history).forEach(row => seen.set(row.id + '@' + row.at, row));
    out.history = Array.from(seen.values()).sort((x, y) => x.at - y.at).slice(-HISTORY_LIMIT);
    ['rush', 'vision'].forEach(kind => {
      const best = Object.assign({}, left[kind].best);
      Object.entries(right[kind].best).forEach(([mode, score]) => { best[mode] = Math.max(best[mode] || 0, score); });
      const runs = new Map();
      left[kind].runs.concat(right[kind].runs).forEach(run => runs.set(run.mode + '@' + run.at, run));
      out[kind] = { best, runs: Array.from(runs.values()).sort((x, y) => x.at - y.at).slice(-50) };
    });
    out.daily = Object.assign({}, left.daily);
    Object.entries(right.daily).forEach(([day, row]) => {
      const cur = out.daily[day];
      out.daily[day] = !cur ? row : { id: cur.id, solved: cur.solved || row.solved, firstTry: cur.firstTry || row.firstTry };
    });
    out.updatedAt = Math.max(left.updatedAt, right.updatedAt);
    return normalizeState(out);
  }

  // Deviation grows with time away so a returning player's rating moves
  // faster again.
  function currentDeviation(state, now) {
    if (!state.lastRatedAt) return state.deviation;
    const days = Math.max(0, (now - state.lastRatedAt) / DAY_MS);
    return clamp(Math.sqrt(state.deviation * state.deviation + DEVIATION_DRIFT_PER_DAY * DEVIATION_DRIFT_PER_DAY * days), MIN_DEVIATION, MAX_DEVIATION);
  }

  // One Glicko-1 rating period with a single game against the puzzle.
  function glickoUpdate(rating, deviation, opponentRating, score) {
    const q = Math.LN10 / 400;
    const g = 1 / Math.sqrt(1 + 3 * q * q * PUZZLE_DEVIATION * PUZZLE_DEVIATION / (Math.PI * Math.PI));
    const expected = 1 / (1 + Math.pow(10, -g * (rating - opponentRating) / 400));
    const dSquared = 1 / (q * q * g * g * expected * (1 - expected));
    const denom = 1 / (deviation * deviation) + 1 / dSquared;
    const newRating = rating + (q / denom) * g * (score - expected);
    const newDeviation = Math.sqrt(1 / denom);
    return { rating: newRating, deviation: clamp(newDeviation, MIN_DEVIATION, MAX_DEVIATION), expected };
  }

  // Record one attempt. Rated attempts move the rating; replays and retries
  // are kept in history without a rating change.
  function recordAttempt(state, puzzle, result, now) {
    const next = normalizeState(state);
    const rated = result.rated !== false;
    const before = next.rating;
    if (rated) {
      const update = glickoUpdate(next.rating, currentDeviation(next, now), puzzle.rating, result.win ? 1 : 0);
      next.rating = clamp(update.rating, 100, 3500);
      next.deviation = update.deviation;
      next.lastRatedAt = now;
    }
    const attempt = normalizeAttempt({
      id: puzzle.id, at: now, puzzleRating: puzzle.rating, win: !!result.win, rated, hinted: !!result.hinted,
      delta: Math.round(next.rating) - Math.round(before), ratingAfter: next.rating, themes: puzzle.themes, ms: result.ms || 0
    });
    next.history.push(attempt);
    next.history = next.history.slice(-HISTORY_LIMIT);
    next.updatedAt = now;
    return { state: next, attempt };
  }

  function isProvisional(state, now) {
    return currentDeviation(state, now || Date.now()) > 110;
  }

  function puzzleMatchesGroup(puzzle, groupId) {
    const group = THEME_GROUPS.find(row => row.id === groupId);
    if (!group || !group.keys.length) return true;
    return puzzle.themes.some(theme => group.keys.includes(theme));
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Choose a puzzle close to the target rating. The window widens until
  // enough candidates exist; recent puzzles are skipped unless the filtered
  // pool has nothing else.
  function selectPuzzle(puzzles, opts) {
    const options = opts || {};
    const rng = options.rng || Math.random;
    const target = finiteOr(options.target, START_RATING);
    const exclude = options.exclude || new Set();
    const pool = puzzles.filter(p => puzzleMatchesGroup(p, options.group || 'all'));
    if (!pool.length) return null;
    const fresh = pool.filter(p => !exclude.has(p.id));
    const source = fresh.length ? fresh : pool;
    let window = finiteOr(options.window, 100);
    let candidates = [];
    while (window <= 3000) {
      candidates = source.filter(p => Math.abs(p.rating - target) <= window);
      if (candidates.length >= (options.minCandidates || 8)) break;
      window += 100;
    }
    if (!candidates.length) candidates = source;
    return candidates[Math.floor(rng() * candidates.length) % candidates.length];
  }

  function recentIds(state, limit) {
    return new Set(normalizeState(state).history.slice(-(limit || RECENT_EXCLUSION)).map(row => row.id));
  }

  // The daily puzzle is the same for everyone on a given calendar day and
  // stays near intermediate strength.
  function dailyPuzzle(puzzles, dayKey) {
    const pool = puzzles.filter(p => p.rating >= 1100 && p.rating <= 1900);
    const source = pool.length ? pool : puzzles;
    if (!source.length) return null;
    return source[hashString('daily:' + dayKey) % source.length];
  }

  function dayKey(date) {
    const d = date || new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Solution checking. moves[0] is the opponent's set-up move; the solver
  // plays the odd indexes. Lichess accepts any move that delivers mate, so a
  // different mating move also counts as solving the puzzle.
  function checkSolverMove(ChessCtor, puzzle, ply, uci) {
    const expected = puzzle.moves[ply];
    if (!expected || ply % 2 !== 1) return { ok: false, reason: 'not-solver-turn' };
    const board = new ChessCtor(puzzle.fen);
    for (let i = 0; i < ply; i++) {
      if (!applyUci(board, puzzle.moves[i])) return { ok: false, reason: 'bad-data' };
    }
    const normalized = normalizeUci(board, uci);
    if (!normalized) return { ok: false, reason: 'illegal' };
    if (normalized === expected) return { ok: true, uci: normalized, complete: ply + 1 >= puzzle.moves.length };
    const move = applyUci(board, normalized);
    if (move && board.in_checkmate()) return { ok: true, uci: normalized, complete: true, alternative: true };
    return { ok: false, reason: 'wrong', uci: normalized };
  }

  function applyUci(board, uci) {
    if (!uci || uci.length < 4) return null;
    return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  }

  // Accept a promotion without a suffix only when it is the queen. Returns
  // the legal move as UCI, or null.
  function normalizeUci(board, uci) {
    const m = String(uci || '').toLowerCase().match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (!m) return null;
    const legal = board.moves({ verbose: true }).find(move => move.from === m[1] && move.to === m[2] &&
      (!move.promotion || move.promotion === (m[3] || 'q')));
    return legal ? legal.from + legal.to + (legal.promotion || '') : null;
  }

  // Puzzle Rush: ratings climb with each solve so the run ends naturally.
  const RUSH_MODES = {
    three: { label: '3 minutes', seconds: 180, strikes: 3 },
    five: { label: '5 minutes', seconds: 300, strikes: 3 },
    survival: { label: 'Survival', seconds: 0, strikes: 3 }
  };

  function rushTarget(solved, start) {
    return Math.min(2700, (start || 600) + solved * 65 + Math.floor(solved * solved * 1.5));
  }

  function rushPuzzle(puzzles, solved, used, rng, start) {
    return selectPuzzle(puzzles, { target: rushTarget(solved, start), exclude: used, rng, window: 75, minCandidates: 4 });
  }

  // Strengths and weaknesses by theme from recent rated attempts. A theme
  // needs a few attempts before it is listed, and the solve rate is shown
  // with its sample size.
  function themeStats(state, opts) {
    const options = opts || {};
    const minAttempts = options.minAttempts || 4;
    const rows = normalizeState(state).history.filter(row => row.rated).slice(-(options.window || 200));
    const byTheme = new Map();
    rows.forEach(row => {
      row.themes.filter(theme => !DESCRIPTIVE.has(theme)).forEach(theme => {
        const cur = byTheme.get(theme) || { theme, attempts: 0, wins: 0, ratingSum: 0 };
        cur.attempts++;
        if (row.win) cur.wins++;
        cur.ratingSum += row.puzzleRating;
        byTheme.set(theme, cur);
      });
    });
    const overall = rows.length ? rows.filter(r => r.win).length / rows.length : 0;
    const list = Array.from(byTheme.values()).filter(row => row.attempts >= minAttempts).map(row => ({
      theme: row.theme, label: themeLabel(row.theme), attempts: row.attempts, wins: row.wins,
      rate: row.wins / row.attempts, averageRating: Math.round(row.ratingSum / row.attempts)
    }));
    const strengths = list.filter(row => row.rate >= overall).sort((a, b) => b.rate - a.rate || b.attempts - a.attempts).slice(0, 3);
    const weaknesses = list.filter(row => row.rate < overall).sort((a, b) => a.rate - b.rate || b.attempts - a.attempts).slice(0, 3);
    return { attempts: rows.length, overall, strengths, weaknesses };
  }

  // Coach insight tags (app.js INSIGHT_TAG_META) → the puzzle theme that
  // trains the same skill. Tags without a clear tactical twin map to none.
  const INSIGHT_GROUPS = {
    missed_mate: 'mate', missed_check: 'mate', back_rank: 'mate',
    missed_capture: 'hanging', missed_recapture: 'hanging', hung_material: 'hanging', piece_left_en_prise: 'hanging',
    missed_promotion: 'pawns', pawn_structure: 'pawns',
    allowed_mate: 'quiet', allowed_forcing: 'quiet',
    fork_risk: 'fork', pin_pressure: 'pin-skewer', unsafe_trade: 'defender',
    premature_queen: 'opening', development: 'opening', opening_principles: 'opening',
    king_safety: 'attack', time_to_castle: 'attack',
    endgame_technique: 'endgame'
  };
  function groupForInsightTag(tag) {
    return INSIGHT_GROUPS[tag] || null;
  }
  function groupLabel(id) {
    const group = THEME_GROUPS.find(row => row.id === id);
    return group ? group.label : '';
  }

  function groupForTheme(theme) {
    const group = THEME_GROUPS.find(row => row.keys.includes(theme));
    return group ? group.id : 'all';
  }

  // Current run of consecutive first-try solves among rated attempts.
  function currentStreak(state) {
    const rows = normalizeState(state).history.filter(row => row.rated);
    let streak = 0;
    for (let i = rows.length - 1; i >= 0 && rows[i].win; i--) streak++;
    return streak;
  }

  function todaySummary(state, now) {
    const today = dayKey(new Date(now || Date.now()));
    const rows = normalizeState(state).history.filter(row => dayKey(new Date(row.at)) === today && row.rated);
    return { attempts: rows.length, wins: rows.filter(row => row.win).length,
      delta: rows.reduce((sum, row) => sum + row.delta, 0) };
  }

  // Vision trainer: name squares quickly. Squares are uniform at random but
  // never repeat back to back.
  const FILES = 'abcdefgh';
  function randomSquare(rng, previous) {
    let sq = previous;
    let guard = 0;
    while (sq === previous && guard++ < 10) {
      const n = Math.floor((rng || Math.random)() * 64) % 64;
      sq = FILES[n % 8] + String(Math.floor(n / 8) + 1);
    }
    return sq;
  }

  function squareColor(square) {
    const file = FILES.indexOf(square[0]);
    const rank = Number(square[1]) - 1;
    return (file + rank) % 2 === 0 ? 'dark' : 'light';
  }

  function recordRun(state, kind, mode, score, mistakes, now) {
    const next = normalizeState(state);
    const bucket = next[kind];
    const isBest = score > (bucket.best[mode] || 0);
    if (isBest) bucket.best[mode] = score;
    bucket.runs.push({ at: now, mode, score, mistakes });
    bucket.runs = bucket.runs.slice(-50);
    next.updatedAt = now;
    return { state: next, isBest };
  }

  const api = {
    STATE_VERSION, START_RATING, THEMES, THEME_GROUPS, RUSH_MODES,
    themeLabel, themeNote, parsePuzzle, emptyState, normalizeState, mergeStates, compactState,
    currentDeviation, glickoUpdate, recordAttempt, isProvisional,
    puzzleMatchesGroup, selectPuzzle, recentIds, dailyPuzzle, dayKey, hashString, mulberry32,
    checkSolverMove, normalizeUci, applyUci, rushTarget, rushPuzzle,
    themeStats, groupForTheme, groupForInsightTag, groupLabel, INSIGHT_GROUPS, currentStreak, todaySummary, randomSquare, squareColor, recordRun
  };
  root.PuzzleCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
