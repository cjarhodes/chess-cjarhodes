// Library view: the openings list, Study / Quiz / Explore on the Library
// board (#myBoard), line selection, quiz auto-play and mistake review,
// move list, explanations, key ideas and feedback. The Library SR maths
// is in src/core/library-sr.js and Explore data in src/library/explore.js;
// event binding is in src/views/boot.js.
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
  $('.opening-btn').removeClass('active');
  $('.app').removeClass('has-opening');
  $('#opening-content').hide();
  $('#move-list, #key-ideas').empty();
  if (!exploreMode) {
    $('#myBoard').hide();
    $('#board-placeholder').show();
    $('#empty-state').show();
  }
  ['btn-prev', 'btn-start', 'btn-next', 'btn-end', 'btn-flip'].forEach(id => $('#' + id).prop('disabled', true));
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
  $('#myBoard').attr('aria-label', describeChessPosition(activeGame));
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
  $('#opening-title').text(currentOpening.name);
  if (currentLine.id === 'main') {
    $('#opening-tagline').text(currentOpening.tagline || '');
    $('#opening-desc').text(currentOpening.description || '');
  } else {
    const note = currentLine.note || currentLine.tagline || '';
    $('#opening-tagline').text(note ? `${currentLine.name} · ${note}` : currentLine.name);
    $('#opening-desc').text(currentLine.description || currentOpening.description || '');
  }
}

function renderLineSelector() {
  const lines = getOpeningLines(currentOpening);
  const $wrap = $('#line-selector-wrap');
  const $sel = $('#line-selector').empty();
  if (!currentOpening || lines.length <= 1) {
    $wrap.hide();
    return;
  }
  lines.forEach(line => {
    $('<button class="line-btn"></button>')
      .toggleClass('active', line.id === currentLineId)
      .attr('data-line', line.id)
      .text(line.name)
      .appendTo($sel);
  });
  $wrap.show();
}

function resetQuizTracking() {
  quizTimerGeneration++;
  quizAttempts = 0;
  quizSessionMisses = 0;
  quizMissedMoves = [];
  quizReviewMode = false;
  quizReviewQueue = [];
  quizReviewCursor = 0;
  $('#btn-review-misses').hide();
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
  $('#btn-review-misses').hide();
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
  if (quizMissedMoves.length > 0) $('#btn-review-misses').show();
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
    $('#btn-study, #btn-quiz, #btn-explore').removeClass('active').attr('aria-pressed', 'false');
    $('#btn-study').addClass('active').attr('aria-pressed', 'true');
    $('#btn-start, #btn-prev, #btn-next, #btn-end').show();
    $('#btn-explore-undo, #btn-explore-reset').hide();
    $('#explore-content').hide();
  }

  currentMoveIdx = -1;
  resetQuizTracking();
  game.reset();
  boardFlipped = false;

  // Show board element first so the board measures its real size
  $('#board-placeholder').hide();
  $('#myBoard').show();
  createBoard('start', quizMode, 'white');

  // Enable controls
  ['btn-prev', 'btn-start', 'btn-flip'].forEach(id => $('#' + id).prop('disabled', true));
  ['btn-next', 'btn-end'].forEach(id => $('#' + id).prop('disabled', false));
  $('#btn-flip').prop('disabled', false);

  // Update library
  $('.opening-btn').removeClass('active');
  $(`.opening-btn[data-id="${currentOpening.id}"]`).addClass('active');

  // Update info panel
  $('#empty-state').hide();
  $('#opening-content').show();
  $('.app').addClass('has-opening');
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
  $('#btn-prev').prop('disabled', atStart);
  $('#btn-start').prop('disabled', atStart);
  $('#btn-next').prop('disabled', atEnd || !currentOpening);
  $('#btn-end').prop('disabled', atEnd || !currentOpening);
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
  $('#move-list').html(html);

  // Click handlers for move chips
  $('.move-chip').on('click', function () {
    if (quizMode) return; // no clicking in quiz mode
    const idx = parseInt($(this).data('idx'));
    goToMove(idx);
  });
}

