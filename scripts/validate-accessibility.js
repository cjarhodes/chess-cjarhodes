#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
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

const muted = (html.match(/--muted:\s*(#[0-9a-f]{6})/i) || [])[1];
const surface2 = (html.match(/--surface2:\s*(#[0-9a-f]{6})/i) || [])[1];
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
requirePattern(html, /@media \(max-width:\s*600px\)[\s\S]+?\.top-nav/, 'header navigation must have a narrow-mobile layout');
requirePattern(html, /id="btn-mobile-openings"[^>]+aria-expanded=/, 'mobile opening picker must expose expansion state');
requirePattern(html, /class="top-nav-btn active"[^>]+id="nav-coach"[^>]+aria-selected="true"/, 'Coach must be the default selected application section');
requirePattern(html, /class="app"[^>]+id="library-view"[^>]+aria-hidden="true"[^>]+style="display:none;"/, 'Library must be hidden in the initial application shell');
requirePattern(html, /class="coach-view"[^>]+id="coach-view"[^>]+aria-hidden="false"/, 'Coach must be visible in the initial application shell');
requirePattern(app, /wB:\s*'♝'[\s\S]{0,100}wK:\s*'♚'[\s\S]{0,100}wN:\s*'♞'/, 'white pieces must use filled silhouettes rather than low-contrast hollow glyphs');
requirePattern(app, /const strokeWidth = isWhite \? '1\.35' : '0\.55'/, 'white pieces must retain a strong dark outline');
requirePattern(app, /paint-order="stroke fill"/, 'piece SVGs must render their contrast outline behind the fill');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Accessibility validation passed.');
