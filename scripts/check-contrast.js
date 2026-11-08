#!/usr/bin/env node
// Checks WCAG contrast for the colour pairs the components use, in both
// themes and every board theme, straight from the token file. Also checks
// that the two copies of the dark theme (media query and data-theme
// override) stay identical. Dependency-free.
//   node scripts/check-contrast.js [path/to/tokens.css]
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'styles', 'tokens.css');
const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector) {
  const start = css.indexOf(selector + ' {');
  if (start < 0) throw new Error('missing block ' + selector);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  throw new Error('unterminated block ' + selector);
}
function decls(body) {
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const base = decls(block(':root'));
const darkMedia = decls(block(':root:not([data-theme="light"])'));
const darkAttr = decls(block(':root[data-theme="dark"]'));
const boards = {
  sage: {},
  walnut: decls(block(':root[data-board-theme="walnut"]')),
  slate: decls(block(':root[data-board-theme="blue"]')),
  contrast: decls(block(':root[data-board-theme="contrast"]')),
};

const errors = [];
if (JSON.stringify(darkMedia) !== JSON.stringify(darkAttr)) {
  const keys = new Set([...Object.keys(darkMedia), ...Object.keys(darkAttr)]);
  for (const k of keys) if (darkMedia[k] !== darkAttr[k]) errors.push(`dark theme copies differ at ${k}: ${darkMedia[k]} vs ${darkAttr[k]}`);
}

function resolve(vars, name, seen = new Set()) {
  if (seen.has(name)) throw new Error('cycle at ' + name);
  seen.add(name);
  const value = vars[name];
  if (value === undefined) throw new Error('undefined token ' + name);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolve(vars, ref[1], seen) : value;
}
function rgb(value) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) throw new Error('not a solid hex colour: ' + value);
  const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
// A translucent token (rgba) is checked as drawn: composited over the
// surface it sits on. A pair's background may be [overlay, base].
function rgba(value) {
  const m = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (!m) return [...rgb(value), 1];
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}
function colour(vars, spec) {
  if (!Array.isArray(spec)) return resolve(vars, spec);
  const [over, under] = spec;
  const [r, g, b, a] = rgba(resolve(vars, over));
  const base = rgb(resolve(vars, under));
  return '#' + [r, g, b].map((v, i) => Math.round(v * a + base[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}
function lum(c) {
  const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const la = lum(rgb(a)), lb = lum(rgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// [foreground, background, minimum]. 4.5 for text, 3 for graphics and glyphs.
const TEXT = [
  ['--text', '--surface'], ['--text', '--bg'], ['--text', '--surface-2'], ['--text', '--nav-bg'],
  ['--text-2', '--surface'], ['--text-2', '--surface-2'], ['--text-2', '--bg'],
  ['--text-3', '--surface'], ['--text-3', '--surface-2'], ['--text-3', '--bg'], ['--text-3', '--nav-bg'],
  ['--accent-ink', '--accent'], ['--accent-text', '--surface'], ['--accent-text', '--bg'],
  // Selected rows, the current move chip, the quiz badge and Coach cues.
  ['--accent-text', ['--accent-soft', '--bg']], ['--accent-text', ['--accent-soft', '--surface']],
  ['--text', ['--accent-soft', '--bg']], ['--text', ['--accent-soft', '--surface']],
  ['--danger', '--surface'],
].map(p => [...p, 4.5]);
const GRAPHICS = [
  ['--mq-best', '--surface'], ['--mq-good', '--surface'], ['--mq-inaccuracy', '--surface'],
  ['--mq-mistake', '--surface'], ['--mq-blunder', '--surface'], ['--mq-excellent', '--surface'],
  ['--mq-book', '--surface'], ['--success', '--surface'], ['--warning', '--surface'],
  ['--focus-ring', '--surface'], ['--focus-ring', '--bg'],
].map(p => [...p, 3]);
const BOARD = [['--board-dark', '--board-light', 1.5]];

let checked = 0;
function run(label, vars, pairs) {
  for (const [fg, bg, min] of pairs) {
    const r = ratio(colour(vars, fg), colour(vars, bg));
    checked++;
    const bgName = Array.isArray(bg) ? bg.join(' over ') : bg;
    if (r < min) errors.push(`${label}: ${fg} on ${bgName} is ${r.toFixed(2)}:1, needs ${min}:1`);
  }
}
const themes = { light: base, dark: { ...base, ...darkAttr } };
for (const [name, vars] of Object.entries(themes)) {
  run(name, vars, [...TEXT, ...GRAPHICS]);
  for (const [board, overrides] of Object.entries(boards)) {
    const merged = { ...vars, ...overrides };
    run(`${name}/${board}`, merged, board === 'contrast' ? [['--board-dark', '--board-light', 3]] : BOARD);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Contrast check passed (${checked} pairs across light/dark and 4 board themes).`);
