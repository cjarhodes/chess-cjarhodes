#!/usr/bin/env node
// Puzzle trainer: replay every shipped puzzle as legal chess and exercise the
// rating, selection, Rush, Vision and merge logic in puzzles-core.js.
const path = require('path');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');
const core = require(path.join(__dirname, '..', 'puzzles-core.js'));
const data = require(path.join(__dirname, '..', 'puzzle-data.js'));

let checks = 0;
const failures = [];
const assert = (ok, message) => { checks++; if (!ok) failures.push(message); };

// ── Data ──────────────────────────────────────
const puzzles = data.map(core.parsePuzzle);
assert(puzzles.length >= 2000, `expected at least 2000 puzzles, found ${puzzles.length}`);
assert(puzzles.every(Boolean), 'a puzzle row failed to parse');
const ids = new Set();
puzzles.forEach(p => {
  if (!p) return;
  assert(!ids.has(p.id), 'duplicate puzzle id ' + p.id);
  ids.add(p.id);
  assert(p.moves.length % 2 === 0, `puzzle ${p.id} should end on a solver move`);
  const board = new Chess();
  assert(board.load(p.fen), `puzzle ${p.id} has an invalid FEN`);
  let legal = true;
  p.moves.forEach(uci => { if (legal && !core.applyUci(board, uci)) legal = false; });
  assert(legal, `puzzle ${p.id} contains an illegal move`);
  if (legal && p.themes.includes('mate')) assert(board.in_checkmate(), `mate puzzle ${p.id} does not end in mate`);
  // Every solver move in the shipped line must be accepted by the checker.
  for (let ply = 1; ply < p.moves.length; ply += 2) {
    const result = core.checkSolverMove(Chess, p, ply, p.moves[ply]);
    assert(result.ok, `puzzle ${p.id} rejects its own solution at ply ${ply}`);
  }
});
const lowest = Math.min(...puzzles.map(p => p.rating)), highest = Math.max(...puzzles.map(p => p.rating));
assert(lowest < 700 && highest > 2400, `rating range ${lowest}-${highest} is too narrow`);
core.THEME_GROUPS.forEach(group => {
  const count = puzzles.filter(p => core.puzzleMatchesGroup(p, group.id)).length;
  assert(count >= 40, `theme group ${group.id} has only ${count} puzzles`);
});

// ── Solution checking ─────────────────────────
const mateIn1 = puzzles.find(p => p.themes.includes('mateIn1'));
const first = core.checkSolverMove(Chess, mateIn1, 1, mateIn1.moves[1]);
assert(first.ok && first.complete, 'mate in one should complete on the right move');
assert(core.checkSolverMove(Chess, mateIn1, 0, mateIn1.moves[0]).reason === 'not-solver-turn', 'opponent ply was graded');
assert(core.checkSolverMove(Chess, mateIn1, 1, 'a1a1').reason === 'illegal', 'illegal move was not rejected');
// A position with two mates in one: either mate solves the puzzle.
const twoMates = { id: 'x', fen: '6k1/2p2ppp/8/8/8/8/8/R3R1K1 b - - 0 1', moves: ['c7c6', 'a1a8'], rating: 800, themes: ['mate'] };
const alt = core.checkSolverMove(Chess, twoMates, 1, 'e1e8');
assert(alt.ok && alt.alternative && alt.complete, 'an alternative mating move should solve the puzzle');
const wrong = core.checkSolverMove(Chess, twoMates, 1, 'a1a7');
assert(!wrong.ok && wrong.reason === 'wrong', 'a non-mating alternative should be wrong');
// Promotions: the bare move means queen; an underpromotion needs its suffix.
const promo = { id: 'p', fen: '8/4P1k1/8/8/8/8/8/4K3 b - - 0 1', moves: ['g7g6', 'e7e8n'], rating: 1500, themes: [] };
assert(!core.checkSolverMove(Chess, promo, 1, 'e7e8').ok, 'queen promotion accepted for an underpromotion answer');
assert(core.checkSolverMove(Chess, promo, 1, 'e7e8n').ok, 'underpromotion answer rejected');

// ── Rating ────────────────────────────────────
const now = Date.UTC(2026, 10, 5);
let state = core.emptyState();
const easy = { id: 'e', rating: 900, themes: ['fork'] }, hard = { id: 'h', rating: 1600, themes: ['fork'] };
const winEasy = core.recordAttempt(state, easy, { win: true }, now).attempt.delta;
const winHard = core.recordAttempt(state, hard, { win: true }, now).attempt.delta;
const loseEasy = core.recordAttempt(state, easy, { win: false }, now).attempt.delta;
const loseHard = core.recordAttempt(state, hard, { win: false }, now).attempt.delta;
assert(winHard > winEasy && winEasy > 0, 'beating a harder puzzle should gain more');
assert(loseEasy < loseHard && loseHard < 0, 'failing an easier puzzle should cost more');
const replay = core.recordAttempt(state, hard, { win: true, rated: false }, now);
assert(replay.attempt.delta === 0 && replay.state.rating === state.rating && replay.state.history.length === 1, 'unrated replays changed the rating or were not recorded');
let rolling = core.emptyState();
for (let i = 0; i < 40; i++) rolling = core.recordAttempt(rolling, { id: 'r' + i, rating: 1500, themes: ['pin'] }, { win: i % 2 === 0 }, now + i).state;
assert(Math.abs(rolling.rating - 1500) < 120, `50% against 1500 should settle near 1500, got ${Math.round(rolling.rating)}`);
assert(rolling.deviation < 110 && !core.isProvisional(rolling, now + 50), 'deviation should fall below provisional after 40 attempts');
assert(core.currentDeviation(rolling, now + 200 * 86400000) > rolling.deviation + 50, 'deviation should grow after time away');
assert(core.isProvisional(core.emptyState(), now), 'a new player should be provisional');

