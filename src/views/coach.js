// Coach view: the live game loop. State for the game, premoves, status
// and phase presentation, the user move and opponent reply pipeline, game
// over, New Game, the Coach board (#coachBoard), control enabled-state,
// the right-rail panel tabs and the summary overlay. Move review and
// history are in coach-review.js, practice drills in coach-practice.js;
// event binding is in src/views/boot.js.
// Classic script (see index.html): its top-level declarations are shared
// globals with src/, the other view scripts, growth.js and the feature
// modules, as they were inside app.js. Nothing here runs at load except
// plain initialisers, so the view scripts can call each other freely.

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let summaryReturnFocus = null;
let coachMode = false;             // true when coach view is active
let coachGame = null;
let coachStartFen = null;
let coachStats = null;
let coachReviewLog = [];           // all reviews from current session (for summary turning point)
let coachLastReview = null;        // most recent review (for take back / show best)
let coachThinking = false;
let coachUserSide = 'white';       // 'white' | 'black'
let coachEngineElo = 1200;         // displayed opponent level
let coachOpeningTransfer = null;   // optional Library-to-play context, owned with the saved game
let coachOpeningId = null;         // deepest identified opening in the current game
let coachBoard = null;             // the Coach board (src/ui/board.js)
let coachBoardFlipped = false;
let coachGameActive = false;       // true once user hits New Game
let coachGameGeneration = 0;       // invalidates async work from replaced/rewound games
let coachLocalGameId = null;       // stable id for idempotent local lifetime rollups
let coachEndedAt = null;           // timestamp of game end, null while playing
let coachReviewCursor = null;      // null = live; integer = ply index displayed on the board
let coachReviewAnalysis = null;    // transient recommended line shown on the main board
let coachReviewAnalysisToken = 0;  // invalidates stale analysis-board updates
let coachLastEndMsg = null;        // headline from last game-over, used to reopen the review
let candidateRequestId = 0;        // invalidates stale async candidate searches
let threatRequestId = 0;           // invalidates stale async threat scans
let coachPremove = null;           // queued premove while opponent is thinking
let coachPracticeSession = null;   // active mistake-position drill, separate from normal games
let coachPracticeRun = null;       // ordered multi-drill session and its aggregate result
let coachPracticeReturnState = null; // in-progress game restored after the drill
let renderedPracticeItems = new Map();
let summaryPracticeItems = [];

const CoachController = {
  phase: 'idle',
  setPhase(phase) {
    this.phase = phase;
    renderCoachPresentation();
    return this.phase;
  }
};

// ─────────────────────────────────────────────
// PREMOVE — queue your move while the engine is thinking
// ─────────────────────────────────────────────
function setPremoveSquares(from, to) {
  if (!coachBoard) return;
  coachBoard.setMarks('coach-premove-from', from ? [from] : []);
  coachBoard.setMarks('coach-premove-to', to ? [to] : []);
}
function setPremove(from, to, promotion) {
  coachPremove = { from, to, promotion: promotion || 'q' };
  setPremoveSquares(from, to);
  const suffix = coachPremove.promotion && coachPremove.promotion !== 'q'
    ? '=' + coachPremove.promotion.toUpperCase()
    : '';
  $('#coach-premove-hint').text(`Premove queued: ${from}–${to}${suffix} (click board to cancel)`).show();
}
function clearPremove() {
  coachPremove = null;
  setPremoveSquares(null, null);
  $('#coach-premove-hint').hide().text('');
}
// Called after the opponent's move applies. If the queued premove is still
// legal, dispatch it through the normal user-move pipeline.
function tryApplyPremove() {
  if (!coachPremove || !coachGame || !coachGameActive) return;
  if (!coachIsUserTurn()) { clearPremove(); return; }
  const pm = coachPremove;
  const tmp = new Chess(coachGame.fen());
  const mv = tmp.move({ from: pm.from, to: pm.to, promotion: pm.promotion });
  clearPremove();
  if (!mv) return; // illegal in the new position — silently drop
  // Update the board immediately, then run classification asynchronously.
  if (coachBoard) { coachBoard.position(tmp.fen()); setBoardLastMove('coachBoard', mv); }
  coachHandleUserMove(pm.from, pm.to, pm.promotion, { updateBoard: false });
}

