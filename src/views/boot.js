// Startup: the jQuery ready handler. It binds every Library, Coach,
// Explore and global input event, lays out the boards, applies the route
// the page loaded with and starts the router. It must load after the
// other view scripts and before growth.js and the feature modules, whose
// own ready handlers run after this one.

// ─────────────────────────────────────────────
// EVENT HANDLERS
// ─────────────────────────────────────────────
$(function () {
  // Board is initialized lazily on first opening selection
  initDesktopNotice();
  initBoardTheme();
  initColorTheme();
  initCoachPanelTabs();
  migrateLegacyCoachMemory();
  coachSync.init();
  let applySearch;

  function bindLibraryEvents() {

  // Promotion picker
  $('#promotion-picker .promotion-choice').on('click', function() {
    const promotion = $(this).attr('data-promotion');
    const cb = pendingPromotionChoice;
    closePromotionPicker();
    if (cb) cb(promotion);
  });
  $('#promotion-picker').on('click', function(e) {
    if (e.target === this) closePromotionPicker();
  });

  // Library buttons
  $('.opening-btn').on('click', function () {
    loadOpening($(this).data('id'));
  });

  // Category tab filtering
  $('.cat-tab').on('click', function () {
    $('.cat-tab').removeClass('active');
    $(this).addClass('active');
    applySearch($('#library-search-input').val());
  });

  // Navigation
  $('#btn-prev').on('click', () => goToMove(currentMoveIdx - 1));
  $('#btn-next').on('click', () => goToMove(currentMoveIdx + 1));
  $('#btn-start').on('click', () => goToMove(-1));
  $('#btn-end').on('click', () => { if (currentOpening) goToMove(activeMoves().length - 1); });
  $('#btn-review-misses').on('click', startQuizMistakeReview);

  // Opening line selector
  $(document).on('click', '.line-btn', function () {
    const lineId = $(this).attr('data-line');
    if (lineId && lineId !== currentLineId) switchOpeningLine(lineId);
  });

  // Flip board
  $('#btn-flip').on('click', function () {
    if (!currentOpening) return;
    boardFlipped = !boardFlipped;
    board.flip();
  });

  // Mode toggle
  $('#btn-study').on('click', () => setMode('study'));
  $('#btn-quiz').on('click', () => { if (currentOpening) setMode('quiz'); });
  $('#btn-explore').on('click', () => setMode('explore'));

  $('#library-keyboard-move-form').on('submit', function(event) {
    event.preventDefault();
    const $status = $('#library-keyboard-move-status');
    if (!quizMode && !exploreMode) {
      $status.text('Switch to Quiz or Explore mode to play a move.');
      return;
    }
    const activeGame = exploreMode ? exploreGame : game;
    const move = resolveAccessibleMove(activeGame, $('#library-keyboard-move-input').val());
    if (!move) {
      $status.text('That move is not legal here. Try SAN such as Nf3 or coordinates such as g1f3.');
      return;
    }
    const result = exploreMode
      ? applyExploreMove(move.from, move.to, move.promotion || 'q', { updateBoard: true })
      : handleQuizDrop(move.from, move.to, move.promotion || 'q');
    if (!exploreMode && result === 'snapback') {
      $status.text('Legal move, but not the quiz answer. Try again.');
      return;
    }
    $('#library-keyboard-move-input').val('');
    $status.text('Move played: ' + move.san);
    updateLibraryBoardAccessibility();
  });
  }

  function bindCoachEvents() {

  // ─── Header nav (Library / Coach) ───────
  $('#nav-library').on('click', () => switchView('library'));
  $('#nav-coach').on('click', () => switchView('coach'));
  $('#nav-puzzles').on('click', () => switchView('puzzles'));
  $('.top-nav-btn').on('keydown', function(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const current = APP_VIEWS.indexOf(String(this.id).replace(/^nav-/, ''));
    let index = current < 0 ? 1 : current;
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = APP_VIEWS.length - 1;
    else if (event.key === 'ArrowLeft') index = Math.max(0, index - 1);
    else index = Math.min(APP_VIEWS.length - 1, index + 1);
    const nextView = APP_VIEWS[index];
    switchView(nextView);
    $('#nav-' + nextView).trigger('focus');
  });

  // ─── Coach settings ─────────────────────
  $('#coach-strength').on('input', function() {
    coachEngineElo = parseInt($(this).val(), 10);
    $('#coach-strength-value').text(coachEngineElo);
    $('#coach-strength-tier').text(strengthTierLabel(coachEngineElo));
    renderCoachPresentation();
  });

  $('.side-toggle button').on('click', function() {
    $('.side-toggle button').removeClass('active').attr('aria-pressed', 'false');
    $(this).addClass('active').attr('aria-pressed', 'true');
    const side = $(this).data('side');
    coachUserSide = side; // 'white' | 'black' | 'random'
    renderCoachPresentation();
  });

  $('#coach-fen').on('input', function() {
    $('#coach-fen-error').hide();
  });

  $('#coach-auth-email-form').on('submit', function(event) {
    event.preventDefault();
    sendCoachLoginLink().catch(handleCoachDbError);
  });
  $('#coach-auth-code-form').on('submit', function(event) {
    event.preventDefault();
    verifyCoachLoginCode().catch(handleCoachDbError);
  });
  $('#btn-coach-logout').on('click', function() {
    signOutCoach().catch(handleCoachDbError);
  });
  $('#btn-coach-reconnect').on('click', () => location.reload());
  $('#btn-coach-sync').on('click', async function() {
    if (!hasCoachDbSession()) {
      setCoachDbStatus('Sign in to sync games.');
      return;
    }
    const syncOwner = coachMemoryOwnerId();
    setCoachDbStatus('Syncing...');
    const [insightsResult, gameResult] = await Promise.allSettled([
      coachSync.loadInsights(),
      coachPracticeSession ? Promise.resolve() : coachSync.saveGame(coachGameActive ? null : coachLastEndMsg)
    ]);
    if (syncOwner !== coachMemoryOwnerId()) return;
    if (typeof flushAccountCheckpoint === 'function') flushAccountCheckpoint().catch(handleAccountCheckpointError);
    const insightError = insightsResult.status === 'rejected' ? insightsResult.reason : null;
    const gameError = gameResult.status === 'rejected' ? gameResult.reason : null;
    if (insightError && gameError) {
      setCoachDbStatus('Sync failed: ' + ((gameError && gameError.message) || (insightError && insightError.message) || 'Unknown error'));
    } else if (insightError) {
      setCoachDbStatus('Game saved, insights failed: ' + ((insightError && insightError.message) || 'Unknown error'));
    } else if (gameError) {
      setCoachDbStatus('Insights loaded, game save failed: ' + ((gameError && gameError.message) || 'Unknown error'));
    } else {
      setCoachDbStatus('Games, insights, and training sessions synced.');
    }
  });

  // Lifetime stats reset.
  $('#btn-coach-lifetime-reset').on('click', function() {
    if (!confirm('Reset all lifetime stats? This cannot be undone.')) return;
    saveLifetime(emptyLifetime());
    renderLifetime();
  });

  $('#btn-coach-insights-reset').on('click', function() {
    if (!confirm('Reset coach insights for this browser? This cannot be undone.')) return;
    clearInsights();
    renderInsights();
  });

  $('#btn-practice-progress-reset').on('click', function() {
    if (!confirm('Reset all practice attempts and scheduling for this browser?')) return;
    clearPracticeProgress();
    renderInsights();
  });

  $(document).on('click', '.practice-load', function() {
    const item = renderedPracticeItems.get($(this).attr('data-practice-id'));
    if (!item) {
      setCoachStatus('Practice position is no longer valid.');
      return;
    }
    const due = Array.from(renderedPracticeItems.values()).filter(candidate => practiceIsDue(candidate));
    startCoachPracticeSession(due, item);
  });

  $('#btn-practice-session-start').on('click', function() {
    const recommendation = practiceRecommendation();
    if (!recommendation || coachThinking) return;
    if (recommendation.items[0].id.startsWith('drill-')) startCoachPracticeSession(recommendation.items, recommendation.items[0]);
    else startCoachPractice(recommendation.items[0]);
  });

  $('#btn-coach-next-action').on('click', function() {
    const action = $(this).attr('data-action');
    if (action === 'progress') {
      if (coachPracticeSession) exitCoachPractice();
      document.querySelector('.panel-tab[data-panel="progress"]')?.click();
      document.getElementById('tab-progress')?.focus();
      return;
    }
    if (action === 'practice') {
      const due = Array.from(renderedPracticeItems.values()).filter(item => practiceIsDue(item));
      startCoachPracticeSession(due, due[0]);
      return;
    }
    if (action === 'continue') {
      if (!coachPracticeSession && coachIsReviewing()) coachGotoLive();
      showCoachPanel(coachPracticeSession ? 'practice' : 'game');
      document.querySelector('.coach-board-area')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      document.getElementById('coachBoard')?.focus({ preventScroll: true });
      return;
    }
    startCoachGame();
  });
  $('#btn-coach-practice-answer').on('click', revealCoachPracticeAnswer);
  $('#btn-coach-practice-hint').on('click', showCoachPracticeHint);
  $('#btn-coach-practice-next').on('click', advanceCoachPractice);
  $('#btn-coach-practice-exit').on('click', function() { exitCoachPractice(); });
  $('#btn-coach-review-practice').on('click', function() {
    const item = practiceItemFromReview(coachLastReview);
    if (!item || !practiceIsDue(item)) {
      $(this).hide();
      setCoachStatus('This move is already scheduled for later practice.');
      return;
    }
    startCoachPracticeSession([item], item);
  });
  $('#btn-coach-opening-study').on('click', function() {
    if (!coachOpeningId || !OPENINGS.some(opening => opening.id === coachOpeningId)) {
      setCoachStatus('This opening is not in the local study library yet.');
      return;
    }
    const context = coachOpeningTransfer;
    loadOpening(coachOpeningId, context ? context.lineId : undefined);
    if (context) goToMove(context.sourcePly - 1);
  });

  // Sound toggle — restore prior preference, persist on change. The first
  // change is also a user gesture so we can prime the AudioContext here.
  coachSoundEnabled = readSoundPref();
  $('#coach-sound-toggle').prop('checked', coachSoundEnabled);
  $('#coach-sound-toggle').on('change', function() {
    coachSoundEnabled = this.checked;
    writeSoundPref(coachSoundEnabled);
    if (coachSoundEnabled) {
      // Prime the audio context with a quiet wood-tap preview so a real
      // sound fires immediately on the next move.
      const ctx = ensureAudioCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      playWoodTap({ bodyFreq: 220, bodyEnd: 130, bodyGain: 0.018, clickGain: 0.014 });
    }
  });

  $('#btn-coach-newgame').on('click', function() {
    startCoachGame();
  });

  $('#coach-keyboard-move-form').on('submit', async function(event) {
    event.preventDefault();
    const $status = $('#coach-keyboard-move-status');
    if (!coachGameActive || !coachGame) {
      $status.text('Start a Coach game first.');
      return;
    }
    if (!coachIsUserTurn() || coachThinking || coachIsReviewing()) {
      $status.text(coachIsReviewing() ? 'Return to the live position first.' : 'Wait until it is your turn.');
      return;
    }
    const move = resolveAccessibleMove(coachGame, $('#coach-keyboard-move-input').val());
    if (!move) {
      $status.text('That move is not legal here. Try SAN such as Nf3 or coordinates such as g1f3.');
      return;
    }
    const inputGeneration = coachGameGeneration;
    const inputPractice = coachPracticeSession;
    const result = coachPracticeSession
      ? await coachHandlePracticeMove(move.from, move.to, move.promotion || 'q', { updateBoard: true })
      : await coachHandleUserMove(move.from, move.to, move.promotion || 'q', { updateBoard: true });
    if (!coachMode || inputGeneration !== coachGameGeneration || inputPractice !== coachPracticeSession) return;
    if (result === 'snapback') {
      $status.text(coachPracticeSession ? 'Position reset. Read the feedback, then try another move.' : 'That move could not be played.');
      if (coachPracticeSession) $('#coach-keyboard-move-input').trigger('focus').trigger('select');
      return;
    }
    if (result === 'stale') {
      $status.text('The position changed before analysis finished.');
      return;
    }
    if (result === 'ungraded' || result === 'pending') {
      $status.text(result === 'ungraded' ? 'Engine did not score that move.' : 'Checking the position…');
      return;
    }
    $('#coach-keyboard-move-input').val('');
    $status.text(coachPracticeSession ? 'Practice move played: ' + move.san : 'Move played: ' + move.san);
    updateCoachBoardAccessibility();
  });

  $(document).on('click', '#btn-coach-retry-opponent', function() {
    if (!coachMode || !coachGameActive || !coachGame) return;
    if (coachIsUserTurn()) {
      setCoachStatus('Your move.');
      return;
    }
    coachOpponentRespond();
  });

  $('#btn-coach-resign').on('click', function() {
    if (!coachGameActive) return;
    const loser = coachUserColor() === 'white' ? 'White' : 'Black';
    const winner = loser === 'White' ? 'Black' : 'White';
    // User-initiated — keep it snappy but still buffer with a small beat + animation.
    coachFinishGame(`Resigned — ${winner} wins.`, 350);
  });

  // Coach: flip board
  $('#btn-coach-flip').on('click', function() {
    if (!coachBoard) return;
    coachBoardFlipped = !coachBoardFlipped;
    coachBoard.flip();
    if (coachPracticeSession) saveCoachPracticeState(); else saveCoachState();
  });

  // Coach: take back (undo user move + opponent reply if present)
  $('#btn-coach-takeback').on('click', function() {
    if (!coachMode || !coachGame) return;
    const removedReview = coachLastReview;
    invalidateCoachAsyncWork('The position was taken back.');
    clearPremove();
    // Remove the prior completed-game contribution before allowing this game
    // to end again with a revised score.
    if (coachLifetimeRolledForThisGame) unrollGameFromLifetime();
    coachLifetimeRolledForThisGame = false;
    // A game with a take-back is unrated from here on. A result already rated
    // stands: taking it back must not erase a loss from the rating.
    coachTakebackUsed = true;
    // If the game just ended and the post-game summary is pending, abort it —
    // taking back un-ends the game.
    if (coachSummaryTimer) { clearTimeout(coachSummaryTimer); coachSummaryTimer = null; }
    $('#coach-status').removeClass('status-ended');
    // Undo opponent reply if it was played
    if (coachLastReview && coachGame.fen() !== coachLastReview.fenAfter) {
      coachGame.undo();
    }
    // Undo user move
    coachGame.undo();
    // Roll back stats
    // Unscored ('unknown') reviews never counted, so they must not uncount.
    if (coachLastReview && coachStats && coachLastReview.tier !== 'unknown') {
      coachStats.moves = Math.max(0, coachStats.moves - 1);
      coachStats[coachLastReview.tier] = Math.max(0, (coachStats[coachLastReview.tier] || 0) - 1);
    }
    coachLastReview = null;
    coachThinking = false;
    coachGameActive = true;
    CoachController.setPhase('userTurn');
    coachReviewCursor = null;
    if (coachBoard) coachBoard.position(coachGame.fen());
    coachSyncLastMove();
    updateCapturedDisplay(coachGame.fen());
    // Also remove the rolled-back review from the log so rolling accuracy and
    // the move list's tier coloring reflect the takeback.
    if (coachReviewLog && coachReviewLog.length > 0) coachReviewLog.pop();
    $('#coach-review').hide();
    $('#threats-section').hide();
    $('#candidates-section').hide();
    updateCoachSummary();
    updateMoveList();
    updateOpeningLabel();
    setCoachStatus('Your move. A game with a take-back is unrated.');
    updateCoachControlsState();
    saveCoachState();
    if (removedReview) {
      const insights = loadInsights();
      insights.entries = insights.entries.filter(entry =>
        !(removedReview.insightId && entry.id === removedReview.insightId) &&
        !(removedReview.localGameId && entry.localGameId === removedReview.localGameId && entry.ply === removedReview.ply));
      saveInsights(insights);
      renderInsights();
    }
    coachSync.deleteMove(removedReview).catch(handleCoachDbError);
  });

  // Coach: show why — display the recommended continuation on the main board.
  // The actual game object and review log remain untouched.
  $('#btn-coach-showbest').on('click', function() {
    startCoachReviewAnalysis(coachLastReview);
  });
  $('#btn-coach-showwhy').on('click', function() {
    startCoachReviewAnalysis(coachLastReview);
  });
  $('#btn-coach-consequence').on('click', function() { startCoachConsequenceAnalysis(coachLastReview); });
  $('#btn-coach-review-analysis-prev').on('click', function() { stepCoachReviewAnalysis(-1); });
  $('#btn-coach-review-analysis-next').on('click', function() { stepCoachReviewAnalysis(1); });
  $('#btn-coach-backtogame').on('click', function() {
    clearCoachReviewAnalysis();
    coachGotoLive();
  });

  // Coach: show top-3 candidate moves
  $('#btn-coach-candidates').on('click', function() {
    if (!coachMode || !coachGame) return;
    if (coachIsReviewing()) return;
    showCandidates();
  });

  // Coach: history navigation
  $('#btn-coach-prev').on('click', function() {
    if (!coachGame) return;
    const total = coachGame.history().length;
    const cur = coachReviewCursor === null ? total : coachReviewCursor;
    if (cur > 0) coachGotoPly(cur - 1);
  });
  $('#btn-coach-next').on('click', function() {
    if (!coachGame) return;
    const total = coachGame.history().length;
    const cur = coachReviewCursor === null ? total : coachReviewCursor;
    if (cur < total) coachGotoPly(cur + 1);
  });
  $('#btn-coach-live').on('click', function() {
    if (!coachGame) return;
    coachGotoLive();
  });

  // Generic clipboard helper used by every Copy * button in coach mode.
  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    throw new Error('Clipboard API unavailable');
  }
  // Coach: Copy PGN to clipboard
  $('#btn-coach-copypgn').on('click', async function() {
    const $btn = $(this);
    const pgn = coachGetPgn();
    if (!pgn) return;
    try {
      await copyToClipboard(pgn);
      $btn.addClass('copied').text('Copied!');
      setTimeout(() => $btn.removeClass('copied').text('Copy PGN'), 1500);
    } catch (e) {
      $btn.text('Copy unavailable');
      setTimeout(() => $btn.text('Copy PGN'), 1500);
    }
  });
  // Coach: Copy FEN of the position currently displayed (respects review cursor).
  $('#btn-coach-copyfen').on('click', async function() {
    const $btn = $(this);
    if (!coachGame) return;
    let fen;
    if (coachReviewCursor !== null) {
      // Build a chess.js instance up to the cursor ply to read its FEN.
      const tmp = new Chess(coachStartFen || undefined);
      const sans = coachGame.history();
      for (let i = 0; i < coachReviewCursor && i < sans.length; i++) tmp.move(sans[i]);
      fen = tmp.fen();
    } else {
      fen = coachGame.fen();
    }
    try {
      await copyToClipboard(fen);
      $btn.addClass('copied').text('Copied!');
      setTimeout(() => $btn.removeClass('copied').text('Copy FEN'), 1500);
    } catch (e) {
      $btn.text('Copy unavailable');
      setTimeout(() => $btn.text('Copy FEN'), 1500);
    }
  });

  // Coach: click a ply in the move list to jump to that position.
  $(document).on('click', '#movelist .ply', function() {
    const ply = parseInt($(this).attr('data-ply'), 10);
    if (!isNaN(ply)) coachGotoPly(ply);
  });

  // Coach: pressing anywhere on the board cancels a queued premove. Pointer
  // events arrive once per press (a touch is not repeated as a mouse event)
  // and before the board reads the press, so a press that queues a new
  // premove clears the old one first.
  const coachBoardEl = document.getElementById('coachBoard');
  if (coachBoardEl) coachBoardEl.addEventListener('pointerdown', function() {
    if (coachPremove) clearPremove();
  });

  // Coach: keyboard shortcuts for history navigation.
  // ← previous ply, → next ply, End returns to the live position. Only
  // fire in coach mode and never while the user is typing in a form field.
  $(document).on('keydown', function(e) {
    if (!coachMode || !coachGame || coachPracticeSession || e.isDefaultPrevented() ||
        $('#summary-overlay, #promotion-picker, #desktop-notice').is(':visible')) return;
    // Ignore if the user is typing (inputs, textareas, contenteditable).
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') {
      const total = coachGame.history().length;
      const cur = coachReviewCursor === null ? total : coachReviewCursor;
      if (cur > 0) { e.preventDefault(); coachGotoPly(cur - 1); }
    } else if (e.key === 'ArrowRight') {
      const total = coachGame.history().length;
      const cur = coachReviewCursor === null ? total : coachReviewCursor;
      if (cur < total) { e.preventDefault(); coachGotoPly(cur + 1); }
    } else if (e.key === 'End') {
      if (coachIsReviewing()) { e.preventDefault(); coachGotoLive(); }
    } else if (e.key === 'Home') {
      if (coachGame.history().length > 0) { e.preventDefault(); coachGotoPly(0); }
    }
  });

  // Summary overlay buttons
  $('#btn-summary-newgame').on('click', function() {
    closeSummaryOverlay();
    startCoachGame();
  });
  $('#btn-summary-practice').on('click', function() {
    const item = summaryPracticeItems[0];
    if (!item) return;
    closeSummaryOverlay();
    startCoachPracticeSession(summaryPracticeItems, item);
  });
  $('#btn-summary-close').on('click', function() {
    closeSummaryOverlay();
  });
  // Reopen the review summary once the game has ended.
  $('#btn-coach-openreview').on('click', function() {
    if (!coachLastEndMsg) return;
    showPostGameSummary(coachLastEndMsg);
  });
  // Copy PGN from within the summary — shares logic with the move-list copy button.
  $('#btn-summary-copypgn').on('click', async function() {
    const $btn = $(this);
    const pgn = coachGetPgn();
    if (!pgn) return;
    try {
      await copyToClipboard(pgn);
      $btn.text('Copied!');
      setTimeout(() => $btn.text('Copy PGN'), 1500);
    } catch (e) {
      $btn.text('Copy unavailable');
      setTimeout(() => $btn.text('Copy PGN'), 1500);
    }
  });
  // Click a critical/best moment to close the overlay and jump to that position.
  $(document).on('click', '.moment-row', function() {
    const ply = parseInt(this.dataset.ply, 10);
    if (!Number.isInteger(ply)) return;
    closeSummaryOverlay();
    coachGotoPly(ply);
    // Surface the "Open review" button so the user can get back to the summary.
    updateCoachControlsState();
  });
  // Allow pressing Escape to dismiss the summary overlay.
  $(document).on('keydown.summary', function(e) {
    const summary = document.getElementById('summary-overlay');
    if (!summary || !$('#summary-overlay').is(':visible')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSummaryOverlay();
    } else {
      trapDialogTab(e, summary);
    }
  });
  }

  function bindExploreEvents() {

  // Explore: database toggle
  $('.db-btn').on('click', function() {
    currentDb = $(this).data('db');
    $('.db-btn').removeClass('active').attr('aria-pressed', 'false');
    $(this).addClass('active').attr('aria-pressed', 'true');
    if (exploreMode) fetchExploreData();
  });

  // Explore: token save
  $('#lichess-token-form').on('submit', function(event) {
    event.preventDefault();
    const token = $('#lichess-token-input').val().trim();
    if (!token) {
      $('#token-error').text('Paste a Lichess token first.').show();
      $('#lichess-token-input').trigger('focus');
      return;
    }
    $('#token-error').hide();
    const $btn = $(this).prop('disabled', true).text('Checking…');
    $.ajax({
      url: 'https://explorer.lichess.ovh/lichess',
      data: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', topGames: 0, recentGames: 0 },
      dataType: 'json',
      headers: { 'Authorization': 'Bearer ' + token },
      success: function() {
        $btn.prop('disabled', false).text('Connect');
        if (!setLichessToken(token)) {
          $('#token-error').text('Could not store token for this tab. Check browser storage settings.').show();
          return;
        }
        showExploreTokenState();
        fetchExploreData();
      },
      error: function(xhr) {
        $btn.prop('disabled', false).text('Connect');
        const msg = xhr.status === 401
          ? 'Invalid token — check you copied it correctly.'
          : (xhr.status === 429 ? LICHESS_RATE_LIMIT_MESSAGE : 'Could not reach Lichess. Try again.');
        $('#token-error').text(msg).show();
      }
    });
  });

  // Explore: disconnect Lichess
  $('#btn-disconnect-lichess').on('click', function() {
    clearLichessToken();
    exploreCache.clear();
    $('#lichess-token-input').val('');
    showExploreTokenState();
  });

  // Explore: undo last move
  $('#btn-explore-undo').on('click', function() {
    if (!exploreMode || !exploreGame) return;
    if (exploreGame.fen() === exploreStartFen) return; // already at start
    exploreGame.undo();
    board.position(exploreGame.fen());
    librarySyncLastMove(exploreGame);
    fetchExploreData();
  });

  // Explore: reset to opening end position (or initial if no opening)
  $('#btn-explore-reset').on('click', function() {
    if (!exploreMode) return;
    exploreGame = new Chess(exploreStartFen);
    board.position(exploreStartFen);
    fetchExploreData();
  });
  }

  function bindGlobalInputEvents() {

  // The boards follow their container's size; also re-measure both after
  // responsive layout changes so desktop-to-mobile resizing and device
  // rotation cannot leave a 440px grid clipped inside a smaller shell.
  let boardResizeTimer = null;
  $(window).on('resize', function() {
    if (boardResizeTimer) clearTimeout(boardResizeTimer);
    boardResizeTimer = setTimeout(() => {
      boardResizeTimer = null;
      if (board) board.resize();
      if (coachBoard) coachBoard.resize();
      placeDailySprintCard();
      scheduleCoachBoardFit();
      scheduleLibraryBoardFit();
      updateLibraryBoardAccessibility();
      updateCoachBoardAccessibility();
    }, 120);
  });

  // ─── SEARCH ─────────────────────────────
  applySearch = function(q) {
    q = (q || '').trim().toLowerCase();
    const activeCat = $('.cat-tab.active').data('cat') || 'all';
    let visibleCount = 0;
    // When searching, ignore category filter and flatten view
    $('.library > .library-section').each(function() {
      const $sec = $(this);
      let secVisible = 0;
      $sec.find('.opening-btn').each(function() {
        const id = $(this).data('id');
        const op = OPENINGS.find(o => o.id === id);
        const hay = (($(this).text() || '') + ' ' + (op ? op.moves.join(' ') : '')).toLowerCase();
        const matchesQuery = !q || hay.includes(q);
        const matchesCat = q ? true : (activeCat === 'all' || op?.category === activeCat);
        const show = matchesQuery && matchesCat;
        $(this).toggle(show);
        if (show) { secVisible++; visibleCount++; }
      });
      $sec.toggle(secVisible > 0);
    });
    $('#library-empty').toggle(visibleCount === 0);
    $('.cat-tabs').toggle(!q);
    // Hide the SR due section while searching
    if (q) $('#sr-due-section').hide();
    else updateSRSidebar();
  };
  $('#library-search-input').on('input', function() { applySearch($(this).val()); });

  // ─── SHARE LINK ─────────────────────────
  $('#btn-share').on('click', function() {
    const $btn = $(this);
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      const original = $btn.text();
      $btn.text('Copy unavailable');
      setTimeout(() => $btn.text(original), 1500);
      return;
    }
    navigator.clipboard.writeText(location.href).then(() => {
      const orig = $btn.text();
      $btn.text('Copied ✓').addClass('copied');
      setTimeout(() => $btn.text(orig).removeClass('copied'), 1500);
    }).catch(() => {
      const original = $btn.text();
      $btn.text('Copy unavailable');
      setTimeout(() => $btn.text(original), 1500);
    });
  });

  // ─── KEYBOARD SHORTCUTS ─────────────────
  $(document).on('keydown', function (e) {
    if (e.isDefaultPrevented() || $('#summary-overlay').is(':visible') || $('#desktop-notice').is(':visible')) return;
    if ($('#promotion-picker').is(':visible')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePromotionPicker();
        return;
      }
      trapDialogTab(e, document.getElementById('promotion-picker'));
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Puzzles handles its own shortcuts (puzzles.js).
    if (appView === 'puzzles') return;

    // In coach view, only handle the flip shortcut; everything else is scoped to library
    // Coach: F flips; arrows step through the game like the nav buttons,
    // Home goes to the first position and End back to live.
    if (coachMode) {
      const usable = id => { const $b = $(id); return $b.length && $b.is(':visible') && !$b.prop('disabled'); };
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        $('#btn-coach-flip').trigger('click');
      } else if (e.key === 'ArrowLeft' && usable('#btn-coach-prev')) {
        e.preventDefault();
        $('#btn-coach-prev').trigger('click');
      } else if (e.key === 'ArrowRight' && usable('#btn-coach-next')) {
        e.preventDefault();
        $('#btn-coach-next').trigger('click');
      } else if (e.key === 'Home' && usable('#btn-coach-prev') && coachGame && coachGame.history().length) {
        e.preventDefault();
        coachGotoPly(0);
      } else if (e.key === 'End' && usable('#btn-coach-live')) {
        e.preventDefault();
        $('#btn-coach-live').trigger('click');
      }
      return;
    }

    // Arrow keys: prev/next in study mode
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (quizMode || exploreMode) return;
      e.preventDefault();
      if (!$('#btn-next').prop('disabled')) goToMove(currentMoveIdx + 1);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (quizMode || exploreMode) return;
      e.preventDefault();
      if (!$('#btn-prev').prop('disabled')) goToMove(currentMoveIdx - 1);
      return;
    }

    const k = e.key.toLowerCase();
    // Focus search
    if (k === '/' ) { e.preventDefault(); $('#library-search-input').trigger('focus').select(); return; }
    // Flip board
    if (k === 'f') {
      if (!currentOpening && !exploreMode) return;
      e.preventDefault();
      if (exploreMode) { boardFlipped = !boardFlipped; board.flip(); return; }
      $('#btn-flip').trigger('click');
      return;
    }
    // Reset
    if (k === 'r') {
      e.preventDefault();
      if (exploreMode) { $('#btn-explore-reset').trigger('click'); return; }
      if (quizMode) { setMode('quiz'); return; }
      if (currentOpening) goToMove(-1);
      return;
    }
    // Mode switch: 1=Study, 2=Quiz, 3=Explore
    if (k === '1') { e.preventDefault(); setMode('study'); return; }
    if (k === '2') { if (currentOpening) { e.preventDefault(); setMode('quiz'); } return; }
    if (k === '3') { e.preventDefault(); setMode('explore'); return; }
  });

  // Tap-to-move needs no handler here: the board (src/ui/board.js) turns a
  // tap or click on a piece and then a square into the same onDragStart /
  // onDrop calls as a drag, so every input takes one path.

  // ─── SWIPE FOR PREV/NEXT (mobile, study only) ───
  let touchStartX = null;
  let touchStartY = null;
  $('.board-area').on('touchstart', function(e) {
    if (quizMode || exploreMode) return;
    if (e.touches.length !== 1) return;
    // The phone layout puts the notation strip here; swiping it scrolls it.
    if ($(e.target).closest('#library-moves, .notation-strip').length) { touchStartX = touchStartY = null; return; }
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  });
  $('.board-area').on('touchend', function(e) {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = touchStartY = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (quizMode || exploreMode) return;
    if (dx < 0) { if (!$('#btn-next').prop('disabled')) goToMove(currentMoveIdx + 1); }
    else { if (!$('#btn-prev').prop('disabled')) goToMove(currentMoveIdx - 1); }
  });
  }

  // ─── HYDRATE FROM URL ───────────────────
  // The page applies the URL it loaded with (old ?view= / ?opening= / mode=
  // links included, see parseRoute), then Back and Forward go through
  // restoreRoute.
  function hydrateFromUrl() {
    applyRoute(parseRoute(location.search), { initial: true });
    // Settings opens after the view, so write the address once more with it.
    updateURL();
    Router.start(restoreRoute);
  }
  bindLibraryEvents();
  bindCoachEvents();
  bindExploreEvents();
  bindGlobalInputEvents();
  placeDailySprintCard();
  initCoachWorkspaceLayout();
  initLibraryWorkspaceLayout();
  updateSRSidebar();
  hydrateFromUrl();
  updateNetworkStatus(false);
  window.addEventListener('offline', () => updateNetworkStatus(false));
  window.addEventListener('online', () => updateNetworkStatus(true));
});
