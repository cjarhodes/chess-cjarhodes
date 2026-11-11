// Navigation state in the URL, with real browser history (redesign Phase 6,
// docs/redesign-plan.md §3). A route is what the address bar says:
//   { view, opening, line, mode, move, settings }
//   view      library | coach | puzzles
//   opening   Library opening id (null for the opening list)
//   line      Library line id, or null for the main line
//   mode      Library: study | quiz | explore; Puzzles: rated | daily | rush |
//             vision | endgames | repertoire; Coach: null
//   move      Library study position (ply index), or null
//   settings  open Settings section (appearance | account | data), or null
// The URLs from before the router keep working as entry points: ?view=coach,
// ?view=puzzles&mode=rush, ?opening=italian&mode=quiz, ?view=library&mode=explore,
// ?mode=explore, and a bare / (Coach, the home).
//
// History: a change of view, opening, line or mode, or opening Settings, is a
// new history entry; anything else (a study move, another Settings section,
// closing Settings) rewrites the current one. Back and Forward hand the
// route to the app (restoreRoute in src/views/shell.js) without a reload.
//
// parseRoute, routeSearch, routeKey and routeHistoryAction are pure, so
// scripts/validate-router.js runs them in Node.

const ROUTE_VIEWS = ['library', 'coach', 'puzzles'];
const ROUTE_LIBRARY_MODES = ['study', 'quiz', 'explore'];
const ROUTE_PUZZLE_MODES = ['rated', 'daily', 'rush', 'vision', 'endgames', 'repertoire'];
const ROUTE_SETTINGS_SECTIONS = ['appearance', 'account', 'data'];

function routeParams(search) {
  if (search && typeof search === 'object' && typeof search.get === 'function') return search;
  return new URLSearchParams(String(search || '').replace(/^\?/, ''));
}

// The address bar as a route. Unknown values fall back to the defaults, so
// an old or hand-typed link always lands somewhere sensible.
function parseRoute(search) {
  const p = routeParams(search);
  const view = p.get('view');
  const mode = p.get('mode');
  const settings = ROUTE_SETTINGS_SECTIONS.includes(p.get('settings')) ? p.get('settings') : null;
  const route = { view: 'coach', opening: null, line: null, mode: null, move: null, settings };
  if (view === 'coach') return route;
  if (view === 'puzzles') {
    route.view = 'puzzles';
    route.mode = ROUTE_PUZZLE_MODES.includes(mode) ? mode : 'rated';
    return route;
  }
  const opening = p.get('opening');
  if (opening || view === 'library' || mode === 'explore') {
    route.view = 'library';
    route.opening = opening || null;
    route.mode = ROUTE_LIBRARY_MODES.includes(mode) ? mode : 'study';
    // Only an opening's study mode has a position worth keeping; a quiz or
    // free exploration starts from its own beginning.
    if (opening) {
      const line = p.get('line');
      route.line = line && line !== 'main' ? line : null;
      const move = parseInt(p.get('move'), 10);
      if (route.mode === 'study' && Number.isInteger(move) && move >= 0) route.move = move;
    }
    return route;
  }
  return route;
}

// The canonical query string for a route ('' never happens: Coach is
// written out so a reload keeps the home explicit).
function routeSearch(route) {
  const r = route || {};
  const params = new URLSearchParams();
  if (r.view === 'puzzles') {
    params.set('view', 'puzzles');
    if (r.mode && r.mode !== 'rated') params.set('mode', r.mode);
  } else if (r.view === 'library') {
    // An opening link implies the Library; without one, say so.
    if (!r.opening) params.set('view', 'library');
    if (r.opening) params.set('opening', r.opening);
    if (r.opening && r.line && r.line !== 'main') params.set('line', r.line);
    if (r.mode === 'quiz' || r.mode === 'explore') params.set('mode', r.mode);
    if (r.opening && (!r.mode || r.mode === 'study') && Number.isInteger(r.move) && r.move >= 0) params.set('move', String(r.move));
  } else {
    params.set('view', 'coach');
  }
  if (r.settings) params.set('settings', r.settings);
  return '?' + params.toString();
}

