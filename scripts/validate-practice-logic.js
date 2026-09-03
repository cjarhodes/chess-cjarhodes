#!/usr/bin/env node

// Executable test of the Coach practice scheduling logic in app.js.
//
// Unlike the other scripts/validate-*.js files (which are regex "shape"
// checks against app.js source text), this script follows the vm-slicing
// approach used by validate-openings.js: it extracts real function/const
// declarations out of app.js by name, runs them in a node:vm context with
// minimal stubs, and asserts on their actual runtime behavior.
//
// Functions tested (pure or near-pure — depend only on arguments, module
// constants, a controllable Date.now(), and a fake localStorage):
//   hashPracticeValue, practiceItemId, nextPracticeInterval,
//   practiceProgressStorageKey, emptyPracticeProgress, activePracticeOwnerId,
//   loadPracticeProgress, savePracticeProgress, adoptAnonymousPracticeProgress,
//   practiceRecordFor, practiceIsDue, practiceProgressTotals, practiceDayKey,
//   practiceTrendSnapshot, practiceEventId, createCoachGameId,
//   practiceEventFromAttempt, recordPracticeAttempt, markPracticeEventSynced,
//   hasCoachDbSession, queueRemotePracticeProgressSync (early-return path only).
//
// Functions skipped (cannot be isolated without heavy DOM/jQuery/Supabase
// stubbing, or exercise remote-sync plumbing rather than scheduling math):
//   buildPracticeQueue, practiceItemsForEntries, currentGameDuePracticeItems,
//   formatPracticeContext (need coachReviewLog, insightEntryFromReview,
//   insightTagCounts, INSIGHT_TAG_META, isInsightProblem — insight-tagging
//   concerns, not scheduling arithmetic);
//   renderPracticeTrends (jQuery DOM rendering);
//   syncRemotePracticeEvent, mergeRemotePracticeRecords, handleCoachDbError,
//   setCoachDbStatus, setCoachStatus (Supabase client + DOM status text).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'app.js');
const app = fs.readFileSync(appPath, 'utf8');

const errors = [];
let assertions = 0;

function fail(message) {
  errors.push(message);
}

function assert(condition, message) {
  assertions += 1;
  if (!condition) fail(message);
}

