// Puzzles view: rated tactics, the daily puzzle, Puzzle Rush and the Vision
// trainer. Logic lives in puzzles-core.js; this file owns the board, storage
// and rendering. The 400 KB puzzle set loads on first visit.
(function() {
  'use strict';
  const Core = window.PuzzleCore;
  const STORAGE_KEY = 'chess_puzzles_v1';
  const BOARD_ID = 'puzzleBoard';
  const OPPONENT_DELAY = 450;
  const RUSH_OPPONENT_DELAY = 220;
  const VISION_SECONDS = 30;

  let puzzles = null;          // parsed PUZZLE_DATA
  let loading = null;          // Promise while puzzle-data.js loads
  let board = null;
  let orientation = 'white';
  let mode = 'rated';          // rated | daily | rush | vision | endgames | repertoire
  let initialMode = null;
  let visible = false;
  let themeGroup = 'all';
  let session = null;          // current puzzle being solved
  let rush = null;             // running Rush run
  let vision = null;           // running Vision run
  let lastRush = null;         // finished Rush run, for review
  let repRun = null;           // repertoire review session: { queue, at, results, index }
  let tapFrom = null;
  let timers = [];
  let generation = 0;          // invalidates delayed work after a change

  // ── Storage ───────────────────────────────────
  function ownerId() {
    return typeof activePracticeOwnerId === 'function' ? activePracticeOwnerId() : null;
  }
  function storageKey() {
    const owner = ownerId();
    return owner ? `${STORAGE_KEY}:${owner}` : STORAGE_KEY;
  }
  // The full history lives under this browser's key. A compact copy goes
  // into the growth state, which syncs to the account and is in backups, and
  // is merged back in on load (another browser, or an imported backup).
  function syncedCopy() {
    if (typeof loadGrowthState !== 'function') return null;
    try { return loadGrowthState().puzzles; } catch (e) { return null; }
  }
  function loadState() {
    let local;
    try { local = Core.normalizeState(JSON.parse(localStorage.getItem(storageKey()))); }
    catch (e) { local = Core.emptyState(); }
    const synced = syncedCopy();
    return synced ? Core.mergeStates(local, synced) : local;
  }
  function saveState(state) {
    const normalized = Core.normalizeState(state);
    try {
      localStorage.setItem(storageKey(), JSON.stringify(normalized));
    } catch (e) {
      setStatus('Puzzle progress could not be saved in this browser. Free some storage to keep your rating.');
      return false;
    }
    if (typeof loadGrowthState === 'function' && typeof saveGrowthState === 'function') {
      const growth = loadGrowthState();
      growth.puzzles = Core.compactState(normalized);
      saveGrowthState(growth);
    }
    return true;
  }

  // ── Repertoire storage ────────────────────────
  // Spaced-repetition records per line, in this browser and in backups.
  const Rep = window.RepertoireCore;
  function repKey() { return Rep.storageKeyFor(ownerId()); }
  function repLoad() { try { return Rep.normalizeState(JSON.parse(localStorage.getItem(repKey()))); } catch (e) { return Rep.emptyState(); } }
  function repSave(state) {
    try { localStorage.setItem(repKey(), JSON.stringify(Rep.normalizeState(state))); return true; } catch (e) { return false; }
  }
  function repCards() {
    const ids = typeof repertoireIds === 'function' ? repertoireIds() : [];
    const sideOf = window.OpponentPersonas ? window.OpponentPersonas.lineSide : (id, o) => (o.category === 'black' ? 'b' : 'w');
    return Rep.cardsFor(typeof OPENINGS !== 'undefined' ? OPENINGS : [], ids, sideOf);
  }

  // ── Timers ────────────────────────────────────
  function later(fn, ms) {
    const gen = generation;
    const id = setTimeout(() => { timers = timers.filter(t => t !== id); if (gen === generation) fn(); }, ms);
    timers.push(id);
    return id;
  }
  function cancelPending() {
    generation++;
    timers.forEach(clearTimeout);
    timers = [];
  }

  // ── Sounds (respect the Coach sound setting) ──
  function soundsOn() { return typeof coachSoundEnabled === 'undefined' || coachSoundEnabled; }
  function chime(kind) {
    if (!soundsOn() || typeof playTone !== 'function' || typeof ensureAudioCtx !== 'function') return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (kind === 'solved') {
      playTone(660, 110, { type: 'triangle', gain: 0.05 });
      playTone(880, 160, { delay: 0.09, type: 'triangle', gain: 0.05 });
    } else if (kind === 'wrong') {
      playTone(220, 180, { type: 'triangle', endFreq: 150, gain: 0.06 });
    } else if (kind === 'tick') {
      playTone(990, 50, { type: 'sine', gain: 0.025 });
    }
  }
  function moveSound(move, after) {
    if (typeof playSound === 'function' && typeof soundForMove === 'function') playSound(soundForMove(move, after));
  }

  // ── Data loading ──────────────────────────────
  function ensureData() {
    if (puzzles) return Promise.resolve(puzzles);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const done = () => {
        if (typeof PUZZLE_DATA === 'undefined' || !Array.isArray(PUZZLE_DATA)) { reject(new Error('Puzzle data is missing.')); return; }
        puzzles = PUZZLE_DATA.map(Core.parsePuzzle).filter(Boolean);
        resolve(puzzles);
      };
      if (typeof PUZZLE_DATA !== 'undefined') { done(); return; }
      const script = document.createElement('script');
      script.src = 'puzzle-data.js';
      script.async = true;
      script.onload = done;
      script.onerror = () => reject(new Error('The puzzle set could not be loaded. Check your connection and reload.'));
      document.body.appendChild(script);
    }).catch(err => { loading = null; throw err; });
    return loading;
  }

  // ── Board ─────────────────────────────────────
  function pieceTheme(piece) {
    return typeof localPieceTheme === 'function' ? localPieceTheme(piece) : `vendor/pieces/cburnett/${piece}.svg`;
  }
  function createBoard(position, opts) {
    const options = opts || {};
    if (board) board.destroy();
    clearTap();
    board = Chessboard(BOARD_ID, {
      position: position || 'start',
      orientation,
      draggable: !options.static,
      showNotation: options.showNotation !== false,
      pieceTheme,
      moveSpeed: 160,
      onDragStart: onDragStart,
      onDrop: onDrop,
      onSnapEnd: () => { if (session && board) board.position(session.game.fen(), false); }
    });
    if (typeof observeBoardLastMove === 'function') observeBoardLastMove(BOARD_ID);
    setArrows(null);
    describeBoard();
  }
  function setLastMove(move) {
    if (typeof setBoardLastMove === 'function') setBoardLastMove(BOARD_ID, move);
  }
  function describeBoard() {
    const el = document.getElementById(BOARD_ID);
    if (!el) return;
    if (mode === 'vision') { el.setAttribute('aria-label', 'Vision board. Click the named square.'); return; }
    if (!session) { el.setAttribute('aria-label', 'Puzzle board'); return; }
    const side = session.game.turn() === 'w' ? 'White' : 'Black';
    el.setAttribute('aria-label', `Puzzle position, ${side} to move. FEN ${session.game.fen()}`);
  }
  function squareEl(square) {
    return document.querySelector(`#${BOARD_ID} .square-${square}`);
  }
  function markSquares(cls, squares) {
    document.querySelectorAll(`#${BOARD_ID} .${cls}`).forEach(el => el.classList.remove(cls));
    (squares || []).forEach(sq => { const el = squareEl(sq); if (el) el.classList.add(cls); });
  }
  function setArrows(arrows) {
    if (window.BoardOverlay) window.BoardOverlay.set(BOARD_ID, 'puzzleBoard-wrap', arrows && arrows.length ? { arrows } : null);
  }
  function clearTap() {
    tapFrom = null;
    markSquares('tap-selected', []);
    markSquares('tap-target', []);
  }
  function flash(kind) {
    const el = document.getElementById('puzzle-board-flash');
    if (!el) return;
    el.className = 'puzzle-board-flash ' + kind;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { el.className = 'puzzle-board-flash'; }, 420);
  }

  // ── Solving ───────────────────────────────────
  function solverColor() { return session ? session.solver : null; }
  function canMove() { return !!(session && session.phase === 'solving' && !session.busy); }

  function onDragStart(source, piece) {
    if (mode === 'vision') return false;
    if (!canMove()) return false;
    return piece[0] === solverColor();
  }
  function onDrop(source, target) {
    if (!canMove() || source === target) return 'snapback';
    if (typeof requestPromotionChoice === 'function' && requestPromotionChoice(session.game, source, target, promotion => submitMove(source + target + promotion), true)) {
      return 'snapback';
    }
    const legal = session.game.moves({ verbose: true }).some(m => m.from === source && m.to === target);
    if (!legal) return 'snapback';
    // chessboard.js finishes the drop itself; a wrong move snaps back.
    return submitMove(source + target, { fromDrop: true }) ? undefined : 'snapback';
  }

  function onSquareClick(square) {
    if (mode === 'vision') { visionClick(square); return; }
    if (!canMove()) return;
    if (tapFrom && tapFrom !== square) {
      const from = tapFrom;
      const legal = session.game.moves({ square: from, verbose: true }).filter(m => m.to === square);
      clearTap();
      if (!legal.length) { maybeSelect(square); return; }
      if (typeof requestPromotionChoice === 'function' && requestPromotionChoice(session.game, from, square, promotion => submitMove(from + square + promotion, { animate: true }), true)) return;
      submitMove(from + square, { animate: true });
      return;
    }
    if (tapFrom === square) { clearTap(); return; }
    maybeSelect(square);
  }
  function maybeSelect(square) {
    const piece = session.game.get(square);
    if (!piece || piece.color !== solverColor()) return;
    clearTap();
    tapFrom = square;
    markSquares('tap-selected', [square]);
    markSquares('tap-target', session.game.moves({ square, verbose: true }).map(m => m.to));
  }

  function startPuzzle(puzzle, opts) {
    cancelPending();
    const options = opts || {};
    const game = new Chess(puzzle.fen);
    // The solver plays the side that moves after the set-up move.
    const solver = game.turn() === 'w' ? 'b' : 'w';
    orientation = solver === 'w' ? 'white' : 'black';
    session = {
      puzzle, game, solver, ply: 0, phase: 'intro', busy: true,
      outcome: null, hinted: false, hintLevel: 0, revealed: false,
      rated: options.rated !== false, source: options.source || mode, startedAt: Date.now()
    };
    createBoard(puzzle.fen);
    setLastMove(null);
    const kbStatus = document.getElementById('puzzle-keyboard-move-status');
    if (kbStatus) kbStatus.textContent = '';
    renderPuzzleCard();
    updateControls();
    setStatus(options.source === 'rush' ? 'Get ready…' : 'Watch the opponent’s move.');
    later(() => playOpponent(), options.source === 'rush' ? RUSH_OPPONENT_DELAY : OPPONENT_DELAY);
  }

  function playOpponent() {
    if (!session) return;
    const uci = session.puzzle.moves[session.ply];
    const move = Core.applyUci(session.game, uci);
    if (!move) { setStatus('This puzzle has a broken move. Choose Next puzzle.'); return; }
    session.ply++;
    board.position(session.game.fen());
    setLastMove(move);
    moveSound(move, session.game);
    session.phase = 'solving';
    session.busy = false;
    const side = session.solver === 'w' ? 'White' : 'Black';
    setPhase(session.source === 'rush' ? 'Puzzle Rush' : session.rated ? 'Your turn' : 'Practice · unrated');
    setStatus(session.ply === 1 ? `Find the best move for ${side}.` : 'Keep going: find the next move.');
    describeBoard();
    updateControls();
  }

  // Returns true when the move was accepted.
  function submitMove(uci, opts) {
    if (!canMove()) return false;
    if (session.kind === 'endgame') return endgameMove(uci, opts || {});
    if (session.kind === 'repertoire') return repMove(uci, opts || {});
    const options = opts || {};
    clearTap();
    markSquares('hint-square', []);
    setArrows(null);
    const result = Core.checkSolverMove(Chess, session.puzzle, session.ply, uci);
    if (result.reason === 'illegal' || result.reason === 'not-solver-turn') {
      if (board && !options.fromDrop) board.position(session.game.fen(), false);
      return false;
    }
    if (!result.ok) { wrongMove(result.uci, options); return false; }
    const move = Core.applyUci(session.game, result.uci);
    session.ply++;
    session.hintLevel = 0;
    // After a drag, onSnapEnd redraws castling, en passant and promotion.
    if (!options.fromDrop) board.position(session.game.fen(), !!options.animate);
    setLastMove(move);
    moveSound(move, session.game);
    describeBoard();
    if (result.complete || session.ply >= session.puzzle.moves.length) { solved(result.alternative); return true; }
    session.busy = true;
    setStatus('Correct. Keep going.');
    flash('good');
    updateControls();
    later(playOpponent, session.source === 'rush' ? RUSH_OPPONENT_DELAY : OPPONENT_DELAY);
    return true;
  }

  function wrongMove(uci, opts) {
    const fromDrop = !!(opts && opts.fromDrop);
    chime('wrong');
    flash('bad');
    const probe = new Chess(session.game.fen());
    const tried = Core.applyUci(probe, uci);
    const san = tried ? tried.san : uci;
    if (session.source === 'rush') {
      if (board && !fromDrop) board.position(session.game.fen(), false);
      rushResult(false);
      return;
    }
    const firstMiss = !session.outcome;
    if (firstMiss) decide(false);
    // Show a clicked or typed move briefly, then take it back. A dragged
    // move snaps back on its own.
    session.busy = true;
    if (tried && !fromDrop) { board.position(probe.fen(), false); setLastMove(tried); }
    later(() => {
      if (!session) return;
      board.position(session.game.fen(), false);
      const history = session.game.history({ verbose: true });
      setLastMove(history.length ? history[history.length - 1] : null);
      session.busy = false;
      updateControls();
    }, 650);
    setStatus(`${san} is not it. Try again, or show the solution.`);
    renderPuzzleCard();
  }

  function solved(alternative) {
    session.phase = 'solved';
    session.busy = false;
    chime('solved');
    flash('good');
    if (session.source === 'rush') { rushResult(true); return; }
    if (!session.outcome) decide(true);
    if (session.source === 'daily' || session.source === 'daily-retry') markSolvedDaily();
    const note = alternative ? ' A different mate than the original game, and just as good.' : '';
    setPhase(session.outcome === 'win' ? 'Solved' : 'Completed');
    setStatus((session.outcome === 'win' ? 'Solved!' : 'Completed. Next time, first try.') + note);
    renderPuzzleCard();
    updateControls();
    document.getElementById('btn-puzzle-next').focus({ preventScroll: true });
  }

  // Record the first decisive event: a first-try solve, or the first miss,
  // hint or solution view.
  function decide(win) {
    session.outcome = win ? 'win' : 'loss';
    const ms = Date.now() - session.startedAt;
    if (session.source === 'daily') {
      const state = loadState();
      const day = Core.dayKey();
      const existing = state.daily[day];
      state.daily[day] = { id: session.puzzle.id, solved: !!(existing && existing.solved) || win, firstTry: existing ? existing.firstTry : win };
      const rec = Core.recordAttempt(state, session.puzzle, { win, rated: false, hinted: session.hinted, ms }, Date.now());
      saveState(rec.state);
      session.delta = 0;
    } else {
      const rec = Core.recordAttempt(loadState(), session.puzzle, { win, rated: session.rated, hinted: session.hinted, ms }, Date.now());
      saveState(rec.state);
      session.delta = rec.attempt.delta;
      if (session.source === 'review') session.reviewWin = win;
    }
    renderRail();
    renderHistory();
  }

  function markSolvedDaily() {
    if (!session || session.source !== 'daily') return;
    const state = loadState();
    const day = Core.dayKey();
    const row = state.daily[day] || { id: session.puzzle.id, firstTry: false };
    state.daily[day] = Object.assign({}, row, { solved: true });
    saveState(state);
  }

  function showHint() {
    if (!canMove()) return;
    if (session.kind === 'endgame') { endgameHint(); return; }
    if (session.kind === 'repertoire') { repHint(); return; }
    const expected = session.puzzle.moves[session.ply];
    if (!expected) return;
    session.hinted = true;
    if (!session.outcome && session.source !== 'rush') decide(false);
    session.hintLevel = Math.min(2, session.hintLevel + 1);
    const squares = session.hintLevel === 1 ? [expected.slice(0, 2)] : [expected.slice(0, 2), expected.slice(2, 4)];
    markSquares('hint-square', squares);
    if (session.hintLevel === 2) setArrows([{ from: expected.slice(0, 2), to: expected.slice(2, 4), kind: 'hint' }]);
    const piece = session.game.get(expected.slice(0, 2));
    const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    setStatus(session.hintLevel === 1 ? `Hint: move your ${piece ? names[piece.type] : 'piece'} on ${expected.slice(0, 2)}.` : `Hint: ${expected.slice(0, 2)} to ${expected.slice(2, 4)}.`);
    renderPuzzleCard();
  }

  function showSolution() {
    if (!session || session.phase === 'solved') return;
    if (!session.outcome && session.source !== 'rush') decide(false);
    session.revealed = true;
    session.phase = 'revealing';
    session.busy = true;
    markSquares('hint-square', []);
    setArrows(null);
    updateControls();
    const step = () => {
      if (!session) return;
      if (session.ply >= session.puzzle.moves.length) {
        session.phase = 'solved';
        session.busy = false;
        setPhase('Solution');
        setStatus('That was the solution. Retry it unrated, or move on.');
        renderPuzzleCard();
        updateControls();
        return;
      }
      const move = Core.applyUci(session.game, session.puzzle.moves[session.ply]);
      session.ply++;
      board.position(session.game.fen());
      setLastMove(move);
      moveSound(move, session.game);
      later(step, 700);
    };
    setStatus('Showing the solution…');
    later(step, 250);
  }

  function retryPuzzle() {
    if (!session) return;
    if (session.kind === 'endgame') { startEndgame(session.drill); return; }
    startPuzzle(session.puzzle, { rated: false, source: session.source === 'daily' ? 'daily-retry' : session.source === 'review' ? 'review' : 'replay' });
  }

  function nextPuzzle() {
    // Rush, Vision and Endgames own the board while they are open.
    if (!puzzles || mode === 'rush' || mode === 'vision' || mode === 'endgames' || mode === 'repertoire') return;
    if (session && session.source === 'review') {
      const queue = loadedMissed().filter(id => id !== session.puzzle.id);
      if (queue.length) { startReview(queue[0]); return; }
    }
    nextRated();
  }

  // A rated puzzle near the player's rating, on the chosen theme.
  function nextRated() {
    if (!puzzles || mode === 'rush' || mode === 'vision' || mode === 'endgames' || mode === 'repertoire') return;
    if (mode === 'daily') { setMode('rated'); return; }
    const state = loadState();
    const pick = Core.selectPuzzle(puzzles, { target: state.rating, group: themeGroup, exclude: Core.recentIds(state) });
    if (!pick) { setStatus('No puzzles match this theme. Choose another theme.'); return; }
    startPuzzle(pick, { rated: true, source: 'rated' });
  }

  function startReview(id) {
    const puzzle = puzzles && puzzles.find(p => p.id === id);
    if (!puzzle) return false;
    if (mode !== 'rated') setMode('rated', { keepSession: true });
    startPuzzle(puzzle, { rated: false, source: 'review' });
    return true;
  }

  // Missed puzzles that this puzzle set can actually open.
  function loadedMissed() {
    const ids = puzzles ? new Set(puzzles.map(p => p.id)) : new Set();
    return Core.missedQueue(loadState()).filter(id => ids.has(id));
  }

  function reviewMissed() {
    const queue = loadedMissed();
    if (queue.length) startReview(queue[0]);
  }

  function replayPuzzle(id) {
    const puzzle = puzzles && puzzles.find(p => p.id === id);
    if (!puzzle) return;
    if (mode === 'rush' || mode === 'vision') setMode('rated', { keepSession: true });
    startPuzzle(puzzle, { rated: false, source: 'replay' });
  }

  // ── Rush ──────────────────────────────────────
  function startRush() {
    if (!puzzles) return;
    const choice = document.querySelector('input[name="puzzle-rush-mode"]:checked');
    const key = choice ? choice.value : 'three';
    const config = Core.RUSH_MODES[key] || Core.RUSH_MODES.three;
    const start = Math.max(500, Math.min(1000, Math.round(loadState().rating - 600)));
    rush = { key, config, solved: 0, strikes: 0, used: new Set(), attempts: [], start,
      endsAt: config.seconds ? Date.now() + config.seconds * 1000 : 0, clock: null };
    lastRush = null;
    document.getElementById('puzzle-rush-result').hidden = true;
    document.getElementById('puzzle-rush-review-section').hidden = true;
    document.getElementById('btn-puzzle-rush-start').hidden = true;
    document.getElementById('btn-puzzle-rush-stop').hidden = false;
    syncBars();
    document.querySelectorAll('input[name="puzzle-rush-mode"]').forEach(el => { el.disabled = true; });
    if (rush.endsAt) rush.clock = setInterval(tickRush, 200);
    renderRushBar();
    nextRushPuzzle();
  }
  function nextRushPuzzle() {
    if (!rush) return;
    const pick = Core.rushPuzzle(puzzles, rush.solved, rush.used, Math.random, rush.start);
    if (!pick) { endRush('You solved every puzzle we had at this level.'); return; }
    rush.used.add(pick.id);
    startPuzzle(pick, { rated: false, source: 'rush' });
  }
  function rushResult(win) {
    if (!rush || !session) return;
    rush.attempts.push({ id: session.puzzle.id, rating: session.puzzle.rating, win });
    if (win) rush.solved++;
    else rush.strikes++;
    renderRushBar();
    renderRushReview();
    if (rush.strikes >= rush.config.strikes) { endRush('Three mistakes. Run over.'); return; }
    setStatus(win ? 'Solved!' : 'Missed. Next one.');
    session.busy = true;
    later(nextRushPuzzle, win ? 350 : 700);
  }
  function tickRush() {
    if (!rush || !rush.endsAt) return;
    const left = rush.endsAt - Date.now();
    if (left <= 0) { endRush('Time!'); return; }
    renderRushBar();
  }
  function endRush(message) {
    if (!rush) return;
    const run = rush;
    rush = null;
    if (run.clock) clearInterval(run.clock);
    cancelPending();
    if (session) { session.phase = 'solved'; session.busy = false; }
    const rec = Core.recordRun(loadState(), 'rush', run.key, run.solved, run.strikes, Date.now());
    saveState(rec.state);
    lastRush = run;
    const result = document.getElementById('puzzle-rush-result');
    result.hidden = false;
    result.textContent = `${message} Score ${run.solved}${rec.isBest ? ' — a new best!' : `. Best ${rec.state.rush.best[run.key] || run.solved}.`}`;
    document.getElementById('btn-puzzle-rush-start').hidden = false;
    document.getElementById('btn-puzzle-rush-start').textContent = 'Run again';
    document.getElementById('btn-puzzle-rush-stop').hidden = true;
    document.querySelectorAll('input[name="puzzle-rush-mode"]').forEach(el => { el.disabled = false; });
    setPhase('Puzzle Rush');
    setStatus(`${message} You solved ${run.solved}. Review the run on the right.`);
    renderRushBar(run);
    renderRushReview(run);
    renderRushBests();
    updateControls();
    if (rec.isBest) chime('solved');
  }
  function renderRushBar(finished) {
    const run = rush || finished;
    if (!run) return;
    const left = run.endsAt ? Math.max(0, run.endsAt - Date.now()) : 0;
    const clock = document.getElementById('puzzle-rush-clock');
    if (run.endsAt) {
      const secs = Math.ceil(left / 1000);
      clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      clock.classList.toggle('low', secs <= 15 && !!rush);
    } else {
      clock.textContent = 'Survival';
    }
    document.getElementById('puzzle-rush-score').textContent = String(run.solved);
    const strikes = document.getElementById('puzzle-rush-strikes');
    strikes.textContent = '';
    for (let i = 0; i < run.config.strikes; i++) {
      const dot = document.createElement('span');
      dot.className = 'puzzle-strike' + (i < run.strikes ? ' used' : '');
      dot.textContent = i < run.strikes ? '✕' : '○';
      strikes.appendChild(dot);
    }
    strikes.setAttribute('aria-label', `${run.strikes} of ${run.config.strikes} mistakes`);
  }
  function renderRushReview(finished) {
    const run = rush || finished;
    const section = document.getElementById('puzzle-rush-review-section');
    const list = document.getElementById('puzzle-rush-review');
    if (!run || !run.attempts.length) { section.hidden = true; return; }
    section.hidden = false;
    list.textContent = '';
    run.attempts.slice().reverse().forEach(row => list.appendChild(historyItem(row.id, row.win, row.rating, null, !rush)));
  }
  function renderRushBests() {
    const best = loadState().rush.best;
    document.querySelectorAll('.puzzle-rush-best').forEach(el => {
      const key = el.getAttribute('data-best');
      el.textContent = best[key] ? `Best ${best[key]}` : '';
    });
  }

  // ── Vision ────────────────────────────────────
  function visionSide() {
    const active = document.querySelector('#puzzle-vision-side button.active');
    const side = active ? active.getAttribute('data-side') : 'white';
    return side === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : side;
  }
  function prepareVisionBoard() {
    session = null;
    orientation = vision ? vision.side : visionSide();
    const showPieces = document.getElementById('puzzle-vision-pieces').checked;
    createBoard(showPieces ? 'start' : {}, { static: true, showNotation: false });
    setLastMove(null);
  }
  function startVision() {
    cancelPending();
    const activeSide = document.querySelector('#puzzle-vision-side button.active');
    const sideKey = activeSide ? activeSide.getAttribute('data-side') : 'white';
    vision = { sideKey, side: visionSide(), score: 0, mistakes: 0, target: null, endsAt: Date.now() + VISION_SECONDS * 1000, clock: null };
    prepareVisionBoard();
    vision.target = Core.randomSquare(Math.random, null);
    vision.clock = setInterval(tickVision, 200);
    document.getElementById('puzzle-vision-result').hidden = true;
    document.getElementById('btn-puzzle-vision-start').disabled = true;
    renderVision();
    setPhase('Vision');
    setStatus(`Click ${vision.target}.`);
  }
  function visionClick(square) {
    if (!vision) return;
    if (square === vision.target) {
      vision.score++;
      flashSquare(square, 'vision-good');
      vision.target = Core.randomSquare(Math.random, vision.target);
      chime('tick');
    } else {
      vision.mistakes++;
      flashSquare(square, 'vision-bad');
    }
    renderVision();
  }
  function flashSquare(square, cls) {
    const el = squareEl(square);
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 260);
  }
  function tickVision() {
    if (!vision) return;
    if (vision.endsAt - Date.now() <= 0) { endVision(); return; }
    renderVision();
  }
  function endVision(abandoned) {
    if (!vision) return;
    const run = vision;
    vision = null;
    clearInterval(run.clock);
    document.getElementById('btn-puzzle-vision-start').disabled = false;
    document.getElementById('puzzle-vision-prompt').hidden = true;
    document.getElementById('puzzle-vision-prompt').textContent = '';
    syncBars();
    if (abandoned) return;
    const key = run.sideKey === 'random' ? 'random' : run.side;
    const rec = Core.recordRun(loadState(), 'vision', key, run.score, run.mistakes, Date.now());
    saveState(rec.state);
    const accuracy = run.score + run.mistakes ? Math.round(100 * run.score / (run.score + run.mistakes)) : 0;
    const result = document.getElementById('puzzle-vision-result');
    result.hidden = false;
    result.textContent = `${run.score} squares in ${VISION_SECONDS} seconds, ${accuracy}% accurate.${rec.isBest ? ' A new best!' : ''}`;
    document.getElementById('btn-puzzle-vision-start').textContent = 'Go again';
    setPhase('Vision');
    setStatus(`Time! ${run.score} correct, ${run.mistakes} missed.`);
    renderVisionBest();
    if (rec.isBest) chime('solved');
  }
  function renderVision() {
    if (!vision) return;
    const prompt = document.getElementById('puzzle-vision-prompt');
    prompt.hidden = false;
    if (prompt.textContent !== vision.target) {
      prompt.textContent = vision.target;
      setStatus(`Click ${vision.target}.`);
    }
    syncBars();
    const secs = Math.max(0, Math.ceil((vision.endsAt - Date.now()) / 1000));
    document.getElementById('puzzle-rush-clock').textContent = `0:${String(secs).padStart(2, '0')}`;
    document.getElementById('puzzle-rush-clock').classList.toggle('low', secs <= 5);
    document.getElementById('puzzle-rush-score').textContent = String(vision.score);
    const strikes = document.getElementById('puzzle-rush-strikes');
    strikes.textContent = vision.mistakes ? `${vision.mistakes} missed` : '';
    strikes.setAttribute('aria-label', `${vision.mistakes} missed`);
  }
  function renderVisionBest() {
    const best = loadState().vision.best;
    const parts = ['white', 'black', 'random'].filter(k => best[k]).map(k => `${k[0].toUpperCase() + k.slice(1)} ${best[k]}`);
    document.getElementById('puzzle-vision-best').textContent = parts.length ? 'Best: ' + parts.join(' · ') : '';
  }

  // ── Endgame practice (endgames.js) ────────────
  const EG_KEY = 'chess_endgames_v1';
  const EG_DEPTH = 14;
  let egToken = 0;
  function egBest() {
    try { const v = JSON.parse(localStorage.getItem(EG_KEY)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; }
  }
  function saveEgBest(id, moves) {
    const best = egBest();
    const isBest = !best[id] || moves < best[id];
    if (isBest) best[id] = moves;
    try { localStorage.setItem(EG_KEY, JSON.stringify(best)); } catch (e) { /* this page only */ }
    return isBest;
  }
  function goalText(drill) {
    return drill.goal === 'mate' ? `Checkmate within ${drill.limit} moves` : `Promote safely within ${drill.limit} moves`;
  }

  function startEndgame(drill) {
    if (!drill) return;
    cancelPending();
    egToken++;
    orientation = 'white';
    session = { kind: 'endgame', drill, game: new Chess(drill.fen), solver: EndgameDrills.userColor(drill), phase: 'solving', busy: false, userMoves: 0, hinted: false, outcome: null };
    createBoard(drill.fen);
    setLastMove(null);
    const kb = document.getElementById('puzzle-keyboard-move-status');
    if (kb) kb.textContent = '';
    egReport('');
    setPhase(drill.title);
    setStatus(`${goalText(drill)}. ${drill.tip}`);
    renderEndgames();
    updateControls();
  }

  function egReport(text) {
    const el = document.getElementById('endgame-result');
    if (el) { el.hidden = !text; el.textContent = text || ''; }
  }

  function egFinish(verdict) {
    session.phase = 'solved';
    session.busy = false;
    session.outcome = verdict.result;
    let text = verdict.reason;
    if (verdict.result === 'win') {
      chime('solved');
      flash('good');
      if (session.hinted) text += ' Hints were used, so this does not set a best.';
      else if (saveEgBest(session.drill.id, session.userMoves)) text += ' A new best!';
    } else {
      chime('wrong');
      flash('bad');
      text += ' Try again to take another run at it.';
    }
    setPhase(verdict.result === 'win' ? 'Done' : 'Not this time');
    setStatus(text);
    egReport(text);
    renderEndgames();
    updateControls();
  }

  function endgameMove(uci, options) {
    const normalized = Core.normalizeUci(session.game, uci);
    if (!normalized) { if (board && !options.fromDrop) board.position(session.game.fen(), false); return false; }
    const move = Core.applyUci(session.game, normalized);
    session.userMoves++;
    clearTap();
    setArrows(null);
    if (!options.fromDrop) board.position(session.game.fen(), !!options.animate);
    setLastMove(move);
    moveSound(move, session.game);
    describeBoard();
    const verdict = EndgameDrills.judge(Chess, session.drill, session.game, session.userMoves);
    if (verdict) { egFinish(verdict); return true; }
    session.busy = true;
    updateControls();
    setStatus('Engine thinking…');
    const mine = ++egToken;
    const current = session;
    const movedAt = Date.now();
    // Let the player's move finish animating: the engine can answer these
    // positions in milliseconds, and overlapping chessboard.js animations
    // leave a ghost piece behind.
    const settle = res => new Promise(resolve => setTimeout(() => resolve(res), Math.max(0, 350 - (Date.now() - movedAt))));
    engineClient.evaluate(session.game.fen(), EG_DEPTH).then(settle).then(res => {
      if (mine !== egToken || session !== current) return;
      const reply = res && res.bestmove ? Core.applyUci(current.game, res.bestmove) : null;
      if (!reply) { egRollback(current, 'The engine did not reply, so your move was taken back. Play it again.'); return; }
      board.position(current.game.fen());
      setLastMove(reply);
      moveSound(reply, current.game);
      describeBoard();
      const after = EndgameDrills.judge(Chess, current.drill, current.game, current.userMoves);
      if (after) { egFinish(after); return; }
      current.busy = false;
      const left = current.drill.limit - current.userMoves;
      setStatus(`Your move. ${left} move${left === 1 ? '' : 's'} left.`);
      updateControls();
    }).catch(() => {
      if (mine !== egToken || session !== current) return;
      egRollback(current, 'The engine stopped, so your move was taken back. Play it again.');
    });
    return true;
  }

  // Take back the player's last move when the engine cannot answer it, so
  // the drill is never left with the engine to move and no reply coming.
  function egRollback(current, message) {
    if (current.game.turn() !== current.solver && current.game.undo()) current.userMoves = Math.max(0, current.userMoves - 1);
    current.busy = false;
    current.phase = 'solving';
    if (board && session === current) {
      board.position(current.game.fen(), false);
      const history = current.game.history({ verbose: true });
      setLastMove(history.length ? history[history.length - 1] : null);
    }
    if (session === current) { setStatus(message); updateControls(); }
  }

  function endgameHint() {
    const current = session;
    current.hinted = true;
    current.busy = true;
    updateControls();
    setStatus('Looking for the best move…');
    const mine = ++egToken;
    engineClient.evaluate(current.game.fen(), EG_DEPTH).then(res => {
      if (mine !== egToken || session !== current) return;
      current.busy = false;
      const uci = res && res.bestmove;
      if (uci) setArrows([{ from: uci.slice(0, 2), to: uci.slice(2, 4), kind: 'hint' }]);
      setStatus(uci ? 'The arrow shows the engine’s move. Hints mean this run will not set a best.' : 'No hint available.');
      updateControls();
    }).catch(() => { if (session === current) { current.busy = false; updateControls(); } });
  }

  function renderEndgames() {
    const list = document.getElementById('endgame-list');
    if (!list) return;
    const best = egBest();
    list.textContent = '';
    EndgameDrills.DRILLS.forEach(drill => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const active = session && session.kind === 'endgame' && session.drill.id === drill.id;
      btn.className = 'endgame-row' + (active ? ' active' : '');
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.dataset.drill = drill.id;
      const name = document.createElement('span');
      name.className = 'endgame-name';
      name.textContent = drill.title;
      const meta = document.createElement('span');
      meta.className = 'endgame-meta';
      meta.textContent = goalText(drill) + (best[drill.id] ? ` · best ${best[drill.id]}` : '');
      btn.append(name, meta);
      btn.addEventListener('click', () => { egReport(''); startEndgame(drill); });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  // ── Repertoire trainer ────────────────────────
  // Play your side of each due line from memory. The opponent's moves are
  // played for you; a wrong move shows the line's move and plays it, and the
  // line comes back in ten minutes. Scheduling lives in repertoire-core.js.
  function startRepSession() {
    const cards = repCards();
    const queue = Rep.queue(cards, repLoad(), Date.now());
    repSummary('');
    if (!queue.length) { renderRepertoire(); setStatus('Nothing is due. Come back when lines are due, or star more openings.'); return; }
    // Progress saves to the account the session started under.
    repRun = { queue, at: 0, results: [], index: Rep.moveIndex(Chess, cards), key: repKey() };
    startRepCard();
  }

  function startRepCard() {
    cancelPending();
    const card = repRun.queue[repRun.at];
    const plies = Rep.plies(Chess, card);
    if (!plies) { repRun.at++; if (repRun.at < repRun.queue.length) startRepCard(); else endRepSession(); return; }
    orientation = card.side === 'w' ? 'white' : 'black';
    session = { kind: 'repertoire', card, plies, ply: 0, game: new Chess(), solver: card.side, phase: 'solving', busy: false, mistakes: 0, hinted: false };
    createBoard('start');
    setLastMove(null);
    const kb = document.getElementById('puzzle-keyboard-move-status');
    if (kb) kb.textContent = '';
    setPhase(`Line ${repRun.at + 1} of ${repRun.queue.length} · ${card.side === 'w' ? 'White' : 'Black'}`);
    renderRepertoire();
    if (!plies[0].mine) {
      session.busy = true;
      setStatus(`${card.name}. Watch White's move.`);
      later(repOpponent, OPPONENT_DELAY);
    } else {
      setStatus(`${card.name}. Your move.`);
    }
    updateControls();
  }

  function repOpponent() {
    if (!session || session.kind !== 'repertoire') return;
    const ply = session.plies[session.ply];
    const move = Core.applyUci(session.game, ply.uci);
    session.ply++;
    board.position(session.game.fen());
    setLastMove(move);
    moveSound(move, session.game);
    describeBoard();
    session.busy = false;
    setStatus(`${move.san}. Your move.`);
    updateControls();
    // Typed moves keep the move field focused through the opponent's reply.
    if (session.typed) {
      const input = document.getElementById('puzzle-keyboard-move-input');
      if (input && document.getElementById('puzzle-keyboard-move').open) input.focus({ preventScroll: true });
    }
  }

  // Plays the line's move (the user's correct move, or the shown answer).
  function repAdvance(ply, animate, fromDrop) {
    const move = Core.applyUci(session.game, ply.uci);
    session.ply++;
    clearTap();
    markSquares('hint-square', []);
    if (!fromDrop) board.position(session.game.fen(), animate);
    setLastMove(move);
    moveSound(move, session.game);
    describeBoard();
    if (session.ply >= session.plies.length) { finishRepCard(); return; }
    session.busy = true;
    updateControls();
    later(repOpponent, OPPONENT_DELAY);
  }

  function repMove(uci, options) {
    const normalized = Core.normalizeUci(session.game, uci);
    if (!normalized) { if (board && !options.fromDrop) board.position(session.game.fen(), false); return false; }
    const ply = session.plies[session.ply];
    const verdict = Rep.grade(repRun.index, session.card, ply, normalized);
    session.typed = !!options.animate;
    setArrows(null);
    if (verdict === 'ok') {
      flash('good');
      repAdvance(ply, !!options.animate, !!options.fromDrop);
      if (session && session.phase === 'solving') setStatus('Correct.');
      return true;
    }
    if (board && !options.fromDrop) board.position(session.game.fen(), false);
    clearTap();
    if (verdict && verdict.other) {
      // One slip into a sibling line is free; a second guess at the same
      // move counts like a hint.
      session.siblingTries = session.siblingTries || {};
      session.siblingTries[session.ply] = (session.siblingTries[session.ply] || 0) + 1;
      if (session.siblingTries[session.ply] > 1) session.hinted = true;
      setStatus(`That is your move in ${verdict.other}. This line goes another way: try again.` + (session.hinted && session.siblingTries[session.ply] > 1 ? ' A second guess here counts as a hint.' : ''));
      return false;
    }
    session.mistakes++;
    chime('wrong');
    flash('bad');
    session.busy = true;
    updateControls();
    setArrows([{ from: ply.uci.slice(0, 2), to: ply.uci.slice(2, 4), kind: 'hint' }]);
    setStatus(`Not this line. It plays ${ply.san}.`);
    const current = session;
    later(() => {
      if (session !== current) return;
      setArrows(null);
      repAdvance(ply, true, false);
    }, 1400);
    return false;
  }

  function repHint() {
    const ply = session.plies[session.ply];
    session.hinted = true;
    setArrows([{ from: ply.uci.slice(0, 2), to: ply.uci.slice(2, 4), kind: 'hint' }]);
    setStatus(`Hint: ${ply.san}. A hint brings this line back in ten minutes.`);
  }

  function finishRepCard() {
    const clean = session.mistakes === 0 && !session.hinted;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(repRun.key)); } catch (e) { stored = null; }
    try { localStorage.setItem(repRun.key, JSON.stringify(Rep.review(stored, session.card.id, clean, Date.now()))); } catch (e) { /* this line's result is lost */ }
    repRun.results.push({ name: session.card.name, clean });
    session.phase = 'solved';
    session.busy = true;
    if (clean) chime('solved');
    setStatus(clean ? 'Line complete, first try.' : 'Line complete. It comes back in ten minutes.');
    renderRepertoire();
    updateControls();
    repRun.at++;
    later(() => { if (!repRun) return; if (repRun.at < repRun.queue.length) startRepCard(); else endRepSession(); }, 1100);
  }

  function endRepSession() {
    const results = repRun ? repRun.results : [];
    repRun = null;
    if (session && session.kind === 'repertoire') { session.busy = false; session.phase = 'solved'; }
    const clean = results.filter(r => r.clean).length;
    setPhase('Review complete');
    const text = `${results.length} line${results.length === 1 ? '' : 's'} reviewed, ${clean} first try.` +
      (results.length - clean ? ` ${results.length - clean} come${results.length - clean === 1 ? 's' : ''} back in ten minutes.` : '');
    setStatus(text);
    repSummary(text);
    renderRepertoire();
    updateControls();
  }

  function repSummary(text) {
    const el = document.getElementById('rep-summary');
    if (el) { el.hidden = !text; el.textContent = text || ''; }
  }

  function whenLabel(ts) {
    const days = Math.round((Rep.addDays(ts, 0) - Rep.addDays(Date.now(), 0)) / 86400000);
    if (days <= 0) return 'later today';
    if (days === 1) return 'tomorrow';
    return `in ${days} days`;
  }

  let repDueTimer = null;
  function renderRepertoire() {
    const stats = document.getElementById('rep-stats');
    if (!stats) return;
    // Re-render when the next line comes due (a ten-minute relearn, or
    // midnight), so Start does not stay disabled on a stale count.
    clearTimeout(repDueTimer);
    const cards = repCards();
    const state = repLoad();
    const now = Date.now();
    const s = Rep.stats(cards, state, now);
    const detail = document.getElementById('puzzle-repertoire-detail');
    if (detail) detail.textContent = s.due ? `${s.due} line${s.due === 1 ? '' : 's'} due` : 'Drill your starred openings';
    document.getElementById('rep-empty').hidden = cards.length > 0;
    const start = document.getElementById('btn-rep-start');
    const ready = s.due + s.newToday;
    start.hidden = !cards.length;
    start.disabled = !!repRun || !ready;
    start.textContent = repRun ? 'Reviewing…' : ready ? `Review ${Math.min(ready, Rep.SESSION_LIMIT)} line${Math.min(ready, Rep.SESSION_LIMIT) === 1 ? '' : 's'}` : 'Nothing due';
    const wait = s.nextDue ? s.nextDue - now + 500 : 0;
    if (wait > 0 && wait < 86400000) repDueTimer = setTimeout(() => { if (visible) renderRepertoire(); }, wait);
    stats.hidden = !cards.length;
    stats.textContent = cards.length ? [`${s.total} line${s.total === 1 ? '' : 's'}`, `${s.learned} learned`, `${s.due} due`, s.fresh ? `${s.fresh} new (${s.newToday} today)` : '',
      !s.due && s.nextDue ? `next due ${whenLabel(s.nextDue)}` : ''].filter(Boolean).join(' · ') : '';
    const list = document.getElementById('rep-list');
    list.textContent = '';
    const byOpening = new Map();
    cards.forEach(c => { if (!byOpening.has(c.openingId)) byOpening.set(c.openingId, []); byOpening.get(c.openingId).push(c); });
    byOpening.forEach(group => {
      const li = document.createElement('li');
      li.className = 'rep-row';
      const name = document.createElement('span');
      name.className = 'rep-name';
      name.textContent = group[0].name.split(':')[0] + (group[0].side === 'w' ? ' · White' : ' · Black');
      const meta = document.createElement('span');
      meta.className = 'rep-meta';
      const g = Rep.stats(group, state, now);
      meta.textContent = `${g.total} line${g.total === 1 ? '' : 's'} · ${g.learned} learned${g.due ? ` · ${g.due} due` : ''}`;
      li.append(name, meta);
      list.appendChild(li);
    });
  }

  // The Rush clock and Vision prompt take height from the board.
  function syncBars() {
    const bar = mode === 'rush' ? !!(rush || lastRush) : mode === 'vision' ? !!vision : false;
    document.getElementById('puzzle-rush-bar').hidden = !bar;
    document.getElementById('puzzle-vision-prompt').hidden = !(mode === 'vision' && vision);
    const view = document.getElementById('puzzles-view');
    view.classList.toggle('has-bar', bar);
    view.classList.toggle('has-prompt', mode === 'vision' && !!vision);
    if (board && visible) requestAnimationFrame(() => board && board.resize());
  }

  // ── Rendering ─────────────────────────────────
  function setStatus(text) { const el = document.getElementById('puzzle-status'); if (el) el.textContent = text; }
  function setPhase(text) { const el = document.getElementById('puzzle-phase'); if (el) el.textContent = text; }

  function renderPuzzleCard() {
    const kind = document.getElementById('puzzle-card-kind');
    const title = document.getElementById('puzzle-card-title');
    const prompt = document.getElementById('puzzle-card-prompt');
    const rating = document.getElementById('puzzle-card-rating');
    const feedback = document.getElementById('puzzle-feedback');
    const themes = document.getElementById('puzzle-themes');
    const source = document.getElementById('puzzle-source');
    const next = document.getElementById('btn-puzzle-next');
    if (!session || session.source === 'rush' || session.kind === 'endgame' || session.kind === 'repertoire') return;
    const p = session.puzzle;
    const side = session.solver === 'w' ? 'White' : 'Black';
    const labels = { rated: 'Rated puzzle', daily: 'Daily puzzle · ' + Core.dayKey(), replay: 'Replay · unrated', review: 'Missed puzzle review · unrated', 'daily-retry': 'Daily puzzle · retry' };
    kind.textContent = labels[session.source] || 'Puzzle';
    const done = session.phase === 'solved';
    const decided = !!session.outcome;
    // Hide the puzzle rating while solving so it does not hint at difficulty.
    rating.textContent = done || decided ? `Rated ${p.rating}` : '';
    title.textContent = done ? (session.outcome === 'win' ? 'Solved' : session.revealed ? 'Solution shown' : 'Completed with help') : `${side} to move`;
    // Say nothing about the motif or length while solving: that is the puzzle.
    prompt.textContent = done ? '' : decided ? 'Finish the line to see the idea behind it.' : 'Find the best move. Some puzzles need more than one move.';
    if (session.outcome && !['replay', 'review', 'daily-retry'].includes(session.source)) {
      feedback.hidden = false;
      const delta = session.delta || 0;
      if (session.source === 'daily') feedback.textContent = session.outcome === 'win' ? 'Daily puzzle solved first try.' : 'Daily puzzle missed on the first try. Finish it to keep the habit.';
      else feedback.textContent = session.outcome === 'win' ? `Correct first try. Rating ${delta >= 0 ? '+' : ''}${delta}.` : `Rating ${delta}. ${session.hinted && !session.revealed ? 'A hint counts as a miss.' : session.revealed ? 'Viewing the solution counts as a miss.' : 'Finish the puzzle to see the idea.'}`;
      feedback.className = 'puzzle-feedback ' + (session.outcome === 'win' ? 'good' : 'bad');
    } else if (session.source === 'review') {
      feedback.hidden = !done;
      const left = Core.missedQueue(loadState()).length;
      feedback.textContent = session.reviewWin ? `Solved first time — off your review list. ${left ? left + ' left.' : 'Review list cleared.'}` : `Still on your review list. ${left} left.`;
      feedback.className = 'puzzle-feedback ' + (session.reviewWin ? 'good' : '');
    } else if (session.source === 'replay' || session.source === 'daily-retry') {
      feedback.hidden = !done;
      feedback.textContent = 'Replay finished. Replays do not change your rating.';
      feedback.className = 'puzzle-feedback';
    } else {
      feedback.hidden = true;
    }
    themes.textContent = '';
    themes.hidden = !done;
    if (done) {
      const skill = p.themes.filter(t => !['short', 'long', 'veryLong', 'oneMove', 'advantage', 'crushing', 'equality', 'master', 'masterVsMaster', 'superGM'].includes(t));
      skill.slice(0, 5).forEach(theme => {
        const row = document.createElement('div');
        row.className = 'puzzle-theme';
        const name = document.createElement('strong');
        name.textContent = Core.themeLabel(theme);
        row.appendChild(name);
        const note = Core.themeNote(theme);
        if (note) { const span = document.createElement('span'); span.textContent = ' — ' + note; row.appendChild(span); }
        themes.appendChild(row);
      });
    }
    let line = document.getElementById('puzzle-solution-line');
    if (!line) {
      line = document.createElement('p');
      line.id = 'puzzle-solution-line';
      line.className = 'puzzle-solution-line';
      themes.insertAdjacentElement('beforebegin', line);
    }
    line.hidden = !done;
    line.textContent = done ? 'Solution: ' + Core.solutionSan(Chess, p) : '';
    source.hidden = !done;
    source.href = `https://lichess.org/training/${encodeURIComponent(p.id)}`;
    next.textContent = session.source === 'daily' || session.source === 'daily-retry' ? 'Continue to rated puzzles'
      : session.source === 'review' ? (loadedMissed().some(id => id !== p.id) ? 'Next missed puzzle' : 'Back to rated puzzles')
      : (done || decided ? 'Next puzzle' : 'Skip');
    next.classList.toggle('primary', done || decided);
  }

  function renderRail() {
    const state = loadState();
    const now = Date.now();
    document.getElementById('puzzle-rating-value').textContent = String(Math.round(state.rating));
    document.getElementById('puzzle-rating-provisional').hidden = !Core.isProvisional(state, now);
    const rated = state.history.filter(row => row.rated);
    const last = rated[rated.length - 1];
    const delta = document.getElementById('puzzle-rating-delta');
    if (last && now - last.at < 6 * 3600000 && last.delta) {
      delta.textContent = (last.delta > 0 ? '+' : '') + last.delta;
      delta.className = 'puzzle-rating-delta ' + (last.delta > 0 ? 'up' : 'down');
    } else {
      delta.textContent = '';
      delta.className = 'puzzle-rating-delta';
    }
    renderSpark(rated.slice(-40).map(row => row.ratingAfter));
    const today = Core.todaySummary(state, now);
    const streak = Core.currentStreak(state);
    document.getElementById('puzzle-today').textContent = today.attempts
      ? `Today: ${today.wins} of ${today.attempts} solved first try (${today.delta >= 0 ? '+' : ''}${today.delta}).`
      : 'No rated puzzles yet today.';
    document.getElementById('puzzle-streak').textContent = streak >= 2 ? `${streak} in a row` : '';
    const daily = state.daily[Core.dayKey()];
    document.getElementById('puzzle-daily-detail').textContent = daily && daily.solved ? 'Solved today ✓' : 'One new puzzle each day';
    renderThemeStats(state);
  }

  function renderSpark(values) {
    const host = document.getElementById('puzzle-rating-spark');
    host.textContent = '';
    host.hidden = values.length < 2;
    if (values.length < 2) return;
    const w = 240, h = 40, pad = 3;
    const lo = Math.min(...values), hi = Math.max(...values);
    const span = Math.max(20, hi - lo);
    const points = values.map((v, i) => `${(pad + i * (w - 2 * pad) / (values.length - 1)).toFixed(1)},${(h - pad - (v - lo) * (h - 2 * pad) / span).toFixed(1)}`).join(' ');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', points);
    line.setAttribute('class', 'puzzle-spark-line');
    svg.appendChild(line);
    host.appendChild(svg);
  }

  function renderThemeStats(state) {
    const host = document.getElementById('puzzle-theme-stats');
    host.textContent = '';
    const stats = Core.themeStats(state);
    if (!stats.strengths.length && !stats.weaknesses.length) {
      const p = document.createElement('p');
      p.className = 'puzzle-empty';
      p.textContent = stats.attempts < 10
        ? `Solve ${10 - stats.attempts} more rated puzzle${10 - stats.attempts === 1 ? '' : 's'} to see which themes you spot and which you miss.`
        : 'No theme stands out yet. Keep solving.';
      host.appendChild(p);
      return;
    }
    const block = (label, rows, kind) => {
      if (!rows.length) return;
      const head = document.createElement('div');
      head.className = 'puzzle-stat-label';
      head.textContent = label;
      host.appendChild(head);
      rows.forEach(row => {
        const item = document.createElement('div');
        item.className = 'puzzle-stat ' + kind;
        const name = document.createElement('span');
        name.className = 'puzzle-stat-name';
        name.textContent = row.label;
        const meter = document.createElement('span');
        meter.className = 'puzzle-stat-meter';
        const fill = document.createElement('span');
        fill.style.width = Math.round(row.rate * 100) + '%';
        meter.appendChild(fill);
        const val = document.createElement('span');
        val.className = 'puzzle-stat-value';
        val.textContent = `${row.wins}/${row.attempts}`;
        item.append(name, meter, val);
        if (kind === 'weak') {
          const group = Core.groupForTheme(row.theme);
          if (group !== 'all') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'movelist-copy';
            btn.textContent = 'Practise';
            btn.addEventListener('click', () => { setTheme(group); setMode('rated'); nextRated(); });
            item.appendChild(btn);
          }
        }
        host.appendChild(item);
      });
    };
    block('You spot these', stats.strengths, 'strong');
    block('You miss these more', stats.weaknesses, 'weak');
    const note = document.createElement('p');
    note.className = 'progress-method';
    note.textContent = `First-try solve rates from your last ${stats.attempts} rated puzzles (${Math.round(stats.overall * 100)}% overall). Small samples move a lot.`;
    host.appendChild(note);
  }

  function historyItem(id, win, rating, delta, clickable) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'puzzle-history-item ' + (win ? 'win' : 'loss');
    btn.disabled = clickable === false;
    btn.title = clickable === false ? '' : 'Replay this puzzle (unrated)';
    const mark = document.createElement('span');
    mark.className = 'puzzle-history-mark';
    mark.textContent = win ? '✓' : '✕';
    mark.setAttribute('aria-label', win ? 'solved' : 'missed');
    const r = document.createElement('span');
    r.textContent = String(rating);
    btn.append(mark, r);
    if (delta) {
      const d = document.createElement('span');
      d.className = 'puzzle-history-delta';
      d.textContent = (delta > 0 ? '+' : '') + delta;
      btn.appendChild(d);
    }
    btn.addEventListener('click', () => replayPuzzle(id));
    li.appendChild(btn);
    return li;
  }

  function renderHistory() {
    const review = document.getElementById('btn-puzzle-review');
    if (review) {
      const n = puzzles ? loadedMissed().length : Core.missedQueue(loadState()).length;
      review.hidden = !n;
      review.textContent = `Review ${n} missed puzzle${n === 1 ? '' : 's'}`;
    }
    const list = document.getElementById('puzzle-history');
    list.textContent = '';
    const rows = loadState().history.filter(row => row.rated).slice(-18).reverse();
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'puzzle-empty';
      li.textContent = 'Your solved and missed puzzles appear here. Select one to replay it.';
      list.appendChild(li);
      return;
    }
    rows.forEach(row => list.appendChild(historyItem(row.id, row.win, Math.round(row.puzzleRating), row.delta)));
  }

  function updateControls() {
    const solving = canMove();
    const inPuzzle = !!session && mode !== 'vision';
    const rushing = !!rush;
    if (session && session.kind === 'repertoire') {
      document.getElementById('btn-puzzle-hint').disabled = !solving;
      document.getElementById('btn-puzzle-solution').disabled = true;
      document.getElementById('btn-puzzle-retry').disabled = true;
      document.getElementById('btn-puzzle-flip').disabled = false;
      document.getElementById('puzzle-keyboard-move-input').disabled = !solving;
      return;
    }
    if (session && session.kind === 'endgame') {
      document.getElementById('btn-puzzle-hint').disabled = !solving;
      document.getElementById('btn-puzzle-solution').disabled = true;
      document.getElementById('btn-puzzle-retry').disabled = false;
      document.getElementById('btn-puzzle-flip').disabled = false;
      document.getElementById('puzzle-keyboard-move-input').disabled = !solving;
      return;
    }
    document.getElementById('btn-puzzle-hint').disabled = !solving || rushing;
    document.getElementById('btn-puzzle-solution').disabled = !inPuzzle || rushing || !session || session.phase === 'solved' || session.phase === 'revealing';
    document.getElementById('btn-puzzle-retry').disabled = !inPuzzle || rushing || !session || session.phase !== 'solved';
    document.getElementById('btn-puzzle-flip').disabled = mode === 'vision' && !!vision;
    document.getElementById('puzzle-keyboard-move-input').disabled = !solving;
  }

  function setTheme(group) {
    themeGroup = Core.THEME_GROUPS.some(g => g.id === group) ? group : 'all';
    document.getElementById('puzzle-theme').value = themeGroup;
    try { localStorage.setItem('ui:puzzle-theme', themeGroup); } catch (e) { /* session only */ }
  }

  // ── Modes ─────────────────────────────────────
  function setMode(next, opts) {
    const options = opts || {};
    if (rush && next !== 'rush') endRush('Run ended.');
    if (vision && next !== 'vision') endVision(true);
    if (mode === 'endgames' && next !== 'endgames' && session && session.kind === 'endgame') { egToken++; session = null; }
    if (next !== 'repertoire' && (repRun || (session && session.kind === 'repertoire'))) { cancelPending(); repRun = null; session = null; }
    mode = next;
    document.querySelectorAll('.puzzle-mode').forEach(btn => {
      const active = btn.getAttribute('data-mode') === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const panel = ['rush', 'vision', 'endgames', 'repertoire'].includes(mode) ? mode : 'rated';
    document.querySelectorAll('.puzzle-panel').forEach(el => { el.hidden = el.id !== 'puzzle-panel-' + panel; });
    syncBars();
    document.getElementById('puzzle-keyboard-move').hidden = mode === 'vision';
    document.getElementById('puzzles-view').classList.toggle('vision-active', mode === 'vision');
    if (typeof updateURL === 'function' && visible) updateURL();
    // The repertoire trainer needs only the Library lines, not the puzzle set.
    if (mode === 'repertoire') {
      if (!session || session.kind !== 'repertoire') {
        cancelPending();
        session = null;
        orientation = 'white';
        createBoard('start', { static: true });
        setLastMove(null);
        setPhase('My repertoire');
        setStatus(repCards().length ? 'Start a review to play your due lines.' : 'Star openings in the Library to build your repertoire.');
      }
      renderRepertoire();
      updateControls();
      return;
    }
    if (!puzzles || options.keepSession) { updateControls(); return; }
    if (mode === 'endgames') {
      if (!session || session.kind !== 'endgame') {
        cancelPending();
        session = null;
        orientation = 'white';
        createBoard(EndgameDrills.DRILLS[0].fen, { static: true });
        setLastMove(null);
        setPhase('Endgame practice');
        setStatus('Choose an endgame on the right and play it out against the engine.');
      }
      renderEndgames();
    } else if (mode === 'vision') {
      cancelPending();
      prepareVisionBoard();
      setPhase('Vision');
      setStatus('Choose a side, then start. Click each square as it is named.');
      renderVisionBest();
    } else if (mode === 'rush') {
      cancelPending();
      if (!rush) {
        session = null;
        orientation = 'white';
        createBoard('start', { static: true });
        setLastMove(null);
        setPhase('Puzzle Rush');
        setStatus(lastRush ? 'Run over. Review it or run again.' : 'Choose a length, then start your run.');
        document.getElementById('btn-puzzle-rush-start').textContent = lastRush ? 'Run again' : 'Start Rush';
      }
      renderRushBests();
    } else if (mode === 'daily') {
      const pick = Core.dailyPuzzle(puzzles, Core.dayKey());
      const record = loadState().daily[Core.dayKey()];
      startPuzzle(pick, { rated: false, source: record ? 'daily-retry' : 'daily' });
      if (record) setStatus(record.solved ? 'You already solved today’s puzzle. Replay it, or continue to rated puzzles.' : 'Finish today’s puzzle.');
    } else if (!session || session.source === 'rush' || session.source === 'daily' || session.source === 'daily-retry') {
      nextPuzzle();
    }
    updateControls();
  }

  // ── Keyboard ──────────────────────────────────
  function onKey(e) {
    if (!visible) return;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    const picker = document.getElementById('promotion-picker');
    if (picker && picker.getAttribute('aria-hidden') === 'false') return;
    const k = e.key.toLowerCase();
    const click = id => { const el = document.getElementById(id); if (el && !el.disabled) { e.preventDefault(); el.click(); } };
    if (k === 'h') click('btn-puzzle-hint');
    else if (k === 's') click('btn-puzzle-solution');
    else if (k === 'r') click('btn-puzzle-retry');
    else if (k === 'f') click('btn-puzzle-flip');
    else if ((k === 'n' || (k === 'enter' && session && session.phase === 'solved' && e.target === document.body)) && mode !== 'rush' && mode !== 'vision') click('btn-puzzle-next');
  }

  // ── Wiring ────────────────────────────────────
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    const select = document.getElementById('puzzle-theme');
    Core.THEME_GROUPS.forEach(group => {
      const opt = document.createElement('option');
      opt.value = group.id;
      opt.textContent = group.label;
      select.appendChild(opt);
    });
    let saved = 'all';
    try { saved = localStorage.getItem('ui:puzzle-theme') || 'all'; } catch (e) { /* default */ }
    setTheme(saved);
    select.addEventListener('change', () => {
      setTheme(select.value);
      if (mode !== 'rated') setMode('rated');
      else if (!session || session.source === 'review' || session.phase === 'solved' || session.outcome || session.ply <= 1) nextRated();
    });
    document.querySelectorAll('.puzzle-mode').forEach(btn => btn.addEventListener('click', () => { initialMode = null; setMode(btn.getAttribute('data-mode')); }));
    document.getElementById('btn-puzzle-next').addEventListener('click', nextPuzzle);
    document.getElementById('btn-puzzle-review').addEventListener('click', reviewMissed);
    document.getElementById('btn-puzzle-hint').addEventListener('click', showHint);
    document.getElementById('btn-puzzle-solution').addEventListener('click', showSolution);
    document.getElementById('btn-puzzle-retry').addEventListener('click', retryPuzzle);
    document.getElementById('btn-puzzle-flip').addEventListener('click', () => {
      if (!board) return;
      board.flip();
      orientation = board.orientation();
    });
    document.getElementById('btn-puzzle-rush-start').addEventListener('click', startRush);
    document.getElementById('btn-rep-start').addEventListener('click', startRepSession);
    document.getElementById('btn-rep-library').addEventListener('click', () => { if (typeof switchView === 'function') switchView('library'); });
    document.getElementById('btn-puzzle-rush-stop').addEventListener('click', () => endRush('Run ended.'));
    document.getElementById('btn-puzzle-vision-start').addEventListener('click', startVision);
    document.querySelectorAll('#puzzle-vision-side button').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('#puzzle-vision-side button').forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      if (!vision) prepareVisionBoard();
    }));
    document.getElementById('puzzle-vision-pieces').addEventListener('change', () => { if (!vision) prepareVisionBoard(); });
    const drawer = document.getElementById('puzzle-keyboard-move');
    drawer.addEventListener('toggle', () => {
      document.getElementById('puzzles-view').classList.toggle('kb-open', drawer.open);
      if (board && visible) requestAnimationFrame(() => board && board.resize());
    });
    document.getElementById('puzzle-keyboard-move-form').addEventListener('submit', e => {
      e.preventDefault();
      const input = document.getElementById('puzzle-keyboard-move-input');
      const status = document.getElementById('puzzle-keyboard-move-status');
      if (!canMove()) { status.textContent = 'Wait for your turn.'; return; }
      const move = typeof resolveAccessibleMove === 'function' ? resolveAccessibleMove(session.game, input.value) : null;
      if (!move) { status.textContent = 'That move is not legal here. Try SAN such as Nf3 or coordinates such as g1f3.'; return; }
      input.value = '';
      status.textContent = 'Move played: ' + move.san;
      submitMove(move.from + move.to + (move.promotion || ''), { animate: true });
    });
    // chessboard.js starts a drag on mousedown, so a click on a piece never
    // reaches the square. Select on pointerdown instead (mouse and touch).
    document.getElementById(BOARD_ID).addEventListener('pointerdown', e => {
      if (!visible || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const sq = e.target.closest && e.target.closest('.square-55d63');
      if (sq) onSquareClick(sq.getAttribute('data-square'));
    });
    document.addEventListener('keydown', onKey);
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (board && visible) board.resize(); }, 120);
    });
  }

  function show() {
    bind();
    visible = true;
    renderRail();
    renderHistory();
    renderRushBests();
    renderVisionBest();
    renderRepertoire();
    if (board) setTimeout(() => board && board.resize(), 0);
    if (puzzles) {
      if (initialMode) { const m = initialMode; initialMode = null; setMode(m); }
      return;
    }
    // The repertoire trainer needs only the Library, so it opens at once;
    // the puzzle set keeps loading in the background.
    if ((initialMode || mode) === 'repertoire') {
      initialMode = null;
      setMode('repertoire');
      ensureData().catch(() => { /* puzzles retry when their modes open */ });
      return;
    }
    setStatus('Loading puzzles…');
    if (!board) { orientation = 'white'; createBoard('start', { static: true }); }
    ensureData().then(() => {
      const start = initialMode || mode;
      initialMode = null;
      // A mode chosen while loading (such as the repertoire) is already open.
      if (visible && start !== 'repertoire') setMode(start);
    }).catch(err => setStatus(err.message));
  }

  function hide() {
    visible = false;
    egToken++;
    if (session && session.kind === 'endgame' && session.busy && session.phase === 'solving') egRollback(session, 'Your last move was taken back when you left. Play it again.');
    if (rush) endRush('Run ended when you left Puzzles.');
    if (vision) endVision(true);
    // Lines already finished are saved; the one in progress stops here.
    if (repRun || (session && session.kind === 'repertoire' && session.phase === 'solving')) {
      cancelPending();
      repRun = null;
      session = null;
      if (mode === 'repertoire') {
        createBoard('start', { static: true });
        setLastMove(null);
        setPhase('My repertoire');
        setStatus('Review stopped when you left. Finished lines are saved.');
        renderRepertoire();
      }
    }
    clearTap();
  }

  // Open rated puzzles on one theme, from anywhere in the app.
  function openGroup(group) {
    setTheme(group);
    if (visible) { setMode('rated'); nextRated(); return; }
    initialMode = 'rated';
    mode = 'rated';
    session = null;
    if (typeof switchView === 'function') switchView('puzzles');
  }

  // Progress → "Work on next": offer matching puzzles for the focus.
  function bindProgressLink() {
    const next = document.getElementById('btn-progress-next');
    const title = document.getElementById('progress-next-title');
    if (!next || !title || document.getElementById('btn-progress-puzzles')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctrl-btn';
    btn.id = 'btn-progress-puzzles';
    btn.hidden = true;
    next.insertAdjacentElement('afterend', btn);
    const update = () => {
      let tag = null;
      try {
        if (typeof progressRecommendation === 'function' && typeof currentInsightEntries === 'function') tag = progressRecommendation(currentInsightEntries()).focusTag;
      } catch (e) { tag = null; }
      const group = Core.groupForInsightTag(tag);
      btn.hidden = !group;
      if (group) {
        btn.dataset.group = group;
        btn.textContent = `Solve ${Core.groupLabel(group).toLowerCase()} puzzles`;
      }
    };
    btn.addEventListener('click', () => { if (btn.dataset.group) openGroup(btn.dataset.group); });
    if (typeof MutationObserver !== 'undefined') new MutationObserver(update).observe(title, { childList: true, characterData: true, subtree: true });
    update();
  }

  window.PuzzlesView = {
    openGroup,
    history: () => loadState().history,
    missed: () => Core.missedQueue(loadState()),
    show,
    hide,
    urlMode: () => (mode === 'rated' ? null : mode),
    setInitialMode: m => { if (['rated', 'daily', 'rush', 'vision', 'endgames', 'repertoire'].includes(m)) { initialMode = m; mode = m; } },
    repertoireKey: () => repKey(),
    // Exposed for tests and the console.
    _debug: () => ({ mode, session, rush, vision, repRun, puzzles: puzzles ? puzzles.length : 0, state: loadState() }),
    _start: id => { const p = puzzles && puzzles.find(row => row.id === id); if (p) startPuzzle(p, { rated: true, source: 'rated' }); return !!p; }
  };

  const boot = () => { bind(); bindProgressLink(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
