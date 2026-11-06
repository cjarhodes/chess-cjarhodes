// Repertoire trainer: the pure part. Turns the openings starred in the
// Library into drillable lines, schedules them with spaced repetition and
// grades moves. No DOM, so scripts/validate-repertoire.js runs it in Node;
// puzzles.js plays the drills.
(function(root) {
  'use strict';
  const KEY = 'repertoire:srs:v1';
  const NEW_PER_DAY = 5;
  const SESSION_LIMIT = 10;
  const RELEARN_MS = 10 * 60 * 1000;
  const MAX_INTERVAL = 180;

  // A line is drilled from the side that owns it (opponents.js lineSide):
  // a White repertoire never drills the moves of a Black trap's victim.
  function cardsFor(openings, ids, sideOf) {
    const out = [];
    const seen = new Set();
    (ids || []).forEach(id => {
      const opening = (openings || []).find(o => o.id === id);
      if (!opening || !Array.isArray(opening.moves)) return;
      const side = sideOf(opening.id, opening);
      const add = (lineId, name, moves) => {
        if (seen.has(lineId) || !Array.isArray(moves) || !moves.length) return;
        seen.add(lineId);
        out.push({ id: lineId, openingId: opening.id, name, side, moves: moves.slice() });
      };
      add(opening.id, opening.name, opening.moves);
      (opening.variations || []).forEach(v => {
        if (v && v.id && sideOf(v.id, opening) === side) add(v.id, `${opening.name}: ${v.name}`, v.moves);
      });
    });
    return out;
  }

  // The line's half-moves up to the user's last move, as
  // { fenBefore, uci, san, mine }; null when a move is illegal.
  function plies(ChessCtor, card) {
    const game = new ChessCtor();
    const out = [];
    for (const raw of card.moves) {
      const fenBefore = game.fen();
      const mine = game.turn() === card.side;
      const move = game.move(String(raw).replace(/[?!]+$/, ''), { sloppy: true });
      if (!move) return null;
      out.push({ fenBefore, uci: move.from + move.to + (move.promotion || ''), san: move.san, mine });
    }
    let last = out.length - 1;
    while (last >= 0 && !out[last].mine) last--;
    return out.slice(0, last + 1);
  }

  const positionKey = fen => String(fen).split(' ').slice(0, 4).join(' ');

  // Every repertoire move by position, so a move from another of the user's
  // lines (a transposition or a sibling line) is told apart from a mistake.
  function moveIndex(ChessCtor, cards) {
    const index = new Map();
    cards.forEach(card => {
      (plies(ChessCtor, card) || []).forEach(p => {
        if (!p.mine) return;
        const key = card.side + '|' + positionKey(p.fenBefore);
        if (!index.has(key)) index.set(key, new Map());
        if (!index.get(key).has(p.uci)) index.get(key).set(p.uci, card.name);
      });
    });
    return index;
  }

  // 'ok' | { other: lineName } | 'wrong'
  function grade(index, card, ply, uci) {
    if (uci === ply.uci) return 'ok';
    const moves = index.get(card.side + '|' + positionKey(ply.fenBefore));
    if (moves && moves.has(uci)) return { other: moves.get(uci) };
    return 'wrong';
  }

  // ── Scheduling ──
  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // Local midnight n days after ts, with calendar arithmetic so a DST change
  // never moves a due date by an hour into the wrong day.
  function addDays(ts, n) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }

  function emptyState() { return { v: 1, records: {}, newDay: { day: '', count: 0 } }; }
  function normalizeState(value) {
    const state = emptyState();
    if (!value || value.v !== 1 || typeof value.records !== 'object' || !value.records) return state;
    Object.keys(value.records).slice(0, 500).forEach(id => {
      const r = value.records[id];
      if (!r || typeof id !== 'string' || id.length > 60) return;
      const num = (x, lo, hi, d) => Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
      state.records[id] = {
        reps: num(r.reps, 0, 1000, 0), ease: num(r.ease, 1.3, 3, 2.5), interval: num(r.interval, 0, MAX_INTERVAL, 0),
        lapses: num(r.lapses, 0, 1000, 0), seen: num(r.seen, 0, 100000, 0), dueAt: num(r.dueAt, 0, 8.64e15, 0), lastAt: num(r.lastAt, 0, 8.64e15, 0)
      };
    });
    if (value.newDay && typeof value.newDay.day === 'string') state.newDay = { day: value.newDay.day.slice(0, 10), count: Math.max(0, Number(value.newDay.count) || 0) };
    return state;
  }
  // Backups and other browsers: per line, keep the record reviewed last.
  function mergeStates(a, b) {
    const x = normalizeState(a), y = normalizeState(b);
    const out = emptyState();
    new Set(Object.keys(x.records).concat(Object.keys(y.records))).forEach(id => {
      const p = x.records[id], q = y.records[id];
      out.records[id] = !p ? q : !q ? p : (q.lastAt > p.lastAt ? q : p);
    });
    out.newDay = x.newDay.day === y.newDay.day ? { day: x.newDay.day, count: Math.max(x.newDay.count, y.newDay.count) } : (x.newDay.day > y.newDay.day ? x.newDay : y.newDay);
    return out;
  }

  // A clean line (no mistakes, no hints) grows the interval: 1 day, 3 days,
  // then by the ease factor. A lapse comes back in ten minutes.
  function review(state, cardId, perfect, now) {
    const next = normalizeState(state);
    const r = Object.assign({ reps: 0, ease: 2.5, interval: 0, lapses: 0, seen: 0, dueAt: 0, lastAt: 0 }, next.records[cardId]);
    if (!r.seen) {
      const day = dayKey(now);
      next.newDay = next.newDay.day === day ? { day, count: next.newDay.count + 1 } : { day, count: 1 };
    }
    if (perfect) {
      r.reps += 1;
      r.interval = Math.min(MAX_INTERVAL, r.reps === 1 ? 1 : r.reps === 2 ? 3 : Math.max(r.interval + 1, Math.round(r.interval * r.ease)));
      r.ease = Math.min(3, r.ease + 0.05);
      r.dueAt = addDays(now, r.interval);
    } else {
      r.lapses += 1;
      r.reps = 0;
      r.interval = 0;
      r.ease = Math.max(1.3, Math.round((r.ease - 0.2) * 100) / 100);
      r.dueAt = now + RELEARN_MS;
    }
    r.seen += 1;
    r.lastAt = now;
    next.records[cardId] = r;
    return next;
  }

  function newLeft(state, now) {
    const s = normalizeState(state);
    return Math.max(0, NEW_PER_DAY - (s.newDay.day === dayKey(now) ? s.newDay.count : 0));
  }

  // Due lines first (most overdue first), then up to the day's new lines.
  function queue(cards, state, now, limit) {
    const s = normalizeState(state);
    const due = cards.filter(c => s.records[c.id] && s.records[c.id].seen && s.records[c.id].dueAt <= now)
      .sort((a, b) => s.records[a.id].dueAt - s.records[b.id].dueAt);
    const fresh = cards.filter(c => !s.records[c.id] || !s.records[c.id].seen).slice(0, newLeft(s, now));
    return due.concat(fresh).slice(0, limit || SESSION_LIMIT);
  }

  function stats(cards, state, now) {
    const s = normalizeState(state);
    let due = 0, fresh = 0, learned = 0, nextDue = 0;
    cards.forEach(c => {
      const r = s.records[c.id];
      if (!r || !r.seen) { fresh++; return; }
      if (r.reps > 0) learned++;
      if (r.dueAt <= now) due++;
      else if (!nextDue || r.dueAt < nextDue) nextDue = r.dueAt;
    });
    return { total: cards.length, due, fresh, learned, newToday: Math.min(fresh, newLeft(s, now)), nextDue };
  }

  // Spaced-repetition records live per account in this browser.
  function storageKeyFor(owner) { return owner ? `${KEY}:${owner}` : KEY; }

  const api = { KEY, storageKeyFor, NEW_PER_DAY, SESSION_LIMIT, RELEARN_MS, cardsFor, plies, moveIndex, grade, dayKey, addDays, emptyState, normalizeState, mergeStates, review, newLeft, queue, stats };
  root.RepertoireCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
