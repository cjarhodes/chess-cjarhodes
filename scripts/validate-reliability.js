#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const errors = [];

function fail(message) {
  errors.push(message);
}

function requirePattern(pattern, message) {
  if (!pattern.test(app)) fail(message);
}

requirePattern(/failAll\s*\(/, 'engine must expose failAll for worker-level failures');
requirePattern(/this\.worker\.onerror[\s\S]{0,300}this\.failAll/, 'worker.onerror must fail active and queued engine tasks');
requirePattern(/reject:\s*reject/, 'engine evaluate tasks must carry a reject callback');
requirePattern(/id="btn-coach-retry-opponent"[\s\S]{0,300}Retry/, 'opponent timer failures must show a retry action');
requirePattern(/Opponent move failed[\s\S]{0,120}retry or take back/, 'opponent timer failures must show a retry message');
requirePattern(/setTimeout\(\(\)\s*=>\s*\{[\s\S]*?try\s*\{[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?showCoachRetryStatus\('Opponent move failed/, 'opponent delayed move body must catch and surface failures');
requirePattern(/function saveSR\(data\)[\s\S]{0,250}return\s*\{\s*ok:\s*true\s*\}/, 'saveSR must return a success result');
requirePattern(/function saveSR\(data\)[\s\S]{0,350}return\s*\{\s*ok:\s*false,\s*error/, 'saveSR must return an error result when storage fails');
requirePattern(/Progress could not be saved in this browser/, 'quiz completion must warn when spaced-repetition progress cannot be saved');
requirePattern(/COACH_STATE_BACKUP_KEY/, 'corrupt coach restore should preserve a backup key');
requirePattern(/Previous game could not be restored/, 'corrupt coach restore should show visible status');
requirePattern(/function detectMateThreat\(fen\)[\s\S]{0,700}status:\s*'unavailable'/, 'mate threat detection must distinguish unavailable from no threat');
requirePattern(/Mate scan unavailable/, 'threat panel must render mate-scan failures');
requirePattern(/function createMemoryAuthStorage/, 'Supabase auth needs an in-memory storage fallback');
requirePattern(/checkCoachAuthStorage\(\)/, 'Supabase auth storage must be capability-checked');
requirePattern(/Account sync cannot persist in this browser session/, 'Supabase storage fallback must be visible to users');
requirePattern(/Promise\.allSettled/, 'manual sync must aggregate partial failures');
requirePattern(/Game saved, insights failed|Insights loaded, game save failed/, 'manual sync must report partial sync failures');
requirePattern(/Paste a Lichess token first/, 'empty Lichess token submit must show feedback');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Reliability validation passed.');
