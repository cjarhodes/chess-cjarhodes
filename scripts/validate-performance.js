#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase-schema.sql'), 'utf8');
const errors = [];

function fail(message) {
  errors.push(message);
}

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) fail(message);
}

function forbidPattern(source, pattern, message) {
  if (pattern.test(source)) fail(message);
}

const syncMoveBlock = app.match(/async function syncRemoteCoachMove\(review\) \{[\s\S]*?\n\}/);
const deleteMoveBlock = app.match(/async function deleteRemoteCoachMove\(review\) \{[\s\S]*?\n\}/);
const threatBlock = app.match(/async function showThreats\(\) \{[\s\S]*?\n\}/);

if (!syncMoveBlock) fail('syncRemoteCoachMove must exist');
if (!deleteMoveBlock) fail('deleteRemoteCoachMove must exist');
if (!threatBlock) fail('showThreats must exist');

requirePattern(app, /REMOTE_GAME_SYNC_DEBOUNCE_MS/, 'remote game updates must be debounced');
requirePattern(app, /function queueRemoteCoachGameUpdate/, 'remote game updates must use a queue helper');
requirePattern(app, /function upsertRemoteInsightEntry/, 'remote insights must be updated incrementally after move sync');
requirePattern(app, /function removeRemoteInsightEntry/, 'remote insights must be removable incrementally after takeback');
if (syncMoveBlock) {
  forbidPattern(syncMoveBlock[0], /refreshRemoteInsights/, 'per-move sync must not reload all remote insights');
  requirePattern(syncMoveBlock[0], /upsertRemoteInsightEntry/, 'per-move sync must apply the synced insight locally');
  requirePattern(syncMoveBlock[0], /queueRemoteCoachGameUpdate/, 'per-move sync must debounce parent game updates');
}
if (deleteMoveBlock) {
  forbidPattern(deleteMoveBlock[0], /refreshRemoteInsights/, 'takeback sync must not reload all remote insights');
  requirePattern(deleteMoveBlock[0], /removeRemoteInsightEntry/, 'takeback sync must remove the insight locally');
  requirePattern(deleteMoveBlock[0], /queueRemoteCoachGameUpdate/, 'takeback sync must debounce parent game updates');
}
requirePattern(app, /if\s*\(!artifacts\.drills\.length\s*&&\s*!artifacts\.cards\.length\)\s*return/, 'learning artifact sync must skip empty delete/upsert work');

forbidPattern(schema, /(?<!select\s)auth\.uid\(\)/, 'RLS policies should wrap auth.uid() as (select auth.uid())');
requirePattern(schema, /\(select auth\.uid\(\)\)/, 'RLS policies must use cached auth.uid() form');

requirePattern(app, /let threatRequestId\s*=/, 'threat scans must have a stale-position request guard');
requirePattern(app, /function renderThreatItems/, 'threat panel must render static threats independently');
if (threatBlock) {
  requirePattern(threatBlock[0], /renderThreatItems\(items\)/, 'showThreats must render static threats before mate scan finishes');
  requirePattern(threatBlock[0], /detectMateThreat\(fen\)\.then/, 'mate threat scan should run asynchronously after static render');
  requirePattern(threatBlock[0], /requestId !== threatRequestId/, 'mate threat scan must ignore stale results');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Performance validation passed.');
