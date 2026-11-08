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
// Keep LAYOUT_STACKED_QUERY in step with the media query in styles.css.
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
      if (stacked) strip.place(el);
      else homes.get(strip.id).after(el);
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
      window.scrollTo({ top: Math.max(0, window.scrollY + top), behavior: motionOk() ? 'smooth' : 'auto' });
    });
  }

  function watchActions() {
    // Library: choosing an opening (from the list or the review queue).
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest('#library .opening-btn, #library [data-id], #sr-due-list button')) revealBoard('#library-view .board-area');
      // Puzzles: actions in the panel that load a position on the board.
      const puzzleButton = target.closest('.puzzles-panel button');
      if (puzzleButton && !puzzleButton.closest('.puzzle-side-toggle') && puzzleButton.id !== 'btn-puzzle-rush-stop') revealBoard('.puzzles-board-area');
      // Coach: the panel tabs sit under the board; keep the chosen page in view.
      if (target.closest('.panel-tab')) {
        requestAnimationFrame(() => {
          const tabs = document.querySelector('.coach-panel .panel-tabs');
          if (!tabs || !layoutIsStacked()) return;
          const top = tabs.getBoundingClientRect().top;
          if (top < 0 || top > window.innerHeight * 0.6) tabs.scrollIntoView({ block: 'start', behavior: motionOk() ? 'smooth' : 'auto' });
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
      new MutationObserver(() => {
        if (layoutIsStacked() && view.getAttribute('aria-hidden') === 'false') window.scrollTo(0, 0);
      }).observe(view, { attributes: true, attributeFilter: ['aria-hidden'] });
    });
  }

  function init() {
    placeStrips();
    watchStrips();
    watchActions();
    if (window.matchMedia) {
      const query = window.matchMedia(LAYOUT_STACKED_QUERY);
      const onChange = () => placeStrips();
      if (query.addEventListener) query.addEventListener('change', onChange);
      else if (query.addListener) query.addListener(onChange);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
