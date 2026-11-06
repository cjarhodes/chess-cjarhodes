// Coach clocks: an optional time control for Coach games (untimed stays the
// default). Each side's clock sits on its bar beside the board; the side to
// move is charged, increments follow each move, and running out ends the
// game through app.js's coachFinishGame. Clocks pause while Coach grades a
// move, while Show why is open and while Coach is not on screen, since this
// is training, not a tournament.
// The rules live in clock-core.js; this file only watches the live game.
(function() {
  'use strict';
  const C = window.ClockCore;
  const PREF = 'ui:coach-clock';
  const SAVE = 'coach:clock:v1';
  const TICK_MS = 100;
  const LOW_MS = 20000;
  let state = null;
  let gameId = null;
  let lastSaved = 0;
  const now = () => performance.now();

  function pref() { try { return C.control(localStorage.getItem(PREF) || 'none').id; } catch (e) { return 'none'; } }
  function saveKey() { return typeof coachMemoryKey === 'function' ? coachMemoryKey(SAVE) : SAVE; }

  // Practice drills and opening exercises are not games against the clock.
  function eligible() {
    return typeof coachGame !== 'undefined' && !!coachGame &&
      !(typeof coachPracticeSession !== 'undefined' && coachPracticeSession) &&
      !(typeof coachOpeningTransfer !== 'undefined' && coachOpeningTransfer);
  }

  function persist(force) {
    if (!state || !gameId) return;
    const t = Date.now();
    if (!force && t - lastSaved < 1000) return;
    lastSaved = t;
    try { localStorage.setItem(saveKey(), JSON.stringify({ gameId, state })); } catch (e) { /* the clock still runs this session */ }
  }
  function restore(id) {
    try {
      const saved = JSON.parse(localStorage.getItem(saveKey()));
      return saved && saved.gameId === id ? C.normalize(saved.state) : null;
    } catch (e) { return null; }
  }

  function startFor(id) {
    gameId = id;
    state = restore(id);
    // A new game picks up the chosen control before its first move.
    if (!state && coachGameActive && coachGame.history().length === 0 && C.timed(pref())) {
      state = C.create(pref(), 0);
      persist(true);
    }
  }

  function tick() {
    if (!eligible()) { gameId = null; state = null; render(); return; }
    const id = typeof coachLocalGameId !== 'undefined' ? coachLocalGameId : null;
    if (id !== gameId) startFor(id);
    if (!state) { render(); return; }
    // Coach grading the user's move is not the opponent's thinking time.
    const paused = (typeof appView !== 'undefined' && appView !== 'coach') || (typeof coachReviewAnalysis !== 'undefined' && !!coachReviewAnalysis) ||
      (typeof coachThinking !== 'undefined' && coachThinking) || document.hidden;
    const plies = coachGame.history().length;
    const moved = plies !== state.plies;
    const wasFlagged = state.flagged;
    state = C.sync(state, { turn: coachGame.turn(), plies, active: !!coachGameActive, paused }, now());
    if (!wasFlagged && state.flagged && coachGameActive && typeof coachFinishGame === 'function') {
      coachFinishGame(C.flagResult(Chess, coachGame.fen(), state.flagged), 350);
    }
    render();
    persist(moved || state.flagged !== wasFlagged);
  }

  function face(id, host, side) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('span');
      el.id = id;
      el.className = 'coach-clock';
      el.setAttribute('role', 'timer');
      host.appendChild(el);
    }
    if (!state) { el.hidden = true; return; }
    el.hidden = false;
    const ms = state.ms[side];
    el.textContent = C.format(ms);
    el.classList.toggle('running', state.running === side);
    el.classList.toggle('low', ms < LOW_MS);
    el.classList.toggle('flagged', state.flagged === side);
    el.setAttribute('aria-label', `${side === 'w' ? 'White' : 'Black'} clock ${C.format(ms)}${state.flagged === side ? ', out of time' : ''}`);
  }

  function render() {
    const top = document.getElementById('captured-top');
    const bottom = document.getElementById('captured-bottom');
    if (!top || !bottom) return;
    const flipped = typeof coachBoardFlipped !== 'undefined' && coachBoardFlipped;
    face('coach-clock-top', top, flipped ? 'w' : 'b');
    face('coach-clock-bottom', bottom, flipped ? 'b' : 'w');
  }

  function build() {
    const toggle = document.querySelector('#coach-game-options .side-toggle');
    if (!toggle || document.getElementById('coach-clock-control')) return;
    const wrap = document.createElement('div');
    wrap.className = 'coach-clock-setup';
    wrap.innerHTML = '<label class="section-label" for="coach-clock-control">Time control</label>' +
      '<select id="coach-clock-control" class="coach-clock-select"></select>' +
      '<p class="coach-clock-note" id="coach-clock-note"></p>';
    const select = wrap.querySelector('select');
    C.CONTROLS.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label; select.appendChild(o); });
    select.value = pref();
    toggle.insertAdjacentElement('afterend', wrap);
    const note = () => {
      const fresh = typeof coachGame !== 'undefined' && coachGame && coachGameActive && coachGame.history().length === 0;
      document.getElementById('coach-clock-note').textContent = !C.timed(select.value) ? '' :
        (fresh || !coachGameActive ? 'Clocks pause during Show why and when you leave Coach.' : 'Starts with your next game. Clocks pause during Show why and when you leave Coach.');
    };
    select.addEventListener('change', () => {
      try { localStorage.setItem(PREF, select.value); } catch (e) { /* this page only */ }
      // Before the first move, the choice applies to the game on the board.
      if (eligible() && coachGameActive && coachGame.history().length === 0) {
        state = C.timed(select.value) ? C.create(select.value, 0) : null;
        if (state) persist(true); else { try { localStorage.removeItem(saveKey()); } catch (e) { /* noop */ } }
      }
      note();
      render();
    });
    note();
    setInterval(tick, TICK_MS);
  }

  window.CoachClock = { _state: () => state, tick };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
