#!/usr/bin/env node
// Colour accessibility, checked from the token file (the artefact that sets
// every colour). Keyboard, screen-reader and dialog behaviour is tested in the
// running app by scripts/verify-behaviour-units.js and the browser smoke.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tokens = fs.readFileSync(path.join(root, 'styles', 'tokens.css'), 'utf8');
const errors = [];

// Every text pair at 4.5:1 and every graphic at 3:1, in light and dark and
// every board theme.
const contrastRun = spawnSync(process.execPath, [path.join(__dirname, 'check-contrast.js')], { encoding: 'utf8' });
if (contrastRun.status !== 0) {
  errors.push('colour tokens must meet WCAG AA contrast:\n' + (contrastRun.stderr || contrastRun.stdout).trim());
}

// Each selectable board theme defines both square colours, including the
// high-contrast option for low vision.
for (const theme of ['walnut', 'blue', 'contrast']) {
  const block = new RegExp(':root\\[data-board-theme="' + theme + '"\\]\\s*\\{[^}]*--board-light:[^}]*--board-dark:');
  if (!block.test(tokens)) errors.push('board theme ' + theme + ' must set both square colours');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Accessibility validation passed.');
