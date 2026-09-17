#!/usr/bin/env node

// Focused executable checks for the Coach review teaching layer. The replay
// builder is sliced from app.js and run with the same vendored chess.js used by
// the browser, so these checks exercise legal move generation rather than only
// matching source text.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const errors = [];
let assertions = 0;

function assert(condition, message) {
  assertions += 1;
  if (!condition) errors.push(message);
}

function findFunctionStart(name) {
  for (const marker of [`\nfunction ${name}(`, `\nasync function ${name}(`]) {
    const index = app.indexOf(marker);
    if (index !== -1) return index + 1;
  }
  throw new Error(`Could not locate function ${name} in app.js`);
}

function findMatchingBrace(source, openBrace) {
  let depth = 0;
  let mode = 'code';
  for (let i = openBrace; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === 'line') { if (c === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (c === '*' && next === '/') { mode = 'code'; i += 1; } continue; }
    if (mode === 'single' || mode === 'double') {
      if (c === '\\') { i += 1; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"')) mode = 'code';
      continue;
    }
    if (c === '/' && next === '/') { mode = 'line'; i += 1; continue; }
    if (c === '/' && next === '*') { mode = 'block'; i += 1; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '{') depth += 1;
    if (c === '}' && --depth === 0) return i;
  }
  throw new Error('Unmatched function brace in app.js');
}

function extractFunction(name) {
  const start = findFunctionStart(name);
  const openBrace = app.indexOf('{', start);
  return app.slice(start, findMatchingBrace(app, openBrace) + 1);
}

const builderCode = extractFunction('buildCoachReviewAnalysisSteps');
new vm.Script(builderCode, { filename: 'app.js#review-teaching-slice' });
const context = { Chess };
vm.createContext(context);
vm.runInContext(`${builderCode}\nthis.buildCoachReviewAnalysisSteps = buildCoachReviewAnalysisSteps;`, context);

const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const legalReview = {
  fenBefore: startFen,
  bestUci: 'e2e4',
  evalBefore: { pv: ['e2e4', 'e7e5', 'g1f3', 'b8c6'] }
};

// Every generated FEN must load and every generated step must be a legal
// continuation of the preceding step.
const steps = context.buildCoachReviewAnalysisSteps(legalReview);
assert(steps.length === 5, `legal PV should produce start plus four legal steps (got ${steps.length})`);
let replay = new Chess(startFen);
for (let i = 0; i < steps.length; i += 1) {
  assert(new Chess(steps[i].fen).fen() === steps[i].fen, `step ${i} must contain a valid FEN`);
  if (i === 0) continue;
  const move = replay.move({ from: steps[i].move.from, to: steps[i].move.to, promotion: steps[i].move.promotion });
  assert(!!move, `step ${i} must be legal from the prior replay position`);
  assert(replay.fen() === steps[i].fen, `step ${i} FEN must match the applied move`);
}

// A stale or truncated PV must stop at the first illegal continuation; later
// UCI entries must never be skipped into the displayed line.
const stopped = context.buildCoachReviewAnalysisSteps({
  fenBefore: startFen,
  bestUci: 'e2e4',
  evalBefore: { pv: ['e2e4', 'e7e5', 'a1a1', 'g1f3'] }
});
assert(stopped.length === 3, `invalid continuation should stop replay at the prior legal step (got ${stopped.length})`);
assert(stopped[stopped.length - 1].san === 'e5', 'replay must stop after the legal e5 continuation');

// Building analysis steps must not edit the actual game or its PGN.
const live = new Chess(startFen);
live.move('e4');
live.move('e5');
live.move('Nf3');
const livePgn = live.pgn();
context.buildCoachReviewAnalysisSteps(legalReview);
assert(live.pgn() === livePgn, 'analysis replay must preserve the live game PGN');

// Static interaction guards: drag, drop, tap, review navigation, and reset
// must all treat the transient analysis layer as review mode and clear it.
assert(/function coachIsReviewing\(\)\s*\{[\s\S]{0,120}if \(coachReviewAnalysis\) return true/.test(app), 'analysis mode must count as coach review mode');
assert(/function startCoachReviewAnalysis\(review\)[\s\S]{0,500}if \(coachGameActive && !coachIsUserTurn\(\)\) return/.test(app), 'live analysis must require the human turn while ended reviews remain explainable');
assert(/const canExplain = [\s\S]{0,260}!coachGameActive \|\| coachIsUserTurn\(\)/.test(app), 'Show why must remain available for an ended or imported review');
assert(/onDragStart:[\s\S]{0,500}if \(coachIsReviewing\(\)\) return false/.test(app), 'drag input must be blocked during analysis');
assert(/onDrop:[\s\S]{0,650}if \(coachIsReviewing\(\)\) return 'snapback'/.test(app), 'drop input must snap back during analysis');
assert(/#coachBoard \.square-55d63[\s\S]{0,180}coachIsReviewing\(\)/.test(app), 'tap input must be ignored during analysis');
assert(/function invalidateCoachAsyncWork[\s\S]{0,220}clearCoachReviewAnalysis\(\{ restore: false \}\)[\s\S]{0,180}engineClient\.cancel/.test(app), 'reset invalidation must clear analysis before cancelling engine work');
assert(/function coachGotoPly\(n\)[\s\S]{0,120}clearCoachReviewAnalysis\(\{ restore: false \}\)/.test(app), 'history navigation must leave analysis mode safely');
assert(/function coachGotoLive\(\)[\s\S]{0,120}clearCoachReviewAnalysis\(\{ restore: false \}\)/.test(app), 'Back to live must clear analysis mode');
assert(/coachReviewAnalysis = null/.test(app), 'reset state must clear the analysis reference');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Review-teaching validation passed (${assertions} assertions).`);
