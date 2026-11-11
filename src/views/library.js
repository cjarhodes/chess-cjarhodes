// Library view: the openings list, Study / Quiz / Explore on the Library
// board (#myBoard), line selection, quiz auto-play and mistake review,
// move list, explanations, key ideas and feedback. The Library SR maths
// is in src/core/library-sr.js and Explore data in src/library/explore.js;
// event binding is in app.js.
// Classic script (see index.html): its top-level declarations are shared
// globals with src/, the other view scripts, growth.js and the feature
// modules, as they were inside app.js. Nothing here runs at load except
// plain initialisers, so the view scripts can call each other freely.

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let board = null;
let game = new Chess();
let currentOpening = null;
let currentLine = null;
let currentLineId = 'main';
let currentMoveIdx = -1;  // -1 = starting position
let quizMode = false;
let exploreMode = false;
let exploreGame = null;
let exploreStartFen = null;
let exploreRequestId = 0;
let currentDb = 'lichess';
let boardFlipped = false;
let quizAttempts = 0;
let feedbackTimeout = null;
let quizSessionMisses = 0;  // misses in current quiz session (before completion)
let quizMissedMoves = [];
let quizReviewMode = false;
let quizReviewQueue = [];
let quizReviewCursor = 0;
let quizTimerGeneration = 0; // invalidates pending quiz auto-play when the quiz restarts

// Library with no opening on the board (Back from an opening to the list).
function clearOpening() {
  if (!currentOpening) return;
  resetQuizTracking();
  currentOpening = null;
  currentLine = null;
  currentLineId = 'main';
  currentMoveIdx = -1;
  game.reset();
  boardFlipped = false;
  librarySyncLastMove(null);
  qsa('.opening-btn').forEach(el => { el.classList.remove('active'); });
  qsa('.app').forEach(el => { el.classList.remove('has-opening'); });
  hideEl(byId('opening-content'));
  qsa('#move-list, #key-ideas').forEach(el => { el.replaceChildren(); });
  if (!exploreMode) {
    hideEl(byId('myBoard'));
    showEl(byId('board-placeholder'));
    showEl(byId('empty-state'));
  }
  ['btn-prev', 'btn-start', 'btn-next', 'btn-end', 'btn-flip'].forEach(id => { byId(id).disabled = true; });
  if (typeof renderRepertoireUI === 'function') renderRepertoireUI();
  updateProgress();
  clearFeedback();
  updateSRPanel();
}

// ─────────────────────────────────────────────
// LIBRARY BOARD
// ─────────────────────────────────────────────
// describeChessPosition lives in src/core/position-text.js.
function updateLibraryBoardAccessibility() {
  const activeGame = exploreMode && exploreGame ? exploreGame : game;
  byId('myBoard').setAttribute('aria-label', describeChessPosition(activeGame));
}

// Library board: interactive in Quiz and Explore. Only the side to move can
// pick up a piece; the drop handlers check the move itself.
function libraryActiveGame() {
  return exploreMode && exploreGame ? exploreGame : game;
}

function createBoard(position, draggable, orientation) {
  if (board) board.destroy();
  board = Chessboard('myBoard', {
    position: position || 'start',
    draggable: !!draggable,
    orientation: orientation || 'white',
    onDragStart: function(source, piece) {
      const active = libraryActiveGame();
      return !!(active && (quizMode || exploreMode) && piece[0] === active.turn());
    },
    moveTargets: function(square) {
      const active = libraryActiveGame();
      return active ? active.moves({ square, verbose: true }).map(m => m.to) : [];
    },
    onDrop: handleDrop,
    onSnapEnd: handleSnapEnd,
  });
  restoreBoardLastMove('myBoard');
  scheduleLibraryBoardFit();
  updateLibraryBoardAccessibility();
}

