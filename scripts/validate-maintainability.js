#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const errors = [];

function requirePattern(pattern, message) {
  if (!pattern.test(html)) errors.push(message);
}

requirePattern(/const libraryState\s*=/, 'global state must expose a libraryState namespace');
requirePattern(/const coachState\s*=/, 'global state must expose a coachState namespace');
requirePattern(/const syncState\s*=/, 'global state must expose a syncState namespace');
requirePattern(/const uiState\s*=/, 'global state must expose a uiState namespace');

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
requirePattern(/const engine\s*=\s*engineClient/, 'legacy engine references must be a compatibility alias');

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
