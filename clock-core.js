// Coach clocks: the pure part. A clock state is advanced by `sync` with the
// game's turn and move count; it charges elapsed time to the side to move,
// adds the increment after each completed move and reports a flag. No DOM or
// timers, so scripts/validate-clock.js runs it in Node; coach-clock.js
// drives it from the live Coach game.
(function(root) {
  'use strict';
  const CONTROLS = [
    { id: 'none', label: 'Untimed', base: 0, inc: 0 },
    { id: '3+2', label: '3 min + 2 s', base: 180, inc: 2 },
    { id: '5+0', label: '5 min', base: 300, inc: 0 },
    { id: '10+0', label: '10 min', base: 600, inc: 0 },
    { id: '15+10', label: '15 min + 10 s', base: 900, inc: 10 }
  ];
  function control(id) { return CONTROLS.find(c => c.id === id) || CONTROLS[0]; }
  function timed(id) { return control(id).base > 0; }

  // hist[n] holds both clocks as they stood when the game had n moves, so a
  // take-back restores the clocks along with the position.
  const HIST_LIMIT = 600;
  function create(id, plies) {
    const c = control(id);
    const ms = { w: c.base * 1000, b: c.base * 1000 };
    const hist = [];
    hist[plies || 0] = { w: ms.w, b: ms.b };
    return { v: 1, control: c.id, ms, plies: plies || 0, running: null, since: null, flagged: null, hist };
  }

  // input: { turn: 'w' | 'b', plies, active, paused }
  function sync(state, input, now) {
    const s = { v: 1, control: state.control, ms: { w: state.ms.w, b: state.ms.b }, plies: state.plies, running: state.running, since: state.since, flagged: state.flagged, hist: (state.hist || []).slice() };
    // A take-back puts both clocks back to that position, so replayed moves
    // cannot collect the increment twice. It also lifts a flag.
    if (input.plies < s.plies) {
      const back = s.hist[input.plies];
      if (back) { s.ms = { w: back.w, b: back.b }; s.flagged = null; }
      s.hist.length = input.plies + 1;
      s.plies = input.plies;
      s.running = null;
      s.since = null;
    }
    if (s.flagged) { s.running = null; s.since = null; return s; }
    if (s.running && s.since !== null) s.ms[s.running] -= Math.max(0, now - s.since);
    const c = control(s.control);
    // Each completed move earns its mover the increment. Moves alternate,
    // so the side that moved last is the one not to move now.
    if (input.plies > s.plies) {
      let mover = input.turn === 'w' ? 'b' : 'w';
      for (let n = input.plies; n > s.plies; n--) {
        if (s.ms[mover] > 0) s.ms[mover] += c.inc * 1000;
        mover = mover === 'w' ? 'b' : 'w';
      }
    }
    if (input.plies > s.plies && input.plies <= HIST_LIMIT) s.hist[input.plies] = { w: Math.max(0, s.ms.w), b: Math.max(0, s.ms.b) };
    s.plies = input.plies;
    ['w', 'b'].forEach(side => { if (!s.flagged && s.ms[side] <= 0) { s.flagged = side; s.ms[side] = 0; } });
    s.running = input.active && !input.paused && !s.flagged ? input.turn : null;
    s.since = s.running ? now : null;
    return s;
  }

  function format(ms) {
    const t = Math.max(0, ms);
    if (t < 10000) return `0:0${Math.floor(t / 1000)}.${Math.floor((t % 1000) / 100)}`;
    const total = Math.floor(t / 1000);
    const m = Math.floor(total / 60), sec = total % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  // Losing on time is a loss unless no sequence of legal moves could let the
  // winner mate (FIDE 6.9). That is the case for a bare king, and for a king
  // and one minor piece against a bare king; with any other pieces on the
  // loser's side a mate can still be helped along, so it counts.
  function canMate(ChessCtor, fen, side) {
    const board = new ChessCtor(fen).board();
    const mine = [], theirs = [];
    board.forEach(row => row.forEach(sq => { if (sq && sq.type !== 'k') (sq.color === side ? mine : theirs).push(sq.type); }));
    if (!mine.length) return false;
    if (mine.length === 1 && (mine[0] === 'n' || mine[0] === 'b') && !theirs.length) return false;
    return true;
  }
  function flagResult(ChessCtor, fen, flagged) {
    const winner = flagged === 'w' ? 'b' : 'w';
    if (!canMate(ChessCtor, fen, winner)) return 'Draw: time ran out with insufficient material.';
    return `Time — ${winner === 'w' ? 'White' : 'Black'} wins.`;
  }

  // A damaged save is dropped rather than read as zero time, which would
  // flag the side to move at once.
  function normalize(value) {
    if (!value || value.v !== 1 || !timed(value.control) || !value.ms) return null;
    const cap = control(value.control).base * 1000 * 4;
    const clamp = x => Math.max(0, Math.min(cap, x));
    if (!Number.isFinite(value.ms.w) || !Number.isFinite(value.ms.b)) return null;
    const plies = Math.max(0, Math.min(HIST_LIMIT, Math.floor(Number(value.plies) || 0)));
    const hist = [];
    (Array.isArray(value.hist) ? value.hist : []).slice(0, plies + 1).forEach((h, i) => {
      if (h && Number.isFinite(h.w) && Number.isFinite(h.b)) hist[i] = { w: clamp(h.w), b: clamp(h.b) };
    });
    return { v: 1, control: value.control, ms: { w: clamp(value.ms.w), b: clamp(value.ms.b) }, plies, running: null, since: null,
      flagged: value.flagged === 'w' || value.flagged === 'b' ? value.flagged : null, hist };
  }

  const api = { CONTROLS, control, timed, create, sync, format, canMate, flagResult, normalize };
  root.ClockCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
