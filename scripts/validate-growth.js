#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const growth = fs.readFileSync(path.join(root, 'growth.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
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
requirePattern(html, /id="player-profile-form"[\s\S]+id="coach-auto-elo"[\s\S]+id="game-inbox-pgn"[\s\S]+id="weekly-review-section"[\s\S]+id="endgame-track-section"/, 'Coach UI must expose profile, adaptive strength, Game Inbox, weekly review, and endgames');
requirePattern(html, /rel="manifest"[\s\S]+growth\.js/, 'the installable app must load its manifest and growth feature layer');
requirePattern(worker, /APP_SHELL[\s\S]+stockfish\/stockfish\.wasm[\s\S]+request\.mode === 'navigate'[\s\S]+caches\.match\('\/index\.html'\)/, 'offline shell must cache the engine and provide a navigation fallback');
if (manifest.display !== 'standalone' || manifest.scope !== '/') errors.push('manifest must install as a root-scoped standalone app');
requirePattern(migration, /create table public\.player_training_profiles[\s\S]+enable row level security[\s\S]+for select to authenticated[\s\S]+for insert to authenticated[\s\S]+for update to authenticated[\s\S]+grant select, insert, update/, 'training profile sync must use explicit grants and owner-only RLS');
requirePattern(dbTest, /plan\(12\)[\s\S]+another account cannot read the first account profile[\s\S]+another account cannot insert for the first account/, 'database tests must prove training-profile account isolation');
requirePattern(smoke, /cross-device growth merge lost Library progress[\s\S]+training profile did not save through onboarding UI[\s\S]+installable offline app shell did not register[\s\S]+personal repertoire did not persist across reload[\s\S]+structured endgame lesson was not graded[\s\S]+PGN Game Inbox did not complete a bounded imported review/, 'browser smoke must cover the complete player-growth journey');
requirePattern(smoke, /difficulty mapping was not monotonic at every slider step[\s\S]+candidate selection did not tighten as difficulty increased[\s\S]+completed results did not move the player estimate[\s\S]+same completed game updated the player estimate twice[\s\S]+engine capability detection did not match/, 'browser smoke must prove monotonic difficulty, result-based estimation, idempotency, and real engine capabilities');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Growth feature validation passed.');