// ─────────────────────────────────────────────
// LINES AND QUIZ MISTAKE REVIEW
// ─────────────────────────────────────────────
function getOpeningLines(opening) {
  if (!opening) return [];
  return [{
    id: 'main',
    name: 'Main line',
    note: opening.tagline || '',
    tagline: opening.tagline,
    description: opening.description,
    moves: opening.moves,
    explanations: opening.explanations,
    keyIdeas: opening.keyIdeas
  }].concat(opening.variations || []);
}

function setActiveLine(lineId) {
  const lines = getOpeningLines(currentOpening);
  currentLine = lines.find(line => line.id === lineId) || lines[0] || null;
  currentLineId = currentLine ? currentLine.id : 'main';
}

function activeMoves() {
  return currentLine && currentLine.moves ? currentLine.moves : [];
}

function activeExplanations() {
  return currentLine && currentLine.explanations ? currentLine.explanations : [];
}

function activeKeyIdeas() {
  if (currentLine && currentLine.keyIdeas) return currentLine.keyIdeas;
  return currentOpening && currentOpening.keyIdeas ? currentOpening.keyIdeas : [];
}

function renderOpeningDetails() {
  if (!currentOpening || !currentLine) return;
  byId('opening-title').textContent = currentOpening.name;
  if (currentLine.id === 'main') {
    byId('opening-tagline').textContent = currentOpening.tagline || '';
    byId('opening-desc').textContent = currentOpening.description || '';
  } else {
    const note = currentLine.note || currentLine.tagline || '';
    byId('opening-tagline').textContent = note ? `${currentLine.name} · ${note}` : currentLine.name;
    byId('opening-desc').textContent = currentLine.description || currentOpening.description || '';
  }
}

function renderLineSelector() {
  const lines = getOpeningLines(currentOpening);
  const wrap = byId('line-selector-wrap');
  const selector = byId('line-selector');
  selector.replaceChildren();
  if (!currentOpening || lines.length <= 1) {
    hideEl(wrap);
    return;
  }
  lines.forEach(line => {
    const button = makeEl('button', 'line-btn', line.name);
    button.classList.toggle('active', line.id === currentLineId);
    button.setAttribute('data-line', line.id);
    selector.append(button);
  });
  showEl(wrap);
}

function resetQuizTracking() {
  quizTimerGeneration++;
  quizAttempts = 0;
  quizSessionMisses = 0;
  quizMissedMoves = [];
  quizReviewMode = false;
  quizReviewQueue = [];
  quizReviewCursor = 0;
  hideEl(byId('btn-review-misses'));
}

function recordQuizMiss(idx) {
  if (!quizMissedMoves.includes(idx)) quizMissedMoves.push(idx);
}

function moveLabelForIndex(idx) {
  const moveNo = Math.floor(idx / 2) + 1;
  return `${moveNo}${idx % 2 === 0 ? '.' : '...'} ${activeMoves()[idx] || ''}`.trim();
}

function setLineStartPosition() {
  currentMoveIdx = -1;
  quizAttempts = 0;
  game.reset();
  board.position('start', false);
  librarySyncLastMove(null);
  renderMoveList();
  renderExplanation(-1);
  updateProgress();
  updateControls();
}

function switchOpeningLine(lineId) {
  if (!currentOpening) return;
  setActiveLine(lineId);
  resetQuizTracking();
  game.reset();
  currentMoveIdx = -1;
  if (quizMode) boardFlipped = (getUserColor() === 'black');
  createBoard('start', quizMode, boardFlipped ? 'black' : 'white');
  renderOpeningDetails();
  renderLineSelector();
  renderKeyIdeas();
  renderMoveList();
  renderExplanation(-1);
  updateProgress();
  updateControls();
  clearFeedback();
  updateSRPanel();
  updateURL();
  if (quizMode) {
    const colorLabel = getUserColor() === 'white' ? 'White ♙' : 'Black ♟';
    showFeedback('hint', `💡 You're playing ${colorLabel}. The opponent's moves play automatically.`);
    autoPlayOpponent();
  }
}

