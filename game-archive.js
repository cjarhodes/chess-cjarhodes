// Game archive: finished Coach games are kept in this browser with their
// move-by-move review, listed in Progress, and opened in a viewer with its
// own board, a move list with quality marks, an evaluation graph and the
// engine's choice on each reviewed move. The live game is never touched.
(function() {
  'use strict';
  const KEY = 'coach:archive:v1';
  const LIMIT = 40;
  const TIERS = ['best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder', 'unknown'];
  const GLYPH = { best: '★', excellent: '✓', good: '✓', book: '≡', inaccuracy: '?!', mistake: '?', blunder: '??' };
  let viewer = null;     // { game, plies: [fen...], moves, cursor, board, returnFocus }

  function ownerId() { return typeof activePracticeOwnerId === 'function' ? activePracticeOwnerId() : null; }
  function storageKey() { const owner = ownerId(); return owner ? `${KEY}:${owner}` : KEY; }

  function normalize(list) {
    return (Array.isArray(list) ? list : []).filter(row => row && typeof row.id === 'string' && typeof row.pgn === 'string' && Number.isFinite(row.at))
      .map(row => ({
        id: row.id, at: row.at, result: String(row.result || '').slice(0, 120), side: row.side === 'black' ? 'black' : 'white',
        elo: Math.max(0, Math.min(3500, Number(row.elo) || 0)), startFen: typeof row.startFen === 'string' ? row.startFen : '',
        pgn: row.pgn.slice(0, 20000), accuracy: Number.isFinite(row.accuracy) ? row.accuracy : null,
        acpl: Number.isFinite(row.acpl) ? row.acpl : null, opening: String(row.opening || '').slice(0, 80),
        reviews: (Array.isArray(row.reviews) ? row.reviews : []).filter(r => r && Number.isFinite(r.ply) && TIERS.includes(r.tier)).slice(0, 400)
          .map(r => ({ ply: r.ply, tier: r.tier, flair: r.flair === 'great' || r.flair === 'brilliant' ? r.flair : null,
            userSan: String(r.userSan || '').slice(0, 12), bestSan: String(r.bestSan || '').slice(0, 12),
            bestUci: typeof r.bestUci === 'string' ? r.bestUci.slice(0, 5) : '', userUci: typeof r.userUci === 'string' ? r.userUci.slice(0, 5) : '',
            cp: Number.isFinite(r.cp) ? Math.max(-10000, Math.min(10000, r.cp)) : null }))
      }))
      .sort((a, b) => b.at - a.at).slice(0, LIMIT);
  }
  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(storageKey()))); } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(storageKey(), JSON.stringify(normalize(list))); return true; } catch (e) { return false; }
  }

  // White-perspective centipawns after the user's move (engine scores are
  // from the side to move, which is the opponent then).
  function whiteCp(review) {
    if (!review || !review.evalAfter || review.tier === 'unknown') return null;
    const info = review.evalAfter;
    const userWhite = String(review.fenBefore || '').split(' ')[1] === 'w';
    const own = info.mate !== null && info.mate !== undefined ? (info.mate > 0 ? -10000 + info.mate : 10000 + info.mate) : -(info.cp || 0);
    return userWhite ? own : -own;
  }

  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  // Called when a game's summary opens (game end, or reopening the review).
  function record(endMsg) {
    try {
      if (typeof coachGame === 'undefined' || !coachGame || !coachGame.history().length) return;
      if (typeof coachPracticeSession !== 'undefined' && coachPracticeSession) return;
      const startFen = typeof coachStartFen !== 'undefined' && coachStartFen ? coachStartFen : new Chess().fen();
      const id = typeof coachLocalGameId !== 'undefined' && coachLocalGameId ? coachLocalGameId : 'pgn-' + hash(startFen + '|' + coachGame.pgn());
      const reviews = (typeof coachReviewLog !== 'undefined' ? coachReviewLog : [])
        .filter(r => r && (!r.localGameId || r.localGameId === id))
        .map(r => ({ ply: r.ply, tier: r.tier, flair: r.flair, userSan: r.userSan, bestSan: r.bestSan, bestUci: r.bestUci, userUci: r.userUci, cp: whiteCp(r) }));
      const total = typeof coachStats !== 'undefined' && coachStats ? coachStats.moves : 0;
      const accuracy = typeof accuracyFromTallies === 'function' && total ? accuracyFromTallies(coachStats, total) : null;
      const acpl = typeof computeACPL === 'function' ? computeACPL(coachReviewLog || []) : null;
      const openingEl = document.getElementById('coach-opening-eco');
      const entry = {
        id, at: Date.now(), result: endMsg || (typeof coachLastEndMsg !== 'undefined' ? coachLastEndMsg : '') || 'Game over',
        side: typeof coachUserColor === 'function' ? coachUserColor() : 'white',
        elo: typeof coachEngineElo !== 'undefined' ? coachEngineElo : 0,
        startFen,
        pgn: coachGame.pgn(), accuracy, acpl,
        opening: openingEl ? openingEl.textContent.trim() : '', reviews
      };
      const list = load();
      const existing = list.find(row => row.id === id);
      if (existing) entry.at = existing.at;
      save([entry].concat(list.filter(row => row.id !== id)));
      render();
    } catch (e) { /* the archive must never break the game summary */ }
  }

  function remove(id) {
    save(load().filter(row => row.id !== id));
    render();
  }

  // ── Progress panel list ─────────────────────────
  function ensureSection() {
    let section = document.getElementById('game-archive-section');
    if (section) return section;
    const panel = document.getElementById('panel-progress');
    if (!panel) return null;
    section = document.createElement('section');
    section.className = 'coach-panel-section game-archive';
    section.id = 'game-archive-section';
    section.setAttribute('aria-labelledby', 'game-archive-heading');
    section.innerHTML = '<div class="game-archive-head"><h3 class="section-label" id="game-archive-heading">Game archive</h3><span class="game-archive-count" id="game-archive-count"></span></div>' +
      '<ol class="game-archive-list" id="game-archive-list"></ol><p class="progress-method">Kept in this browser (latest ' + LIMIT + ' games). Copy a PGN to keep a game elsewhere.</p>';
    const lifetime = document.getElementById('lifetime-section');
    if (lifetime && lifetime.parentElement === panel) panel.insertBefore(section, lifetime);
    else panel.appendChild(section);
    return section;
  }

  function dateLabel(at) {
    const d = new Date(at);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  // Coach ends games with "Checkmate — White wins.", "Resigned — Black
  // wins.", "Stalemate." or "Draw.".
  function outcome(row) {
    const win = row.result.match(/\b(White|Black) wins\b/);
    if (win) return win[1].toLowerCase() === row.side ? 'win' : 'loss';
    if (/stalemate|draw/i.test(row.result)) return 'draw';
    return '';
  }

  function render() {
    const section = ensureSection();
    if (!section) return;
    const list = load();
    section.hidden = !list.length;
    const ol = document.getElementById('game-archive-list');
    ol.textContent = '';
    document.getElementById('game-archive-count').textContent = list.length ? String(list.length) : '';
    list.slice(0, 12).forEach(row => {
      const li = document.createElement('li');
      li.className = 'game-archive-row';
      const result = outcome(row);
      const moves = Math.ceil((row.pgn.match(/\d+\./g) || []).length);
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'game-archive-open';
      main.innerHTML = '<span class="game-archive-result"></span><span class="game-archive-meta"></span>';
      main.firstChild.textContent = result === 'win' ? 'Won' : result === 'loss' ? 'Lost' : result === 'draw' ? 'Draw' : 'Game';
      main.firstChild.className = 'game-archive-result ' + result;
      main.lastChild.textContent = [dateLabel(row.at), (row.side === 'white' ? 'White' : 'Black') + ' vs ' + row.elo, moves + ' moves', row.accuracy !== null ? row.accuracy + '%' : ''].filter(Boolean).join(' · ');
      main.setAttribute('aria-label', `Review game: ${main.firstChild.textContent}, ${main.lastChild.textContent}`);
      main.addEventListener('click', () => open(row.id, main));
      li.appendChild(main);
      ol.appendChild(li);
    });
  }

  // ── Viewer dialog ───────────────────────────────
  function buildViewer() {
    const el = document.createElement('div');
    el.className = 'game-viewer-overlay';
    el.id = 'game-viewer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'game-viewer-title');
    el.hidden = true;
    el.innerHTML =
      '<div class="game-viewer-card">' +
        '<div class="game-viewer-head"><div><h2 id="game-viewer-title">Game review</h2><p class="game-viewer-sub" id="game-viewer-sub"></p></div>' +
        '<button type="button" class="ctrl-btn" id="btn-game-viewer-close" aria-label="Close game review">✕</button></div>' +
        '<div class="game-viewer-body">' +
          '<div class="game-viewer-board-col"><div class="game-viewer-board-wrap" id="archiveBoard-wrap"><div id="archiveBoard" role="img" aria-label="Archived game position"></div></div>' +
          '<div class="game-viewer-nav"><button type="button" class="ctrl-btn" data-step="start" aria-label="First position">⏮</button><button type="button" class="ctrl-btn" data-step="prev" aria-label="Previous move">◀</button>' +
          '<span class="game-viewer-ply" id="game-viewer-ply" aria-live="polite"></span>' +
          '<button type="button" class="ctrl-btn" data-step="next" aria-label="Next move">▶</button><button type="button" class="ctrl-btn" data-step="end" aria-label="Last position">⏭</button>' +
          '<button type="button" class="ctrl-btn flip" data-step="flip" aria-label="Flip board">⇅</button></div></div>' +
          '<div class="game-viewer-side">' +
            '<div class="game-viewer-stats" id="game-viewer-stats"></div>' +
            '<div class="game-viewer-chart" id="game-viewer-chart"></div>' +
            '<div class="game-viewer-note" id="game-viewer-note" role="status" aria-live="polite"></div>' +
            '<div class="game-viewer-moves" id="game-viewer-moves" aria-label="Moves"></div>' +
            '<div class="game-viewer-actions"><button type="button" class="ctrl-btn" id="btn-game-viewer-pgn">Copy PGN</button>' +
            '<button type="button" class="ctrl-btn" id="btn-game-viewer-delete">Delete game</button></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) close(); });
    el.querySelector('#btn-game-viewer-close').addEventListener('click', close);
    el.querySelectorAll('.game-viewer-nav [data-step]').forEach(btn => btn.addEventListener('click', () => step(btn.getAttribute('data-step'))));
    el.querySelector('#btn-game-viewer-pgn').addEventListener('click', copyPgn);
    el.querySelector('#btn-game-viewer-delete').addEventListener('click', () => {
      if (!viewer) return;
      const btn = el.querySelector('#btn-game-viewer-delete');
      if (btn.dataset.confirm !== 'yes') { btn.dataset.confirm = 'yes'; btn.textContent = 'Delete? Click again'; return; }
      const id = viewer.game.id;
      close();
      remove(id);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
      const map = { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'start', End: 'end' };
      if (map[e.key]) { e.preventDefault(); e.stopPropagation(); step(map[e.key]); }
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); step('flip'); }
      if (e.key === 'Tab' && typeof trapDialogTab === 'function') trapDialogTab(e, el.querySelector('.game-viewer-card'));
    });
    return el;
  }

  function open(id, returnFocus) {
    const game = load().find(row => row.id === id);
    if (!game) return false;
    const el = document.getElementById('game-viewer') || buildViewer();
    const chess = new Chess();
    if (game.startFen) chess.load(game.startFen);
    const replay = new Chess(chess.fen());
    const parsed = new Chess();
    if (!parsed.load_pgn(game.pgn, { sloppy: true })) return false;
    const moves = parsed.history({ verbose: true });
    const fens = [replay.fen()];
    moves.forEach(m => { replay.move({ from: m.from, to: m.to, promotion: m.promotion }); fens.push(replay.fen()); });
    viewer = { game, fens, moves, cursor: fens.length - 1, board: null, orientation: game.side, returnFocus: returnFocus || document.activeElement };
    el.hidden = false;
    document.getElementById('game-viewer-title').textContent = game.result || 'Game review';
    document.getElementById('game-viewer-sub').textContent = [dateLabel(game.at), `You played ${game.side === 'white' ? 'White' : 'Black'} vs ${game.elo}`, game.opening].filter(Boolean).join(' · ');
    const del = el.querySelector('#btn-game-viewer-delete');
    del.dataset.confirm = '';
    del.textContent = 'Delete game';
    renderStats();
    if (viewer.board) viewer.board.destroy();
    viewer.board = Chessboard('archiveBoard', { position: fens[viewer.cursor], orientation: viewer.orientation, draggable: false, pieceTheme: typeof localPieceTheme === 'function' ? localPieceTheme : 'vendor/pieces/cburnett/{piece}.svg' });
    if (typeof observeBoardLastMove === 'function') observeBoardLastMove('archiveBoard');
    renderMoves();
    renderChart();
    show();
    el.querySelector('#btn-game-viewer-close').focus();
    return true;
  }

  function close() {
    const el = document.getElementById('game-viewer');
    if (!el || el.hidden) return;
    el.hidden = true;
    if (window.BoardOverlay) window.BoardOverlay.clear('archiveBoard');
    const back = viewer && viewer.returnFocus;
    if (viewer && viewer.board) { viewer.board.destroy(); viewer.board = null; }
    viewer = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
  }

  function step(kind) {
    if (!viewer) return;
    const last = viewer.fens.length - 1;
    if (kind === 'flip') { viewer.orientation = viewer.orientation === 'white' ? 'black' : 'white'; viewer.board.orientation(viewer.orientation); show(); return; }
    viewer.cursor = kind === 'start' ? 0 : kind === 'end' ? last : kind === 'prev' ? Math.max(0, viewer.cursor - 1) : Math.min(last, viewer.cursor + 1);
    show();
  }

  function reviewAt(ply) { return viewer.game.reviews.find(r => r.ply === ply) || null; }

  function show() {
    const ply = viewer.cursor;
    viewer.board.position(viewer.fens[ply], false);
    const move = ply ? viewer.moves[ply - 1] : null;
    if (typeof setBoardLastMove === 'function') setBoardLastMove('archiveBoard', move);
    const review = reviewAt(ply);
    const spec = { arrows: [], badges: [] };
    let note = '';
    if (review && move) {
      spec.badges.push({ square: move.to, tier: review.flair || review.tier });
      const label = review.flair === 'brilliant' ? 'Brilliant' : review.flair === 'great' ? 'Great move' : review.tier.charAt(0).toUpperCase() + review.tier.slice(1);
      note = `${move.san}: ${label}.`;
      if (['good', 'inaccuracy', 'mistake', 'blunder'].includes(review.tier) && review.bestUci && review.bestUci !== review.userUci) {
        spec.arrows.push({ from: review.bestUci.slice(0, 2), to: review.bestUci.slice(2, 4), kind: 'best' });
        note += ` The engine preferred ${review.bestSan || review.bestUci}.`;
      }
    } else if (move) {
      note = `${move.san} (opponent).`;
    } else {
      note = 'Starting position.';
    }
    let evalRow = null;
    viewer.game.reviews.forEach(r => { if (r.ply <= ply && r.cp !== null && (!evalRow || r.ply > evalRow.ply)) evalRow = r; });
    if (evalRow) spec.eval = { cp: Math.abs(evalRow.cp) >= 9000 ? 0 : evalRow.cp, mate: Math.abs(evalRow.cp) >= 9000 ? (evalRow.cp > 0 ? 1 : -1) * Math.max(1, 10000 - Math.abs(evalRow.cp)) : null, orientation: viewer.orientation, stale: evalRow.ply !== ply };
    if (window.BoardOverlay) window.BoardOverlay.set('archiveBoard', 'archiveBoard-wrap', spec);
    document.getElementById('game-viewer-note').textContent = note;
    document.getElementById('game-viewer-ply').textContent = ply ? `Move ${Math.ceil(ply / 2)}${ply % 2 ? '' : '…'} · ${ply}/${viewer.fens.length - 1}` : `Start · 0/${viewer.fens.length - 1}`;
    document.getElementById('archiveBoard').setAttribute('aria-label', `Position after ${ply} of ${viewer.fens.length - 1} moves. ${note}`);
    document.querySelectorAll('#game-viewer-moves .ply').forEach(el => el.classList.toggle('current', Number(el.dataset.ply) === ply));
    const cur = document.querySelector('#game-viewer-moves .ply.current');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    document.querySelectorAll('#game-viewer-chart .gv-cursor').forEach(line => {
      const n = viewer.fens.length - 1 || 1;
      line.setAttribute('x1', String((ply / n) * 300)); line.setAttribute('x2', String((ply / n) * 300));
    });
  }

  function renderStats() {
    const g = viewer.game;
    const counts = {};
    g.reviews.forEach(r => { const k = r.flair || r.tier; counts[k] = (counts[k] || 0) + 1; });
    const host = document.getElementById('game-viewer-stats');
    host.textContent = '';
    const head = document.createElement('div');
    head.className = 'gv-accuracy';
    head.innerHTML = '<span class="gv-acc-value"></span><span class="gv-acc-label">accuracy</span>';
    head.firstChild.textContent = g.accuracy !== null ? g.accuracy + '%' : '—';
    host.appendChild(head);
    const row = document.createElement('div');
    row.className = 'gv-tiers';
    ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'].forEach(k => {
      if (!counts[k]) return;
      const chip = document.createElement('span');
      chip.className = 'gv-tier ' + k;
      chip.textContent = `${counts[k]} ${k === 'great' ? 'great' : k}`;
      row.appendChild(chip);
    });
    host.appendChild(row);
  }

  function renderMoves() {
    const host = document.getElementById('game-viewer-moves');
    host.textContent = '';
    viewer.moves.forEach((m, i) => {
      const ply = i + 1;
      if (ply % 2 === 1 || i === 0) {
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = Math.ceil(ply / 2) + (ply % 2 ? '.' : '…');
        host.appendChild(num);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ply';
      btn.dataset.ply = String(ply);
      const r = reviewAt(ply);
      btn.textContent = m.san;
      if (r) {
        const k = r.flair || r.tier;
        btn.classList.add('tier-' + k);
        if (GLYPH[k] || k === 'great' || k === 'brilliant') {
          const g = document.createElement('span');
          g.className = 'gv-glyph';
          g.textContent = k === 'brilliant' ? '!!' : k === 'great' ? '!' : GLYPH[k];
          btn.appendChild(g);
        }
      }
      btn.addEventListener('click', () => { viewer.cursor = ply; show(); });
      host.appendChild(btn);
    });
  }

  function renderChart() {
    const host = document.getElementById('game-viewer-chart');
    host.textContent = '';
    const n = viewer.fens.length - 1;
    const pts = viewer.game.reviews.filter(r => r.cp !== null).sort((a, b) => a.ply - b.ply);
    if (pts.length < 2 || !n) { host.hidden = true; return; }
    host.hidden = false;
    const W = 300, H = 70, mid = H / 2, clamp = 800;
    const y = cp => mid - Math.max(-clamp, Math.min(clamp, cp)) / clamp * (mid - 3);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Evaluation through the game. Select a point to jump there.');
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p.ply / n * W).toFixed(1)},${y(p.cp).toFixed(1)}`).join(' ');
    const area = document.createElementNS(ns, 'path');
    area.setAttribute('d', `M0,${mid} L${(pts[0].ply / n * W).toFixed(1)},${y(pts[0].cp).toFixed(1)} ${d.replace(/^M/, 'L')} L${(pts[pts.length - 1].ply / n * W).toFixed(1)},${mid} Z`);
    area.setAttribute('class', 'gv-area');
    const zero = document.createElementNS(ns, 'line');
    zero.setAttribute('x1', '0'); zero.setAttribute('x2', String(W)); zero.setAttribute('y1', String(mid)); zero.setAttribute('y2', String(mid));
    zero.setAttribute('class', 'gv-zero');
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', d);
    line.setAttribute('class', 'gv-line');
    const cursor = document.createElementNS(ns, 'line');
    cursor.setAttribute('y1', '0'); cursor.setAttribute('y2', String(H));
    cursor.setAttribute('class', 'gv-cursor');
    svg.append(area, zero, line, cursor);
    pts.forEach(p => {
      if (!['mistake', 'blunder'].includes(p.tier)) return;
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', (p.ply / n * W).toFixed(1)); dot.setAttribute('cy', y(p.cp).toFixed(1)); dot.setAttribute('r', '3');
      dot.setAttribute('class', 'gv-dot ' + p.tier);
      svg.appendChild(dot);
    });
    svg.addEventListener('click', e => {
      const rect = svg.getBoundingClientRect();
      viewer.cursor = Math.max(0, Math.min(n, Math.round((e.clientX - rect.left) / rect.width * n)));
      show();
    });
    host.appendChild(svg);
  }

  function copyPgn() {
    if (!viewer) return;
    const btn = document.getElementById('btn-game-viewer-pgn');
    const done = text => { btn.textContent = text; setTimeout(() => { btn.textContent = 'Copy PGN'; }, 1500); };
    if (!navigator.clipboard || !navigator.clipboard.writeText) { done('Copy unavailable'); return; }
    navigator.clipboard.writeText(viewer.game.pgn).then(() => done('Copied ✓'), () => done('Copy unavailable'));
  }

  window.GameArchive = { record, load, open, close, render, remove, _viewer: () => viewer };
  const init = () => { render(); const tab = document.getElementById('tab-progress'); if (tab) tab.addEventListener('click', render); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