function assertEqual(actual, expected, message) {
  assertions += 1;
  if (actual !== expected) {
    fail(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

// --- Source extraction -------------------------------------------------
//
// Locates `function NAME(` / `async function NAME(` (or `const NAME =` for
// simple single-statement consts) at column 0, then slices to the matching
// closing brace / statement terminator by walking the characters and
// tracking string/template/comment state, so braces or semicolons inside
// string literals don't confuse the scan.

function findFunctionStart(name) {
  const patterns = [`\nfunction ${name}(`, `\nasync function ${name}(`];
  for (const pattern of patterns) {
    const idx = app.indexOf(pattern);
    if (idx !== -1) return idx + 1; // skip the leading \n
  }
  return -1;
}

// Walk forward from `openBraceIdx` (index of the function's opening `{`)
// and return the index of its matching closing `}`, honoring single/double
// quoted strings, template literals (including `${...}` interpolation),
// and line/block comments.
function findMatchingBrace(src, openBraceIdx) {
  let depth = 0;
  let mode = 'code'; // code | line-comment | block-comment | sstring | dstring | template
  const templateDepthStack = [];
  for (let i = openBraceIdx; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (mode === 'line-comment') {
      if (c === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block-comment') {
      if (c === '*' && next === '/') { mode = 'code'; i++; }
      continue;
    }
    if (mode === 'sstring') {
      if (c === '\\') { i++; continue; }
      if (c === "'") mode = 'code';
      continue;
    }
    if (mode === 'dstring') {
      if (c === '\\') { i++; continue; }
      if (c === '"') mode = 'code';
      continue;
    }
    if (mode === 'template') {
      if (c === '\\') { i++; continue; }
      if (c === '`') { mode = 'code'; continue; }
      if (c === '$' && next === '{') {
        templateDepthStack.push(depth);
        depth += 1;
        mode = 'code';
        i++;
        continue;
      }
      continue;
    }

    // mode === 'code'
    if (c === '/' && next === '/') { mode = 'line-comment'; i++; continue; }
    if (c === '/' && next === '*') { mode = 'block-comment'; i++; continue; }
    if (c === "'") { mode = 'sstring'; continue; }
    if (c === '"') { mode = 'dstring'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === '{') { depth += 1; continue; }
    if (c === '}') {
      depth -= 1;
      if (templateDepthStack.length && depth === templateDepthStack[templateDepthStack.length - 1]) {
        templateDepthStack.pop();
        mode = 'template';
        continue;
      }
      if (depth === 0) return i;
      continue;
    }
  }
  throw new Error('Unmatched brace while scanning app.js');
}

function extractFunction(name) {
  const start = findFunctionStart(name);
  if (start === -1) throw new Error(`Could not locate function ${name} in app.js`);
  const openBrace = app.indexOf('{', start);
  const closeBrace = findMatchingBrace(app, openBrace);
  return app.slice(start, closeBrace + 1);
}

// Extracts a single-statement `const NAME = ...;` declaration at column 0.
function extractConst(name) {
  const marker = `\nconst ${name} = `;
  const idx = app.indexOf(marker);
  if (idx === -1) throw new Error(`Could not locate const ${name} in app.js`);
  const start = idx + 1;
  let mode = 'code';
  let i = start;
  for (; i < app.length; i++) {
    const c = app[i];
    const next = app[i + 1];
    if (mode === 'sstring') { if (c === '\\') { i++; continue; } if (c === "'") mode = 'code'; continue; }
    if (mode === 'dstring') { if (c === '\\') { i++; continue; } if (c === '"') mode = 'code'; continue; }
    if (mode === 'template') { if (c === '\\') { i++; continue; } if (c === '`') mode = 'code'; continue; }
    if (c === "'") { mode = 'sstring'; continue; }
    if (c === '"') { mode = 'dstring'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === ';') { return app.slice(start, i + 1); }
  }
  throw new Error(`Could not find terminating ';' for const ${name}`);
}

// --- Build the vm slice --------------------------------------------------

const constNames = ['DAY_MS', 'PRACTICE_PROGRESS_KEY', 'LEGACY_PRACTICE_PROGRESS_KEY', 'PRACTICE_EVENT_LIMIT', 'practiceRemoteSyncChains'];
const functionNames = [
  'emptyPracticeProgress',
  'activePracticeOwnerId',
  'practiceProgressStorageKey',
  'loadPracticeProgress',
  'savePracticeProgress',
  'adoptAnonymousPracticeProgress',
  'hashPracticeValue',
  'practiceItemId',
  'practiceRecordFor',
  'practiceIsDue',
  'practiceProgressTotals',
  'practiceDayKey',
  'practiceTrendSnapshot',
  'practiceEventId',
  'createCoachGameId',
  'practiceEventFromAttempt',
  'nextPracticeInterval',
  'recordPracticeAttempt',
  'markPracticeEventSynced',
  'hasCoachDbSession',
  'queueRemotePracticeProgressSync'
];

const slicedParts = [];
for (const name of constNames) slicedParts.push(extractConst(name));
for (const name of functionNames) slicedParts.push(extractFunction(name));
const sliceCode = slicedParts.join('\n\n');

// Sanity-check the slice actually parses as a standalone script before we
// try to run it (this is the "parses via new vm.Script" check called for
// in the task: a syntax error here means the brace/statement scanner above
// mis-sliced something).
new vm.Script(sliceCode, { filename: 'app.js#practice-slice' });

// --- vm context + stubs ---------------------------------------------------

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); }
  };
}

let currentNow = Date.parse('2024-01-10T12:00:00');

class MockDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(currentNow);
    else super(...args);
  }
  static now() { return currentNow; }
}

const context = {
  localStorage: makeFakeLocalStorage(),
  window: { crypto: { randomUUID: () => nodeCrypto.randomUUID() } },
  coachAuthUser: null,
  coachDbClient: null,
  Date: MockDate,
  console
};
vm.createContext(context);
vm.runInContext(sliceCode, context, { filename: 'app.js#practice-slice' });

function resetStorage() {
  context.localStorage.clear();
  context.coachAuthUser = null;
  context.coachDbClient = null;
}

const DAY_MS = 86400000;

// === 1. practiceItemId: deterministic, sensitive to every input field ====

resetStorage();
{
  const base = { fenBefore: 'fenA', bestUci: 'e2e4' };
  const id1 = context.practiceItemId(base, 'tagX');
  const id2 = context.practiceItemId({ fenBefore: 'fenA', bestUci: 'e2e4' }, 'tagX');
  assertEqual(id1, id2, 'practiceItemId must be deterministic for identical fenBefore+bestUci+tag');
  assert(/^drill-/.test(id1), 'practiceItemId must be prefixed "drill-"');

  const idDiffFen = context.practiceItemId({ fenBefore: 'fenB', bestUci: 'e2e4' }, 'tagX');
  assert(idDiffFen !== id1, 'practiceItemId must differ when fenBefore differs');

  const idDiffUci = context.practiceItemId({ fenBefore: 'fenA', bestUci: 'd2d4' }, 'tagX');
  assert(idDiffUci !== id1, 'practiceItemId must differ when bestUci differs');

  const idDiffTag = context.practiceItemId({ fenBefore: 'fenA', bestUci: 'e2e4' }, 'tagY');
  assert(idDiffTag !== id1, 'practiceItemId must differ when tag differs');
}