function startQuizMistakeReview() {
  if (!currentOpening || quizMissedMoves.length === 0) return;
  quizReviewQueue = quizMissedMoves.slice().sort((a, b) => a - b);
  quizReviewCursor = 0;
  quizReviewMode = true;
  quizAttempts = 0;
  hideEl(byId('btn-review-misses'));
  loadQuizReviewPosition();
}

function loadQuizReviewPosition() {
  if (!quizReviewMode || quizReviewCursor >= quizReviewQueue.length) {
    quizReviewMode = false;
    setLineStartPosition();
    showFeedback('correct', 'Review complete — missed moves replayed.');
    return;
  }
  const idx = quizReviewQueue[quizReviewCursor];
  const moves = activeMoves();
  game.reset();
  for (let i = 0; i < idx; i++) game.move(moves[i]);
  currentMoveIdx = idx - 1;
  quizAttempts = 0;
  board.position(game.fen(), false);
  librarySyncLastMove(game);
  renderMoveList();
  renderExplanation(idx - 1);
  updateProgress();
  const moveNo = Math.floor(idx / 2) + 1;
  showFeedback('hint', `Review ${quizReviewCursor + 1}/${quizReviewQueue.length}: find the missed ${idx % 2 === 0 ? moveNo + '.' : moveNo + '...'} move.`);
}

// ─────────────────────────────────────────────
// QUIZ AUTO-PLAY HELPERS
// ─────────────────────────────────────────────
// The side that owns a Library line: traps and gambits are played by the side
// that springs them (Fool's Mate, Stafford and the Slav are Black's), which
// opponents.js records. It loads after the view scripts, so it is looked up
// at call time; without it the opening's category decides.
function openingLineSide(opening, lineId) {
  if (!opening) return 'white';
  if (typeof OpponentPersonas !== 'undefined' && OpponentPersonas.lineSide) {
    const id = lineId && lineId !== 'main' ? lineId : opening.id;
    return OpponentPersonas.lineSide(id, opening) === 'b' ? 'black' : 'white';
  }
  return opening.category === 'black' ? 'black' : 'white';
}

function getUserColor() {
  if (!currentOpening) return 'white';
  return openingLineSide(currentOpening, currentLine && currentLine.id);
}

function isUserTurn(idx) {
  // Even indices (0,2,4…) = White's move; odd = Black's move
  const userIsWhite = getUserColor() === 'white';
  return userIsWhite ? (idx % 2 === 0) : (idx % 2 === 1);
}

function finishQuiz() {
  if (!currentOpening) return;
  const m = quizSessionMisses;
  const quality = m === 0 ? 5 : (m <= 2 ? 4 : (m <= 4 ? 3 : 2));
  const saveResult = srRecordQuiz(currentOpening.id, quality);
  const summary = m === 0
    ? '🎉 Opening complete — perfect run!'
    : `🎉 Opening complete — ${m} miss${m === 1 ? '' : 'es'}.`;
  const saveWarning = saveResult && saveResult.ok === false
    ? ' Progress could not be saved in this browser.'
    : '';
  showFeedback('correct', summary + saveWarning);
  if (quizMissedMoves.length > 0) showEl(byId('btn-review-misses'));
  updateSRSidebar();
  updateSRPanel();
  if (typeof renderOpeningTransferEntry === 'function') renderOpeningTransferEntry();
}

