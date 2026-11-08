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
const app = require('./lib/app-source').appSource();

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

const constNames = ['DAILY_DRILL_TARGET', 'DAILY_SPRINT_KEY', 'DAILY_MOVE_TARGET', 'DAILY_TRANSFER_TARGET', 'DAILY_HISTORY_LIMIT', 'DAY_MS', 'PRACTICE_PROGRESS_KEY', 'LEGACY_PRACTICE_PROGRESS_KEY', 'PRACTICE_EVENT_LIMIT', 'practiceRemoteSyncChains'];
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
  'distinctPracticeItems',
  'orderedPracticeRunItems',
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
  'queueRemotePracticeProgressSync',
  'formatPracticeDue',
  'dailySprintStorageKey',
  'emptyDailySprintHistory',
  'loadDailySprintHistory',
  'saveDailySprintHistory',
  'dailySprintDayKey',
  'dailySprintToday',
  'updateDailySprint',
  'initializeAdaptiveDay',
  'upgradeLegacyDailySprint',
  'beginDailyDrillSprint',
  'recordDailySprintMove',
  'recordDailySprintDrill',
  'settleDailySprintDay',
  'settleSavedDailySprints',
  'dailySprintStreak',
  'practiceDayStart'
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
  console,
  // Daily Sprint boundaries: status text, remote sync and the takeaway copy.
  setCoachStatus: () => {},
  queueRemoteDailySprintSync: () => {},
  dailyMoveSprintTakeaway: () => 'takeaway',
  adaptiveDailyPlan: () => ({ focusTag: null, drillTarget: 0, moveTarget: 10 }),
  coachLocalGameId: 'game-1',
  renderedAdaptivePlan: null
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
  assertEqual(record.dueAt, new Date(2024, 0, 11).getTime(), 'dueAt must be local midnight intervalDays calendar days later after attempt 1');

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
  assertEqual(record.reps, 0, 'an assisted-correct attempt must not count as a spaced-repetition rep');
  assertEqual(record.lastResult, 'assisted', 'lastResult must be "assisted" when correct+revealed');
  assertEqual(record.intervalDays, 1, 'an assisted attempt must come back after one day');

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

// Grouping preserves legacy schedules and events instead of inventing credit.
resetStorage();
{
  const entry = { fenBefore: 'position w KQ - 0 1', bestUci: 'e2e4', tags: ['development', 'king_safety'] };
  const make = tag => ({ id: context.practiceItemId(entry, tag), tag, entry, meta: { practice: 'Compare candidates.' } });
  const first = make('development'), second = make('king_safety');
  context.recordPracticeAttempt(first, true, false);
  assert(!context.practiceIsDue(second), 'one completion must schedule equivalent weakness tags together');
  assertEqual(context.practiceProgressTotals().attempts, 1, 'grouping must not duplicate attempt counts');
  currentNow += 1000;
  context.recordPracticeAttempt(second, false, false);
  assert(context.practiceIsDue(first), 'a newer miss on another tag must reopen the position');
  assertEqual(context.loadPracticeProgress().events.length, 2, 'grouping must preserve the two real events');
  assertEqual(Object.keys(context.loadPracticeProgress().records).length, 2, 'existing per-tag record IDs must remain intact');
  assertEqual(context.practiceProgressTotals().attempts, 2, 'a second real attempt must add only one attempt');
  const changedCounters = {...second, entry: {...entry, fenBefore: 'position w KQ - 8 24'}};
  const another = {...first, id: 'different', entry: {...entry, fenBefore: 'other b - - 0 1', bestUci: 'e7e5'}};
  assertEqual(context.distinctPracticeItems([first, second, changedCounters, another]).length, 2, 'counter changes and tags must not create extra positions');
  context.renderedAdaptivePlan = { drillTarget: 1 };
  assertEqual(context.orderedPracticeRunItems([first, second, another], second).length, 1, 'session must honour its displayed adaptive cap');
  assertEqual(context.orderedPracticeRunItems([first, second, another], second)[0].id, second.id, 'selected lesson must stay first when grouping');
  context.renderedAdaptivePlan = { drillTarget: 0 };
  assertEqual(context.orderedPracticeRunItems([first, second]).length, 1, 'manual practice must remain available for a play-first plan');
  context.renderedAdaptivePlan = { drillTarget: 4 };
  assertEqual(context.orderedPracticeRunItems([first, second, another]).length, 2, 'session must cap to available distinct positions');
}

