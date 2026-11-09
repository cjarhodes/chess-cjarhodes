// Responsive layout (redesign Phase 6a). styles.css lays the views out at
// three widths (see "RESPONSIVE LAYOUT" there). The stacked layout (phones,
// tablets held upright, phones held sideways) puts the board first and the
// panels under it, which needs a few things CSS cannot do on its own:
//   - the notation moves from the side panel to a strip under the board, and
//     the strip keeps the current move in view;
//   - after an action that changes what the board shows (choosing an opening,
//     starting a game, drill or puzzle, switching view), the page scrolls back
//     to the board instead of leaving it above the screen.
// Nothing here touches game state or board input; it only moves and scrolls.
// Must equal the stacked-layout media query in styles.css
// (scripts/validate-design-tokens.js checks it).
const LAYOUT_STACKED_QUERY = '(max-width: 759.98px), (max-width: 1199.98px) and (orientation: portrait), (max-width: 1199.98px) and (max-height: 499.98px)';

function layoutIsStacked() {
  return !!(window.matchMedia && window.matchMedia(LAYOUT_STACKED_QUERY).matches);
}

(function() {
  'use strict';
  // Each strip: the notation block, where it goes in the stacked layout, and
  // the element that marks the current move.
  const STRIPS = [
    { id: 'movelist-section', list: 'movelist', current: '.ply.current', place: el => {
      const nav = document.querySelector('.coach-board-area .board-nav');
      if (nav) nav.before(el);
    } },
    { id: 'library-moves', list: 'move-list', current: '.move-chip.current', place: el => {
      const wrap = document.getElementById('board-wrap');
      if (wrap) wrap.after(el);
    } }
  ];
  const homes = new Map();
  const motionOk = () => !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function placeStrips() {
    const stacked = layoutIsStacked();
    document.documentElement.classList.toggle('layout-stacked', stacked);
    STRIPS.forEach(strip => {
      const el = document.getElementById(strip.id);
      if (!el) return;
      if (!homes.has(strip.id)) {
        const marker = document.createComment(' ' + strip.id + ' sits here outside the stacked layout ');
        el.before(marker);
        homes.set(strip.id, marker);
      }
      el.classList.toggle('notation-strip', stacked);
      // Moving a node drops focus inside it; put it back (rotating a phone
      // must not lose the keyboard or screen-reader position).
      const focused = el.contains(document.activeElement) ? document.activeElement : null;
      if (stacked) strip.place(el);
      else homes.get(strip.id).after(el);
      if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
      centreCurrent(strip);
    });
  }

  // Keep the current move in the middle of the strip (only the strip
  // scrolls, never the page).
  function centreCurrent(strip) {
    const list = document.getElementById(strip.list);
    if (!list || !layoutIsStacked() || !list.clientWidth) return;
    const current = list.querySelector(strip.current);
    if (!current) { list.scrollLeft = 0; return; }
    const l = list.getBoundingClientRect();
    const c = current.getBoundingClientRect();
    list.scrollLeft += (c.left + c.width / 2) - (l.left + l.width / 2);
  }

  // The stacked layout reorders sections with CSS `order` (board first, the
  // opening list last, a drill's question above the board). Keyboard focus
  // and screen readers follow the DOM, so the DOM is put in the same order:
  // children sorted by their computed `order`, ties keeping their current
  // place. Wider layouts get the original markup order back.
  const ORDERED = ['#library-view', '#coach-view', '#puzzles-view', '#library-view .board-area', '.coach-board-area', '.puzzles-board-area'];
  const original = new Map();
  function syncOrder() {
    const stacked = layoutIsStacked();
    ORDERED.forEach(selector => {
      const container = document.querySelector(selector);
      if (!container) return;
      if (!original.has(container)) original.set(container, [...container.children]);
      const home = original.get(container);
      const kids = [...container.children];
      const at = el => kids.indexOf(el);
      const homeAt = el => { const i = home.indexOf(el); return i < 0 ? home.length + at(el) : i; };
      const orderOf = el => parseInt(getComputedStyle(el).order, 10) || 0;
      const desired = kids.slice().sort(stacked
        ? (a, b) => (orderOf(a) - orderOf(b)) || (at(a) - at(b))
        : (a, b) => homeAt(a) - homeAt(b));
      if (desired.every((el, i) => el === kids[i])) return;
      const focused = container.contains(document.activeElement) ? document.activeElement : null;
      desired.forEach(el => container.appendChild(el));
      if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
    });
  }

  // What changes the order: the Coach state and classes, and whether the
  // Library has an opening on the board.
  function watchOrder() {
    if (typeof MutationObserver === 'undefined') return;
    let frame = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; syncOrder(); });
    };
    const coach = document.getElementById('coach-view');
    if (coach) new MutationObserver(schedule).observe(coach, { attributes: true, attributeFilter: ['class', 'data-ui-state'] });
    const placeholder = document.getElementById('board-placeholder');
    if (placeholder) new MutationObserver(schedule).observe(placeholder, { attributes: true, attributeFilter: ['style'] });
  }

  function watchStrips() {
    if (typeof MutationObserver === 'undefined') return;
    STRIPS.forEach(strip => {
      const list = document.getElementById(strip.list);
      if (!list) return;
      let frame = null;
      new MutationObserver(() => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => { frame = null; centreCurrent(strip); });
      }).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    });
  }

  // Bring a view's board area to the top of the screen when it is above it
  // (or mostly below it).
  function revealBoard(selector) {
    if (!layoutIsStacked()) return;
    requestAnimationFrame(() => {
      const area = document.querySelector(selector);
      if (!area || !area.offsetParent) return;
      const top = area.getBoundingClientRect().top;
      if (top >= 0 && top < window.innerHeight * 0.25) return;
      window.scrollTo({ top: Math.max(0, window.scrollY + top), behavior: motionOk() ? 'smooth' : 'instant' });
    });
  }

  function watchActions() {
    // Library: choosing an opening (from the list or the review queue).
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest('#library .opening-btn, #library [data-id], #sr-due-list button')) revealBoard('#library-view .board-area');
      // Puzzles: actions in the panel that load a position on the board.
      // The mode buttons sit below the board in the stacked layout.
      if (target.closest('.puzzles-rail .puzzle-mode')) revealBoard('.puzzles-board-area');
      const puzzleButton = target.closest('.puzzles-panel button');
      if (puzzleButton && !puzzleButton.closest('.puzzle-side-toggle') && puzzleButton.id !== 'btn-puzzle-rush-stop') revealBoard('.puzzles-board-area');
      // Coach: the panel tabs sit under the board; keep the chosen page in view.
      if (target.closest('.panel-tab')) {
        requestAnimationFrame(() => {
          const tabs = document.querySelector('.coach-panel .panel-tabs');
          if (!tabs || !layoutIsStacked()) return;
          const top = tabs.getBoundingClientRect().top;
          if (top < 0 || top > window.innerHeight * 0.6) tabs.scrollIntoView({ block: 'start', behavior: motionOk() ? 'smooth' : 'instant' });
        });
      }
    }, true);

    // Coach: starting a game or a drill moves the board's turn into play.
    const coach = document.getElementById('coach-view');
    const setup = state => ['ready', 'complete', 'ended'].includes(state);
    if (coach && typeof MutationObserver !== 'undefined') {
      let last = coach.dataset.uiState || '';
      let practicing = coach.classList.contains('practice-active');
      new MutationObserver(() => {
        const state = coach.dataset.uiState || '';
        const nowPracticing = coach.classList.contains('practice-active');
        const started = (setup(last) && !setup(state) && state !== 'review') || (nowPracticing && !practicing);
        last = state;
        practicing = nowPracticing;
        if (started) revealBoard(nowPracticing ? '#coach-view' : '.coach-board-area');
      }).observe(coach, { attributes: true, attributeFilter: ['data-ui-state', 'class'] });
    }

    // Any view change starts at the top of the new view.
    ['library-view', 'coach-view', 'puzzles-view'].forEach(id => {
      const view = document.getElementById(id);
      if (!view || typeof MutationObserver === 'undefined') return;
      // Only when the view is newly shown: switchView re-writes aria-hidden
      // on the current view too (for example on sign-in), which must not jump.
      new MutationObserver(records => {
        const shown = records.some(r => r.oldValue === 'true') && view.getAttribute('aria-hidden') === 'false';
        if (shown && layoutIsStacked()) window.scrollTo(0, 0);
      }).observe(view, { attributes: true, attributeFilter: ['aria-hidden'], attributeOldValue: true });
    });
  }

  // Going wide, the original order comes back before the strips go home;
  // going stacked, the strips move first and then everything is sorted.
  function relayout() {
    if (layoutIsStacked()) { placeStrips(); syncOrder(); }
    else { syncOrder(); placeStrips(); }
  }

  function init() {
    relayout();
    watchStrips();
    watchOrder();
    watchActions();
    if (window.matchMedia) {
      const query = window.matchMedia(LAYOUT_STACKED_QUERY);
      const onChange = () => relayout();
      if (query.addEventListener) query.addEventListener('change', onChange);
      else if (query.addListener) query.addListener(onChange);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
