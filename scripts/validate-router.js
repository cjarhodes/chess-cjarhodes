#!/usr/bin/env node
// Unit tests for the URL router's pure logic (src/ui/router.js): which
// address means which place (old links included), the canonical address for
// each place, and when a change is a new history entry. Back/Forward in the
// running app is covered by scripts/verify-behaviour-units.js.
const path = require('path');
const { parseRoute, routeSearch, routeKey, routeHistoryAction } = require(path.join(__dirname, '..', 'src', 'ui', 'router.js'));

const errors = [];
let assertions = 0;
const same = (actual, expected, message) => {
  assertions++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) errors.push(`${message}: expected ${e}, got ${a}`);
};
const route = (view, extra) => Object.assign({ view, opening: null, line: null, mode: null, move: null, settings: null }, extra || {});

// ── Entry points: every link from before the router still lands ──
same(parseRoute(''), route('coach'), 'a bare visit opens Coach, the home');
same(parseRoute('?view=coach'), route('coach'), '?view=coach');
same(parseRoute('?view=puzzles'), route('puzzles', { mode: 'rated' }), '?view=puzzles is rated puzzles');
same(parseRoute('?view=puzzles&mode=rush'), route('puzzles', { mode: 'rush' }), '?view=puzzles&mode=rush');
same(parseRoute('?view=puzzles&mode=repertoire'), route('puzzles', { mode: 'repertoire' }), 'the repertoire trainer');
same(parseRoute('?view=puzzles&mode=nonsense'), route('puzzles', { mode: 'rated' }), 'an unknown puzzle mode falls back to rated');
same(parseRoute('?opening=italian'), route('library', { opening: 'italian', mode: 'study' }), 'an opening link implies the Library');
same(parseRoute('?opening=italian&mode=quiz'), route('library', { opening: 'italian', mode: 'quiz' }), 'an opening quiz');
same(parseRoute('?opening=italian&mode=explore'), route('library', { opening: 'italian', mode: 'explore' }), 'explore from an opening');
same(parseRoute('?opening=italian&line=two-knights&move=3'), route('library', { opening: 'italian', line: 'two-knights', mode: 'study', move: 3 }), 'a line and a study move');
same(parseRoute('?opening=italian&line=main'), route('library', { opening: 'italian', mode: 'study' }), 'the main line is the default line');
same(parseRoute('?opening=italian&mode=quiz&move=3'), route('library', { opening: 'italian', mode: 'quiz' }), 'a quiz starts from its beginning');
same(parseRoute('?opening=italian&move=-2'), route('library', { opening: 'italian', mode: 'study' }), 'a negative move is the start');
same(parseRoute('?opening=italian&move=abc'), route('library', { opening: 'italian', mode: 'study' }), 'a non-numeric move is the start');
same(parseRoute('?view=library'), route('library', { mode: 'study' }), 'the opening list');
same(parseRoute('?view=library&mode=explore'), route('library', { mode: 'explore' }), 'free exploration');
same(parseRoute('?mode=explore'), route('library', { mode: 'explore' }), 'mode=explore alone opens free exploration');
same(parseRoute('?view=coach&opening=italian'), route('coach'), 'view=coach wins over an opening, as before');
same(parseRoute('?view=puzzles&opening=italian'), route('puzzles', { mode: 'rated' }), 'view=puzzles wins over an opening, as before');
same(parseRoute('?view=nowhere'), route('coach'), 'an unknown view is the home');
same(parseRoute('?view=coach&settings=account'), route('coach', { settings: 'account' }), 'Settings opens at a section');
same(parseRoute('?view=coach&settings=data'), route('coach', { settings: 'data' }), 'Settings → Training data');
same(parseRoute('?view=coach&settings=nonsense'), route('coach'), 'an unknown Settings section is ignored');
same(parseRoute('view=coach&settings=appearance'), route('coach', { settings: 'appearance' }), 'a query without its ? parses the same');
same(parseRoute(new URLSearchParams('view=puzzles&mode=daily')), route('puzzles', { mode: 'daily' }), 'URLSearchParams input');

