#!/usr/bin/env node

// Executable practice grading checks using vendored chess.js and a deterministic
// engine stub. Browser smoke covers the full UI handoff; this covers scoring
// boundaries and immediate-mate safety without starting a worker.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const errors = [];
let assertions = 0;
function assert(condition, message) { assertions += 1; if (!condition) errors.push(message); }

function findStart(name) {
  for (const marker of [`\nfunction ${name}(`, `\nasync function ${name}(`]) {
    const index = app.indexOf(marker);
    if (index !== -1) return index + 1;
  }
  throw new Error(`Could not locate ${name}`);
}
function matchingBrace(source, open) {
  let depth = 0; let mode = 'code';
  for (let i = open; i < source.length; i += 1) {
    const c = source[i]; const next = source[i + 1];
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
  throw new Error('Unmatched function brace');
}
function extract(name) {
  const start = findStart(name); const open = app.indexOf('{', start);
  return app.slice(start, matchingBrace(app, open) + 1);
}
function extractConst(name) {
  const marker = `\nconst ${name} = `; const index = app.indexOf(marker);
  if (index < 0) throw new Error(`Could not locate ${name}`);
  const end = app.indexOf(';', index + marker.length);
  return app.slice(index + 1, end + 1);
}

const code = [
  extractConst('PRACTICE_SOUND_LOSS_CP'),
  extractConst('PRACTICE_INACCURACY_LOSS_CP'),
  extract('fenSideToUserSide'), extract('practiceMoveFor'), extract('practiceIdeaForMove'), extract('practicePromptForItem'), extract('practiceHintForSession'),
  extract('practiceUciEqual'), extract('practiceEngineScore'),
  extract('practiceAfterMoveScore'), extract('practiceMoveIsMate'),
  extract('evaluatePracticeMove')
].join('\n\n') + '\nthis.evaluatePracticeMove = evaluatePracticeMove;';
new vm.Script(code, { filename: 'app.js#practice-upgrades' });

const context = {
  Chess,
  PIECE_NAME: { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' },
  moveFromUci: (fen, uci) => new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }),
  coachGame: new Chess(),
  coachPracticeSession: null,
  coachGameActive: true,
  coachGameGeneration: 1,
  engineClient: { evaluate: async () => ({ info: { cp: 0, pv: ['a7a6'] } }) },
  scoreToCp: info => info.mate != null ? (info.mate > 0 ? 10000 - info.mate : -10000 - info.mate) : (info.cp || 0)
};
vm.createContext(context);
vm.runInContext(code, context);
context.practicePositionIsCurrent = () => true;

function makeSession(known, bestCp, extra = {}) {
  const fen = new Chess().fen();
  return Object.assign({
    item: { entry: { bestUci: 'e2e4', fenBefore: fen } }, expectedUci: 'e2e4',
    analysis: { fen, bestCp, bestMate: null, known, pv: [] }, completed: false
  }, extra);
}

(async () => {
  const hintSession = makeSession({}, 0);
  assert(context.practicePromptForItem(hintSession.item).includes('opponent threatening'), 'practice must ask for a candidate scan before hinting');
  assert(!context.practicePromptForItem(hintSession.item).includes('e4'), 'initial prompt must not give away the move');
  const authored = {...hintSession.item, meta: { practice: 'Find the immediate checkmate.' }};
  assert(context.practicePromptForItem(authored).includes('Find the immediate checkmate.'), 'authored objectives must appear before asking for a move');
  assert(context.practiceHintForSession(hintSession, 1).includes('centre'), 'first hint must introduce the central-play idea');
  assert(context.practiceHintForSession(hintSession, 2).includes('e2'), 'piece hint must locate the pawn');
  assert(context.practiceHintForSession(hintSession, 3).includes('e4'), 'destination hint must name e4');
  assert(context.practiceHintForSession(hintSession, 4).startsWith('Answer: e4.'), 'answer must reveal legal SAN');
  let session = makeSession({ d2d4: -50 }, 0);
  context.coachPracticeSession = session; context.coachGame = new Chess();
  let result = await context.evaluatePracticeMove(session, 'd2d4');
  assert(result.sound === true, 'sound alternatives within 80cp should be accepted');

  session = makeSession({ f2f3: -130 }, 0); context.coachPracticeSession = session;
  result = await context.evaluatePracticeMove(session, 'f2f3');
  assert(result.sound === false && result.inaccurate === true, 'inaccurate alternatives should stay incorrect');

  session = makeSession({}, null); context.coachPracticeSession = session;
  result = await context.evaluatePracticeMove(session, 'f2f3');
  assert(result.unknown === true, 'missing engine scores should remain ungraded');

  const mateFen = '7k/8/5KQ1/8/8/8/8/8 w - - 0 1';
  session = makeSession({ g6e4: 9950, g6g7: 9999 }, 9999, {
    item: { entry: { bestUci: 'g6g7', fenBefore: mateFen } }, expectedUci: 'g6g7',
    analysis: { fen: mateFen, bestCp: 9999, bestMate: 1, known: { g6e4: 9950 }, pv: [] }
  });
  context.coachPracticeSession = session; context.coachGame = new Chess(mateFen);
  result = await context.evaluatePracticeMove(session, 'g6e4');
  assert(result.sound === false && result.loss >= 250, 'missing an immediate mate should be bad');

  assert(/completionRecorded/.test(app), 'completion must be guarded against duplicate recording');
  assert(/entry\.continuation[\s\S]{0,700}followupUci/.test(app), 'authored continuation must be bounded and legal');
  assert(/captureCoachPracticeReturnState[\s\S]{0,500}!coachGameActive \|\| coachGame\.game_over\(\)/.test(app), 'ended games must not be restored');
  assert(/id="btn-coach-practice-hint"/.test(html), 'practice must expose a separate hint action');

  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`Practice-upgrade validation passed (${assertions} assertions).`);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