function renderExplanation(idx) {
  const box = $('#explanation-box');
  if (idx < 0 || !currentOpening) {
    if (quizMode) {
      box.html(`<span class="move-label">Quiz Mode Active</span><p>Find the correct move on the board. Drag the right piece to the right square.</p>`);
    } else {
      box.html(`<p>Click a move or use <strong>Next →</strong> to step through the opening.</p>`);
    }
    return;
  }
  const exp = activeExplanations()[idx] || { label: moveLabelForIndex(idx), text: 'Continue the selected line from this position.' };
  box.html(`<span class="move-label">${escapeHtml(exp.label)}</span><p>${escapeHtml(exp.text)}</p>`);
}

function renderKeyIdeas() {
  if (!currentOpening) return;
  const html = activeKeyIdeas().map(idea => `<div class="key-idea">${escapeHtml(idea)}</div>`).join('');
  $('#key-ideas').html(html);
}

function updateProgress() {
  if (board) updateLibraryBoardAccessibility();
  if (typeof renderOpeningTransferEntry === 'function') renderOpeningTransferEntry();
  if (!currentOpening) { $('#progress-fill').css('width', '0%'); return; }
  const moves = activeMoves();
  const pct = moves.length ? ((currentMoveIdx + 1) / moves.length) * 100 : 0;
  $('#progress-fill').css('width', pct + '%');
}

// ─────────────────────────────────────────────
// QUIZ MODE
// ─────────────────────────────────────────────
function updateBoardDraggable() {
  if (!board) return;
  createBoard(game.fen(), quizMode, boardFlipped ? 'black' : 'white');
}

function setMode(mode) {
  quizMode = (mode === 'quiz');
  exploreMode = (mode === 'explore');

  $('#btn-study, #btn-quiz, #btn-explore').removeClass('active').attr('aria-pressed', 'false');
  $(`#btn-${mode}`).addClass('active').attr('aria-pressed', 'true');

  if (exploreMode) {
    // Hide study nav, show explore nav
    $('#btn-start, #btn-prev, #btn-next, #btn-end').hide();
    $('#btn-explore-undo, #btn-explore-reset').show();
    $('#btn-flip').prop('disabled', false);

    // Swap info panel to explore view
    $('#empty-state, #opening-content').hide();
    $('#explore-content').show().css('display', 'flex');

    // Build explore game from end of current opening (or start position)
    exploreGame = new Chess();
    if (currentOpening) {
      activeMoves().forEach(m => exploreGame.move(m));
      $('#explore-title').text(currentLineId === 'main' ? currentOpening.name : `${currentOpening.name}: ${currentLine.name}`);
      $('#explore-tagline').text('Exploring from end of line · move freely');
    } else {
      $('#explore-title').text('Free Exploration');
      $('#explore-tagline').text('Move freely from the starting position');
    }
    exploreStartFen = exploreGame.fen();

    // Show board in free-play mode
    $('#board-placeholder').hide();
    $('#myBoard').show();
    createBoard(exploreStartFen, true, boardFlipped ? 'black' : 'white');
    clearFeedback();
    showExploreTokenState();
    fetchExploreData();

  } else if (quizMode) {
    // Back to study nav
    $('#btn-start, #btn-prev, #btn-next, #btn-end').show();
    $('#btn-explore-undo, #btn-explore-reset').hide();
    $('#explore-content').hide();
    if (currentOpening) {
      $('#empty-state').hide();
      $('#opening-content').show();
    }
    $('#btn-next, #btn-prev, #btn-start, #btn-end').prop('disabled', true);
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
    $('#btn-start, #btn-prev, #btn-next, #btn-end').show();
    $('#btn-explore-undo, #btn-explore-reset').hide();
    $('#explore-content').hide();
    if (currentOpening) {
      $('#empty-state').hide();
      $('#opening-content').show();
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
  const bar = $('#feedback-bar');
  bar.removeClass('correct incorrect hint').addClass(type + ' show').text(message);
  if (feedbackTimeout) clearTimeout(feedbackTimeout);
  if (type === 'correct') {
    feedbackTimeout = setTimeout(clearFeedback, 5000);
  }
}

function clearFeedback() {
  $('#feedback-bar').removeClass('show correct incorrect hint');
}