// === 2. practiceIsDue: a brand-new item (no stored record) is due now ====

resetStorage();
{
  const item = { id: 'drill-new-item', entry: { fenBefore: 'fen1', bestUci: 'e2e4' }, tag: 'candidate_moves' };
  assert(context.practiceIsDue(item, currentNow) === true, 'an item with no practice record must be due immediately (practiceIsDue)');
}

// === 3. recordPracticeAttempt: scheduling arithmetic against nextPracticeInterval ===
//
// nextPracticeInterval(record, clean): reps<=1 -> 1 day; reps===2 -> 3 days;
// else -> max(4, round(intervalDays * ease)). recordPracticeAttempt adjusts
// ease by +0.08 per correct (unassisted), -0.05 per correct-but-revealed
// ("assisted"), -0.2 per incorrect, floored at 1.3, and resets reps/interval
// to 0 (due immediately) on an incorrect attempt.

resetStorage();
{
  const item = { id: 'drill-schedule', entry: { fenBefore: 'fen2', bestUci: 'g1f3' }, tag: 'candidate_moves', meta: { practice: 'Find the best move' } };

  // Attempt 1: correct, unassisted. reps 0->1, ease 2.5+0.08=2.58, interval=1 (reps<=1).
  currentNow = Date.parse('2024-01-10T12:00:00');
  let record = context.recordPracticeAttempt(item, true, false);
  assertEqual(record.attempts, 1, 'recordPracticeAttempt must increment attempts on each call');
  assertEqual(record.correct, 1, 'recordPracticeAttempt must increment correct on a correct attempt');
  assertEqual(record.reps, 1, 'first correct attempt must bring reps to 1');
  assert(Math.abs(record.ease - 2.58) < 1e-9, `ease after 1 correct unassisted attempt should be 2.5+0.08=2.58, got ${record.ease}`);
  assertEqual(record.intervalDays, 1, 'nextPracticeInterval must return 1 day when reps<=1');
  assertEqual(record.dueAt, currentNow + 1 * DAY_MS, 'dueAt must be now + intervalDays*DAY_MS after attempt 1');

  assert(context.practiceIsDue(item, record.dueAt - 1) === false, 'item must not be due 1ms before its scheduled dueAt');
  assert(context.practiceIsDue(item, record.dueAt) === true, 'item must be due exactly at its scheduled dueAt (dueAt <= now)');

  // Attempt 2: correct, unassisted, one day later. reps 1->2, ease 2.58+0.08=2.66, interval=3 (reps===2).
  currentNow = record.dueAt;
  record = context.recordPracticeAttempt(item, true, false);
  assertEqual(record.reps, 2, 'second consecutive correct attempt must bring reps to 2');
  assert(Math.abs(record.ease - 2.66) < 1e-9, `ease after 2 correct unassisted attempts should be 2.66, got ${record.ease}`);
  assertEqual(record.intervalDays, 3, 'nextPracticeInterval must return 3 days when reps===2');

  // Attempt 3: correct, unassisted. reps 2->3, ease 2.66+0.08=2.74,
  // interval = max(4, round(previous intervalDays(3) * new ease(2.74))) = max(4, round(8.22)) = 8.
  currentNow = record.dueAt;
  record = context.recordPracticeAttempt(item, true, false);
  assertEqual(record.reps, 3, 'third consecutive correct attempt must bring reps to 3');
  assert(Math.abs(record.ease - 2.74) < 1e-9, `ease after 3 correct unassisted attempts should be 2.74, got ${record.ease}`);
  assertEqual(record.intervalDays, 8, 'nextPracticeInterval must compute max(4, round(intervalDays*ease)) = 8 once reps>2');

  const totalsAfterThree = context.practiceProgressTotals();
  assertEqual(totalsAfterThree.mastered, 1, 'practiceProgressTotals must count a drill as mastered once reps>=3');

  // Attempt 4: incorrect. reps reset to 0, ease -0.2, interval reset to 0, due immediately.
  const easeBeforeMiss = record.ease;
  record = context.recordPracticeAttempt(item, false, false);
  assertEqual(record.reps, 0, 'an incorrect attempt must reset reps to 0');
  assert(Math.abs(record.ease - (easeBeforeMiss - 0.2)) < 1e-9, `ease after an incorrect attempt should drop by 0.2, got ${record.ease}`);
  assertEqual(record.intervalDays, 0, 'an incorrect attempt must reset intervalDays to 0');
  assertEqual(record.dueAt, currentNow, 'an incorrect attempt must schedule the item due immediately (dueAt===now)');
  assert(context.practiceIsDue(item, currentNow) === true, 'item must be immediately due again after an incorrect attempt');
}

