#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const openingsPath = path.join(root, 'openings.js');
const openingsSource = fs.readFileSync(openingsPath, 'utf8');

if (!openingsSource.includes('const OPENINGS = [')) {
  console.error('Could not locate OPENINGS data in openings.js');
  process.exit(1);
}

const code = openingsSource + '\nglobalThis.OPENINGS = OPENINGS;';
const context = {};
vm.createContext(context);
vm.runInContext(code, context, { filename: 'openings.js' });

const openings = context.OPENINGS;
const errors = [];

function getOpeningLines(opening) {
  return [{
    id: 'main',
    name: 'Main line',
    moves: opening.moves,
    explanations: opening.explanations,
    keyIdeas: opening.keyIdeas
  }].concat(opening.variations || []);
}

function fail(message) {
  errors.push(message);
}

const ids = new Set();
for (const opening of openings) {
  if (!opening.id) fail('Opening missing id');
  if (ids.has(opening.id)) fail(`Duplicate opening id: ${opening.id}`);
  ids.add(opening.id);

  if (!opening.name) fail(`${opening.id}: missing name`);
  if (!opening.category) fail(`${opening.id}: missing category`);
  if (!Array.isArray(opening.moves) || opening.moves.length === 0) {
    fail(`${opening.id}: missing moves`);
  }
  if (!Array.isArray(opening.explanations)) {
    fail(`${opening.id}: missing explanations`);
  } else if (Array.isArray(opening.moves) && opening.explanations.length !== opening.moves.length) {
    fail(`${opening.id}: explanations length ${opening.explanations.length} != moves length ${opening.moves.length}`);
  }

  const lineIds = new Set();
  for (const line of getOpeningLines(opening)) {
    const lineKey = `${opening.id}/${line.id}`;
    if (!line.id) fail(`${opening.id}: line missing id`);
    if (lineIds.has(line.id)) fail(`${opening.id}: duplicate line id ${line.id}`);
    lineIds.add(line.id);
    if (!line.name) fail(`${lineKey}: missing name`);
    if (!Array.isArray(line.moves) || line.moves.length === 0) {
      fail(`${lineKey}: missing moves`);
    }
    if (!Array.isArray(line.explanations)) {
      fail(`${lineKey}: missing explanations`);
    } else if (Array.isArray(line.moves) && line.explanations.length !== line.moves.length) {
      fail(`${lineKey}: explanations length ${line.explanations.length} != moves length ${line.moves.length}`);
    }
    if (Array.isArray(line.keyIdeas) && line.keyIdeas.length === 0) {
      fail(`${lineKey}: keyIdeas is empty`);
    }
  }
}

// Every line must be playable from the starting position with the same chess
// rules the app uses (vendored chess.js), so Study and Quiz never show an
// illegal move.
vm.runInContext(fs.readFileSync(path.join(root, 'vendor/chess.js/chess-0.10.3.min.js'), 'utf8'), context, { filename: 'chess.js' });
let movesPlayed = 0;
for (const opening of openings) {
  for (const line of getOpeningLines(opening)) {
    const game = new context.Chess();
    for (let i = 0; i < (line.moves || []).length; i++) {
      if (!game.move(line.moves[i])) {
        fail(`${opening.id}/${line.id}: move ${i + 1} (${line.moves[i]}) is illegal after ${game.history().join(' ') || 'the start'}`);
        break;
      }
      movesPlayed++;
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Validated ${openings.length} openings and ${openings.reduce((n, o) => n + getOpeningLines(o).length, 0)} lines (${movesPlayed} legal moves).`);
