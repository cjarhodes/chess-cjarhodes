#!/usr/bin/env node

// Small behavioural checks for the growth-only upgrades. This runs without a
// browser or Stockfish: it exercises the pure import target builder, transfer
// evidence floor, and every authored endgame start/solution with chess.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const chessSource = fs.readFileSync(path.join(root, 'vendor/chess.js/chess-0.10.3.min.js'), 'utf8');
const growthSource = fs.readFileSync(path.join(root, 'growth.js'), 'utf8');
const DAY_MS = 24 * 60 * 60 * 1000;
const anchor = 1000000000;

let practiceEvents = [{ tag: 'transfer-tag', correct: true, at: anchor }];
const context = {
  console,
  DAY_MS,
  loadPracticeProgress: () => ({ events: practiceEvents }),
  practiceRecordFor: () => null,
  isInsightProblem: tier => ['inaccuracy', 'mistake', 'blunder'].includes(tier),
  uciFromMove: move => move && move.from + move.to + (move.promotion || ''),
  $: () => {},
  window: {}
};
vm.createContext(context);
vm.runInContext(`${chessSource}\nthis.Chess = Chess;`, context);
vm.runInContext(`${growthSource}\nthis.__growthChecks = { personalizeAdaptivePlan, transferMeasurement, collectImportedTargets, endgameLessons: ENDGAME_LESSONS, endgamePracticeItem };`, context);

const checks = context.__growthChecks;
const failures = [];
function assert(condition, message) {
  if (!condition) failures.push(message);
}

function reviewEntries(beforeCount, afterCount, beforeErrors, afterErrors, tier = 'good') {
  const entries = [];
  for (let i = 0; i < beforeCount; i++) entries.push({
    ts: anchor - 1000 - i,
    tier: i < beforeErrors ? 'mistake' : tier,
    tags: i < beforeErrors ? ['transfer-tag'] : []
  });
  for (let i = 0; i < afterCount; i++) entries.push({
    ts: anchor + 1000 + i,
    tier: i < afterErrors ? 'mistake' : tier,
    tags: i < afterErrors ? ['transfer-tag'] : []
  });
  return entries;
}

const insufficient = checks.transferMeasurement(reviewEntries(29, 30, 5, 2), 'transfer-tag');
assert(insufficient && insufficient.enoughEvidence === false, 'transfer comparison claimed evidence below the 30-per-side floor');
assert(insufficient.beforeSamples === 29 && insufficient.afterSamples === 30, 'transfer comparison did not report both sample counts');

const equal = checks.transferMeasurement(reviewEntries(30, 30, 5, 5), 'transfer-tag');
assert(equal && equal.enoughEvidence && equal.direction === 'unchanged', 'equal before/after rates were not reported as unchanged');
assert(equal.change === 0 && equal.beforeSamples === 30 && equal.afterSamples === 30, 'equal transfer comparison returned the wrong change or samples');

const improved = checks.transferMeasurement(reviewEntries(30, 30, 10, 2), 'transfer-tag');
assert(improved && improved.direction === 'improved' && improved.change < 0, 'lower after error rate was not reported as improved');

const games = [];
for (let i = 0; i < 31; i++) {
  const game = new context.Chess();
  game.move('e4');
  game.move('e5');
  games.push({ sourceIndex: i, game });
}
const targets = checks.collectImportedTargets(games, 'white', games.map(() => ({ openingId: null, opening: null })));
assert(targets.length === 31, `multi-game import built ${targets.length} targets instead of all 31 selected-side moves`);
assert(targets[0].gameKey === 'import-1' && targets[30].gameKey === 'import-31', 'multi-game import lost original game identity');
assert(new Set(targets.map(target => target.gameIndex)).size === 31, 'multi-game import collapsed later games onto one index');

checks.endgameLessons.forEach(lesson => {
  const scenarios = [lesson].concat(lesson.scenarios || []);
  scenarios.forEach((scenario, scenarioIndex) => {
    const game = new context.Chess(scenario.fen);
    assert(!game.in_check(), `${lesson.id} scenario ${scenarioIndex} starts with the side to move in check`);
    const pieces = game.board().reduce((all, row) => all.concat(row.filter(Boolean)), []);
    assert(pieces.some(piece => piece.type === 'k' && piece.color === 'w') && pieces.some(piece => piece.type === 'k' && piece.color === 'b'), `${lesson.id} scenario ${scenarioIndex} is missing a king`);
    const opponentTurn = new context.Chess(scenario.fen.replace(' w ', ' b '));
    assert(!opponentTurn.in_check(), `${lesson.id} scenario ${scenarioIndex} starts with the other king already in check`);
    const move = game.move({
      from: scenario.bestUci.slice(0, 2),
      to: scenario.bestUci.slice(2, 4),
      promotion: scenario.bestUci[4] || undefined
    });
    assert(move && move.san === scenario.bestSan, `${lesson.id} scenario ${scenarioIndex} best SAN/UCI mismatch`);
    if (scenario.bestSan.includes('#')) assert(game.in_checkmate(), `${lesson.id} scenario ${scenarioIndex} claims mate without checkmate`);
    (scenario.continuation || []).forEach(step => {
      const opponent = game.move({ from: step.opponentUci.slice(0, 2), to: step.opponentUci.slice(2, 4), promotion: step.opponentUci[4] || undefined });
      const followup = opponent && game.move({ from: step.followupUci.slice(0, 2), to: step.followupUci.slice(2, 4), promotion: step.followupUci[4] || undefined });
      assert(opponent && followup, `${lesson.id} scenario ${scenarioIndex} has an illegal authored continuation`);
    });
  });
});

assert(context.__growthChecks.endgameLessons[0].bestUci === 'g6g7' && context.__growthChecks.endgameLessons[0].bestSan === 'Qg7#', 'canonical queen mate lesson changed');
const canonicalQueen = checks.endgamePracticeItem(checks.endgameLessons[0]);
assert(canonicalQueen.entry.bestUci === 'g6g7' && canonicalQueen.entry.bestSan === 'Qg7#', 'first queen practice item did not retain canonical Qg7#');
context.practiceRecordFor = () => ({ attempts: 1 });
const replayRook = checks.endgamePracticeItem(checks.endgameLessons[1]);
assert(replayRook.entry.bestUci === 'f6g6' && replayRook.entry.continuation.length === 1, 'replayed rook lesson did not expose its authored multi-move continuation');

// Every preference combination must produce a session with reachable targets.
let testProfile;
context.playerProfile = () => testProfile;
context.repertoireFocusOpening = () => null;
for (const sessionStyle of ['balanced', 'drills', 'play']) {
  for (const minutes of [5, 15, 20, 60]) {
    for (const goal of ['balanced', 'tactics']) {
      for (const available of [0, 1, 2, 3]) {
        testProfile = { sessionStyle, minutes, goal };
        const plan = checks.personalizeAdaptivePlan({
          kind: available ? 'focus-transfer' : 'baseline',
          drillTarget: Math.min(2, available), moveTarget: 10,
          orderedDue: Array.from({ length: available }, (_, id) => ({ id }))
        });
        assert(plan.drillTarget <= available, `${sessionStyle}/${minutes}/${goal} requires unavailable drills`);
        assert(plan.moveTarget > 0, 'session lost its live-play step');
        if (sessionStyle === 'play') assert(plan.drillTarget === 0, 'play-first plan requires drills');
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Growth upgrade behavioural validation passed.');
