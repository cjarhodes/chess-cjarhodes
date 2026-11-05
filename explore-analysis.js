// Analysis board for Library → Explore: Stockfish's top three lines for the
// position on the board, an evaluation bar and a best-move arrow, plus
// loading any FEN or PGN. Works without a Lichess token. Uses the shared
// engineClient and the Explore globals from app.js (exploreGame, board).
(function() {
  'use strict';
  const DEPTH = 14;
  const LINES = 3;
  const SETTING_KEY = 'ui:explore-engine';
  let lastFen = null;
  let token = 0;
  let result = null;     // { fen, lines, depth }
  let pending = null;

  function enabled() {
    try { return localStorage.getItem(SETTING_KEY) !== 'off'; } catch (e) { return true; }
  }
  function active() {
    return typeof appView !== 'undefined' && appView === 'library' && typeof exploreMode !== 'undefined' && exploreMode && typeof exploreGame !== 'undefined' && !!exploreGame;
  }

  // Engine scores are from the side to move; the bar and labels use White's.
  function whiteScore(fen, line) {
    const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
    if (line.mate !== null && line.mate !== undefined) return { cp: 0, mate: sign * line.mate };
    return { cp: sign * (line.cp || 0), mate: null };
  }
  function label(score) {
    if (score.mate !== null && score.mate !== undefined) return (score.mate > 0 ? '#' : '#-') + Math.abs(score.mate);
    const p = score.cp / 100;
    return (p > 0 ? '+' : '') + p.toFixed(2);
  }

  function sanLine(fen, pv, max) {
    const game = new Chess(fen);
    const out = [];
    for (const uci of (pv || []).slice(0, max)) {
      const moveNo = game.fen().split(' ')[5];
      const white = game.turn() === 'w';
      const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      if (!move) break;
      out.push((white ? moveNo + '. ' : (out.length === 0 ? moveNo + '… ' : '')) + move.san);
    }
    return out.join(' ');
  }

  function render() {
    const panel = document.getElementById('explore-engine');
    if (!panel) return;
    const list = document.getElementById('explore-engine-lines');
    const status = document.getElementById('explore-engine-status');
    list.textContent = '';
    if (!enabled()) { status.textContent = 'Engine off.'; overlay(); return; }
    if (!active()) { overlay(); return; }
    const fen = exploreGame.fen();
    const game = new Chess(fen);
    if (game.game_over()) {
      status.textContent = game.in_checkmate() ? 'Checkmate.' : 'Draw.';
      overlay();
      return;
    }
    if (!result || result.fen !== fen) {
      status.textContent = 'Analysing…';
      setBarRoom(true);
      return;
    }
    status.textContent = `Stockfish · depth ${result.depth}`;
    result.lines.forEach((line, index) => {
      const score = whiteScore(fen, line);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'explore-engine-line';
      btn.title = 'Play the first move of this line';
      const ev = document.createElement('span');
      ev.className = 'explore-engine-eval ' + (score.mate !== null ? (score.mate > 0 ? 'white' : 'black') : score.cp >= 0 ? 'white' : 'black');
      ev.textContent = label(score);
      const moves = document.createElement('span');
      moves.className = 'explore-engine-moves';
      moves.textContent = sanLine(fen, line.pv, 8);
      btn.append(ev, moves);
      btn.addEventListener('click', () => {
        const uci = line.pv && line.pv[0];
        if (uci && active() && typeof applyExploreMove === 'function') applyExploreMove(uci.slice(0, 2), uci.slice(2, 4), uci[4] || 'q', { updateBoard: true });
      });
      btn.setAttribute('aria-label', `Line ${index + 1}: ${label(score)}, ${moves.textContent}`);
      li.appendChild(btn);
      list.appendChild(li);
    });
    overlay();
  }

  // Room for the bar: the Library board fits its area's content width, so
  // extra left padding shrinks it just enough.
  function setBarRoom(on) {
    const view = document.getElementById('library-view');
    if (view) view.classList.toggle('has-eval-bar', on);
  }

  function overlay() {
    if (!window.BoardOverlay) return;
    // Keep the bar's room while a new position is analysed so the board
    // does not jump between moves.
    setBarRoom(enabled() && active());
    if (!enabled() || !active() || !result || result.fen !== exploreGame.fen() || !result.lines.length) {
      window.BoardOverlay.set('myBoard', 'board-wrap', null);
      return;
    }
    const best = result.lines[0];
    const orientation = typeof board !== 'undefined' && board && board.orientation ? board.orientation() : 'white';
    const spec = { arrows: [], badges: [], eval: Object.assign(whiteScore(result.fen, best), { orientation }) };
    const uci = best.pv && best.pv[0];
    if (uci) spec.arrows.push({ from: uci.slice(0, 2), to: uci.slice(2, 4), kind: 'best' });
    window.BoardOverlay.set('myBoard', 'board-wrap', spec);
  }

  function analyse() {
    pending = null;
    if (!enabled() || !active() || typeof engineClient === 'undefined') { render(); return; }
    const fen = exploreGame.fen();
    if (fen === lastFen && result && result.fen === fen) { render(); return; }
    lastFen = fen;
    const mine = ++token;
    render();
    if (new Chess(fen).game_over()) return;
    engineClient.evaluate(fen, DEPTH, { multipv: LINES }).then(res => {
      if (mine !== token) return;
      const lines = (res.lines || []).filter(line => line && line.pv && line.pv.length);
      result = { fen, lines, depth: lines.length ? Math.max(...lines.map(line => line.depth || 0)) : DEPTH };
      render();
    }).catch(() => {
      if (mine !== token) return;
      lastFen = null;
      const status = document.getElementById('explore-engine-status');
      if (status && active()) status.textContent = 'The engine stopped. Make a move to analyse again.';
    });
  }

  function schedule() {
    if (pending) clearTimeout(pending);
    pending = setTimeout(analyse, 220);
  }

  // Load a FEN or a PGN into Explore.
  function loadPosition(text) {
    const value = String(text || '').trim();
    if (!value) return 'Paste a FEN or a PGN.';
    let game = new Chess();
    if (game.load(value)) {
      // FEN
    } else {
      game = new Chess();
      const ok = game.load_pgn(value, { sloppy: true });
      if (!ok) return 'That is not a FEN or PGN this board can read.';
    }
    if (typeof setMode === 'function' && !exploreMode) setMode('explore');
    exploreGame = game;
    exploreStartFen = game.fen();
    const history = game.history();
    if (history.length) {
      // Keep the moves so Undo steps back through the PGN.
      const start = new Chess();
      const headers = game.header ? game.header() : {};
      if (headers && headers.FEN) start.load(headers.FEN);
      exploreStartFen = start.fen();
    }
    createBoard(game.fen(), true, typeof boardFlipped !== 'undefined' && boardFlipped ? 'black' : 'white');
    if (typeof librarySyncLastMove === 'function') librarySyncLastMove(exploreGame);
    document.getElementById('explore-title').textContent = 'Analysis board';
    document.getElementById('explore-tagline').textContent = history.length ? `Loaded PGN · ${history.length} moves · Undo steps back` : 'Loaded position · move freely';
    if (typeof fetchExploreData === 'function') fetchExploreData();
    schedule();
    return '';
  }

  function build() {
    const host = document.getElementById('explore-content');
    if (!host || document.getElementById('explore-engine')) return;
    const section = document.createElement('section');
    section.className = 'explore-engine';
    section.id = 'explore-engine';
    section.setAttribute('aria-labelledby', 'explore-engine-heading');
    section.innerHTML =
      '<div class="explore-engine-head"><h3 class="section-label" id="explore-engine-heading">Engine analysis</h3>' +
      '<label class="toggle-label" for="explore-engine-toggle"><input type="checkbox" id="explore-engine-toggle"> <span>On</span></label></div>' +
      '<div class="explore-engine-status" id="explore-engine-status" role="status" aria-live="polite"></div>' +
      '<ol class="explore-engine-lines" id="explore-engine-lines" aria-label="Engine lines, best first"></ol>' +
      '<details class="explore-load"><summary>Load a FEN or PGN</summary>' +
      '<form class="explore-load-form" id="explore-load-form"><label class="sr-only" for="explore-load-input">FEN or PGN</label>' +
      '<textarea id="explore-load-input" rows="3" spellcheck="false" placeholder="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"></textarea>' +
      '<button type="submit" class="ctrl-btn">Load</button></form><div class="explore-load-status" id="explore-load-status" role="status" aria-live="polite"></div></details>';
    const tagline = document.getElementById('explore-tagline');
    const anchor = tagline ? tagline.parentElement : null;
    if (anchor && anchor.nextSibling) host.insertBefore(section, anchor.nextSibling);
    else host.appendChild(section);
    const toggle = document.getElementById('explore-engine-toggle');
    toggle.checked = enabled();
    toggle.addEventListener('change', () => {
      try { localStorage.setItem(SETTING_KEY, toggle.checked ? 'on' : 'off'); } catch (e) { /* this page only */ }
      lastFen = null;
      token++;
      schedule();
    });
    document.getElementById('explore-load-form').addEventListener('submit', e => {
      e.preventDefault();
      const message = loadPosition(document.getElementById('explore-load-input').value);
      document.getElementById('explore-load-status').textContent = message || 'Loaded.';
    });
    // Explore moves, undo, reset and flips all redraw the Library board.
    const boardEl = document.getElementById('myBoard');
    if (boardEl && typeof MutationObserver !== 'undefined') new MutationObserver(schedule).observe(boardEl, { childList: true, subtree: true });
    const content = document.getElementById('explore-content');
    if (content && typeof MutationObserver !== 'undefined') new MutationObserver(schedule).observe(content, { attributes: true, attributeFilter: ['style'] });
    schedule();
  }

  window.ExploreAnalysis = { refresh: schedule, loadPosition, _state: () => ({ result, lastFen }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