// === 3b. ease floor and "assisted" (revealed-but-correct) handling ========

resetStorage();
{
  const item = { id: 'drill-assisted', entry: { fenBefore: 'fen3', bestUci: 'b1c3' }, tag: 'candidate_moves', meta: { practice: 'Find the best move' } };
  currentNow = Date.parse('2024-01-10T12:00:00');
  const record = context.recordPracticeAttempt(item, true, true); // correct but revealed ("assisted")
  assert(Math.abs(record.ease - (2.5 - 0.05)) < 1e-9, `a revealed-but-correct ("assisted") attempt should lower ease by 0.05 to 2.45, got ${record.ease}`);
  assertEqual(record.reps, 1, 'an assisted-correct attempt still counts as a rep towards spaced repetition');
  assertEqual(record.lastResult, 'assisted', 'lastResult must be "assisted" when correct+revealed');
  assertEqual(record.intervalDays, 1, 'assisted attempts follow the same nextPracticeInterval schedule as unassisted ones');

  // Drive ease down toward the 1.3 floor with repeated incorrect attempts.
  for (let i = 0; i < 20; i++) context.recordPracticeAttempt(item, false, false);
  const floored = context.recordPracticeAttempt(item, false, false);
  assertEqual(floored.ease, 1.3, 'ease must be floored at 1.3 and never drop below it');
}

// === 4. event fields + rounded success rate via practiceTrendSnapshot ====

resetStorage();
{
  currentNow = Date.parse('2024-01-10T12:00:00');
  const itemA = { id: 'drill-rate-a', entry: { fenBefore: 'fen4', bestUci: 'e2e4', bestSan: 'e4' }, tag: 'candidate_moves', meta: { practice: 'Find the best move' } };

  const missedEvent = context.recordPracticeAttempt(itemA, false, false);
  const firstAttemptEvents = context.loadPracticeProgress().events;
  const lastEvent = firstAttemptEvents[firstAttemptEvents.length - 1];
  assertEqual(lastEvent.drillId, itemA.id, 'recorded event drillId must match the practice item id');
  assertEqual(lastEvent.tag, itemA.tag, 'recorded event tag must match the practice item tag');
  assertEqual(lastEvent.fen, itemA.entry.fenBefore, 'recorded event fen must match entry.fenBefore');
  assertEqual(lastEvent.bestUci, itemA.entry.bestUci, 'recorded event bestUci must match entry.bestUci');
  assertEqual(lastEvent.correct, false, 'recorded event correct flag must reflect the attempt outcome');
  assertEqual(lastEvent.result, 'incorrect', 'recorded event result must be "incorrect" for a wrong attempt');

  let trend = context.practiceTrendSnapshot(currentNow);
  assertEqual(trend.attempts, 1, 'practiceTrendSnapshot must count 1 attempt after 1 wrong attempt');
  assertEqual(trend.rate, 0, 'practiceTrendSnapshot rate must be 0% after 1 wrong attempt');

  context.recordPracticeAttempt(itemA, true, false); // 1 wrong + 1 right => 50%
  trend = context.practiceTrendSnapshot(currentNow);
  assertEqual(trend.attempts, 2, 'practiceTrendSnapshot must count 2 attempts after 1 wrong + 1 right');
  assertEqual(trend.rate, 50, 'practiceTrendSnapshot rate must round to 50% after 1 wrong + 1 right');

  context.recordPracticeAttempt(itemA, true, false); // 2 of 3 correct => round(66.67) = 67%
  trend = context.practiceTrendSnapshot(currentNow);
  assertEqual(trend.attempts, 3, 'practiceTrendSnapshot must count 3 attempts after a third attempt');
  assertEqual(trend.rate, 67, 'practiceTrendSnapshot rate must round 2/3 up to 67%');

  // markPracticeEventSynced flips the synced flag on the matching event only.
  context.markPracticeEventSynced(missedEvent && lastEvent.id);
  const syncedEvent = context.loadPracticeProgress().events.find(e => e.id === lastEvent.id);
  assert(syncedEvent.synced === true, 'markPracticeEventSynced must mark the matching event as synced');
}