// === 10. hints never advance spaced repetition =========================
//
// Hint stage 3 names the destination square, so a hinted solve is not
// evidence of recall: it keeps reps, comes back tomorrow, and never reaches
// "Repeated 3×". It still counts as a completed attempt, matching the
// "completed with a hint or answer" wording in Progress.

resetStorage();
{
  const item = { id: 'drill-hinted', entry: { fenBefore: 'fen-hint', bestUci: 'e2e4' }, tag: 'candidate_moves', meta: { practice: 'Find it' } };
  currentNow = Date.parse('2024-01-10T12:00:00');
  for (let i = 0; i < 3; i++) {
    const record = context.recordPracticeAttempt(item, true, true);
    currentNow = record.dueAt;
  }
  const record = context.loadPracticeProgress().records[item.id];
  assertEqual(record.reps, 0, 'three hinted solves must not build spaced-repetition reps');
  assertEqual(record.intervalDays, 1, 'a hinted solve must come back after one day');
  assertEqual(context.practiceProgressTotals().mastered, 0, 'hinted solves must never count as "Repeated 3×"');
  assertEqual(record.correct, 3, 'hinted solves still count as completed attempts');

  // Two clean solves then a hinted one: reps hold at 2 and the interval drops to a day.
  context.recordPracticeAttempt(item, true, false);
  currentNow += 2 * DAY_MS;
  context.recordPracticeAttempt(item, true, false);
  currentNow += 4 * DAY_MS;
  const hinted = context.recordPracticeAttempt(item, true, true);
  assertEqual(hinted.reps, 2, 'a hinted solve must keep the reps earned by clean solves');
  assertEqual(hinted.intervalDays, 1, 'a hinted solve must shorten the interval to one day');
}

// === 11. the same position under a new tag keeps its schedule =============

resetStorage();
{
  const entry = { fenBefore: 'fen-retag w - - 0 1', bestUci: 'e2e4', tags: ['development', 'missed_center_break'] };
  const make = tag => ({ id: context.practiceItemId(entry, tag), tag, entry, meta: { practice: 'Compare candidates.' } });
  const first = make('development'), second = make('missed_center_break');
  currentNow = Date.parse('2024-01-10T12:00:00');
  let record = context.recordPracticeAttempt(first, true, false);
  currentNow = record.dueAt;
  record = context.recordPracticeAttempt(first, true, false);
  assertEqual(record.reps, 2, 'setup: two clean solves under the first tag');
  currentNow = record.dueAt;
  assert(context.practiceIsDue(second), 'setup: the position is due again under its new tag');
  record = context.recordPracticeAttempt(second, true, false);
  assertEqual(record.reps, 3, 'a clean solve under a new tag must continue the position\'s schedule');
  assert(record.intervalDays >= 4, `the continued schedule must grow past 3 days, got ${record.intervalDays}`);
  assertEqual(record.attempts, 1, 'the new tag record must count only its own attempt');
  assertEqual(context.practiceProgressTotals().attempts, 3, 'continuing a schedule must not double-count attempts');
}

// === 12. due dates are calendar days ======================================

resetStorage();
{
  const item = { id: 'drill-evening', entry: { fenBefore: 'fen-evening', bestUci: 'e2e4' }, tag: 'candidate_moves', meta: { practice: 'Find it' } };
  currentNow = new Date(2024, 0, 10, 20, 0).getTime();
  const record = context.recordPracticeAttempt(item, true, false);
  assertEqual(record.dueAt, new Date(2024, 0, 11).getTime(), 'a one-day interval must fall due at the start of tomorrow');
  assert(context.practiceIsDue(item, new Date(2024, 0, 11, 8, 0).getTime()), 'a drill solved last evening must be due this morning');
}