function updateCoachSummary() {
  if (!coachStats) return;
  const total = coachStats.moves;
  $('#coach-moves-count').text(total);
  $('#coach-tally-best').text(coachStats.best);
  $('#coach-tally-excellent').text(coachStats.excellent);
  $('#coach-tally-good').text(coachStats.good);
  $('#coach-tally-inacc').text(coachStats.inaccuracy);
  $('#coach-tally-mistake').text(coachStats.mistake);
  $('#coach-tally-blunder').text(coachStats.blunder);
  if (total === 0) {
    $('#coach-accuracy').text('—');
    $('#coach-accuracy-recent').text('—');
    $('#coach-accuracy-recent-label').text('Recent accuracy');
    return;
  }
  const pct = accuracyFromTallies(coachStats, total);
  $('#coach-accuracy').text((pct === null ? '—' : pct + '%'));
  const roll = rollingAccuracy(10);
  if (roll && roll.pct !== null) {
    $('#coach-accuracy-recent').text(roll.pct + '%');
    $('#coach-accuracy-recent-label').text(`Last ${roll.n} move${roll.n === 1 ? '' : 's'}`);
  } else {
    $('#coach-accuracy-recent').text('—');
    $('#coach-accuracy-recent-label').text('Recent accuracy');
  }
}

// ─────────────────────────────────────────────
// STATUS, PRESENTATION AND THE GAME LOOP
// ─────────────────────────────────────────────
function setCoachStatus(msg) {
  const guidance = {
    'Your move.': 'Play on the board or enter a move below.',
    'Opponent thinking…': 'Choosing a reply. You can queue a premove.',
    'Analyzing your move…': 'Checking your move before the opponent replies.'
  };
  $('#coach-status').text(guidance[msg] || msg);
  renderCoachPresentation();
}

// Presentation follows the existing game/practice state; it never changes it.
function renderCoachPresentation() {
  const view = document.getElementById('coach-view');
  if (!view) return;
  const practicing = !!coachPracticeSession;
  const reviewing = coachIsReviewing();
  const day = dailySprintToday();
  const state = practicing ? (coachPracticeSession.completed ? 'practice-complete' : coachPracticeSession.grading || coachPracticeSession.pendingMove ? 'practice-checking' : 'practice')
    : reviewing ? 'review'
    : coachGameActive ? (coachThinking || CoachController.phase === 'analyzing' ? 'analyzing' : coachIsUserTurn() ? 'user-turn' : 'opponent-turn')
    : coachLastEndMsg ? 'ended' : day && day.completedAt ? 'complete' : 'ready';
  const labels = {
    ready: 'Ready to train', 'user-turn': 'Your turn · ' + (coachUserColor() === 'white' ? 'White' : 'Black'),
    analyzing: 'Reviewing your move', 'opponent-turn': 'Opponent’s turn',
    review: 'Review · viewing another position', practice: 'Practice · find the move',
    'practice-checking': 'Practice · checking your move', 'practice-complete': 'Practice saved · next step', ended: 'Game complete', complete: 'Today’s training complete'
  };
  if (view.dataset.uiState === 'ready' && ['user-turn', 'analyzing', 'opponent-turn'].includes(state)) {
    document.getElementById('coach-game-options').open = false;
  }
  view.dataset.uiState = state;
  const canEnterMove = state === 'user-turn' || state === 'practice';
  $('#coach-keyboard-move-input, #coach-keyboard-move-form button').prop('disabled', !canEnterMove);
  $('#coachBoard-wrap').attr('aria-busy', ['analyzing', 'opponent-turn', 'practice-checking'].includes(state) ? 'true' : 'false');
  $('#coachBoard').attr('aria-describedby', practicing ? 'coach-status coach-practice-prompt' : 'coach-status');
  $('#coach-review-empty').toggle(!coachLastReview && !practicing);

  const selecting = !practicing && document.getElementById('panel-practice').classList.contains('active');
  $('#coach-phase-label').text(selecting && state === 'ready' ? 'Practice · choose a lesson' : labels[state]);
  $('#practice-selection-guidance').toggle(selecting && state === 'ready');
  $('#coach-daily-plan-label').text(practicing ? 'Practice session' : 'Adaptive session · 5–10 min');
  $('.daily-sprint-progress').attr('aria-label', practicing ? 'Practice progress' : 'Adaptive session progress');
  $('#coach-game-options-label').text((coachUserSide === 'random' ? 'Random' : coachUserColor() === 'white' ? 'White' : 'Black') + ' · ' + coachEngineElo);
  const managed = '#btn-practice-session-start, #btn-opening-transfer-review, #btn-progress-next, #btn-coach-next-action, #btn-coach-showwhy, #btn-coach-backtogame, #btn-coach-live, #btn-coach-practice-next, #btn-coach-practice-exit, #coach-keyboard-move-form button';
  $(managed).removeClass('primary').removeAttr('data-primary-action');
  const progressActive = document.getElementById('panel-progress').classList.contains('active');
  $('#btn-progress-next').prop('disabled', ['analyzing', 'opponent-turn', 'practice-checking'].includes(state) || (typeof importedGameAnalysisActive !== 'undefined' && importedGameAnalysisActive));
  const practiceSelection = !practicing && document.getElementById('panel-practice').classList.contains('active');
  view.classList.toggle('practice-browsing', practiceSelection);
  renderPracticeRecommendation();
  let action = null;
  if (practiceSelection && !coachThinking) action = '#btn-practice-session-start';
  else if (progressActive && !$('#btn-progress-next').prop('disabled') && !['analyzing', 'opponent-turn', 'practice-checking', 'practice', 'practice-complete', 'review'].includes(state)) action = '#btn-progress-next';
  else if (state === 'ended' && coachOpeningTransfer && coachStats.moves > 0 && !document.getElementById('panel-game').hidden) action = '#btn-opening-transfer-review';
  else if (state === 'ready' || state === 'complete' || state === 'ended') action = '#btn-coach-next-action';
  else if (state === 'review') action = coachReviewAnalysis ? '#btn-coach-backtogame' : '#btn-coach-live';
  else if (state === 'practice-complete') action = $('#btn-coach-practice-next').is(':visible') && !$('#btn-coach-practice-next').prop('disabled') ? '#btn-coach-practice-next' : '#btn-coach-practice-exit';
  else if (state === 'user-turn' && !document.getElementById('panel-game').hidden && coachOpeningTransfer && coachStats.moves >= 4) action = '#btn-opening-transfer-review';
  else if (state === 'user-turn' && $('#coach-review').is(':visible') && !$('#btn-coach-showwhy').prop('disabled')) action = '#btn-coach-showwhy';
  else if ((state === 'user-turn' || state === 'practice') && document.getElementById('coach-keyboard-move')?.open) action = '#coach-keyboard-move-form button';
  if (action) $(action).addClass('primary').attr('data-primary-action', 'true');
  $('#coachBoard-wrap').attr('data-primary-target', !action && canEnterMove ? 'true' : 'false');
  $('#btn-coach-practice-exit').text(practicing && coachPracticeReturnState ? 'Return to saved game' : 'Exit practice');
  $('#btn-coach-practice-exit').toggle(state !== 'practice-complete' || !!(coachPracticeRun && coachPracticeRun.index + 1 < coachPracticeRun.items.length));
  $('#btn-coach-practice-hint, #btn-coach-practice-answer').toggle(state !== 'practice-complete');
  renderPracticeBoardCue();
  if (typeof renderOpeningTransfer === 'function') renderOpeningTransfer();
  if (typeof renderLearningTransfer === 'function') renderLearningTransfer();
  scheduleCoachBoardFit();
}