// Everything that makes a place worth going Back to: not the study move, and
// (unless asked) not the Settings section.
function routeKey(route, withSettings) {
  const r = route || {};
  const view = ROUTE_VIEWS.includes(r.view) ? r.view : 'coach';
  const mode = view === 'library' ? (r.mode || 'study') : view === 'puzzles' ? (r.mode || 'rated') : '';
  const parts = [view, view === 'library' ? (r.opening || '') : '', view === 'library' && r.opening ? (r.line && r.line !== 'main' ? r.line : '') : '', mode];
  if (withSettings) parts.push(r.settings || '');
  return parts.join('|');
}

// 'push' for a new place (or Settings opening over the current one),
// 'replace' for the same place.
function routeHistoryAction(from, to) {
  if (routeKey(from) !== routeKey(to)) return 'push';
  if (!(from && from.settings) && to && to.settings) return 'push';
  return 'replace';
}

const Router = (function() {
  'use strict';
  const hasHistory = typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function';
  let started = false;
  let restoring = 0;
  let pushedThisTurn = false;
  let restoreHandler = null;

  // A magic link returns with the session in the fragment. It stays until
  // the Supabase client has read it (clearCoachAuthUrlState removes it), and
  // no history entry is added meanwhile, so the token never sits in an older
  // entry either. Any other fragment is dropped, as before the router.
  function authFragment() {
    if (typeof readCoachAuthUrlState !== 'function') return '';
    return readCoachAuthUrlState().present ? location.hash : '';
  }

  function current() {
    return parseRoute(location.search);
  }

  // Write a route to the address bar. The first new place in one turn of
  // the event loop pushes; anything after it in the same turn (one click
  // can switch view, load an opening and set a mode) rewrites that entry,
  // so one action is one Back step.
  function commit(route) {
    if (!hasHistory) return 'none';
    const fragment = authFragment();
    const url = location.pathname + routeSearch(route) + fragment;
    const from = current();
    const push = started && !restoring && !pushedThisTurn && !fragment && routeHistoryAction(from, route) === 'push';
    if (push) {
      const opensSettings = !!route.settings && !from.settings && routeKey(from) === routeKey(route);
      history.pushState({ chessRoute: 1, settingsEntry: opensSettings }, '', url);
      pushedThisTurn = true;
      Promise.resolve().then(() => { pushedThisTurn = false; });
      return 'push';
    }
    const state = Object.assign({}, history.state && typeof history.state === 'object' ? history.state : {}, { chessRoute: 1 });
    history.replaceState(state, '', url);
    return 'replace';
  }

  // Settings closes by going Back when its own entry is the current one, so
  // Back after closing does not land on Settings again.
  function settingsEntryIsCurrent() {
    return hasHistory && !!(history.state && history.state.settingsEntry) && !!current().settings;
  }

  function back() {
    if (hasHistory) history.back();
  }

  // Run fn while restoring: nothing it writes adds history.
  function quietly(fn) {
    restoring++;
    try { return fn(); } finally { restoring--; }
  }

  function onPopState() {
    if (!restoreHandler) return;
    quietly(() => restoreHandler(current(), { fromHistory: true }));
  }

  // Called once the page has applied the URL it loaded with; until then
  // every write rewrites the entry the page arrived on.
  function start(handler) {
    restoreHandler = handler;
    if (started || !hasHistory) return;
    started = true;
    // The app decides what is on screen after Back; the views scroll inside
    // their own panes, and the phone layout scrolls to the top on a view
    // change (src/ui/layout.js).
    try { history.scrollRestoration = 'manual'; } catch (e) { /* older browsers */ }
    window.addEventListener('popstate', onPopState);
  }

  return { commit, current, start, quietly, back, settingsEntryIsCurrent, isRestoring: () => restoring > 0 };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseRoute, routeSearch, routeKey, routeHistoryAction, ROUTE_VIEWS, ROUTE_LIBRARY_MODES, ROUTE_PUZZLE_MODES, ROUTE_SETTINGS_SECTIONS };
}
