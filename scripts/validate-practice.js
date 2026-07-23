#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'scripts/verify-browser.sh'), 'utf8');
const errors = [];

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) errors.push(message);
}

requirePattern(app, /const PRACTICE_PROGRESS_KEY = 'coach:practice:v1'/, 'practice progress must have dedicated persistence');
requirePattern(app, /function practiceItemId[\s\S]{0,300}fenBefore[\s\S]{0,100}bestUci/, 'practice ids must be deterministic from position and answer');
requirePattern(app, /function recordPracticeAttempt[\s\S]{0,1600}attempts \+= 1[\s\S]{0,800}dueAt/, 'practice attempts must update measurable spaced-repetition state');
requirePattern(app, /function coachHandlePracticeMove[\s\S]{0,2200}actualUci !== session\.item\.entry\.bestUci/, 'practice moves must be graded against the saved best move');
requirePattern(app, /function syncRemotePracticeProgress[\s\S]{0,1200}\.from\('drill_queue'\)[\s\S]{0,300}\.upsert/, 'signed-in practice scheduling must sync to drill_queue');
requirePattern(app, /function queueRemotePracticeProgressSync[\s\S]{0,900}practiceRemoteSyncChains/, 'rapid practice attempts must serialize account-sync writes per drill');
requirePattern(app, /mergeRemotePracticeRecords\(drillsResult\.data \|\| \[\]\)/, 'remote drill scheduling must hydrate local practice progress');
requirePattern(html, /id="coach-practice-banner"[\s\S]{0,800}id="btn-coach-practice-answer"[\s\S]{0,300}id="btn-coach-practice-exit"/, 'practice mode needs answer and exit controls');
requirePattern(html, /id="practice-progress-attempts"[\s\S]{0,400}id="practice-progress-success"[\s\S]{0,400}id="practice-progress-mastered"/, 'practice queue must display progress metrics');
requirePattern(smoke, /incorrect drill move was not rejected[\s\S]+correct drill move was not graded[\s\S]+practice progress did not survive reload[\s\S]+revealed answer was not completed[\s\S]+stale engine result leaked/, 'browser smoke must cover practice grading, persistence, answer reveal, and the replacement-game race');
requirePattern(smoke, /setViewportSize\(\{ width: 390, height: 844 \}\)/, 'browser smoke must cover the 390px mobile layout');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Practice-loop validation passed.');