function autoPlayOpponent() {
  if (!quizMode || !currentOpening) return;
  if (quizReviewMode) return;
  const moves = activeMoves();
  const nextIdx = currentMoveIdx + 1;
  if (nextIdx >= moves.length) {
    finishQuiz();
    return;
  }
  if (isUserTurn(nextIdx)) return; // user's move, wait for them

  // Play opponent's move after a short pause, unless the quiz restarted
  // (another opening, line or mode) in the meantime.
  const generation = quizTimerGeneration;
  setTimeout(function () {
    if (generation !== quizTimerGeneration) return;
    if (!quizMode) return;
    if (quizReviewMode) return;
    game.move(moves[nextIdx]);
    currentMoveIdx = nextIdx;
    board.position(game.fen(), false);
    librarySyncLastMove(game);
    renderMoveList();
    updateProgress();
    if (currentMoveIdx >= moves.length - 1) {
      finishQuiz();
    } else {
      clearFeedback();
    }
  }, 600);
}

function applyExploreMove(source, target, promotion, opts) {
  if (!exploreGame) return false;
  opts = opts || {};
  const move = exploreGame.move({ from: source, to: target, promotion: promotion || 'q' });
  if (!move) return false;
  if (opts.updateBoard !== false) board.position(exploreGame.fen());
  librarySyncLastMove(exploreGame);
  fetchExploreData();
  return true;
}

function quizMoveMatches(position, played, expectedSan) {
  if (!position || !played || !expectedSan) return false;
  try {
    const expected = new Chess(position.fen()).move(expectedSan);
    return !!expected && uciFromMove(expected) === uciFromMove(played);
  } catch (e) { return false; }
}

function handleQuizDrop(source, target, promotion) {
  if (!quizMode || !currentOpening) return 'snapback';
  promotion = promotion || 'q';
  const moves = activeMoves();
  const explanations = activeExplanations();
  if (quizReviewMode) {
    const expectedIdx = quizReviewQueue[quizReviewCursor];
    const expectedSAN = moves[expectedIdx];
    const tempGame = new Chess(game.fen());
    const move = tempGame.move({ from: source, to: target, promotion });
    if (!move) return 'snapback';
    if (quizMoveMatches(game, move, expectedSAN)) {
      game.move({ from: source, to: target, promotion });
      currentMoveIdx = expectedIdx;
      board.position(game.fen(), false);
      librarySyncLastMove(game);
      renderMoveList();
      renderExplanation(expectedIdx);
      updateProgress();
      quizReviewCursor++;
      showFeedback('correct', '✓ Replayed ' + moveLabelForIndex(expectedIdx));
      setTimeout(loadQuizReviewPosition, 650);
    } else {
      quizAttempts++;
      showFeedback(quizAttempts >= 2 ? 'hint' : 'incorrect',
        quizAttempts >= 2 ? '💡 The correct move is ' + expectedSAN : '✗ Not quite — try again!');
      return 'snapback';
    }
    return;
  }
  const nextIdx = currentMoveIdx + 1;
  if (nextIdx >= moves.length) return 'snapback';
  if (!isUserTurn(nextIdx)) return 'snapback'; // opponent's turn — auto-playing

  const expectedSAN = moves[nextIdx];

  // Try the move on a temp game
  const tempGame = new Chess(game.fen());
  const move = tempGame.move({ from: source, to: target, promotion });
  if (!move) return 'snapback';

  if (quizMoveMatches(game, move, expectedSAN)) {
    game.move({ from: source, to: target, promotion });
    currentMoveIdx = nextIdx;
    quizAttempts = 0;
    const exp = explanations[nextIdx];
    showFeedback('correct', '✓ ' + (exp ? exp.text : moveLabelForIndex(nextIdx)));
    const generation = quizTimerGeneration;
    setTimeout(() => {
      if (generation !== quizTimerGeneration) return;
      board.position(game.fen());
      librarySyncLastMove(game);
      renderMoveList();
      updateProgress();
      autoPlayOpponent();
    }, 300);
  } else {
    quizAttempts++;
    if (quizAttempts === 1) {
      quizSessionMisses++;
      recordQuizMiss(nextIdx);
    }
    if (quizAttempts >= 2) {
      showFeedback('hint', '💡 The correct move is ' + expectedSAN);
    } else {
      showFeedback('incorrect', '✗ Not quite — try again!');
    }
    return 'snapback';
  }
}