{
  // Across the autumn clock change, 48.5 elapsed hours are still two calendar days.
  const savedTz = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try {
    currentNow = new Date(2024, 10, 2, 0, 30).getTime();
    assertEqual(context.formatPracticeDue({ dueAt: new Date(2024, 10, 4).getTime() }), 'Due in 2d', 'formatPracticeDue must count calendar days across a clock change');
    currentNow = new Date(2024, 0, 10, 8, 0).getTime();
    assertEqual(context.formatPracticeDue({ dueAt: new Date(2024, 0, 11).getTime() }), 'Due in 1d', 'due tomorrow must read as one day');

    // The seven-day trend window starts at local midnight six calendar days ago.
    resetStorage();
    const now = new Date(2024, 10, 5, 12, 0).getTime();
    const firstDay = new Date(2024, 9, 30, 0, 30).getTime();
    context.savePracticeProgress({ records: {}, events: [{ at: firstDay, correct: true, tag: 'candidate_moves' }] });
    const trend = context.practiceTrendSnapshot(now);
    assertEqual(trend.attempts, 1, 'an attempt just after midnight on the first day of the window must count across a clock change');
    assertEqual(trend.days[0].attempts, 1, 'the first bar must show its attempt across a clock change');
  } finally {
    if (savedTz === undefined) delete process.env.TZ; else process.env.TZ = savedTz;
  }
}

// === 13. Daily Sprint phases and completion ================================

const focusPlan = { kind: 'focus-transfer', focusTag: 'development', focus: 'Slow development', cue: 'Develop.', reason: 'r', drillTarget: 2, moveTarget: 6, orderedDue: [] };
const drillItem = n => ({ id: 'drill-sprint-' + n, tag: 'development', entry: { fenBefore: `fen-sprint-${n} w - - 0 1`, bestUci: 'e2e4' }, meta: { practice: 'Develop.' } });

resetStorage();
{
  // A game resumed on a new day: its first move starts a drills-first day,
  // which must stay in drills rather than counting moves it cannot finish.
  currentNow = new Date(2024, 0, 10, 9, 0).getTime();
  context.renderedAdaptivePlan = focusPlan;
  let day = context.recordDailySprintMove({ ply: 1 });
  assertEqual(day.phase, 'drills', 'the first move of a drills-first day must leave the day in its drills phase');
  assertEqual(day.movesCompleted, 0, 'moves must not count before the day\'s drills');
  context.recordDailySprintDrill(drillItem(1), false, true);
  day = context.recordDailySprintDrill(drillItem(2), false, true);
  assertEqual(day.phase, 'moves', 'finishing the drills must open the live-play phase');
  for (let ply = 2; ply <= 7; ply++) day = context.recordDailySprintMove({ ply });
  assert(!!day.completedAt, 'six transfer moves after the drills must complete the day');
}

resetStorage();
{
  // A day saved with its moves done but drills outstanding completes on the last drill.
  currentNow = new Date(2024, 0, 10, 9, 0).getTime();
  context.updateDailySprint(day => Object.assign(day, {
    mode: 'adaptive', phase: 'moves', focusTag: 'development', drillTarget: 2, drillsCompleted: 0, drillIds: [],
    moveTarget: 6, movesCompleted: 6, moveIds: ['g:1', 'g:2', 'g:3', 'g:4', 'g:5', 'g:6'], target: 8, completedUnits: 6
  }));
  context.recordDailySprintDrill(drillItem(1), false, true);
  const day = context.recordDailySprintDrill(drillItem(2), false, true);
  assert(!!day.completedAt, 'the drill that reaches the day\'s target must complete the day');
  assertEqual(day.phase, 'complete', 'a completed day must be in its complete phase');
}

resetStorage();
{
  // A play-first plan has no drill target; manual practice must not add one.
  currentNow = new Date(2024, 0, 10, 9, 0).getTime();
  context.renderedAdaptivePlan = Object.assign({}, focusPlan, { kind: 'transfer', drillTarget: 0, moveTarget: 8 });
  const day = context.beginDailyDrillSprint([drillItem(1)]);
  assertEqual(day.drillTarget, 0, 'a play-first plan must keep a drill target of 0');
  assertEqual(day.phase, 'moves', 'a play-first day must start in live play');
}

