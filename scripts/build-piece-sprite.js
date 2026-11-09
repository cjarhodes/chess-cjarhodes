#!/usr/bin/env node
// Builds vendor/pieces/cburnett/sprite.svg, the piece sprite cm-chessboard
// draws from, out of the twelve vendored cburnett files (45×45 viewBox each).
// cm-chessboard looks pieces up as <g id="wk">…<g id="bp"> in one SVG, and
// scales each by squareSize / tileSize, so the board uses tileSize 45.
// Run after changing the piece files:  node scripts/build-piece-sprite.js
// Pass --check to fail (exit 1) when the committed sprite is out of date;
// scripts/validate-design-tokens.js runs the same comparison.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'vendor/pieces/cburnett');
const out = path.join(dir, 'sprite.svg');
const TILE = 45;

function pieceBody(file) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8').trim();
  const m = text.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/);
  if (!m) throw new Error(`${file}: expected a single <svg> root`);
  const attrs = m[1];
  if (!/viewBox="0 0 45 45"/.test(attrs)) throw new Error(`${file}: expected viewBox="0 0 45 45"`);
  // The root carries no presentation attributes, so the body can move into a
  // <g> unchanged. Refuse anything else rather than silently drop styling.
  const extra = attrs.replace(/\s*xmlns="[^"]*"/, '').replace(/\s*viewBox="[^"]*"/, '').trim();
  if (extra) throw new Error(`${file}: unexpected root attributes ${extra}`);
  if (/\bid="/.test(m[2])) throw new Error(`${file}: element ids would clash inside the sprite`);
  return m[2].trim();
}

function build() {
  const groups = [];
  for (const color of ['w', 'b']) {
    for (const type of ['k', 'q', 'r', 'b', 'n', 'p']) {
      const file = `${color}${type.toUpperCase()}.svg`;
      groups.push(`  <g id="${color}${type}">${pieceBody(file)}</g>`);
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!--',
    'cburnett chess pieces as a cm-chessboard sprite.',
    'Copyright (c) Colin M.L. Burnett. Licensed under CC BY-SA 3.0',
    '(https://creativecommons.org/licenses/by-sa/3.0/). Obtained from the Lichess',
    'repository (lichess-org/lila, public/piece/cburnett). Generated from the',
    'unmodified files beside this one by scripts/build-piece-sprite.js; do not edit.',
    '-->',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">`,
    ...groups,
    '</svg>',
    ''
  ].join('\n');
}

module.exports = { build, out };
if (require.main !== module) return;

const sprite = build();
if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== sprite) {
    console.error('vendor/pieces/cburnett/sprite.svg is out of date; run node scripts/build-piece-sprite.js');
    process.exit(1);
  }
  console.log('Piece sprite is up to date.');
} else {
  fs.writeFileSync(out, sprite);
  console.log(`Wrote ${path.relative(root, out)} (${sprite.length} bytes, tileSize ${TILE}).`);
}