function handleDrop(source, target) {
  // Explore mode: free play, any legal move for either colour
  if (exploreMode) {
    if (requestPromotionChoice(exploreGame, source, target, promotion => {
      applyExploreMove(source, target, promotion, { updateBoard: true });
    }, true)) {
      return 'snapback';
    }
    if (!applyExploreMove(source, target, 'q', { updateBoard: false })) return 'snapback';
    return;
  }
  if (!quizMode || !currentOpening) return 'snapback';
  if (requestPromotionChoice(game, source, target, promotion => {
    handleQuizDrop(source, target, promotion);
  }, true)) {
    return 'snapback';
  }
  return handleQuizDrop(source, target, 'q');
}

function handleSnapEnd() {
  if (exploreMode) {
    board.position(exploreGame.fen());
    librarySyncLastMove(exploreGame);
    return;
  }
  if (!quizMode) return;
  board.position(game.fen());
  librarySyncLastMove(game);
}

// ─────────────────────────────────────────────
// LOAD AN OPENING
// ─────────────────────────────────────────────
function loadOpening(id, lineId) {
  currentOpening = OPENINGS.find(o => o.id === id);
  if (!currentOpening) return;
  // Opening links are an explicit request for Library, even though Coach is
  // the app's default home. This also keeps shared opening URLs backwards
  // compatible after the default view change.
  if (appView !== 'library') switchView('library');
  setActiveLine(lineId || 'main');

  // Exit explore mode when user picks an opening
  if (exploreMode) {
    exploreMode = false;
    markLibraryMode('study');
    showEl(qsa('#btn-start, #btn-prev, #btn-next, #btn-end'));
    hideEl(qsa('#btn-explore-undo, #btn-explore-reset'));
    hideEl(byId('explore-content'));
  }

  currentMoveIdx = -1;
  resetQuizTracking();
  game.reset();
  boardFlipped = false;

  // Show board element first so the board measures its real size
  hideEl(byId('board-placeholder'));
  showEl(byId('myBoard'));
  createBoard('start', quizMode, 'white');

  // Enable controls
  ['btn-prev', 'btn-start', 'btn-flip'].forEach(id => { byId(id).disabled = true; });
  ['btn-next', 'btn-end'].forEach(id => { byId(id).disabled = false; });
  byId('btn-flip').disabled = false;

  // Update library
  qsa('.opening-btn').forEach(el => { el.classList.remove('active'); });
  qsa(`.opening-btn[data-id="${currentOpening.id}"]`).forEach(btn => btn.classList.add('active'));

  // Update info panel
  hideEl(byId('empty-state'));
  showEl(byId('opening-content'));
  qsa('.app').forEach(el => { el.classList.add('has-opening'); });
  renderOpeningDetails();
  if (typeof renderRepertoireUI === 'function') renderRepertoireUI();

  renderLineSelector();
  renderKeyIdeas();
  renderMoveList();
  renderExplanation(-1);
  updateProgress();
  updateBoardDraggable();
  clearFeedback();
  updateSRPanel();
  updateURL();
  // A quiz carries over to the new opening: orient the board for the side
  // that owns the line and start the opponent's moves.
  if (quizMode) setMode('quiz');
}

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────
function goToMove(idx) {
  if (!currentOpening || !board) return;
  const moves = activeMoves();
  idx = Math.max(-1, Math.min(idx, moves.length - 1));
  game.reset();
  for (let i = 0; i <= idx; i++) {
    game.move(moves[i]);
  }
  currentMoveIdx = idx;
  board.position(idx === -1 ? 'start' : game.fen(), false);
  librarySyncLastMove(idx === -1 ? null : game);
  renderMoveList();
  renderExplanation(idx);
  updateProgress();
  updateControls();
  quizAttempts = 0;
  if (!quizMode) clearFeedback();
  updateURL();
}

