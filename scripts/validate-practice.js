#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'scripts/verify-browser.sh'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260724025215_durable_practice_progress.sql'), 'utf8');
const dbTest = fs.readFileSync(path.join(root, 'supabase/tests/database/durable_practice_progress.test.sql'), 'utf8');
const dailyMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260817024158_sync_adaptive_training_sessions.sql'), 'utf8');
const dailyDbTest = fs.readFileSync(path.join(root, 'supabase/tests/database/daily_training_sessions.test.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const errors = [];

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) errors.push(message);
}

requirePattern(app, /const PRACTICE_PROGRESS_KEY = 'coach:practice:v2'[\s\S]{0,120}LEGACY_PRACTICE_PROGRESS_KEY = 'coach:practice:v1'/, 'practice progress must migrate durable v1 data into event-backed v2 storage');
requirePattern(app, /function practiceProgressStorageKey[\s\S]{0,220}ownerId[\s\S]{0,2600}function adoptAnonymousPracticeProgress/, 'practice progress must be isolated by account and adopt anonymous work');
requirePattern(app, /function practiceItemId[\s\S]{0,300}fenBefore[\s\S]{0,100}bestUci/, 'practice ids must be deterministic from position and answer');
requirePattern(app, /function recordPracticeAttempt[\s\S]{0,1800}attempts \+= 1[\s\S]{0,1000}state\.events\.push\(event\)/, 'practice attempts must update scheduling and append event history');
requirePattern(app, /function coachHandlePracticeMove[\s\S]{0,2200}actualUci !== session\.item\.entry\.bestUci/, 'practice moves must be graded against the saved best move');
requirePattern(app, /const missedImmediateMate[\s\S]{0,300}Math\.max\(loss, 250\)/, 'missing mate-in-one must create a meaningful training error');
requirePattern(app, /function currentGameDuePracticeItems[\s\S]{0,700}practiceIsDue/, 'post-game review must identify due drills from the current game');
requirePattern(app, /function syncRemotePracticeEvent[\s\S]{0,1600}\.rpc\('record_practice_attempt'/, 'signed-in attempts must use the transactional practice RPC');
requirePattern(app, /function queueRemotePracticeProgressSync[\s\S]{0,900}practiceRemoteSyncChains/, 'rapid practice attempts must serialize account-sync writes per drill');
requirePattern(app, /function syncPendingPracticeEvents[\s\S]{0,500}!event\.synced/, 'offline practice events must retry after account reconnection');
requirePattern(app, /mergeRemotePracticeRecords\(drillsResult\.data \|\| \[\], ownerId\)/, 'remote drill scheduling must hydrate the active account progress');
requirePattern(app, /mergeRemotePracticeEvents\(\(attemptsResult\.data \|\| \[\]\)\.slice\(\)\.reverse\(\), ownerId\)/, 'remote attempt history must hydrate the active account trends');
requirePattern(app, /function startCoachPracticeSession[\s\S]{0,900}coachPracticeRun/, 'practice must support ordered multi-drill sessions');
requirePattern(app, /function practiceTrendSnapshot[\s\S]{0,2600}previousRate[\s\S]{0,1200}streak/, 'practice progress must include recent trends and streaks');
requirePattern(app, /const DAILY_SPRINT_KEY = 'coach:daily-sprint:v1'[\s\S]{0,180}DAILY_MOVE_TARGET = 10[\s\S]{0,120}DAILY_DRILL_TARGET = 2[\s\S]{0,120}DAILY_TRANSFER_TARGET = 6/, 'adaptive sessions must define bounded baseline, drill, and transfer targets');
requirePattern(app, /function dailySprintStorageKey[\s\S]{0,220}ownerId[\s\S]{0,3000}function adoptAnonymousDailySprint/, 'Daily Sprint history must be isolated by account and adopt anonymous work');
requirePattern(app, /function mergeDailySprintDay[\s\S]{0,4200}drillIds[\s\S]{0,1200}moveIds[\s\S]{0,2200}completedUnits/, 'cross-device session reconciliation must preserve progress completed on either device');
requirePattern(app, /function queueRemoteDailySprintSync[\s\S]{0,900}syncRemoteDailySprints[\s\S]{0,2600}daily_training_sessions[\s\S]{0,1400}upsert/, 'signed-in adaptive sessions must retry local progress and hydrate remote history');
requirePattern(app, /function adaptiveFocusProfile[\s\S]{0,3200}severity \* recency[\s\S]{0,2600}function adaptiveDailyPlan/, 'adaptive focus must combine error severity, recency, and practice results');
requirePattern(app, /kind: 'focus-transfer'[\s\S]{0,700}drillTarget[\s\S]{0,200}moveTarget: DAILY_TRANSFER_TARGET/, 'returning sessions must connect focused drills to transfer moves');
requirePattern(app, /function upgradeLegacyDailySprint[\s\S]{0,2200}legacyCompleted[\s\S]{0,1600}Continued from the Daily Sprint/, 'in-progress Daily Sprint state must upgrade without losing completed work');
requirePattern(app, /function recordDailySprintMove[\s\S]{0,1800}phase = 'complete'[\s\S]{0,1800}function recordDailySprintDrill[\s\S]{0,1600}phase = 'moves'/, 'adaptive sessions must progress from drills through live transfer to completion');
requirePattern(app, /function orderedPracticeRunItems[\s\S]{0,700}renderedAdaptivePlan\.drillTarget[\s\S]{0,300}slice\(0, Math\.max\(1, target\)\)/, 'adaptive drill sessions must stay bounded by the selected plan');
requirePattern(app, /function placeDailySprintCard[\s\S]{0,700}isCompactLayout[\s\S]{0,500}coach-hero/, 'Daily Sprint must appear before optional setup on compact first visits');
requirePattern(html, /id="coach-practice-banner"[\s\S]{0,800}id="btn-coach-practice-answer"[\s\S]{0,300}id="btn-coach-practice-exit"/, 'practice mode needs answer and exit controls');
requirePattern(html, /id="coach-practice-session-status"[\s\S]{0,800}id="btn-coach-practice-next"/, 'practice mode needs session position and next-drill controls');
requirePattern(html, /id="btn-summary-practice"/, 'post-game review needs a direct practice action');
requirePattern(html, /id="practice-progress-attempts"[\s\S]{0,400}id="practice-progress-success"[\s\S]{0,400}id="practice-progress-mastered"/, 'practice queue must display progress metrics');
requirePattern(html, /id="practice-progress-week"[\s\S]{0,300}id="practice-progress-streak"[\s\S]{0,500}id="practice-trend-bars"/, 'practice progress must render seven-day activity and streaks');
requirePattern(html, /id="coach-daily-plan"[\s\S]{0,900}id="coach-daily-plan-title"[\s\S]{0,1600}id="btn-coach-next-action"/, 'Coach must always show one clear next training action');
requirePattern(html, /Adaptive session · 5–10 min[\s\S]{0,900}id="daily-sprint-focus-title"[\s\S]{0,900}id="daily-sprint-progress-label"[\s\S]{0,700}id="daily-sprint-takeaway"/, 'adaptive session must show its focus, timebox, progress, and completion takeaway');
requirePattern(app, /function renderCoachDailyPlan[\s\S]{0,2200}Today’s training complete[\s\S]{0,5000}Continue rehearsing[\s\S]{0,3600}Train .*then transfer[\s\S]{0,2800}Build your 10-move baseline/, 'daily plan must cover completion, restored rehearsal, focused transfer, and first-time baseline journeys');
requirePattern(migration, /create table public\.practice_attempts[\s\S]{0,1800}enable row level security/, 'attempt history must be RLS-protected');
requirePattern(migration, /function public\.record_practice_attempt[\s\S]{0,600}security invoker[\s\S]{0,4200}pg_advisory_xact_lock/, 'practice RPC must be security-invoker and serialize each drill');
requirePattern(migration, /on conflict \(id\) do nothing[\s\S]{0,300}row_count/, 'practice RPC must be idempotent by event id');
requirePattern(migration, /order by attempted_at asc, id asc[\s\S]{0,1800}last_attempt_at = v_last_attempt_at/, 'practice RPC must rebuild schedules chronologically for late offline events');
requirePattern(dbTest, /plan\(23\)[\s\S]+older offline attempt can arrive after newer events[\s\S]+late delivery preserves the chronologically latest schedule anchor/, 'database tests must prove idempotency, late-event ordering, and account isolation');
requirePattern(dailyMigration, /create table public\.daily_training_sessions[\s\S]{0,1600}enable row level security[\s\S]{0,1800}to authenticated[\s\S]{0,1800}grant select, insert, update/, 'adaptive session sync must use an RLS-protected, explicitly granted account table');
requirePattern(dailyDbTest, /plan\(12\)[\s\S]+another account cannot read the first account session[\s\S]+another account cannot insert for the first account/, 'database tests must prove adaptive-session account isolation');
requirePattern(smoke, /legacy move sprint was not preserved[\s\S]+legacy drill sprint was not preserved[\s\S]+one-click session[\s\S]+reload skipped an unfinished adaptive drill phase[\s\S]+restored adaptive drill session did not restart[\s\S]+focused drills did not advance into transfer play[\s\S]+adaptive takeaway did not assess live transfer[\s\S]+adaptive session completion did not survive reload[\s\S]+daily sprint progress leaked between browser accounts[\s\S]+revealed answer was not completed[\s\S]+stale engine result leaked[\s\S]+clean first visit did not offer a one-click baseline[\s\S]+mobile first visit did not show the Daily Sprint before optional account setup[\s\S]+reviewed move did not advance the Daily Sprint[\s\S]+ten reviewed moves did not complete the Daily Sprint[\s\S]+move sprint completion did not persist across reload/, 'browser smoke must cover upgrades, mid-phase reload, baseline and adaptive transfer journeys, persistence, isolation, mobile priority, races, and completion');
requirePattern(smoke, /setViewportSize\(\{ width: 390, height: 844 \}\)/, 'browser smoke must cover the 390px mobile layout');
requirePattern(workflow, /scripts\/verify-browser\.sh[\s\S]+supabase test db --local/, 'CI must enforce the complete browser and database regressions');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Practice-loop validation passed.');
