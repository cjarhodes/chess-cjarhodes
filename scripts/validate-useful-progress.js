#!/usr/bin/env node

// Exercise the actual evidence calculations and recommendation routing with
// controlled histories. No engine, network, account, or browser is required.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const growth = fs.readFileSync(path.join(root, 'growth.js'), 'utf8');
const DAY_MS = 86400000;
const now = 1800000000000;
const anchor = now - 5 * DAY_MS;
const fen = '7k/8/5KQ1/8/8/8/8/8 w - - 0 1';
const failures = [];
let checks = 0;
const assert = (ok, message) => { checks++; if (!ok) failures.push(message); };
const extract = name => {
  const start = app.indexOf(`\nfunction ${name}(`) + 1;
  if (!start) throw Error('Missing runtime function: ' + name);
  return app.slice(start, app.indexOf('\n}', start) + 2);
};
const metadataStart = app.indexOf('const INSIGHT_TAG_META =');
const metadata = app.slice(metadataStart, app.indexOf('\n};', metadataStart) + 3);
const context = {
  Chess, console, DAY_MS, ACPL_CAP: 1000,
  Date: class extends Date { static now() { return now; } },
  DAILY_DRILL_TARGET: 2, DAILY_TRANSFER_TARGET: 6, DAILY_MOVE_TARGET: 10,
  PRACTICE_QUEUE_LIMIT: 10,
  INSIGHT_PROBLEM_TIERS: new Set(['inaccuracy', 'mistake', 'blunder']),
  INSIGHT_TIER_WEIGHT: { inaccuracy: 1, mistake: 2, blunder: 3 },
  testEvents: [], testRecords: {}, testDay: null, testEntries: [],
  testProfile: { minutes: 10, goal: 'balanced', sessionStyle: 'balanced' },
  coachAuthUser: null, coachRemoteInsightsLoaded: false, coachRemoteInsightEntries: null,
  coachPracticeSession: null, coachGameActive: false,
  loadPracticeProgress: () => ({ events: context.testEvents }),
  practiceRecordFor: item => context.testRecords[item.id] || null,
  practiceIsDue: (item, at = now) => !context.testRecords[item.id] || context.testRecords[item.id].dueAt <= at,
  practiceProgressTotals: () => ({ attempts: context.testEvents.length }),
  dailySprintToday: () => context.testDay,
  loadInsights: () => ({ entries: context.testEntries }),
  $: () => {}, window: {}
};
vm.createContext(context);
vm.runInContext(metadata + '\n' + [
  'isInsightProblem', 'moveFromUci', 'recurringMistakeSummaries', 'insightTagCounts',
  'insightTagForEntry', 'buildPracticeQueue', 'practiceItemsForEntries', 'practiceMoveFor',
  'hashPracticeValue', 'practiceItemId', 'applyAdaptiveGoalBoost', 'adaptiveFocusProfile',
  'adaptiveFocusReason', 'prioritizeAdaptivePractice', 'adaptiveDailyPlan', 'currentInsightEntries'
].map(extract).join('\n') + '\n' + growth + '\nplayerProfile = () => testProfile; repertoireFocusOpening = () => null;', context);

const review = (ts, flagged = false, extras = {}) => Object.assign({
  ts, tier: flagged ? 'mistake' : 'good', tags: flagged ? ['missed_mate'] : [],
  loss: flagged ? 200 : 0, fenBefore: fen, bestUci: 'g6g7'
}, extras);
const history = (beforeCount, afterCount, beforeErrors, afterErrors) => [
  ...Array.from({ length: beforeCount }, (_, i) => review(anchor - 1000 - i, i < beforeErrors)),
  ...Array.from({ length: afterCount }, (_, i) => review(anchor + 1000 + i, i < afterErrors))
];
const attempt = (at = anchor, extras = {}) => Object.assign({ at, tag: 'missed_mate', correct: true, revealed: false }, extras);