// === 5. practiceTrendSnapshot streaks across day boundaries ==============

resetStorage();
{
  const today = Date.parse('2024-01-10T12:00:00');
  const yesterday = today - DAY_MS;
  context.savePracticeProgress({
    records: {},
    events: [
      { at: yesterday, correct: true },
      { at: today, correct: true }
    ]
  });
  const trend = context.practiceTrendSnapshot(today);
  assertEqual(trend.streak, 2, 'attempts on today and yesterday must produce a 2-day streak');
}

resetStorage();
{
  const today = Date.parse('2024-01-10T12:00:00');
  const threeDaysAgo = today - 3 * DAY_MS;
  context.savePracticeProgress({
    records: {},
    events: [
      { at: threeDaysAgo, correct: true },
      { at: today, correct: true }
    ]
  });
  const trend = context.practiceTrendSnapshot(today);
  assertEqual(trend.streak, 1, 'a gap (attempt 3 days ago, none yesterday) must break the streak back down to 1');
}

// === 6. loadPracticeProgress: legacy v1 -> v2 migration ===================

resetStorage();
{
  context.localStorage.setItem('coach:practice:v1', JSON.stringify({
    v: 1,
    records: { 'drill-legacy': { attempts: 2, correct: 1, reps: 1, ease: 2.4, intervalDays: 1, dueAt: 0 } }
  }));
  const migrated = context.loadPracticeProgress(null);
  assertEqual(migrated.v, 2, 'loadPracticeProgress must upgrade legacy v1 data to the v2 shape');
  assert(!!migrated.records['drill-legacy'], 'loadPracticeProgress must carry legacy record data over by drill id');
  assertEqual(migrated.events.length, 0, 'legacy v1 data has no event log, so migrated events must start empty');
}

// === 7. account-scoped storage keys stay isolated =========================

resetStorage();
{
  context.savePracticeProgress({ records: { 'drill-u1': { attempts: 1 } }, events: [] }, 'user-1');
  context.savePracticeProgress({ records: { 'drill-u2': { attempts: 5 } }, events: [] }, 'user-2');
  const u1 = context.loadPracticeProgress('user-1');
  const u2 = context.loadPracticeProgress('user-2');
  assert(!!u1.records['drill-u1'] && !u1.records['drill-u2'], 'user-1 practice storage must not see user-2 records');
  assert(!!u2.records['drill-u2'] && !u2.records['drill-u1'], 'user-2 practice storage must not see user-1 records');
}

// === 8. adoptAnonymousPracticeProgress folds anonymous data into an account, once ===

resetStorage();
{
  context.savePracticeProgress({
    records: { 'drill-anon': { attempts: 3, correct: 2, reps: 1, ease: 2.5, intervalDays: 1, dueAt: 0, lastAttemptAt: 100 } },
    events: [{ id: 'evt-anon-1', at: 100, correct: true }]
  }, null);

  context.adoptAnonymousPracticeProgress('user-new');

  const adopted = context.loadPracticeProgress('user-new');
  assert(!!adopted.records['drill-anon'], 'adoptAnonymousPracticeProgress must copy anonymous records into the account-scoped store');
  assertEqual(adopted.events.length, 1, 'adoptAnonymousPracticeProgress must carry the anonymous event log over');

  const anonAfterAdopt = context.loadPracticeProgress(null);
  assertEqual(Object.keys(anonAfterAdopt.records).length, 0, 'adoptAnonymousPracticeProgress must clear the anonymous store once adopted (no double-adoption on next login)');
}

// === 9. hasCoachDbSession / queueRemotePracticeProgressSync early-return ==

resetStorage();
{
  assert(context.hasCoachDbSession() === false, 'hasCoachDbSession must be false with no auth user and no db client');
  // Must not throw even though syncRemotePracticeEvent is not defined in
  // this slice: with no session, queueRemotePracticeProgressSync must
  // return before ever referencing it.
  let threw = false;
  try {
    context.queueRemotePracticeProgressSync({ id: 'evt-x', drillId: 'drill-x' });
  } catch (e) {
    threw = true;
  }
  assert(threw === false, 'queueRemotePracticeProgressSync must no-op (not throw) when there is no active Coach DB session');
}

// --- Report ---------------------------------------------------------------

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Practice-logic validation passed (${assertions} assertions).`);
