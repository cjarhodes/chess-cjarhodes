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
requirePattern(/function verifyCoachLoginCode[\s\S]{0,1200}auth\.verifyOtp\(\{ email, token: code, type: 'email' \}\)/, 'sign-in must accept the emailed 6-digit code so it can finish in the requesting tab');
requirePattern(/const COACH_AUTH_PENDING_EMAIL_KEY = 'coach:auth-pending-email'/, 'pending sign-in email must survive a reload for code entry');
requirePattern(/function coachEmailCodeEnabled\(\)[\s\S]{0,120}\.emailCodeEnabled/, 'the emailed code must be gated by the emailCodeEnabled config flag');
requirePattern(/toggle\(coachEmailCodeEnabled\(\) && !!pendingEmail\)/, 'the emailed code field must stay hidden until the project email template carries the code');
requirePattern(/function readCoachAuthUrlState[\s\S]{0,900}function clearCoachAuthUrlState[\s\S]{0,300}history\.replaceState/, 'magic-link tokens must be stripped from the URL after the session is read');
requirePattern(/Sign-in link is invalid or has expired/, 'expired magic links must show a visible status');
requirePattern(/function updateURL\(\)[\s\S]{0,1200}readCoachAuthUrlState\(\)\.present \? location\.hash : ''[\s\S]{0,80}history\.replaceState\(null, '', url \+ authHash\)/, 'URL sync must not drop the magic-link fragment before the Supabase client reads it');
requirePattern(/checkCoachAuthStorage\(\)/, 'Supabase auth storage must be capability-checked');
requirePattern(/localStorage\.setItem\(key, '1'\)[\s\S]{0,900}storageKey\.startsWith\('sb-'\)/, 'Supabase auth must persist across email-link tabs and migrate legacy sessions');
requirePattern(/Account sync cannot persist in this browser session/, 'Supabase storage fallback must be visible to users');
requirePattern(/Promise\.allSettled/, 'manual sync must aggregate partial failures');
requirePattern(/Game saved, insights failed|Insights loaded, game save failed/, 'manual sync must report partial sync failures');
requirePattern(/Paste a Lichess token first/, 'empty Lichess token submit must show feedback');
requirePattern(/function invalidateCoachAsyncWork[\s\S]{0,500}engineClient\.cancel/, 'position resets must cancel active and queued engine work');
requirePattern(/generation !== coachGameGeneration|coachGameGeneration !== generation/, 'async Coach work must reject stale game generations');
requirePattern(/const gameRef = coachGame/, 'move analysis must retain and verify the game object it started against');
requirePattern(/function createCoachGameId/, 'Coach games must have stable local ids');
requirePattern(/rollups:\s*\{\}/, 'lifetime stats must track per-game rollups');
requirePattern(/function unrollGameFromLifetime/, 'takeback must be able to remove a completed-game lifetime rollup');
requirePattern(/if \(coachLifetimeRolledForThisGame\) unrollGameFromLifetime\(\)/, 'takeback must unroll completed lifetime stats before resuming');
requirePattern(/#lichess-token-form'\)\.on\('submit'/, 'Lichess token entry must use form submission');
requirePattern(/#coach-auth-email-form'\)\.on\('submit'/, 'Coach sign-in must use form submission');
requirePattern(/navigator\.clipboard[\s\S]{0,300}\.catch/, 'share-link clipboard failures must be handled');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Reliability validation passed.');
