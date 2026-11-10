#!/usr/bin/env node
// Checks on shipped configuration rather than app code: Supabase migrations
// and their database tests, the CI workflow, and the service-worker kill
// switch. These files are the artefact, so pattern checks here are the right
// tool. App behaviour is tested in the browser (scripts/verify-*.js).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const errors = [];
const requirePattern = (source, pattern, message) => { if (!pattern.test(source)) errors.push(message); };
const forbidPattern = (source, pattern, message) => { if (pattern.test(source)) errors.push(message); };

const schema = read('supabase-schema.sql');
const profileMigration = read('supabase/migrations/20260817030844_sync_player_training_profile.sql');
const profileTest = read('supabase/tests/database/player_training_profiles.test.sql');
const practiceMigration = read('supabase/migrations/20260724025215_durable_practice_progress.sql');
const practiceTest = read('supabase/tests/database/durable_practice_progress.test.sql');
const dailyMigration = read('supabase/migrations/20260817024158_sync_adaptive_training_sessions.sql');
const dailyTest = read('supabase/tests/database/daily_training_sessions.test.sql');
const drillSourceMigration = read('supabase/migrations/20261108030000_keep_practised_drills.sql');
const drillSourceTest = read('supabase/tests/database/drill_source_move.test.sql');
const gameKeyMigration = read('supabase/migrations/20261108050000_coach_game_client_key.sql');
const gameKeyTest = read('supabase/tests/database/coach_game_client_key.test.sql');
const ootdDropMigration = read('supabase/migrations/20261108060000_drop_ootd_objects.sql');
const ootdDropTest = read('supabase/tests/database/ootd_objects_dropped.test.sql');
const archiveMigration = read('supabase/migrations/20261110010000_coach_archive_games.sql');
const archiveTest = read('supabase/tests/database/coach_archive_games.test.sql');
const workflow = read('.github/workflows/ci.yml');
const serviceWorker = read('service-worker.js');

// Row-level security and grants
forbidPattern(schema, /(?<!select\s)auth\.uid\(\)/, 'RLS policies should wrap auth.uid() as (select auth.uid())');
requirePattern(schema, /\(select auth\.uid\(\)\)/, 'RLS policies must use cached auth.uid() form');
requirePattern(profileMigration, /create table public\.player_training_profiles[\s\S]+enable row level security[\s\S]+for select to authenticated[\s\S]+for insert to authenticated[\s\S]+for update to authenticated[\s\S]+grant select, insert, update/, 'training profile sync must use explicit grants and owner-only RLS');
requirePattern(practiceMigration, /create table public\.practice_attempts[\s\S]{0,1800}enable row level security/, 'attempt history must be RLS-protected');
requirePattern(dailyMigration, /create table public\.daily_training_sessions[\s\S]{0,1600}enable row level security[\s\S]{0,1800}to authenticated[\s\S]{0,1800}grant select, insert, update/, 'adaptive session sync must use an RLS-protected, explicitly granted account table');
for (const [source, label] of [[archiveMigration, 'migration'], [schema, 'canonical schema']]) {
  requirePattern(source, /create table (if not exists )?public\.coach_archive_games[\s\S]+primary key \(user_id, game_key\)[\s\S]+check \(\(game is null\) = \(deleted_at is not null\)\)[\s\S]+enable row level security[\s\S]+for select to authenticated[\s\S]+for insert to authenticated[\s\S]+for update to authenticated[\s\S]+grant select, insert, update on table public\.coach_archive_games to authenticated/, `${label} must keep the synced game archive one row per game, owner-only, with tombstones and no client deletes`);
}
forbidPattern(archiveMigration, /grant[^;]*delete[^;]*coach_archive_games/, 'archive rows are tombstoned, never deleted by the client');

// Practice RPC semantics
requirePattern(practiceMigration, /function public\.record_practice_attempt[\s\S]{0,600}security invoker[\s\S]{0,4200}pg_advisory_xact_lock/, 'practice RPC must be security-invoker and serialize each drill');
requirePattern(practiceMigration, /on conflict \(id\) do nothing[\s\S]{0,300}row_count/, 'practice RPC must be idempotent by event id');
requirePattern(practiceMigration, /order by attempted_at asc, id asc[\s\S]{0,1800}last_attempt_at = v_last_attempt_at/, 'practice RPC must rebuild schedules chronologically for late offline events');

