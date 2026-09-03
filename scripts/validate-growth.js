#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const growth = fs.readFileSync(path.join(root, 'growth.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'scripts/verify-browser.sh'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260817030844_sync_player_training_profile.sql'), 'utf8');
const dbTest = fs.readFileSync(path.join(root, 'supabase/tests/database/player_training_profiles.test.sql'), 'utf8');
const errors = [];

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) errors.push(message);
}

requirePattern(growth, /function loadGrowthState[\s\S]+function mergeGrowthStates[\s\S]+function adoptAnonymousGrowthState/, 'growth state must migrate, merge, and adopt anonymous work');
requirePattern(growth, /function syncGrowthState[\s\S]+player_training_profiles[\s\S]+\.upsert/, 'growth state must sync through the account-scoped table');
requirePattern(app, /function loadSR\(\)[\s\S]{0,180}loadSyncedLibrarySR[\s\S]{0,220}function saveSR[\s\S]{0,180}saveSyncedLibrarySR/, 'Library spaced repetition must use the synced growth store');
requirePattern(growth, /function toggleRepertoireOpening[\s\S]+function renderRepertoireUI/, 'players must be able to build and render a personal repertoire');
requirePattern(growth, /function renderPersonalRepertoire[\s\S]+function recordImportedOpenings/, 'imported games must build a personal repertoire view and repair queue');
requirePattern(growth, /function repertoireConfidence[\s\S]+function setRepertoireFocus[\s\S]+function openingBridgeItem/, 'repertoire must track confidence, focus, and opening-to-middlegame bridge drills');
requirePattern(growth, /function recordRepertoirePracticeResult[\s\S]+function renderOpeningBridgeTrack/, 'opening bridge lessons must render and update repertoire confidence from practice');
requirePattern(growth, /recordImportedOpenings\(parsedGames, side, coachReviewLog\)/, 'PGN analysis must feed the personal repertoire');
requirePattern(growth, /function nextPlayerRatingEstimate[\s\S]+ratingGames[\s\S]+ratingDeviation[\s\S]+function recordRatedCoachResult/, 'player strength must update from completed game results with confidence and idempotency');
requirePattern(growth, /function recommendedCoachElo[\s\S]+ratingEstimate[\s\S]+function applyAdaptiveCoachElo/, 'automatic difficulty must follow the evidence-based player estimate');
requirePattern(app, /supportedOptions: new Set[\s\S]+option name \(\.\+\?\) type[\s\S]+supportedOptions\.has\('Skill Level'\)/, 'engine wrapper must detect and use only UCI options announced by the bundled engine');
requirePattern(app, /const COACH_DIFFICULTY_KEYFRAMES[\s\S]+function coachStrengthOpts[\s\S]+function chooseCalibratedOpponentMove/, 'opponent strength must use a continuous calibrated candidate-selection model');
requirePattern(app, /function coachHandleGameOver[\s\S]+recordRatedCoachResult\(msg\)[\s\S]+#btn-coach-resign[\s\S]+recordRatedCoachResult\(msg\)/, 'completed games and resignations must feed the player estimate');
if (/postMessage\('setoption name UCI_(?:Elo|LimitStrength)/.test(app)) errors.push('app must not send unsupported UCI Elo options');
if (/function chooseWeakOpponentMove/.test(app)) errors.push('random weak-move heuristic must not remain in the opponent path');
requirePattern(growth, /function transferMeasurement[\s\S]+beforeRate[\s\S]+afterRate[\s\S]+function renderWeeklyReview/, 'weekly review must compare problem recurrence before and after practice');
requirePattern(growth, /const ENDGAME_LESSONS[\s\S]+function renderEndgameTrack[\s\S]+startCoachPractice/, 'structured endgames must reuse the graded Coach practice loop');
requirePattern(growth, /const IMPORT_REVIEW_LIMIT = 30[\s\S]+function analyseImportedPgn[\s\S]+load_pgn[\s\S]+classifyMove/, 'PGN Inbox must parse and bound engine analysis of imported games');
requirePattern(growth, /function splitPgnGames[\s\S]+parsedGames[\s\S]+gameIndex/, 'PGN Inbox must support bounded multi-game imports');
requirePattern(growth, /const TRAINING_BACKUP_VERSION = 1[\s\S]+function readTrainingBackup[\s\S]+function mergeImportedTrainingData/, 'training data must have a versioned local export and safe merge path');
requirePattern(app, /function applyAdaptiveGoalBoost[\s\S]+adaptiveFocusProfile/, 'adaptive curriculum must honour the selected training goal');
requirePattern(app, /function updateNetworkStatus[\s\S]+Offline mode/, 'Coach must communicate offline persistence and reconnect state');
requirePattern(app, /function coachExplanationContext[\s\S]+opponentThreat[\s\S]+classifyMove/, 'Coach explanations must name a chess concept and the opponent threat');
requirePattern(app, /function renderCoachReviewEvidence[\s\S]+reviewBoardMarkup/, 'Coach reviews must visualise the before and after positions');
requirePattern(app, /function recurringMistakeSummaries[\s\S]+function renderRecurringMistakeDashboard/, 'Coach Insights must show recurring mistake trends over time');
requirePattern(html, /id="player-profile-form"[\s\S]+id="coach-auto-elo"[\s\S]+id="game-inbox-pgn"[\s\S]+id="weekly-review-section"[\s\S]+id="endgame-track-section"/, 'Coach UI must expose profile, adaptive strength, Game Inbox, weekly review, and endgames');
requirePattern(html, /id="training-data-card"[\s\S]+id="btn-export-training-data"[\s\S]+id="btn-import-training-data"/, 'Coach UI must expose portable training-data backup controls');
requirePattern(html, /id="opening-section"[\s\S]+id="btn-coach-opening-study"[\s\S]+Study this opening/, 'Coach opening context must bridge directly into the study library');
requirePattern(html, /id="personal-repertoire-card"[\s\S]+id="personal-repertoire-summary"[\s\S]+id="personal-repertoire-list"/, 'Coach must show the repertoire discovered from imported games');
requirePattern(html, /id="coach-review-lesson"[\s\S]+id="coach-review-threat"/, 'Coach review must show the lesson and opponent threat separately');
requirePattern(html, /id="coach-review-evidence"[\s\S]+id="opening-bridge-section"[\s\S]+id="insights-recurring-list"/, 'Coach UI must expose visual evidence, opening-to-middlegame training, and recurring trends');
requirePattern(html, /id="player-style"/, 'training profile must let players choose a drills-first, play-first, or balanced session style');
requirePattern(html, /id="network-status"[^>]+role="status"[^>]+aria-live="polite"/, 'offline state must be announced accessibly');
// Browser-only by design: the site must never become an installable app again,
// because installed copies capture magic-link URLs and open them outside the browser.
if (/rel="manifest"/.test(html)) errors.push('app must stay browser-only: index.html must not link a web app manifest');
if (fs.existsSync(path.join(root, 'manifest.webmanifest'))) errors.push('app must stay browser-only: manifest.webmanifest must not exist');
if (/serviceWorker\.register|beforeinstallprompt|appinstalled/.test(growth + app)) errors.push('app must stay browser-only: no service worker registration or install prompt');
if (/btn-install-app/.test(html + growth)) errors.push('app must stay browser-only: no install button');
requirePattern(worker, /registration\.unregister\(\)/, 'service-worker.js must remain a kill switch that unregisters earlier installs');
requirePattern(worker, /caches\.keys\(\)[\s\S]+caches\.delete\(/, 'service-worker.js kill switch must clear every cache left by earlier installs');
if (/addEventListener\('fetch'/.test(worker)) errors.push('service-worker.js must not intercept fetches');
requirePattern(migration, /create table public\.player_training_profiles[\s\S]+enable row level security[\s\S]+for select to authenticated[\s\S]+for insert to authenticated[\s\S]+for update to authenticated[\s\S]+grant select, insert, update/, 'training profile sync must use explicit grants and owner-only RLS');
requirePattern(dbTest, /plan\(12\)[\s\S]+another account cannot read the first account profile[\s\S]+another account cannot insert for the first account/, 'database tests must prove training-profile account isolation');
requirePattern(smoke, /cross-device growth merge lost Library progress[\s\S]+training profile did not save through onboarding UI[\s\S]+browser-only shell still exposes an installable app[\s\S]+emailed code field showed before the project enabled it[\s\S]+pending sign-in code entry did not render[\s\S]+expired sign-in link was not reported[\s\S]+personal repertoire did not persist across reload[\s\S]+structured endgame lesson was not graded[\s\S]+PGN Game Inbox did not complete a bounded imported review/, 'browser smoke must cover the complete player-growth journey');
requirePattern(smoke, /opponent did not reply after a capture/, 'browser smoke must play a capture and require an opponent reply');
requirePattern(smoke, /training backup merge did not preserve data[\s\S]+offline state was not announced in Coach/, 'browser smoke must cover portable backup and offline recovery');
requirePattern(smoke, /session style did not persist[\s\S]+repertoire bridge, recurring trends, or visual evidence did not initialise[\s\S]+repertoire focus did not persist/, 'browser smoke must cover session personalisation, repertoire rehearsal, comparison evidence, and recurring mistakes');
requirePattern(smoke, /difficulty mapping was not monotonic at every slider step[\s\S]+candidate selection did not tighten as difficulty increased[\s\S]+completed results did not move the player estimate[\s\S]+same completed game updated the player estimate twice[\s\S]+engine capability detection did not match/, 'browser smoke must prove monotonic difficulty, result-based estimation, idempotency, and real engine capabilities');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Growth feature validation passed.');