let entries = [
  ...Array.from({ length: 100 }, (_, i) => review(now - 40 * DAY_MS + i, i < 10)),
  ...Array.from({ length: 200 }, (_, i) => review(now - 2 * DAY_MS + i, i < 15))
];
let trend = context.recurringMistakeSummaries(entries, now)[0];
assert(trend.current === 15 && trend.previous === 10, 'monthly flags lost their window');
assert(trend.currentSamples === 200 && trend.previousSamples === 100, 'monthly denominators ignore reviewed volume');
assert(trend.comparable && Math.abs(trend.change + 0.025) < 1e-9, 'higher raw count must still report the lower observed rate');
trend = context.recurringMistakeSummaries(entries.slice(100), now)[0];
assert(!trend.comparable && trend.previousRate === null && trend.change === null, 'missing prior history must not imply improvement or decline');
entries = Array.from({ length: 30 }, (_, i) => review(now - 30 * DAY_MS - 1000 - i, true));
entries.push(...Array.from({ length: 29 }, (_, i) => review(now - i, true)));
assert(!context.recurringMistakeSummaries(entries, now)[0].comparable, '29 reviews must remain inconclusive');
entries.push(review(now - 200));
assert(context.recurringMistakeSummaries(entries, now)[0].comparable, '30 reviews in each window should allow a descriptive comparison');
const boundary = context.recurringMistakeSummaries([
  review(now - 60 * DAY_MS, true), review(now - 30 * DAY_MS, true), review(now, true), review(now - 61 * DAY_MS, true)
], now)[0];
assert(boundary.previous === 1 && boundary.current === 2, 'calendar boundary reviews were counted twice or dropped');
const duplicate = review(now - 1000, true, { id: 'same-review', tags: ['missed_mate', 'missed_mate'] });
const normalized = context.reviewedProgressEntries([
  duplicate, duplicate, review(now + 1, true), review(NaN, true), review(-1, true), review(now - 1, true, { tier: 'unknown' }), null
], now);
assert(normalized.length === 1, 'future, malformed, unknown, or duplicate ID reviews were counted');
assert(context.recurringMistakeSummaries(normalized, now)[0].current === 1, 'duplicate tags were counted as multiple flagged moves');
assert(context.reviewedProgressEntries(null, now).length === 0, 'malformed history should behave as empty');

context.testEvents = [attempt(anchor, { revealed: true })];
assert(context.transferMeasurement(history(30, 30, 10, 2), 'missed_mate', now) === null, 'hinted/revealed completions must not open a transfer checkpoint');
context.testEvents = [attempt(anchor, { correct: false }), attempt(now + 1), attempt(NaN)];
assert(context.transferMeasurement(history(30, 30, 10, 2), 'missed_mate', now) === null, 'misses and invalid/future attempts must not open a checkpoint');
context.testEvents = [attempt()];
let measurement = context.transferMeasurement(history(29, 30, 5, 2), 'missed_mate', now);
assert(!measurement.baselineReady && !measurement.enoughEvidence && measurement.change === null, 'incomplete baseline falsely implies progress');
measurement = context.transferMeasurement(history(30, 29, 5, 2), 'missed_mate', now);
assert(measurement.baselineReady && !measurement.enoughEvidence && measurement.afterSamples === 29, 'follow-up floor was bypassed');
measurement = context.transferMeasurement(history(30, 30, 10, 2), 'missed_mate', now);
assert(measurement.enoughEvidence && measurement.direction === 'improved' && measurement.change === -26.7, 'equal move-window rate difference is wrong');
assert(context.transferMeasurement(history(30, 30, 5, 5), 'missed_mate', now).direction === 'unchanged', 'equal rates must say unchanged');
assert(context.transferMeasurement(history(30, 30, 2, 10), 'missed_mate', now).direction === 'worsened', 'higher observed rate must remain visible');
const original = JSON.stringify(measurement);
context.testEvents.push(attempt(anchor + 2 * DAY_MS));
assert(JSON.stringify(context.transferMeasurement(history(30, 30, 10, 2), 'missed_mate', now)) === original, 'later rehearsal reset an eligible checkpoint');
context.testEvents = [attempt(anchor - 100000), attempt()];
assert(context.transferMeasurement(history(30, 30, 10, 2), 'missed_mate', now).anchor === anchor, 'first rehearsal with a full baseline was not selected');
context.testEvents = [attempt()];
const longHistory = [
  ...history(30, 30, 10, 2),
  ...Array.from({ length: 100 }, (_, i) => review(anchor - DAY_MS - i, true)),
  ...Array.from({ length: 100 }, (_, i) => review(anchor + DAY_MS + i, true))
];
assert(context.transferMeasurement(longHistory, 'missed_mate', now).change === -26.7, 'more distant reviews changed the fixed nearest before / first after windows');
context.testEvents = [attempt(anchor - 20 * DAY_MS)];
const noExpiry = history(30, 30, 10, 2).map(entry => Object.assign({}, entry, { ts: entry.ts - 20 * DAY_MS }));
assert(context.transferMeasurement(noExpiry, 'missed_mate', now).enoughEvidence, 'retained evidence silently expired after seven days');