// === 14. a reloaded drills phase sizes the run from the saved day ==========

resetStorage();
{
  currentNow = new Date(2024, 0, 10, 9, 0).getTime();
  context.renderedAdaptivePlan = null; // not rebuilt after a reload while a day exists
  context.updateDailySprint(day => Object.assign(day, {
    mode: 'adaptive', phase: 'drills', focusTag: 'development', drillTarget: 3, drillsCompleted: 2, drillIds: ['a', 'b'],
    moveTarget: 6, movesCompleted: 0, moveIds: [], target: 9, completedUnits: 2
  }));
  const run = context.orderedPracticeRunItems([drillItem(1), drillItem(2), drillItem(3)]);
  assertEqual(run.length, 1, 'a drills phase with one drill left must start a one-drill run');
}

// === 15. days saved stuck before the shared completion check settle on render =

resetStorage();
{
  currentNow = new Date(2024, 0, 10, 9, 0).getTime();
  const yesterday = new Date(2024, 0, 9, 21, 15).getTime();
  const history = { v: 1, days: {
    // Yesterday: the last drill reached the target, but the drill path never set completedAt.
    '2024-01-09': { mode: 'adaptive', phase: 'drills', focusTag: 'development', drillTarget: 2, drillsCompleted: 2, drillIds: ['a', 'b'],
      moveTarget: 6, movesCompleted: 6, moveIds: ['g:1', 'g:2', 'g:3', 'g:4', 'g:5', 'g:6'], target: 8, completedUnits: 6, startedAt: yesterday - 3600000, updatedAt: yesterday, completedAt: null },
    // Today: live play opened with drills still owed, so "0 moves remain".
    '2024-01-10': { mode: 'adaptive', phase: 'moves', focusTag: 'development', drillTarget: 2, drillsCompleted: 0, drillIds: [],
      moveTarget: 6, movesCompleted: 6, moveIds: ['g:1', 'g:2', 'g:3', 'g:4', 'g:5', 'g:6'], target: 8, completedUnits: 6, startedAt: currentNow - 60000, updatedAt: currentNow - 60000, completedAt: null },
    // An earlier day short of its target stays incomplete.
    '2024-01-08': { mode: 'adaptive', phase: 'moves', drillTarget: 0, drillsCompleted: 0, moveTarget: 10, movesCompleted: 4, target: 10, completedUnits: 4, updatedAt: yesterday - DAY_MS, completedAt: null }
  } };
  context.saveDailySprintHistory(history);
  assertEqual(context.dailySprintStreak(context.loadDailySprintHistory(), currentNow), 0, 'setup: the stuck day breaks the streak');
  context.settleSavedDailySprints();
  const days = context.loadDailySprintHistory().days;
  assertEqual(days['2024-01-09'].phase, 'complete', 'a past day that reached its target must settle as complete');
  assertEqual(days['2024-01-09'].completedAt, yesterday, 'a past day must complete when its last unit was recorded, not now');
  assertEqual(days['2024-01-09'].completedUnits, 8, 'a settled past day must count drills and moves together');
  assertEqual(context.dailySprintStreak(context.loadDailySprintHistory(), currentNow), 1, 'the settled day must count in the streak');
  assertEqual(days['2024-01-10'].phase, 'drills', 'today\'s day with drills owed must return to its drills phase');
  assert(!days['2024-01-10'].completedAt, 'today\'s day with drills owed must not complete');
  assert(!days['2024-01-08'].completedAt, 'a past day short of its target must stay incomplete');
  const saved = JSON.stringify(context.loadDailySprintHistory());
  context.settleSavedDailySprints();
  assertEqual(JSON.stringify(context.loadDailySprintHistory()), saved, 'settling again must change nothing');
}

// --- Report ---------------------------------------------------------------

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Practice-logic validation passed (${assertions} assertions).`);
