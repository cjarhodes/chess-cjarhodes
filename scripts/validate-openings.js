#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const start = html.indexOf('const OPENINGS = [');
const endMarker = '// STATE';
const end = html.indexOf(endMarker, start);

if (start === -1 || end === -1) {
  console.error('Could not locate OPENINGS data in index.html');
  process.exit(1);
}

const code = html.slice(start, end) + '\nglobalThis.OPENINGS = OPENINGS;';
const context = {};
vm.createContext(context);
vm.runInContext(code, context, { filename: 'index.html' });

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

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Validated ${openings.length} openings and ${openings.reduce((n, o) => n + getOpeningLines(o).length, 0)} lines.`);
