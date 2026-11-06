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

  function create(id, plies) {
    const c = control(id);
    return { v: 1, control: c.id, ms: { w: c.base * 1000, b: c.base * 1000 }, plies: plies || 0, running: null, since: null, flagged: null };
  }

  // input: { turn: 'w' | 'b', plies, active, paused }
  function sync(state, input, now) {
    const s = { v: 1, control: state.control, ms: { w: state.ms.w, b: state.ms.b }, plies: state.plies, running: state.running, since: state.since, flagged: state.flagged };
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
    s.plies = input.plies;
    ['w', 'b'].forEach(side => { if (!s.flagged && s.ms[side] <= 0) { s.flagged = side; s.ms[side] = 0; } });
    s.running = input.active && !input.paused && !s.flagged ? input.turn : null;
    s.since = s.running ? now : null;
    return s;
  }

  function format(ms) {
    const t = Math.max(0, ms);
    if (t < 10000) return `0:0${Math.floor(t / 1000)}.${Math.floor((t % 1000) / 100)}`;
    const total = Math.ceil(t / 1000);
    const m = Math.floor(total / 60), sec = total % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  // Losing on time is a loss unless the winner has nothing left to mate
  // with (a bare king, or king and one minor piece): then it is a draw.
  function canMate(ChessCtor, fen, side) {
    const board = new ChessCtor(fen).board();
    const pieces = [];
    board.forEach(row => row.forEach(sq => { if (sq && sq.color === side && sq.type !== 'k') pieces.push(sq.type); }));
    if (!pieces.length) return false;
    if (pieces.length === 1 && (pieces[0] === 'n' || pieces[0] === 'b')) return false;
    return true;
  }
  function flagResult(ChessCtor, fen, flagged) {
    const winner = flagged === 'w' ? 'b' : 'w';
    if (!canMate(ChessCtor, fen, winner)) return 'Draw: time ran out with insufficient material.';
    return `Time — ${winner === 'w' ? 'White' : 'Black'} wins.`;
  }

  function normalize(value) {
    if (!value || value.v !== 1 || !timed(value.control) || !value.ms) return null;
    const ms = side => Math.max(0, Math.min(control(value.control).base * 1000 * 4, Number(value.ms[side]) || 0));
    return { v: 1, control: value.control, ms: { w: ms('w'), b: ms('b') }, plies: Math.max(0, Number(value.plies) || 0), running: null, since: null,
      flagged: value.flagged === 'w' || value.flagged === 'b' ? value.flagged : null };
  }

  const api = { CONTROLS, control, timed, create, sync, format, canMate, flagResult, normalize };
  root.ClockCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
