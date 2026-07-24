#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'scripts/verify-browser.sh'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260724025215_durable_practice_progress.sql'), 'utf8');
const dbTest = fs.readFileSync(path.join(root, 'supabase/tests/database/durable_practice_progress.test.sql'), 'utf8');
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
requirePattern(html, /id="coach-practice-banner"[\s\S]{0,800}id="btn-coach-practice-answer"[\s\S]{0,300}id="btn-coach-practice-exit"/, 'practice mode needs answer and exit controls');
requirePattern(html, /id="coach-practice-session-status"[\s\S]{0,800}id="btn-coach-practice-next"/, 'practice mode needs session position and next-drill controls');
requirePattern(html, /id="btn-summary-practice"/, 'post-game review needs a direct practice action');
requirePattern(html, /id="practice-progress-attempts"[\s\S]{0,400}id="practice-progress-success"[\s\S]{0,400}id="practice-progress-mastered"/, 'practice queue must display progress metrics');
requirePattern(html, /id="practice-progress-week"[\s\S]{0,300}id="practice-progress-streak"[\s\S]{0,500}id="practice-trend-bars"/, 'practice progress must render seven-day activity and streaks');
requirePattern(html, /id="coach-daily-plan"[\s\S]{0,500}id="coach-daily-plan-title"[\s\S]{0,500}id="btn-coach-next-action"/, 'Coach must always show one clear next training action');
requirePattern(app, /function renderCoachDailyPlan[\s\S]{0,2600}practice drill[\s\S]{0,1200}Play one coached game/, 'daily plan must prioritize active work, due drills, and the next coached game');
requirePattern(migration, /create table public\.practice_attempts[\s\S]{0,1800}enable row level security/, 'attempt history must be RLS-protected');
requirePattern(migration, /function public\.record_practice_attempt[\s\S]{0,600}security invoker[\s\S]{0,4200}pg_advisory_xact_lock/, 'practice RPC must be security-invoker and serialize each drill');
requirePattern(migration, /on conflict \(id\) do nothing[\s\S]{0,300}row_count/, 'practice RPC must be idempotent by event id');
requirePattern(migration, /order by attempted_at asc, id asc[\s\S]{0,1800}last_attempt_at = v_last_attempt_at/, 'practice RPC must rebuild schedules chronologically for late offline events');
requirePattern(dbTest, /plan\(23\)[\s\S]+older offline attempt can arrive after newer events[\s\S]+late delivery preserves the chronologically latest schedule anchor/, 'database tests must prove idempotency, late-event ordering, and account isolation');
requirePattern(smoke, /multi-drill session did not start[\s\S]+session did not advance to drill two[\s\S]+seven-day attempts did not update[\s\S]+practice progress did not survive reload[\s\S]+failed account adoption removed anonymous progress[\s\S]+practice progress leaked between browser accounts[\s\S]+revealed answer was not completed[\s\S]+stale engine result leaked[\s\S]+missed mate was not classified as a blunder[\s\S]+post-game practice action did not open the generated drill[\s\S]+mating move was not classified as best/, 'browser smoke must cover sessions, trends, lossless account adoption, account isolation, engine races, and real missed/delivered mates');
requirePattern(smoke, /setViewportSize\(\{ width: 390, height: 844 \}\)/, 'browser smoke must cover the 390px mobile layout');
requirePattern(workflow, /scripts\/verify-browser\.sh[\s\S]+supabase test db --local/, 'CI must enforce the complete browser and database regressions');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Practice-loop validation passed.');
