// Board overlay: arrows, move-quality badges and an evaluation bar drawn over
// a board from src/ui/board.js (cm-chessboard). Square positions are read
// from the rendered squares (`.square[data-square]`), so orientation, resizing
// and redraws need no extra state. The overlay is a sibling of the board
// inside its positioned wrapper, so the board redrawing its own markup never
// removes it.
(function(root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const boards = new Map(); // boardId -> { wrap, spec, svg, bar, observer, frame }

  // Glyphs follow common annotation symbols; colours come from --mq-* tokens.
  const QUALITY = {
    brilliant: { glyph: '!!', label: 'Brilliant' },
    great: { glyph: '!', label: 'Great move' },
    best: { glyph: '★', label: 'Best move' },
    excellent: { glyph: '✓', label: 'Excellent' },
    good: { glyph: '✓', label: 'Good' },
    book: { glyph: '≡', label: 'Book move' },
    inaccuracy: { glyph: '?!', label: 'Inaccuracy' },
    mistake: { glyph: '?', label: 'Mistake' },
    blunder: { glyph: '??', label: 'Blunder' }
  };

  // Lichess-style win probability from centipawns (white's view, 0..1).
  function winProbability(cp) {
    const c = Math.max(-10000, Math.min(10000, Number(cp) || 0));
    return 1 / (1 + Math.exp(-0.00368208 * c));
  }

  function formatEval(cp, mate) {
    if (mate !== null && mate !== undefined) return (mate > 0 ? 'M' : '-M') + Math.abs(mate);
    const pawns = (Number(cp) || 0) / 100;
    if (Math.abs(pawns) >= 10) return (pawns > 0 ? '+' : '') + pawns.toFixed(0);
    return (pawns > 0 ? '+' : pawns < 0 ? '' : '') + pawns.toFixed(1);
  }

  function el(name, attrs) {
    const node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(key => node.setAttribute(key, attrs[key]));
    return node;
  }

  function geometry(entry, boardId) {
    const board = document.getElementById(boardId);
    if (!board) return null;
    const wrapRect = entry.wrap.getBoundingClientRect();
    const squares = {};
    let size = 0;
    // Square rects only: pieces carry data-square too, but are smaller.
    board.querySelectorAll('.square[data-square]').forEach(node => {
      const r = node.getBoundingClientRect();
      if (!r.width) return;
      size = r.width;
      squares[node.getAttribute('data-square')] = { x: r.left - wrapRect.left, y: r.top - wrapRect.top, size: r.width };
    });
    const a8 = squares.a8, h1 = squares.h1;
    if (!a8 || !h1) return null;
    const left = Math.min(a8.x, h1.x), top = Math.min(a8.y, h1.y);
    return { squares, size, box: { x: left, y: top, w: size * 8, h: size * 8 } };
  }

  function center(geo, square) {
    const s = geo.squares[square];
    return s ? { x: s.x + s.size / 2, y: s.y + s.size / 2 } : null;
  }

  // A straight arrow, or an L-shaped one for knight moves.
  function arrowPath(geo, from, to) {
    const a = center(geo, from), b = center(geo, to);
    if (!a || !b) return null;
    const df = Math.abs(from.charCodeAt(0) - to.charCodeAt(0)), dr = Math.abs(Number(from[1]) - Number(to[1]));
    const knight = (df === 1 && dr === 2) || (df === 2 && dr === 1);
    const head = geo.size * 0.42;
    const start = geo.size * 0.18;
    let points;
    if (knight) {
      // Go the long leg first, then turn.
      const corner = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
      points = [a, corner, b];
    } else {
      points = [a, b];
    }
    // Trim the start away from the piece and stop the shaft under the head.
    const first = points[0], second = points[1];
    const len0 = Math.hypot(second.x - first.x, second.y - first.y) || 1;
    points[0] = { x: first.x + (second.x - first.x) * start / len0, y: first.y + (second.y - first.y) * start / len0 };
    const last = points[points.length - 1], prev = points[points.length - 2];
    const len1 = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
    const ux = (last.x - prev.x) / len1, uy = (last.y - prev.y) / len1;
    const tip = { x: last.x - ux * geo.size * 0.12, y: last.y - uy * geo.size * 0.12 };
    const shaftEnd = { x: tip.x - ux * head * 0.85, y: tip.y - uy * head * 0.85 };
    points[points.length - 1] = shaftEnd;
    const halfW = head * 0.55;
    const headPoints = [
      tip,
      { x: tip.x - ux * head - uy * halfW, y: tip.y - uy * head + ux * halfW },
      { x: tip.x - ux * head + uy * halfW, y: tip.y - uy * head - ux * halfW }
    ];
    return {
      d: points.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' '),
      head: headPoints.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')
    };
  }

  function draw(boardId) {
    const entry = boards.get(boardId);
    if (!entry) return;
    entry.frame = null;
    const spec = entry.spec || {};
    const geo = geometry(entry, boardId);
    if (!entry.svg) {
      entry.svg = el('svg', { class: 'board-overlay', 'aria-hidden': 'true', focusable: 'false' });
      entry.wrap.appendChild(entry.svg);
    }
    const svg = entry.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!geo) return;
    svg.setAttribute('width', entry.wrap.clientWidth);
    svg.setAttribute('height', entry.wrap.clientHeight);
    svg.setAttribute('viewBox', `0 0 ${entry.wrap.clientWidth} ${entry.wrap.clientHeight}`);
    (spec.arrows || []).forEach(arrow => {
      const path = arrowPath(geo, arrow.from, arrow.to);
      if (!path) return;
      const g = el('g', { class: 'board-arrow ' + (arrow.kind || 'best') });
      g.appendChild(el('path', { d: path.d, 'stroke-width': (geo.size * 0.17).toFixed(1) }));
      g.appendChild(el('polygon', { points: path.head }));
      svg.appendChild(g);
    });
    (spec.badges || []).forEach(badge => {
      const s = geo.squares[badge.square];
      const q = QUALITY[badge.tier];
      if (!s || !q) return;
      const r = Math.max(9, geo.size * 0.2);
      const cx = Math.min(s.x + s.size - r * 0.35, geo.box.x + geo.box.w - r - 1);
      const cy = Math.max(s.y + r * 0.35, geo.box.y + r + 1);
      const g = el('g', { class: 'board-badge ' + badge.tier });
      g.appendChild(el('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1) }));
      const text = el('text', { x: cx.toFixed(1), y: (cy + r * 0.36).toFixed(1), 'font-size': (r * (q.glyph.length > 1 ? 0.95 : 1.15)).toFixed(1), 'text-anchor': 'middle' });
      text.textContent = q.glyph;
      g.appendChild(text);
      svg.appendChild(g);
    });
    drawEvalBar(entry, geo, spec.eval);
  }

  function drawEvalBar(entry, geo, evaluation) {
    if (!evaluation) {
      if (entry.bar) entry.bar.hidden = true;
      return;
    }
    if (!entry.bar) {
      entry.bar = document.createElement('div');
      entry.bar.className = 'board-eval-bar';
      entry.bar.setAttribute('role', 'img');
      entry.bar.innerHTML = '<span class="board-eval-white"></span><span class="board-eval-label"></span>';
      entry.wrap.appendChild(entry.bar);
    }
    const bar = entry.bar;
    bar.hidden = false;
    const p = evaluation.mate !== null && evaluation.mate !== undefined
      ? (evaluation.mate > 0 ? 1 : 0)
      : winProbability(evaluation.cp);
    const whiteAtBottom = evaluation.orientation !== 'black';
    bar.style.top = geo.box.y + 'px';
    bar.style.height = geo.box.h + 'px';
    bar.classList.toggle('flipped', !whiteAtBottom);
    bar.classList.toggle('stale', !!evaluation.stale);
    const fill = bar.firstChild;
    fill.style.height = (p * 100).toFixed(1) + '%';
    const label = bar.lastChild;
    const text = formatEval(evaluation.cp, evaluation.mate);
    label.textContent = text.replace(/^\+/, '');
    // Put the number at the end that is ahead.
    const whiteAhead = p >= 0.5;
    label.classList.toggle('on-white', whiteAhead);
    label.classList.toggle('at-bottom', whiteAhead === whiteAtBottom);
    bar.setAttribute('aria-label', `Evaluation ${text} for White${evaluation.stale ? ', from before the last move' : ''}`);
  }

  function schedule(boardId) {
    const entry = boards.get(boardId);
    if (!entry || entry.frame) return;
    entry.frame = requestAnimationFrame(() => draw(boardId));
  }

  // Attach once per board. Redraws follow the board's DOM rebuilds (resize,
  // flip) and window resizes.
  function attach(boardId, wrapId) {
    if (boards.has(boardId)) return boards.get(boardId);
    const wrap = document.getElementById(wrapId);
    const board = document.getElementById(boardId);
    if (!wrap || !board) return null;
    const entry = { wrap, spec: null, svg: null, bar: null, observer: null, frame: null };
    boards.set(boardId, entry);
    if (typeof MutationObserver !== 'undefined') {
      entry.observer = new MutationObserver(() => schedule(boardId));
      // Flips rebuild the squares deep inside the container; resizes set the
      // container's size by inline style.
      entry.observer.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => schedule(boardId)).observe(wrap);
    window.addEventListener('resize', () => schedule(boardId));
    return entry;
  }

  function set(boardId, wrapId, spec) {
    const entry = attach(boardId, wrapId);
    if (!entry) return;
    entry.spec = spec || null;
    schedule(boardId);
  }

  function clear(boardId) {
    const entry = boards.get(boardId);
    if (!entry) return;
    entry.spec = null;
    schedule(boardId);
  }

  root.BoardOverlay = { set, clear, refresh: schedule, winProbability, formatEval, QUALITY, _draw: draw };
})(window);
