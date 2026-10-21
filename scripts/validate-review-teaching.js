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

const builderCode = ['buildCoachReviewAnalysisSteps', 'buildCoachConsequenceSteps', 'coachExplanationContext', 'moveFromUci', 'materialValue'].map(extractFunction).join('\n');
new vm.Script(builderCode, { filename: 'app.js#review-teaching-slice' });
const context = { Chess, PIECE_NAME: {p:'Pawn',n:'Knight',b:'Bishop',r:'Rook',q:'Queen',k:'King'} };
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

// Consequence copy and replays must agree with legal board outcomes, and
// avoid treating every capture as a win or every queen move as opening play.
function positionAfter(fen, uci) {
  const game = new Chess(fen);
  assert(!!game.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]}), 'fixture move must be legal');
  return game.fen();
}
const hangingFen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3';
const hanging = context.coachExplanationContext(hangingFen, 'h5e5', 'f1c4', positionAfter(hangingFen, 'h5e5'), {pv:['c6e5']});
assert(hanging.consequence.includes('queen on e5'), 'queen loss must be visible in the consequence');
assert(hanging.lesson.includes('Piece safety') && hanging.cue.includes('destination'), 'queen loss must teach piece safety ahead of development');
assert(!hanging.opponentThreat.includes('wins'), 'a capture alone must not be described as a material win');
const mateFen = '7k/8/5KQ1/8/8/8/8/8 w - - 0 1';
const missed = context.coachExplanationContext(mateFen, 'g6e4', 'g6g7', positionAfter(mateFen, 'g6e4'), {pv:['h8g8']});
assert(missed.consequence.includes('immediate checkmate') && missed.cue.includes('checks'), 'missed mate must connect the immediate opportunity to a future checking scan');
const staleFen = '7k/5K2/6Q1/8/8/8/8/8 w - - 0 1';
const stale = context.coachExplanationContext(staleFen, 'g6f5', 'g6h5', positionAfter(staleFen, 'g6f5'), {pv:[]});
assert(stale.consequence.includes('stalemate, a draw'), 'terminal stalemate must be explained even without a PV');
assert(stale.cue.includes('legal reply'), 'endgame cue must prevent repeating stalemate');
const quietEndgame = context.coachExplanationContext('7k/8/8/8/8/2N5/4K3/8 w - - 0 32', 'e2e3', 'c3e4', '7k/8/8/8/8/2N1K3/8/8 b - - 1 32', null);
assert(!quietEndgame.lesson.includes('Development'), 'an endgame knight reposition must not be described as new development');
const playedBest = context.coachExplanationContext(mateFen, 'g6g7', 'g6g7', positionAfter(mateFen,'g6g7'), null);
assert(playedBest.consequence === '', 'a played checkmate must not be described as a missed mate');
const consequenceReview = { fenBefore: hangingFen, userUci: 'h5e5', evalAfter:{pv:['c6e5','d2d4','a1a1','g1f3']} };
const consequenceSteps = context.buildCoachConsequenceSteps(consequenceReview);
assert(consequenceSteps.length === 4, 'consequence line must stop before the first illegal move');
assert(consequenceSteps[2].san === 'Nxe5', 'consequence replay must show the capture explained in the lesson');
let consequenceGame = new Chess(hangingFen);
for (const step of consequenceSteps.slice(1)) {
  assert(!!consequenceGame.move(step.move), 'every consequence step must be legal');
  assert(consequenceGame.fen() === step.fen, 'consequence FEN must match the replay');
}
const terminalSteps = context.buildCoachConsequenceSteps({fenBefore:staleFen,userUci:'g6f5',evalAfter:{pv:['h8h7']}});
assert(terminalSteps.length === 2 && new Chess(terminalSteps[1].fen).in_stalemate(), 'stalemate replay must stop at the terminal board');
assert(context.buildCoachConsequenceSteps({fenBefore:startFen}).length === 0, 'legacy review without a user move must not invent a consequence');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Review-teaching validation passed (${assertions} assertions).`);