// ── Canonical addresses (the same strings updateURL wrote before) ──
same(routeSearch(route('coach')), '?view=coach', 'Coach');
same(routeSearch(route('puzzles', { mode: 'rated' })), '?view=puzzles', 'rated puzzles carry no mode');
same(routeSearch(route('puzzles', { mode: 'rush' })), '?view=puzzles&mode=rush', 'Puzzle Rush');
same(routeSearch(route('library', { mode: 'study' })), '?view=library', 'the opening list');
same(routeSearch(route('library', { mode: 'explore' })), '?view=library&mode=explore', 'free exploration');
same(routeSearch(route('library', { opening: 'italian', mode: 'study' })), '?opening=italian', 'an opening at its start');
same(routeSearch(route('library', { opening: 'italian', mode: 'study', move: 4 })), '?opening=italian&move=4', 'a study position');
same(routeSearch(route('library', { opening: 'italian', mode: 'study', move: 0 })), '?opening=italian&move=0', 'the first move');
same(routeSearch(route('library', { opening: 'italian', line: 'two-knights', mode: 'quiz', move: 4 })), '?opening=italian&line=two-knights&mode=quiz', 'a quiz on a line keeps no move');
same(routeSearch(route('library', { opening: 'italian', line: 'main', mode: 'study' })), '?opening=italian', 'the main line is not written');
same(routeSearch(route('coach', { settings: 'account' })), '?view=coach&settings=account', 'Settings comes last');
same(routeSearch(route('library', { opening: 'italian', mode: 'study', move: 2, settings: 'data' })), '?opening=italian&move=2&settings=data', 'Settings over a study position');

// Round trip: every canonical address parses back to the same place.
const places = [
  route('coach'), route('coach', { settings: 'appearance' }),
  route('puzzles', { mode: 'rated' }), route('puzzles', { mode: 'vision' }), route('puzzles', { mode: 'endgames', settings: 'account' }),
  route('library', { mode: 'study' }), route('library', { mode: 'explore' }), route('library', { mode: 'quiz' }),
  route('library', { opening: 'ruy-lopez', mode: 'study', move: 7 }), route('library', { opening: 'ruy-lopez', line: 'berlin', mode: 'explore' })
];
places.forEach(place => same(parseRoute(routeSearch(place)), place, 'round trip ' + routeSearch(place)));

// ── History: new places push, the same place rewrites ──
const action = (a, b) => routeHistoryAction(parseRoute(a), parseRoute(b));
same(action('?view=coach', '?view=puzzles'), 'push', 'switching view');
same(action('?view=library', '?opening=italian'), 'push', 'opening an opening');
same(action('?opening=italian', '?opening=french'), 'push', 'another opening');
same(action('?opening=italian', '?opening=italian&line=two-knights'), 'push', 'another line');
same(action('?opening=italian', '?opening=italian&mode=quiz'), 'push', 'changing Library mode');
same(action('?view=puzzles', '?view=puzzles&mode=rush'), 'push', 'changing Puzzles mode');
same(action('?view=coach', '?view=coach&settings=appearance'), 'push', 'opening Settings');
same(action('?opening=italian&move=2', '?opening=italian&move=2&settings=data'), 'push', 'opening Settings over a position');
same(action('?opening=italian', '?opening=italian&move=0'), 'replace', 'a study move');
same(action('?opening=italian&move=5', '?opening=italian&move=2'), 'replace', 'stepping back through a line');
same(action('?view=coach', '?view=coach'), 'replace', 'the same place');
same(action('?view=coach&settings=appearance', '?view=coach&settings=account'), 'replace', 'another Settings section');
same(action('?view=coach&settings=account', '?view=coach'), 'replace', 'closing Settings');
same(action('?view=puzzles', '?view=puzzles&mode=rated'), 'replace', 'rated is the default puzzle mode');
same(action('', '?view=coach'), 'replace', 'the home written out');
same(action('?view=coach&settings=account', '?view=puzzles&settings=account'), 'push', 'a view change under Settings');
same(routeKey(parseRoute('?opening=italian&move=3')), routeKey(parseRoute('?opening=italian')), 'the key ignores the study move');
same(routeKey(parseRoute('?view=coach&settings=data'), true) === routeKey(parseRoute('?view=coach'), true), false, 'the key with Settings tells them apart');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Router validation passed (${assertions} assertions).`);