function updateControls() {
  const moves = activeMoves();
  const atStart = currentMoveIdx <= -1;
  const atEnd = currentOpening && currentMoveIdx >= moves.length - 1;
  byId('btn-prev').disabled = atStart;
  byId('btn-start').disabled = atStart;
  byId('btn-next').disabled = atEnd || !currentOpening;
  byId('btn-end').disabled = atEnd || !currentOpening;
}

// ─────────────────────────────────────────────
// RENDER FUNCTIONS
// ─────────────────────────────────────────────
function renderMoveList() {
  if (!currentOpening) return;
  const moves = activeMoves();
  // A quiz asks for recall first: moves not reached yet stay hidden, keeping
  // their slots so the length of the line is still visible.
  const chip = (idx, cls) => {
    const hidden = quizMode && idx > currentMoveIdx;
    return hidden
      ? `<button class="move-chip quiz-hidden" data-idx="${idx}" aria-label="Move hidden until you play it" disabled>…</button>`
      : `<button class="move-chip ${cls}" data-idx="${idx}">${escapeHtml(moves[idx])}</button>`;
  };
  let html = '';
  for (let i = 0; i < moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    html += `<div class="move-pair">`;
    html += `<span class="move-num">${moveNum}.</span>`;
    // White move
    const wClass = i === currentMoveIdx ? 'current' : (i < currentMoveIdx ? 'played' : '');
    html += chip(i, wClass);
    // Black move (if exists)
    if (i + 1 < moves.length) {
      const bClass = (i + 1) === currentMoveIdx ? 'current' : (i + 1 < currentMoveIdx ? 'played' : '');
      html += chip(i + 1, bClass);
    }
    html += `</div>`;
  }
  byId('move-list').innerHTML = html;

  // Click handlers for move chips
  on(qsa('.move-chip'), 'click', function () {
    if (quizMode) return; // no clicking in quiz mode
    const idx = parseInt(this.dataset.idx);
    goToMove(idx);
  });
}

function renderExplanation(idx) {
  const box = byId('explanation-box');
  if (idx < 0 || !currentOpening) {
    if (quizMode) {
      box.innerHTML = `<span class="move-label">Quiz Mode Active</span><p>Find the correct move on the board. Drag the right piece to the right square.</p>`;
    } else {
      box.innerHTML = `<p>Click a move or use <strong>Next →</strong> to step through the opening.</p>`;
    }
    return;
  }
  const exp = activeExplanations()[idx] || { label: moveLabelForIndex(idx), text: 'Continue the selected line from this position.' };
  box.innerHTML = `<span class="move-label">${escapeHtml(exp.label)}</span><p>${escapeHtml(exp.text)}</p>`;
}

function renderKeyIdeas() {
  if (!currentOpening) return;
  const html = activeKeyIdeas().map(idea => `<div class="key-idea">${escapeHtml(idea)}</div>`).join('');
  byId('key-ideas').innerHTML = html;
}

function updateProgress() {
  if (board) updateLibraryBoardAccessibility();
  if (typeof renderOpeningTransferEntry === 'function') renderOpeningTransferEntry();
  if (!currentOpening) { byId('progress-fill').style.width = '0%'; return; }
  const moves = activeMoves();
  const pct = moves.length ? ((currentMoveIdx + 1) / moves.length) * 100 : 0;
  byId('progress-fill').style.width = pct + '%';
}

// ─────────────────────────────────────────────
// QUIZ MODE
// ─────────────────────────────────────────────
function updateBoardDraggable() {
  if (!board) return;
  createBoard(game.fen(), quizMode, boardFlipped ? 'black' : 'white');
}