context.testEvents = [];
let next = context.progressRecommendation([], now);
assert(next.action === 'game' && !next.focusTag && next.plan.drillTarget === 0, 'empty progress should start a baseline in one action');
context.testEntries = [review(now - 1000, true)];
next = context.progressRecommendation(context.testEntries, now);
assert(next.action === 'practice' && next.plan.drillTarget === 1 && next.reason.includes('early signal'), 'one flag should offer one real position with sparse-evidence language');
const duplicates = Array.from({ length: 12 }, (_, i) => review(now - 1000 - i, true));
next = context.progressRecommendation(duplicates, now);
assert(next.plan.drillTarget === 1 && next.plan.orderedDue.length === 1, 'repeated instances of one position inflated the promised practice count');
const invalid = [review(now - 2000, true, { fenBefore: 'invalid' }), review(now - 1000, true, { bestUci: 'a1a8' })];
assert(context.progressRecommendation(invalid, now).action === 'game', 'unplayable saved positions produced a dead practice action');
context.testRecords[next.plan.orderedDue[0].id] = { dueAt: now + DAY_MS };
next = context.progressRecommendation(duplicates, now);
assert(next.action === 'game' && next.focusTag === 'missed_mate', 'no-due focus should lead to play');
context.testRecords = {};
context.testProfile.sessionStyle = 'play';
assert(context.progressRecommendation(duplicates, now).action === 'game', 'Progress ignored the play-first preference');
context.testProfile.sessionStyle = 'balanced';
context.testDay = { mode: 'adaptive', phase: 'moves', focusTag: 'development', focus: 'Slow development', focusCue: 'Develop pieces.', completedAt: null };
next = context.progressRecommendation(duplicates, now);
assert(next.action === 'daily' && next.focusTag === 'development' && next.cue === 'Develop pieces.', 'unfinished daily focus was replaced by a new recommendation');
context.testDay.completedAt = now - 1;
context.coachGameActive = true;
next = context.progressRecommendation(duplicates, now);
assert(next.optional && next.action === 'continue', 'completed daily training should offer optional continuation without replacing a live game');
context.coachGameActive = false;
context.testDay = null;
context.coachAuthUser = { id: 'account-a' };
context.coachRemoteInsightsLoaded = true;
context.coachRemoteInsightEntries = [review(now - 1000, true, { tags: ['development'] })];
assert(context.currentInsightEntries()[0].tags[0] === 'development', 'loaded account reviews were replaced by stale local data');
context.coachRemoteInsightEntries = [];
assert(context.currentInsightEntries().length === 1, 'sync hid this account\'s local offline reviews');
context.testEntries = [review(now - 1000, true, {id:'same',gameId:'game',ply:1})];
context.coachRemoteInsightEntries = [review(now - 1000, true, {id:'same',gameId:'game',ply:1})];
assert(context.currentInsightEntries().length === 1, 'local and remote copies double-counted a review');
context.coachRemoteInsightsLoaded = false;
assert(context.currentInsightEntries().length === 1, 'account-local history was unavailable while sync had not loaded');

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Useful progress validation passed (${checks} behavioural checks).`);
