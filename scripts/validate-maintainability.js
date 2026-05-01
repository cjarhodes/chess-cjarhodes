#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const errors = [];

function requirePattern(pattern, message) {
  if (!pattern.test(app)) errors.push(message);
}

function forbidPattern(pattern, message) {
  if (pattern.test(app)) errors.push(message);
}

forbidPattern(/const libraryState\s*=/, 'dead libraryState namespace scaffolding should not remain');
forbidPattern(/const coachState\s*=/, 'dead coachState namespace scaffolding should not remain');
forbidPattern(/const syncState\s*=/, 'dead syncState namespace scaffolding should not remain');
forbidPattern(/const uiState\s*=/, 'dead uiState namespace scaffolding should not remain');

requirePattern(/const CoachController\s*=/, 'Coach move flow must have a CoachController boundary');
requirePattern(/phase:\s*'idle'/, 'CoachController must track an explicit phase');
requirePattern(/setPhase\(phase/, 'CoachController must centralize phase transitions');
requirePattern(/CoachController\.setPhase\('analyzing'\)/, 'Coach analysis flow must mark analyzing phase');
requirePattern(/CoachController\.setPhase\('opponentThinking'\)/, 'Coach opponent flow must mark opponentThinking phase');
requirePattern(/CoachController\.setPhase\('ended'\)/, 'Coach game-over flow must mark ended phase');

requirePattern(/const coachSync\s*=/, 'Supabase behavior must be behind a coachSync API');
requirePattern(/saveMove\(review\)[\s\S]{0,120}syncRemoteCoachMove\(review\)/, 'coachSync API must expose saveMove');
requirePattern(/deleteMove\(review\)[\s\S]{0,120}deleteRemoteCoachMove\(review\)/, 'coachSync API must expose deleteMove');
requirePattern(/saveGame\(endReason\)[\s\S]{0,120}updateRemoteCoachGame\(endReason\)/, 'coachSync API must expose saveGame');
requirePattern(/loadInsights\(opts\)[\s\S]{0,120}refreshRemoteInsights\(opts/, 'coachSync API must expose loadInsights');

requirePattern(/const engineClient\s*=/, 'Stockfish wrapper must be named engineClient');
forbidPattern(/const engine\s*=\s*engineClient/, 'unused engine compatibility alias should not remain');
forbidPattern(/function squaresAttackedBy\(/, 'unused squaresAttackedBy helper should not remain');
forbidPattern(/function coachOpponentColorChar\(/, 'unused coachOpponentColorChar helper should not remain');
forbidPattern(/const PIECE_START_COUNT\s*=/, 'unused PIECE_START_COUNT helper should not remain');
forbidPattern(/document\.execCommand\(/, 'deprecated clipboard execCommand fallback should not remain');

requirePattern(/function bindLibraryEvents\(\)/, 'event wiring must be split into bindLibraryEvents');
requirePattern(/function bindCoachEvents\(\)/, 'event wiring must be split into bindCoachEvents');
requirePattern(/function bindExploreEvents\(\)/, 'event wiring must be split into bindExploreEvents');
requirePattern(/function bindGlobalInputEvents\(\)/, 'event wiring must be split into bindGlobalInputEvents');
requirePattern(/function hydrateFromUrl\(\)/, 'URL hydration must be isolated in hydrateFromUrl');
requirePattern(/bindLibraryEvents\(\);[\s\S]{0,120}bindCoachEvents\(\);[\s\S]{0,120}bindExploreEvents\(\);[\s\S]{0,160}bindGlobalInputEvents\(\);[\s\S]{0,160}hydrateFromUrl\(\);/, 'document ready should compose named boot steps');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Maintainability validation passed.');