// Mark the Study / Quiz / Explore button for mode as pressed.
function markLibraryMode(mode) {
  qsa('#btn-study, #btn-quiz, #btn-explore').forEach(btn => {
    const active = btn.id === 'btn-' + mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setMode(mode) {
  quizMode = (mode === 'quiz');
  exploreMode = (mode === 'explore');

  markLibraryMode(mode);

  if (exploreMode) {
    // Hide study nav, show explore nav
    hideEl(qsa('#btn-start, #btn-prev, #btn-next, #btn-end'));
    showEl(qsa('#btn-explore-undo, #btn-explore-reset'));
    byId('btn-flip').disabled = false;

    // Swap info panel to explore view
    hideEl(qsa('#empty-state, #opening-content'));
    const exploreContent = byId('explore-content');
    showEl(exploreContent);
    exploreContent.style.display = 'flex';

    // Build explore game from end of current opening (or start position)
    exploreGame = new Chess();
    if (currentOpening) {
      activeMoves().forEach(m => exploreGame.move(m));
      byId('explore-title').textContent = currentLineId === 'main' ? currentOpening.name : `${currentOpening.name}: ${currentLine.name}`;
      byId('explore-tagline').textContent = 'Exploring from end of line · move freely';
    } else {
      byId('explore-title').textContent = 'Free Exploration';
      byId('explore-tagline').textContent = 'Move freely from the starting position';
    }
    exploreStartFen = exploreGame.fen();

    // Show board in free-play mode
    hideEl(byId('board-placeholder'));
    showEl(byId('myBoard'));
    createBoard(exploreStartFen, true, boardFlipped ? 'black' : 'white');
    clearFeedback();
    showExploreTokenState();
    fetchExploreData();

  } else if (quizMode) {
    // Back to study nav
    showEl(qsa('#btn-start, #btn-prev, #btn-next, #btn-end'));
    hideEl(qsa('#btn-explore-undo, #btn-explore-reset'));
    hideEl(byId('explore-content'));
    if (currentOpening) {
      hideEl(byId('empty-state'));
      showEl(byId('opening-content'));
    }
    qsa('#btn-next, #btn-prev, #btn-start, #btn-end').forEach(el => { el.disabled = true; });
    if (currentOpening) {
      game.reset();
      currentMoveIdx = -1;
      resetQuizTracking();
      // Orient the board so the user plays from the bottom
      boardFlipped = (getUserColor() === 'black');
      createBoard('start', true, boardFlipped ? 'black' : 'white');
      renderMoveList();
      renderExplanation(-1);
      updateProgress();
      clearFeedback();
      const colorLabel = getUserColor() === 'white' ? 'White ♙' : 'Black ♟';
      showFeedback('hint', `💡 You're playing ${colorLabel}. The opponent's moves play automatically.`);
      // For black openings, auto-play White's first move(s)
      autoPlayOpponent();
    }

  } else {
    // Study mode
    showEl(qsa('#btn-start, #btn-prev, #btn-next, #btn-end'));
    hideEl(qsa('#btn-explore-undo, #btn-explore-reset'));
    hideEl(byId('explore-content'));
    if (currentOpening) {
      hideEl(byId('empty-state'));
      showEl(byId('opening-content'));
      updateControls();
      createBoard(game.fen(), false, boardFlipped ? 'black' : 'white');
      // Reveal the whole line again after a quiz.
      renderMoveList();
    }
    renderExplanation(currentMoveIdx);
    clearFeedback();
  }
  updateProgress();
  updateSRPanel();
  updateURL();
  scheduleLibraryBoardFit();
}

// ─────────────────────────────────────────────
// FEEDBACK
// ─────────────────────────────────────────────
function showFeedback(type, message) {
  const bar = byId('feedback-bar');
  bar.classList.remove('correct', 'incorrect', 'hint');
  bar.classList.add(type, 'show');
  bar.textContent = message;
  if (feedbackTimeout) clearTimeout(feedbackTimeout);
  if (type === 'correct') {
    feedbackTimeout = setTimeout(clearFeedback, 5000);
  }
}

function clearFeedback() {
  byId('feedback-bar').classList.remove('show', 'correct', 'incorrect', 'hint');
}