// A practised drill outlives its source move (take-backs must not erase it)
requirePattern(drillSourceMigration, /drop constraint[\s\S]+add constraint drill_queue_source_move_id_fkey\s+foreign key \(source_move_id\) references public\.coach_moves\(id\) on delete set null/, 'drill_queue.source_move_id must be re-created with on delete set null');
requirePattern(schema, /create table if not exists public\.drill_queue \([\s\S]{0,200}source_move_id uuid references public\.coach_moves\(id\) on delete set null/, 'canonical schema must keep drills when their source move is deleted');

// A pasted game is stored once per account. The unique index must not be
// partial: PostgREST's on_conflict cannot name an index predicate.
for (const [source, label] of [[gameKeyMigration, 'migration'], [schema, 'canonical schema']]) {
  requirePattern(source, /client_game_key text/, `${label} must give coach_games a client_game_key column`);
  requirePattern(source, /create unique index if not exists coach_games_user_client_key_unique_idx\s+on public\.coach_games\(user_id, client_game_key\);/, `${label} must make client_game_key unique per user with a plain (non-partial) index`);
}

// OOTD's leftovers are dropped: storage policies before the bucket row,
// then the function and tables. The canonical schema never carries them.
requirePattern(ootdDropMigration, /drop policy if exists "ootd-photos: read own" on storage\.objects;[\s\S]+drop policy if exists "ootd-photos: add own" on storage\.objects;[\s\S]+delete from storage\.buckets where id = 'ootd-photos'/, 'the OOTD drop migration must remove the bucket policies before the bucket');
requirePattern(ootdDropMigration, /drop function if exists public\.ootd_save_wardrobe\(jsonb, bigint, boolean\);[\s\S]+drop table if exists public\.ootd_wardrobe_history;[\s\S]+drop table if exists public\.ootd_wardrobes;/, 'the OOTD drop migration must drop the save function and both tables');
forbidPattern(schema, /ootd/i, 'supabase-schema.sql must not define OOTD objects');

// Database tests that prove the above
requirePattern(gameKeyTest, /plan\(10\)[\s\S]+a second paste of the same game does not create a second row[\s\S]+games without a client key are each kept[\s\S]+another account pasting the same game gets its own row/, 'database tests must prove a pasted game is stored once per account, with null keys and other accounts unaffected');
requirePattern(ootdDropTest, /plan\(6\)[\s\S]+hasnt_table\('public', 'ootd_wardrobes'[\s\S]+hasnt_table\('public', 'ootd_wardrobe_history'[\s\S]+hasnt_function\('public', 'ootd_save_wardrobe'[\s\S]+the OOTD photo bucket is removed[\s\S]+the OOTD photo bucket policies are removed/, 'database tests must prove the OOTD tables, function, bucket and policies are gone');
requirePattern(drillSourceTest, /plan\(6\)[\s\S]+deleting the source move keeps the drill and its practice progress[\s\S]+another account cannot read a drill with no source move/, 'database tests must prove a practised drill survives its source move and stays private');
requirePattern(archiveTest, /plan\(11\)[\s\S]+the same game is stored once[\s\S]+a row is either a game or a tombstone[\s\S]+another account cannot read the first account archive[\s\S]+archive rows cannot be deleted from the client/, 'database tests must prove the game archive is per game, tombstoned and private');
requirePattern(profileTest, /plan\(12\)[\s\S]+another account cannot read the first account profile[\s\S]+another account cannot insert for the first account/, 'database tests must prove training-profile account isolation');
requirePattern(practiceTest, /plan\(23\)[\s\S]+older offline attempt can arrive after newer events[\s\S]+late delivery preserves the chronologically latest schedule anchor/, 'database tests must prove idempotency, late-event ordering, and account isolation');
requirePattern(dailyTest, /plan\(12\)[\s\S]+another account cannot read the first account session[\s\S]+another account cannot insert for the first account/, 'database tests must prove adaptive-session account isolation');

// CI runs every regression
requirePattern(workflow, /for validator in scripts\/validate-\*\.js/, 'CI must run every validator');
requirePattern(workflow, /scripts\/verify-browser\.sh[\s\S]+supabase test db --local/, 'CI must enforce the complete browser and database regressions');

// Browser-only by design: the old service worker only removes itself
requirePattern(serviceWorker, /registration\.unregister\(\)/, 'service-worker.js must remain a kill switch that unregisters earlier installs');
requirePattern(serviceWorker, /caches\.keys\(\)[\s\S]+caches\.delete\(/, 'service-worker.js kill switch must clear every cache left by earlier installs');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Schema, CI and service-worker validation passed.');
