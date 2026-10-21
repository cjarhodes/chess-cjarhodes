#!/usr/bin/env node
// Focused, dependency-free behavioral checks for the calibrated Coach selector.
// This deliberately extracts only the selector slice from app.js, so it can be
// run without loading the browser UI or engine worker.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(repo, 'app.js'), 'utf8');

function sliceFunction(src, name) {
  const re = new RegExp('(?:^|\\n)(?:async )?function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error('missing function ' + name);
  let i = src.indexOf('{', m.index);
  let depth = 0;
  let quote = null;
  let line = false;
  let block = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
    if (quote) { if (c === '\\') { j++; continue; } if (c === quote) quote = null; continue; }
    if (c === '/' && n === '/') { line = true; continue; }
    if (c === '/' && n === '*') { block = true; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return src.slice(m.index, j + 1);
  }
  throw new Error('unterminated function ' + name);
}

function sliceConst(src, name) {
  const start = src.indexOf('const ' + name + ' = ');
  if (start < 0) throw new Error('missing const ' + name);
  const end = src.indexOf('];', start);
  if (end < 0) throw new Error('unterminated const ' + name);
  return src.slice(start, end + 2);
}

const ctx = { Math, Number, Object, Set, Array, console };
const context = vm.createContext(ctx);
vm.runInContext([
  sliceFunction(app, 'scoreToCp'),
  sliceConst(app, 'COACH_DIFFICULTY_KEYFRAMES'),
  sliceFunction(app, 'interpolateDifficultyField'),
  sliceFunction(app, 'coachStrengthOpts'),
  sliceFunction(app, 'calibratedOpponentCandidates'),
  sliceFunction(app, 'chooseCalibratedOpponentMove'),
  'globalThis.api = { scoreToCp, coachStrengthOpts, calibratedOpponentCandidates, chooseCalibratedOpponentMove, COACH_DIFFICULTY_KEYFRAMES };'
].join('\n'), context, { filename: 'app-selector-slice.js' });
const api = ctx.api;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}
function approx(value, low, high, message) {
  check(value >= low && value <= high, `${message}: ${value} not in [${low}, ${high}]`);
}
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
function resultFrom(scores, extras = {}) {
  return Object.assign({
    lines: scores.map((score, i) => ({ cp: score, pv: ['m' + i] }))
  }, extras);
}
function tally(result, config, samples, seed) {
  const random = rng(seed);
  const counts = new Map();
  let totalLoss = 0;
  for (let i = 0; i < samples; i++) {
    const move = api.chooseCalibratedOpponentMove(result, config, random);
    counts.set(move, (counts.get(move) || 0) + 1);
    const line = api.calibratedOpponentCandidates(result).find(x => x.uci === move);
    totalLoss += line ? line.loss : 0;
  }
  return { counts, meanLoss: totalLoss / samples };
}

// Candidates are sorted by score, duplicate/invalid lines are discarded, and
// losses are always measured against the strongest valid candidate.
const ordered = api.calibratedOpponentCandidates({ lines: [
  { cp: -80, pv: ['c'] }, { cp: 40, pv: ['a'] }, { cp: null, pv: ['bad'] },
  { cp: 40, pv: ['a'] }, { mate: -2, pv: ['mate'] }, { cp: -20, pv: ['b'] }
] });
check(ordered.map(x => x.uci).join(',') === 'a,b,c,mate', 'candidates are not score-sorted and de-duplicated');
check(ordered[0].loss === 0 && ordered[1].loss === 60 && ordered[2].loss === 120, 'candidate losses are incorrect');

// The lowest level must still retain the engine move at its configured rate;
// it should not become an always-weak opponent.
const low = api.coachStrengthOpts(400);
const lowResult = resultFrom([0, -40, -100, -500, -800]);
const lowStats = tally(lowResult, low, 4000, 11);
approx((lowStats.counts.get('m0') || 0) / 4000, 0.30, 0.60, 'low-level best-move probability');

// Error selection should favor modest slips over a catastrophic candidate and
// should never exceed the configured loss cap.
const bounded = resultFrom([0, -40, -100, -500, -800]);
const boundedConfig = { errorRate: 1, errorSize: 240 };
const boundedStats = tally(bounded, boundedConfig, 4000, 22);
const catastrophic = boundedStats.counts.get('m4') || 0;
check(catastrophic === 0, 'catastrophic candidate exceeded the error cap');
const capBoundary = tally(resultFrom([0, -500, -501]), { errorRate: 1, errorSize: 1000 }, 4000, 23);
check((capBoundary.counts.get('m1') || 0) > 0 && !capBoundary.counts.has('m2'), 'absolute 500cp cap boundary is not enforced');
check((boundedStats.counts.get('m1') || 0) + (boundedStats.counts.get('m2') || 0) >
      (boundedStats.counts.get('m3') || 0), 'small errors are not preferred to the largest bounded error');

// Mate handling: do not spend a winning mate as an ordinary error; when all
// moves lose, select the line that delays mate; if a CP move exists, avoid a
// forced losing mate.
const winningMate = { lines: [
  { mate: 1, pv: ['mate-now'] }, { cp: 600, pv: ['cp'] }, { cp: 0, pv: ['quiet'] }
] };
check(api.chooseCalibratedOpponentMove(winningMate, { errorRate: 1, errorSize: 240 }, () => 0.01) === 'mate-now', 'winning mate was not preserved');
const losingMates = { lines: [
  { mate: -3, pv: ['delay'] }, { mate: -1, pv: ['soon'] }
] };
check(api.chooseCalibratedOpponentMove(losingMates, { errorRate: 1, errorSize: 240 }, () => 0.01) === 'delay', 'longest losing mate was not preferred');
const cpEscape = { lines: [
  { mate: -1, pv: ['mated'] }, { cp: 0, pv: ['escape'] }
] };
check(api.chooseCalibratedOpponentMove(cpEscape, { errorRate: 1, errorSize: 240 }, () => 0.01) === 'escape', 'forced losing mate was selected over a CP alternative');

// Equal-valued alternatives should still receive varied play when an error is
// requested, rather than always returning the first PV.
const equal = resultFrom([0, 0, 0, 0]);
const equalStats = tally(equal, { errorRate: 1, errorSize: 100 }, 1000, 33);
check(equalStats.counts.size >= 3, 'equal-valued alternatives are not varied');

// Higher difficulty must reduce both error frequency and average loss.
const high = api.coachStrengthOpts(2400);
for (let level = 450; level <= 2400; level += 50) {
  const previous = api.coachStrengthOpts(level - 50);
  const current = api.coachStrengthOpts(level);
  check(current.errorRate > 0 && current.errorRate < 1 && current.errorRate <= previous.errorRate &&
    current.errorSize <= previous.errorSize && current.depth >= previous.depth,
    'difficulty curve or sound-move probability failed at ' + level);
}
const highStats = tally(lowResult, high, 4000, 44);
check((highStats.counts.get('m0') || 0) > (lowStats.counts.get('m0') || 0), 'error probability is not monotonic');
check(highStats.meanLoss < lowStats.meanLoss, 'mean loss is not lower at high difficulty');
const smallErrorStats = tally(lowResult, { errorRate: 1, errorSize: 80 }, 4000, 55);
const largeErrorStats = tally(lowResult, { errorRate: 1, errorSize: 360 }, 4000, 55);
check(smallErrorStats.meanLoss < largeErrorStats.meanLoss, 'error size is not monotonic');

console.log(`difficulty selector validation passed (${passed} assertions)`);