// ── Normalization and merge ───────────────────
const junk = core.normalizeState({ v: 1, rating: 'x', deviation: -5, history: [null, { id: 3 }, { id: 'ok', at: 5, delta: 9999, themes: ['fork', 7] }], rush: { best: { three: -1, five: 12 } }, daily: { bad: 1, '2026-11-05': { id: 'a', solved: 1 } } });
assert(junk.rating === core.START_RATING && junk.deviation >= 60, 'invalid rating values were kept');
assert(junk.history.length === 1 && junk.history[0].delta === 400 && junk.history[0].themes.length === 1, 'history rows were not cleaned');
assert(junk.rush.best.five === 12 && !('three' in junk.rush.best), 'invalid best scores were kept');
assert(Object.keys(junk.daily).length === 1 && junk.daily['2026-11-05'].solved === true, 'daily rows were not cleaned');
assert(core.normalizeState({ v: 99, rating: 2000 }).rating === core.START_RATING, 'unknown versions should reset');
const a = core.recordAttempt(core.emptyState(), easy, { win: true }, now).state;
const b = core.recordAttempt(core.recordRun(core.emptyState(), 'rush', 'three', 14, 3, now + 5).state, hard, { win: false }, now + 10).state;
const merged = core.mergeStates(a, b);
assert(merged.history.length === 2 && merged.rating === b.rating, 'merge should union attempts and keep the latest rating');
assert(merged.rush.best.three === 14, 'merge lost a Rush best');
assert(core.mergeStates(merged, merged).history.length === 2, 'merging a copy duplicated attempts');

// ── Selection ─────────────────────────────────
const rng = core.mulberry32(42);
for (let i = 0; i < 30; i++) {
  const pick = core.selectPuzzle(puzzles, { target: 1500, rng });
  assert(Math.abs(pick.rating - 1500) <= 200, `selection strayed to ${pick.rating} for a 1500 target`);
}
const forkPick = core.selectPuzzle(puzzles, { target: 1400, group: 'fork', rng });
assert(forkPick.themes.includes('fork'), 'theme filter ignored');
const exclude = new Set(puzzles.filter(p => Math.abs(p.rating - 1500) < 400).map(p => p.id));
const freshPick = core.selectPuzzle(puzzles, { target: 1500, exclude, rng });
assert(!exclude.has(freshPick.id), 'recently seen puzzle repeated while others were available');
assert(core.selectPuzzle([], {}) === null, 'empty pool should return null');
const day1 = core.dailyPuzzle(puzzles, '2026-11-05'), day1b = core.dailyPuzzle(puzzles, '2026-11-05'), day2 = core.dailyPuzzle(puzzles, '2026-11-06');
assert(day1.id === day1b.id && day1.id !== day2.id, 'daily puzzle should be stable within a day and change across days');
assert(core.dayKey(new Date(2026, 0, 3)) === '2026-01-03', 'day key format');

// ── Rush ──────────────────────────────────────
let last = 0;
for (let solved = 0; solved < 40; solved++) {
  const target = core.rushTarget(solved);
  assert(target >= last, 'Rush difficulty should never fall');
  last = target;
}
assert(core.rushTarget(0) < 800 && core.rushTarget(30) > 2000, 'Rush ladder range');
const used = new Set();
for (let solved = 0; solved < 25; solved++) {
  const pick = core.rushPuzzle(puzzles, solved, used, rng);
  assert(!used.has(pick.id), 'Rush repeated a puzzle within a run');
  used.add(pick.id);
}
const run = core.recordRun(core.emptyState(), 'rush', 'three', 20, 3, now);
assert(run.isBest && run.state.rush.best.three === 20, 'first run should set a best');
assert(!core.recordRun(run.state, 'rush', 'three', 12, 3, now + 1).isBest, 'a lower score should not be a best');

// ── Stats ─────────────────────────────────────
let statsState = core.emptyState();
for (let i = 0; i < 8; i++) statsState = core.recordAttempt(statsState, { id: 'f' + i, rating: 1200, themes: ['fork', 'short'] }, { win: true }, now + i).state;
for (let i = 0; i < 8; i++) statsState = core.recordAttempt(statsState, { id: 'p' + i, rating: 1200, themes: ['pin', 'short'] }, { win: i < 2 }, now + 10 + i).state;
const stats = core.themeStats(statsState);
assert(stats.strengths[0].theme === 'fork' && stats.weaknesses[0].theme === 'pin', 'strengths and weaknesses misordered');
assert(!stats.strengths.concat(stats.weaknesses).some(row => row.theme === 'short'), 'length tags should not be a strength');
assert(core.groupForTheme('pin') === 'pin-skewer', 'weak theme should map to a practice group');
assert(core.currentStreak(statsState) === 0, 'streak should end on a miss');
assert(core.themeLabel('discoveredAttack') === 'Discovered attack' && core.themeLabel('someNewTheme') === 'Some new theme', 'theme labels');

// ── Vision ────────────────────────────────────
let prev = null;
for (let i = 0; i < 200; i++) {
  const sq = core.randomSquare(rng, prev);
  assert(/^[a-h][1-8]$/.test(sq) && sq !== prev, 'vision square invalid or repeated');
  prev = sq;
}
assert(core.squareColor('a1') === 'dark' && core.squareColor('h1') === 'light' && core.squareColor('e4') === 'light', 'square colours');

if (failures.length) {
  console.error(`Puzzle validation failed (${failures.length} of ${checks} checks):`);
  failures.slice(0, 40).forEach(f => console.error(' - ' + f));
  process.exit(1);
}
console.log(`Puzzle validation passed: ${puzzles.length} puzzles replayed, ${checks} checks.`);
