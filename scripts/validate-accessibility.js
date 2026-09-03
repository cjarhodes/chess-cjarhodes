#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const errors = [];

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) errors.push(message);
}

function channel(hex, offset) {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const muted = (css.match(/--muted:\s*(#[0-9a-f]{6})/i) || [])[1];
const surface2 = (css.match(/--surface2:\s*(#[0-9a-f]{6})/i) || [])[1];
if (!muted || !surface2 || contrast(muted, surface2) < 4.5) {
  errors.push('muted text must meet WCAG AA contrast on surface2');
}

requirePattern(html, /role="tablist"[\s\S]+?aria-controls="library-view"[\s\S]+?aria-controls="coach-view"/, 'top navigation must expose a complete tab relationship');
requirePattern(app, /\.top-nav-btn'\)\.on\('keydown'[\s\S]+?ArrowLeft[\s\S]+?ArrowRight/, 'top tabs must support arrow-key navigation');
requirePattern(html, /id="promotion-picker"[^>]+aria-labelledby=/, 'promotion dialog must have an accessible name');
requirePattern(html, /id="summary-overlay"[^>]+aria-labelledby=/, 'summary dialog must have an accessible name');
requirePattern(app, /function trapDialogTab/, 'dialogs must trap keyboard focus');
requirePattern(html, /id="library-keyboard-move-form"[\s\S]+?id="coach-keyboard-move-form"/, 'both boards must offer a non-drag move form');
requirePattern(app, /function resolveAccessibleMove/, 'keyboard moves must resolve SAN and coordinate notation');
requirePattern(html, /id="coach-status"[^>]+aria-live="polite"/, 'Coach status must announce changes');
requirePattern(html, /id="feedback-bar"[^>]+aria-live="polite"/, 'quiz feedback must announce changes');
requirePattern(app, /document\.createElement\('button'\)[\s\S]{0,100}\.type = 'button'/, 'post-game moment rows must be real buttons');
requirePattern(html, /id="desktop-notice"[^>]+role="dialog"[^>]+aria-labelledby="desktop-notice-title"/, 'desktop notice must be an accessible dialog');
requirePattern(html, /id="btn-desktop-notice-continue"/, 'desktop notice must offer a way to continue');
requirePattern(html, /class="panel-tabs" role="tablist"[\s\S]+?aria-controls="panel-game"[\s\S]+?aria-controls="panel-practice"[\s\S]+?aria-controls="panel-progress"/, 'Coach panel tabs must expose a complete tab relationship');
requirePattern(app, /\.panel-tab'\)\.on\('keydown'[\s\S]+?ArrowLeft[\s\S]+?ArrowRight/, 'Coach panel tabs must support arrow-key navigation');
requirePattern(html, /id="coach-play-card"[\s\S]{0,600}id="btn-coach-newgame"/, 'primary game controls must sit at the top of the Coach rail');
requirePattern(css, /@media \(max-width:\s*1023px\)[\s\S]+?\.desktop-notice \{ display: flex; \}/, 'desktop notice must appear on narrow screens');
requirePattern(html, /class="top-nav-btn active"[^>]+id="nav-coach"[^>]+aria-selected="true"/, 'Coach must be the default selected application section');
requirePattern(html, /class="app"[^>]+id="library-view"[^>]+aria-hidden="true"[^>]+style="display:none;"/, 'Library must be hidden in the initial application shell');
requirePattern(html, /class="coach-view"[^>]+id="coach-view"[^>]+aria-hidden="false"/, 'Coach must be visible in the initial application shell');
requirePattern(app, /function localPieceTheme\(piece\)[\s\S]{0,120}vendor\/pieces\/cburnett\/\$\{piece\}\.svg/, 'pieces must use the vendored vector set so white stays legible on light squares');
requirePattern(css, /--sq-light:[\s\S]{0,200}--sq-dark:[\s\S]{0,400}html\[data-board-theme="green"\]/, 'board colours must be themeable with a green option');
for (const piece of ['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP']) {
  if (!fs.existsSync(path.join(root, 'vendor/pieces/cburnett/' + piece + '.svg'))) errors.push('missing vendored piece ' + piece);
}
const whiteKing = fs.readFileSync(path.join(root, 'vendor/pieces/cburnett/wK.svg'), 'utf8');
if (!/stroke="#000"/.test(whiteKing) || !/fill="#fff"/.test(whiteKing)) errors.push('white pieces must keep a dark outline around a white fill');
requirePattern(app, /function observeBoardLastMove[\s\S]{0,600}MutationObserver/, 'last-move highlight must survive chessboard.js redraws');
requirePattern(css, /\.square-55d63\.last-move \{ box-shadow: inset 0 0 0 100px var\(--sq-last-move\); \}/, 'last move must be highlighted on the board');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Accessibility validation passed.');