function showCoachRetryStatus(msg) {
  const $status = $('#coach-status').empty();
  $status.append(document.createTextNode(msg + ' '));
  $('<button type="button" class="movelist-copy" id="btn-coach-retry-opponent">Retry</button>')
    .appendTo($status);
}

function invalidateCoachAsyncWork(reason) {
  coachGameGeneration++;
  candidateRequestId++;
  threatRequestId++;
  clearCoachReviewAnalysis({ restore: false });
  engineClient.cancel(reason || 'Coach position changed.');
  clearQueuedRemoteCoachGameUpdate();
  return coachGameGeneration;
}

function resetCoachState(fen, opts = {}) {
  coachContinuityCopy = false;
  coachTakebackUsed = false;
  coachOpeningTransfer = null;
  coachPendingReview = null;
  invalidateCoachAsyncWork('A new game replaced the previous analysis.');
  coachPracticeSession = null;
  if (!opts.preservePracticeRun) {
    coachPracticeRun = null;
    if (typeof setPracticeFocus === 'function') setPracticeFocus(false);
  }
  summaryPracticeItems = [];
  CoachController.setPhase('idle');
  coachGame = fen ? new Chess(fen) : new Chess();
  coachLocalGameId = createCoachGameId();
  coachStartFen = coachGame.fen();
  coachStats = { moves: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  coachReviewLog = [];
  coachLastReview = null;
  coachThinking = false;
  coachEndedAt = null;
  coachReviewCursor = null;
  coachReviewAnalysis = null;
  coachLastEndMsg = null;
  coachRemoteGameId = null;
  coachRemoteGamePromise = null;
  coachRemoteGamePromiseGeneration = null;
  coachLifetimeRolledForThisGame = false;
  if (coachSummaryTimer) { clearTimeout(coachSummaryTimer); coachSummaryTimer = null; }
  clearPremove();
  $('#coach-status').removeClass('status-ended');
  $('#summary-overlay').hide().attr('aria-hidden', 'true');
  $('#coach-practice-banner').hide();
  $('#coach-review').hide();
  $('#coach-review-analysis').hide().empty();
  $('#threats-section').hide();
  $('#candidates-section').hide();
  $('#opening-section').hide();
  $('#movelist-section').hide();
  $('#liveeval-section').hide();
  updateCoachSummary();
  updateCapturedDisplay(coachGame.fen());
  updateMoveList();
  updateOpeningLabel();
}

async function coachOpponentRespond() {
  if (!coachMode || !coachGameActive) return;
  if (coachGame.game_over()) { coachHandleGameOver(); return; }
  if (coachIsUserTurn()) return;
  const generation = coachGameGeneration;
  const gameRef = coachGame;
  CoachController.setPhase('opponentThinking');
  setCoachStatus('Opponent thinking…');
  const fen = coachGame.fen();
  try {
    // Evaluate several plausible candidates and select one from a calibrated
    // loss distribution. Lower settings favor modest slips while preserving
    // detected mates, without unsupported Elo commands.
    const opts = coachStrengthOpts(coachEngineElo);
    // A chosen opponent personality plays its Library book lines first
    // (opponents.js); the calibrated engine takes over once off book.
    const bookMove = typeof OpponentPersonas !== 'undefined' ? OpponentPersonas.coachBookMove() : null;
    const result = bookMove ? null : await engineClient.evaluate(fen, opts.depth, {
      skill: opts.skill,
      multipv: opts.multipv
    });
    const bestmove = bookMove || chooseCalibratedOpponentMove(result, opts);
    if (generation !== coachGameGeneration || coachGame !== gameRef || !coachMode ||
        !coachGameActive || coachIsUserTurn() || coachGame.fen() !== fen) return;
    if (!bestmove) {
      // The game is not over, so an empty answer means the engine failed
      // (for example its 30 s safety timeout). It is still the opponent's
      // turn: say so and offer a retry rather than claiming it is the user's.
      updateCoachControlsState();
      showCoachRetryStatus('The opponent did not answer — retry or take back.');
      return;
    }
    setTimeout(() => {
      try {
        if (generation !== coachGameGeneration || coachGame !== gameRef || !coachMode || !coachGameActive) return;
        const mv = coachGame.move({
          from: bestmove.slice(0, 2),
          to: bestmove.slice(2, 4),
          promotion: bestmove[4] || undefined
        });
        if (!mv) throw new Error('Opponent move was not legal.');
        if (window.CoachClock) window.CoachClock.tick();
        candidateRequestId++;
        if (!coachIsReviewing()) {
          if (!coachBoard) throw new Error('Coach board is not ready.');
          coachBoard.position(coachGame.fen());
          coachSyncLastMove();
          updateCapturedDisplay(coachGame.fen());
        }
        playSound(soundForMove(mv, coachGame));
        updateMoveList();
        updateOpeningLabel();
        saveCoachState();
        if (coachGame.game_over()) { coachHandleGameOver(); return; }
        if (!coachIsReviewing()) {
          CoachController.setPhase('userTurn');
          setCoachStatus('Your move.');
          showThreats();
        }
        updateCoachControlsState();
        // Apply any queued premove now that it's the user's turn again.
        tryApplyPremove();
      } catch (err) {
        clearPremove();
        coachThinking = false;
        updateCoachControlsState();
        showCoachRetryStatus('Opponent move failed — retry or take back.');
      }
    }, 300);
  } catch (err) {
    if (generation !== coachGameGeneration || isAbortError(err)) return;
    setCoachStatus('Engine error: ' + err.message);
  }
}

async function coachHandleUserMove(source, target, promotion, opts) {
  if (!coachMode || !coachGameActive) return 'snapback';
  if (coachThinking) return 'snapback';
  if (!coachIsUserTurn()) return 'snapback';
  opts = opts || {};
  promotion = promotion || 'q';
  const fenBefore = coachGame.fen();
  const generation = coachGameGeneration;
  const gameRef = coachGame;
  const tempGame = new Chess(fenBefore);
  const move = tempGame.move({ from: source, to: target, promotion });
  if (!move) return 'snapback';

  const userMv = coachGame.move({ from: source, to: target, promotion });
  candidateRequestId++;
  const fenAfter = coachGame.fen();
  const userUci = source + target + (move.promotion || '');
  coachPendingReview = { fenBefore, fenAfter, userUci, ply: coachGame.history().length };
  saveCoachState();
  if (opts.updateBoard !== false && coachBoard && !coachIsReviewing()) coachBoard.position(fenAfter);
  if (!coachIsReviewing()) setBoardLastMove('coachBoard', userMv);
  updateCapturedDisplay(fenAfter);
  playSound(soundForMove(userMv, coachGame));

  // Clear threats/candidates on new move
  $('#threats-section').hide();
  $('#candidates-section').hide();

  coachThinking = true;
  CoachController.setPhase('analyzing');
  // Stop the user's clock at the moment of the move (coach-clock.js), so a
  // move made in time is never charged the rest of a clock tick.
  if (window.CoachClock) window.CoachClock.tick();
  setCoachStatus('Analyzing your move…');
  updateCoachControlsState();
  try {
    const review = await classifyMove(fenBefore, userUci, fenAfter);
    if (generation !== coachGameGeneration || coachGame !== gameRef || !coachGameActive ||
        coachGame.fen() !== fenAfter) {
      return 'stale';
    }
    const ply = coachGame.history().length;
    const pairNum = Number(fenBefore.split(/\s+/)[5]) || Math.ceil(ply / 2);
    const opponentPrevious = coachGame.history({ verbose: true })[ply - 2];
    const logged = Object.assign({}, review, {
      fenBefore,
      fenAfter,
      userUci,
      previousCaptureSquare: opponentPrevious && opponentPrevious.captured ? opponentPrevious.to : null,
      ply,
      pairNum,
      gameGeneration: generation,
      localGameId: coachLocalGameId
    });
    coachPendingReview = null;
    coachLastReview = logged;
    coachReviewLog.push(logged);
    recordCoachInsight(logged);
    if (typeof recordLearningTransferLiveMove === 'function') recordLearningTransferLiveMove(logged);
    coachSync.saveMove(logged).catch(handleCoachDbError);
    // Don't count engine-timeout ("unknown") reviews in stats or accuracy.
    if (review.tier !== 'unknown') {
      coachStats.moves++;
      coachStats[review.tier] = (coachStats[review.tier] || 0) + 1;
      recordDailySprintMove(logged);
    }
    renderCoachReview(logged);
    updateCoachSummary();
    updateCoachControlsState();
    updateMoveList();
    updateOpeningLabel();
    saveCoachState();
    renderCoachDailyPlan();
  } catch (err) {
    if (generation !== coachGameGeneration || isAbortError(err)) return 'stale';
    setCoachStatus('Engine error: ' + err.message);
    coachThinking = false;
    CoachController.setPhase('userTurn');
    return;
  }
  coachThinking = false;
  updateCoachControlsState();

  if (generation !== coachGameGeneration || coachGame !== gameRef) return 'stale';
  if (coachGame.game_over()) { coachHandleGameOver(); return; }
  coachOpponentRespond();
}

// Track pending review-reveal so a new game cancels it.
let coachSummaryTimer = null;
function scheduleSummaryReveal(msg, delayMs) {
  if (coachSummaryTimer) { clearTimeout(coachSummaryTimer); coachSummaryTimer = null; }
  // Flag the status line so it pulses while the user takes in the final position.
  $('#coach-status').addClass('status-ended');
  coachSummaryTimer = setTimeout(() => {
    coachSummaryTimer = null;
    showPostGameSummary(msg);
  }, delayMs);
}

// Ends the live game for a reason the board does not show (resignation, or
// a flag from coach-clock.js): the same bookkeeping as a game over.
function coachFinishGame(msg, revealDelay) {
  if (!coachGameActive) return false;
  CoachController.setPhase('ended');
  candidateRequestId++;
  threatRequestId++;
  clearPremove();
  coachGameActive = false;
  coachEndedAt = Date.now();
  setCoachStatus(msg);
  updateCoachControlsState();
  coachLastEndMsg = msg;
  saveCoachState();
  // A per-move update still waiting on its debounce would otherwise rewrite
  // the saved game as unfinished after this result is saved.
  clearQueuedRemoteCoachGameUpdate();
  coachSync.saveGame(msg).catch(handleCoachDbError);
  rollGameIntoLifetime();
  if (typeof recordRatedCoachResult === 'function') recordRatedCoachResult(msg);
  scheduleSummaryReveal(msg, revealDelay);
  return true;
}

function coachHandleGameOver() {
  if (!coachGameActive) return;
  CoachController.setPhase('ended');
  coachGameActive = false;
  coachEndedAt = Date.now();
  let msg = 'Game over.';
  if (coachGame.in_checkmate()) {
    const loser = coachGame.turn() === 'w' ? 'White' : 'Black';
    const winner = loser === 'White' ? 'Black' : 'White';
    msg = `Checkmate — ${winner} wins.`;
  } else if (coachGame.in_stalemate()) msg = 'Stalemate.';
  else if (coachGame.in_draw()) msg = 'Draw.';
  setCoachStatus(msg);
  updateCoachControlsState();
  // Persist the now-ended state so a refresh keeps the review reachable.
  coachLastEndMsg = msg;
  saveCoachState();
  clearQueuedRemoteCoachGameUpdate();
  coachSync.saveGame(msg).catch(handleCoachDbError);
  // Roll this game's stats into lifetime totals (guarded against double-count).
  rollGameIntoLifetime();
  if (typeof recordRatedCoachResult === 'function') recordRatedCoachResult(msg);
  // Let the user take in the final position before the review overlay arrives.
  scheduleSummaryReveal(msg, 1200);
}

// ─────────────────────────────────────────────
// BOARD, PANELS AND NEW GAME
// ─────────────────────────────────────────────
function updateCoachBoardAccessibility() {
  $('#coachBoard').attr('aria-label', describeChessPosition(coachGame));
}

const COACH_PANEL_TAB_KEY = 'ui:coach-panel-tab';

// Right-rail tabs: Game (live review), Practice (queue and drills), Progress.
function showCoachPanel(name, opts) {
  opts = opts || {};
  const $tab = $('.panel-tab[data-panel="' + name + '"]');
  if (!$tab.length) return;
  $('.panel-tab').removeClass('active').attr({ 'aria-selected': 'false', tabindex: '-1' });
  $tab.addClass('active').attr({ 'aria-selected': 'true', tabindex: '0' });
  $('.panel-page').removeClass('active').attr('hidden', true);
  $('#panel-' + name).addClass('active').removeAttr('hidden');
  if (opts.focus) $tab.trigger('focus');
  try { sessionStorage.setItem(COACH_PANEL_TAB_KEY, name); } catch (e) { /* session only */ }
  renderCoachPresentation();
}

function initCoachPanelTabs() {
  let remembered = null;
  try { remembered = sessionStorage.getItem(COACH_PANEL_TAB_KEY); } catch (e) { /* default */ }
  if (remembered && $('.panel-tab[data-panel="' + remembered + '"]').length) showCoachPanel(remembered);
  $('.panel-tab').on('click', function() { showCoachPanel($(this).data('panel')); });
  $('.panel-tab').on('keydown', function(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const tabs = $('.panel-tab').toArray();
    const index = tabs.indexOf(this);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    showCoachPanel($(next).data('panel'), { focus: true });
  });
}

function updatePracticeTabBadge(dueCount) {
  const $badge = $('#tab-practice-badge');
  if (!$badge.length) return;
  $badge.text(String(dueCount));
  if (dueCount > 0) $badge.removeAttr('hidden'); else $badge.attr('hidden', true);
}

function placeDailySprintCard() {
  const card = document.getElementById('coach-daily-plan');
  const settings = document.querySelector('.coach-settings');
  if (!card || !settings) return;
  // Coach's next action is the product's primary job. Keep it immediately
  // below the heading at every breakpoint; settings and account controls are
  // still available underneath it, while the right panel can focus on live
  // status, review, and progress.
  const hero = settings.querySelector('.coach-hero');
  if (hero && hero.nextElementSibling !== card) hero.insertAdjacentElement('afterend', card);
}

function createCoachBoard(position, orientation) {
  if (coachBoard) coachBoard.destroy();
  coachBoard = Chessboard('coachBoard', {
    position: position || 'start',
    draggable: true,
    orientation: orientation || 'white',
    onDragStart: function(source, piece) {
      if (!coachGameActive || !coachGame) return false;
      if (coachPracticeSession && coachPracticeSession.completed) return false;
      if (coachIsReviewing()) return false;
      // Only allow picking up pieces of the user's colour, ever.
      const userPrefix = coachUserColor() === 'white' ? 'w' : 'b';
      if (piece[0] !== userPrefix) return false;
      // Block during our own classification window — premoves wait for opponent's move.
      if (coachThinking && coachIsUserTurn()) return false;
      // Both regular moves (our turn) and premoves (their turn) are allowed.
    },
    moveTargets: function(square) {
      // Legal-move dots on your turn; a premove is checked when it is played.
      if (!coachGame || !coachIsUserTurn() || coachIsReviewing()) return [];
      return coachGame.moves({ square, verbose: true }).map(m => m.to);
    },
    onDrop: function(source, target) {
      if (!coachGameActive || !coachGame) return 'snapback';
      if (coachIsReviewing()) return 'snapback';
      if (source === target) return 'snapback';
      if (coachIsUserTurn()) {
        if (coachThinking) return 'snapback';
        if (requestPromotionChoice(coachGame, source, target, promotion => {
          if (coachPracticeSession) {
            coachHandlePracticeMove(source, target, promotion, { updateBoard: true });
          } else {
            coachHandleUserMove(source, target, promotion, { updateBoard: true });
          }
        }, true)) {
          return 'snapback';
        }
        // Synchronous legality check: the board needs a sync return value.
        const tempGame = new Chess(coachGame.fen());
        const move = tempGame.move({ from: source, to: target, promotion: 'q' });
        if (!move) return 'snapback';
        if (coachPracticeSession) {
          // Grading is async, so the piece goes home now and the board is
          // redrawn from coachGame once the move is accepted.
          const result = coachHandlePracticeMove(source, target, 'q', { updateBoard: true });
          return result && typeof result.then === 'function' ? 'snapback' : result;
        }
        // Legal move — dispatch async classification + opponent reply
        coachHandleUserMove(source, target, 'q', { updateBoard: false });
        return;
      }
      // Opponent's turn → queue the move as a premove. The piece visually snaps
      // back; the highlighted source/target squares + status hint show what's
      // queued. We attempt to apply it as soon as the opponent moves.
      if (requestPromotionChoice(coachGame, source, target, promotion => {
        setPremove(source, target, promotion);
      }, false)) {
        return 'snapback';
      }
      setPremove(source, target, 'q');
      return 'snapback';
    },
    onSnapEnd: function() {
      if (!coachGame || !coachBoard) return;
      // Runs after an accepted move. Redraw from the game so castling, en
      // passant and promotion show correctly, and keep analysis/review
      // positions on the board instead of snapping back to the live game.
      const fen = coachAnalysisFen() || (coachReviewCursor !== null ? coachFenAtPly(coachReviewCursor) : coachGame.fen());
      coachBoard.position(fen, false);
      if (coachReviewAnalysis) {
        const step = coachReviewAnalysis.steps[coachReviewAnalysis.index];
        setBoardLastMove('coachBoard', step && step.move ? step.move : null);
        updateCoachAnalysisAccessibility(fen, step && step.label);
      } else coachSyncLastMove();
    }
  });
  coachSyncLastMove();
  if (coachPremove) setPremoveSquares(coachPremove.from, coachPremove.to);
  renderPracticeBoardCue();
  updateCoachBoardAccessibility();
  setTimeout(() => {
    if (coachBoard) coachBoard.resize();
  }, 0);
}

function startCoachGame(options = {}) {
  if (coachOpeningTransfer && !options.openingTransfer) {
    finishOpeningTransfer();
    return;
  }
  clearCoachPracticeState();
  // Starting a new game is the explicit discard/reset action for an active
  // drill. Do not restore the borrowed game after this click.
  if (coachPracticeSession || coachPracticeReturnState) {
    coachPracticeSession = null;
    coachPracticeRun = null;
    coachPracticeReturnState = null;
    persistCoachPracticeReturnState(null);
  }
  if (typeof applyAdaptiveCoachElo === 'function') applyAdaptiveCoachElo();
  const transfer = options.openingTransfer || null;
  const fenRaw = transfer ? transfer.sourceFen : ($('#coach-fen').val() || '').trim();
  let startFen = null;
  if (fenRaw) {
    if (!isValidFen(fenRaw)) {
      $('#coach-fen-error').text('Invalid FEN — check the position string.').show();
      return;
    }
    startFen = fenRaw;
  }
  $('#coach-fen-error').hide();
  beginDailyMoveSprint();

  // Resolve "random" side
  const chosenSide = transfer ? transfer.side : $('.side-toggle button.active').data('side') || 'white';
  coachUserSide = chosenSide === 'random'
    ? (Math.random() < 0.5 ? 'white' : 'black')
    : chosenSide;

  resetCoachState(startFen);
  coachOpeningTransfer = transfer;
  const generation = coachGameGeneration;
  coachGameActive = true;
  CoachController.setPhase(coachIsUserTurn() ? 'userTurn' : 'opponentThinking');
  $('#summary-overlay').hide().attr('aria-hidden', 'true');
  // Replace any saved state from a prior game so a refresh before the first
  // move doesn't restore the old session.
  clearCoachState();

  // Orient board so user plays from bottom
  coachBoardFlipped = (coachUserColor() === 'black');
  createCoachBoard(coachGame.fen(), coachBoardFlipped ? 'black' : 'white');
  $('#coach-view').addClass('game-active');

  document.getElementById('coach-game-options').open = false;
  showCoachPanel('game');
  document.getElementById('coachBoard')?.focus({ preventScroll: true });
  const tier = strengthTierLabel(coachEngineElo);
  const opening = coachIsUserTurn()
    ? `Playing ${coachUserColor() === 'white' ? 'White' : 'Black'} vs Opponent ${coachEngineElo} (${tier}). Your move.`
    : `Playing ${coachUserColor() === 'white' ? 'White' : 'Black'} vs Opponent ${coachEngineElo} (${tier}). Opponent opens — thinking…`;
  setCoachStatus(opening);

  updateCoachControlsState();
  renderCoachDailyPlan();
  saveCoachState();
  ensureRemoteCoachGame(generation).catch(err => {
    if (!isAbortError(err)) handleCoachDbError(err);
  });

  // Pre-warm engine, then kick off opponent if it's their turn.
  // Wrap in a 15s timeout so a stuck WASM load surfaces a retry instead of hanging.
  const timed = Promise.race([
    engineClient.init(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Engine load timed out')), 15000))
  ]);
  timed.then(() => {
    if (generation !== coachGameGeneration || !coachGameActive) return;
    if (!coachIsUserTurn()) coachOpponentRespond();
  }).catch((err) => {
    if (generation !== coachGameGeneration || isAbortError(err)) return;
    showEngineLoadError(err);
  });
}

// Display a recoverable error inline in the coach status when Stockfish can't load.
function showEngineLoadError(err) {
  const msg = (err && err.message) || 'Engine could not load.';
  setCoachStatus(msg + ' — refresh to retry.');
  // Also disable in-game actions that require the engine.
  $('#btn-coach-resign').prop('disabled', true);
  $('#btn-coach-takeback').prop('disabled', true);
  $('#btn-coach-showbest').prop('disabled', true);
  $('#btn-coach-showwhy').prop('disabled', true);
  $('#btn-coach-candidates').prop('disabled', true);
}

// ─────────────────────────────────────────────
// CONTROL ENABLED-STATE
// ─────────────────────────────────────────────
function updateCoachControlsState() {
  const active = coachGameActive;
  const practicing = !!coachPracticeSession;
  const reviewing = coachIsReviewing();
  $('#btn-coach-review-practice').prop('disabled', coachThinking && !practicing);
  const hasReview = !!coachLastReview;
  const canExplain = !!coachLastReview && !!coachLastReview.bestUci && coachLastReview.tier !== 'best' &&
    coachLastReview.tier !== 'unknown' && (!active || coachIsUserTurn()) && !reviewing && !coachThinking && !practicing;
  const total = coachGame ? coachGame.history().length : 0;
  const cur = coachReviewCursor === null ? total : coachReviewCursor;
  $('#btn-coach-resign').prop('disabled', !active || reviewing || practicing);
  // "Open review" only appears once the game has ended and we have a summary to reopen.
  $('#btn-coach-openreview').toggle(!practicing && !active && !!coachLastEndMsg);
  $('#btn-coach-takeback').prop('disabled', practicing || !hasReview || reviewing || coachThinking);
  $('#btn-coach-showbest').prop('disabled', !canExplain);
  $('#btn-coach-showwhy').prop('disabled', !canExplain);
  $('#btn-coach-consequence').prop('disabled', !canExplain);
  $('#btn-coach-candidates').prop('disabled', practicing || !active || !coachGame || !coachIsUserTurn() || reviewing || coachThinking);
  $('#btn-coach-prev').prop('disabled', practicing || !coachGame || total === 0 || cur === 0);
  $('#btn-coach-next').prop('disabled', practicing || !coachGame || total === 0 || cur === total);
  $('#btn-coach-live').toggle(reviewing);
  const openingPosition = coachOpeningTransfer && coachGame
    ? (reviewing ? coachFenAtPly(cur) : coachGame.fen()) : null;
  $('#coach-nav-label').text(
    practicing ? 'Practice' : openingPosition ? `Move ${openingPosition.split(/\s+/)[5]} • ${reviewing ? 'Review' : 'Live'}` :
    !coachGame || total === 0 ? '' : reviewing ? `Move ${cur}/${total}` : `Move ${total} • Live`
  );
  renderCoachPresentation();
}

function closeSummaryOverlay() {
  const overlay = document.getElementById('summary-overlay');
  const requestedTarget = summaryReturnFocus;
  const canRestore = requestedTarget && requestedTarget !== document.body && requestedTarget.isConnected &&
    !(overlay && overlay.contains(requestedTarget));
  const returnTarget = canRestore
    ? requestedTarget
    : (document.getElementById('btn-coach-openreview') || document.getElementById('btn-coach-newgame'));
  $('#summary-overlay').hide().attr('aria-hidden', 'true');
  updateCoachControlsState();
  summaryReturnFocus = null;
  if (returnTarget && typeof returnTarget.focus === 'function') returnTarget.focus();
}
