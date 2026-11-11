// Startup: the ready handler (onReady, src/ui/dom.js). It binds every Library, Coach,
// Explore and global input event, lays out the boards, applies the route
// the page loaded with and starts the router. It must load after the
// other view scripts and before growth.js and the feature modules, whose
// own ready handlers run after this one.

// ─────────────────────────────────────────────
// EVENT HANDLERS
// ─────────────────────────────────────────────
onReady(function () {
  // Board is initialized lazily on first opening selection
  initBoardTheme();
  initColorTheme();
  initCoachPanelTabs();
  migrateLegacyCoachMemory();
  coachSync.init();
  let applySearch;

  function bindLibraryEvents() {

  // Promotion picker
  on(qsa('#promotion-picker .promotion-choice'), 'click', function() {
    const promotion = this.getAttribute('data-promotion');
    const cb = pendingPromotionChoice;
    closePromotionPicker();
    if (cb) cb(promotion);
  });
  on(byId('promotion-picker'), 'click', function(e) {
    if (e.target === this) closePromotionPicker();
  });

  // Library buttons
  on(qsa('.opening-btn'), 'click', function () {
    loadOpening(this.dataset.id);
  });

  // Category tab filtering
  on(qsa('.cat-tab'), 'click', function () {
    qsa('.cat-tab').forEach(el => { el.classList.remove('active'); });
    this.classList.add('active');
    applySearch(byId('library-search-input').value);
  });

  // Navigation
  on(byId('btn-prev'), 'click', () => goToMove(currentMoveIdx - 1));
  on(byId('btn-next'), 'click', () => goToMove(currentMoveIdx + 1));
  on(byId('btn-start'), 'click', () => goToMove(-1));
  on(byId('btn-end'), 'click', () => { if (currentOpening) goToMove(activeMoves().length - 1); });
  on(byId('btn-review-misses'), 'click', startQuizMistakeReview);

  // Opening line selector
  on(document, 'click', '.line-btn', function () {
    const lineId = this.getAttribute('data-line');
    if (lineId && lineId !== currentLineId) switchOpeningLine(lineId);
  });

  // Flip board
  on(byId('btn-flip'), 'click', function () {
    if (!currentOpening) return;
    boardFlipped = !boardFlipped;
    board.flip();
  });

  // Mode toggle
  on(byId('btn-study'), 'click', () => setMode('study'));
  on(byId('btn-quiz'), 'click', () => { if (currentOpening) setMode('quiz'); });
  on(byId('btn-explore'), 'click', () => setMode('explore'));

  on(byId('library-keyboard-move-form'), 'submit', function(event) {
    event.preventDefault();
    const status = byId('library-keyboard-move-status');
    if (!quizMode && !exploreMode) {
      status.textContent = 'Switch to Quiz or Explore mode to play a move.';
      return;
    }
    const activeGame = exploreMode ? exploreGame : game;
    const move = resolveAccessibleMove(activeGame, byId('library-keyboard-move-input').value);
    if (!move) {
      status.textContent = 'That move is not legal here. Try SAN such as Nf3 or coordinates such as g1f3.';
      return;
    }
    const result = exploreMode
      ? applyExploreMove(move.from, move.to, move.promotion || 'q', { updateBoard: true })
      : handleQuizDrop(move.from, move.to, move.promotion || 'q');
    if (!exploreMode && result === 'snapback') {
      status.textContent = 'Legal move, but not the quiz answer. Try again.';
      return;
    }
    byId('library-keyboard-move-input').value = '';
    status.textContent = 'Move played: ' + move.san;
    updateLibraryBoardAccessibility();
  });
  }

  function bindCoachEvents() {

  // ─── Header nav (Library / Coach) ───────
  on(byId('nav-library'), 'click', () => switchView('library'));
  on(byId('nav-coach'), 'click', () => switchView('coach'));
  on(byId('nav-puzzles'), 'click', () => switchView('puzzles'));
  on(qsa('.top-nav-btn'), 'keydown', function(event) {
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
    byId('nav-' + nextView).focus();
  });

  // ─── Coach settings ─────────────────────
  on(byId('coach-strength'), 'input', function() {
    coachEngineElo = parseInt(this.value, 10);
    byId('coach-strength-value').textContent = coachEngineElo;
    byId('coach-strength-tier').textContent = strengthTierLabel(coachEngineElo);
    renderCoachPresentation();
  });

  on(qsa('.side-toggle button'), 'click', function() {
    qsa('.side-toggle button').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });
    this.classList.add('active');
    this.setAttribute('aria-pressed', 'true');
    const side = this.dataset.side;
    coachUserSide = side; // 'white' | 'black' | 'random'
    renderCoachPresentation();
  });

  on(byId('coach-fen'), 'input', function() {
    hideEl(byId('coach-fen-error'));
  });

  on(byId('coach-auth-email-form'), 'submit', function(event) {
    event.preventDefault();
    sendCoachLoginLink().catch(handleCoachDbError);
  });
  on(byId('coach-auth-code-form'), 'submit', function(event) {
    event.preventDefault();
    verifyCoachLoginCode().catch(handleCoachDbError);
  });
  on(byId('btn-coach-logout'), 'click', function() {
    signOutCoach().catch(handleCoachDbError);
  });
  on(byId('btn-coach-reconnect'), 'click', () => location.reload());
  on(byId('btn-coach-sync'), 'click', async function() {
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
  on(byId('btn-coach-lifetime-reset'), 'click', function() {
    if (!confirm('Reset all lifetime stats? This cannot be undone.')) return;
    saveLifetime(emptyLifetime());
    renderLifetime();
  });

  on(byId('btn-coach-insights-reset'), 'click', function() {
    if (!confirm('Reset coach insights for this browser? This cannot be undone.')) return;
    clearInsights();
    renderInsights();
  });

  on(byId('btn-practice-progress-reset'), 'click', function() {
    if (!confirm('Reset all practice attempts and scheduling for this browser?')) return;
    clearPracticeProgress();
    renderInsights();
  });

  on(document, 'click', '.practice-load', function() {
    const item = renderedPracticeItems.get(this.getAttribute('data-practice-id'));
    if (!item) {
      setCoachStatus('Practice position is no longer valid.');
      return;
    }
    const due = Array.from(renderedPracticeItems.values()).filter(candidate => practiceIsDue(candidate));
    startCoachPracticeSession(due, item);
  });

  on(byId('btn-practice-session-start'), 'click', function() {
    const recommendation = practiceRecommendation();
    if (!recommendation || coachThinking) return;
    if (recommendation.items[0].id.startsWith('drill-')) startCoachPracticeSession(recommendation.items, recommendation.items[0]);
    else startCoachPractice(recommendation.items[0]);
  });

  on(byId('btn-coach-next-action'), 'click', function() {
    const action = this.getAttribute('data-action');
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
  on(byId('btn-coach-practice-answer'), 'click', revealCoachPracticeAnswer);
  on(byId('btn-coach-practice-hint'), 'click', showCoachPracticeHint);
  on(byId('btn-coach-practice-next'), 'click', advanceCoachPractice);
  on(byId('btn-coach-practice-exit'), 'click', function() { exitCoachPractice(); });
  on(byId('btn-coach-review-practice'), 'click', function() {
    const item = practiceItemFromReview(coachLastReview);
    if (!item || !practiceIsDue(item)) {
      hideEl(this);
      setCoachStatus('This move is already scheduled for later practice.');
      return;
    }
    startCoachPracticeSession([item], item);
  });
  on(byId('btn-coach-opening-study'), 'click', function() {
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
  byId('coach-sound-toggle').checked = coachSoundEnabled;
  on(byId('coach-sound-toggle'), 'change', function() {
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

  on(byId('btn-coach-newgame'), 'click', function() {
    startCoachGame();
  });

  on(byId('coach-keyboard-move-form'), 'submit', async function(event) {
    event.preventDefault();
    const status = byId('coach-keyboard-move-status');
    if (!coachGameActive || !coachGame) {
      status.textContent = 'Start a Coach game first.';
      return;
    }
    if (!coachIsUserTurn() || coachThinking || coachIsReviewing()) {
      status.textContent = coachIsReviewing() ? 'Return to the live position first.' : 'Wait until it is your turn.';
      return;
    }
    const move = resolveAccessibleMove(coachGame, byId('coach-keyboard-move-input').value);
    if (!move) {
      status.textContent = 'That move is not legal here. Try SAN such as Nf3 or coordinates such as g1f3.';
      return;
    }
    const inputGeneration = coachGameGeneration;
    const inputPractice = coachPracticeSession;
    const result = coachPracticeSession
      ? await coachHandlePracticeMove(move.from, move.to, move.promotion || 'q', { updateBoard: true })
      : await coachHandleUserMove(move.from, move.to, move.promotion || 'q', { updateBoard: true });
    if (!coachMode || inputGeneration !== coachGameGeneration || inputPractice !== coachPracticeSession) return;
    if (result === 'snapback') {
      status.textContent = coachPracticeSession ? 'Position reset. Read the feedback, then try another move.' : 'That move could not be played.';
      if (coachPracticeSession) {
        const input = byId('coach-keyboard-move-input');
        input.focus();
        input.select();
      }
      return;
    }
    if (result === 'stale') {
      status.textContent = 'The position changed before analysis finished.';
      return;
    }
    if (result === 'ungraded' || result === 'pending') {
      status.textContent = result === 'ungraded' ? 'Engine did not score that move.' : 'Checking the position…';
      return;
    }
    byId('coach-keyboard-move-input').value = '';
    status.textContent = coachPracticeSession ? 'Practice move played: ' + move.san : 'Move played: ' + move.san;
    updateCoachBoardAccessibility();
  });

  on(document, 'click', '#btn-coach-retry-opponent', function() {
    if (!coachMode || !coachGameActive || !coachGame) return;
    if (coachIsUserTurn()) {
      setCoachStatus('Your move.');
      return;
    }
    coachOpponentRespond();
  });

  on(byId('btn-coach-resign'), 'click', function() {
    if (!coachGameActive) return;
    const loser = coachUserColor() === 'white' ? 'White' : 'Black';
    const winner = loser === 'White' ? 'Black' : 'White';
    // User-initiated — keep it snappy but still buffer with a small beat + animation.
    coachFinishGame(`Resigned — ${winner} wins.`, 350);
  });

  // Coach: flip board
  on(byId('btn-coach-flip'), 'click', function() {
    if (!coachBoard) return;
    coachBoardFlipped = !coachBoardFlipped;
    coachBoard.flip();
    if (coachPracticeSession) saveCoachPracticeState(); else saveCoachState();
  });

  // Coach: take back (undo user move + opponent reply if present)
  on(byId('btn-coach-takeback'), 'click', function() {
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
    byId('coach-status').classList.remove('status-ended');
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
    hideEl(byId('coach-review'));
    hideEl(byId('threats-section'));
    hideEl(byId('candidates-section'));
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
  on(byId('btn-coach-showbest'), 'click', function() {
    startCoachReviewAnalysis(coachLastReview);
  });
  on(byId('btn-coach-showwhy'), 'click', function() {
    startCoachReviewAnalysis(coachLastReview);
  });
  on(byId('btn-coach-consequence'), 'click', function() { startCoachConsequenceAnalysis(coachLastReview); });
  on(byId('btn-coach-review-analysis-prev'), 'click', function() { stepCoachReviewAnalysis(-1); });
  on(byId('btn-coach-review-analysis-next'), 'click', function() { stepCoachReviewAnalysis(1); });
  on(byId('btn-coach-backtogame'), 'click', function() {
    clearCoachReviewAnalysis();
    coachGotoLive();
  });

  // Coach: show top-3 candidate moves
  on(byId('btn-coach-candidates'), 'click', function() {
    if (!coachMode || !coachGame) return;
    if (coachIsReviewing()) return;
    showCandidates();
  });

  // Coach: history navigation
  on(byId('btn-coach-prev'), 'click', function() {
    if (!coachGame) return;
    const total = coachGame.history().length;
    const cur = coachReviewCursor === null ? total : coachReviewCursor;
    if (cur > 0) coachGotoPly(cur - 1);
  });
  on(byId('btn-coach-next'), 'click', function() {
    if (!coachGame) return;
    const total = coachGame.history().length;
    const cur = coachReviewCursor === null ? total : coachReviewCursor;
    if (cur < total) coachGotoPly(cur + 1);
  });
  on(byId('btn-coach-live'), 'click', function() {
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
  on(byId('btn-coach-copypgn'), 'click', async function() {
    const btn = this;
    const pgn = coachGetPgn();
    if (!pgn) return;
    try {
      await copyToClipboard(pgn);
      btn.classList.add('copied');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.classList.remove('copied'); btn.textContent = 'Copy PGN'; }, 1500);
    } catch (e) {
      btn.textContent = 'Copy unavailable';
      setTimeout(() => { btn.textContent = 'Copy PGN'; }, 1500);
    }
  });
  // Coach: Copy FEN of the position currently displayed (respects review cursor).
  on(byId('btn-coach-copyfen'), 'click', async function() {
    const btn = this;
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
      btn.classList.add('copied');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.classList.remove('copied'); btn.textContent = 'Copy FEN'; }, 1500);
    } catch (e) {
      btn.textContent = 'Copy unavailable';
      setTimeout(() => { btn.textContent = 'Copy FEN'; }, 1500);
    }
  });

  // Coach: click a ply in the move list to jump to that position.
  on(document, 'click', '#movelist .ply', function() {
    const ply = parseInt(this.getAttribute('data-ply'), 10);
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
  on(document, 'keydown', function(e) {
    if (!coachMode || !coachGame || coachPracticeSession || e.defaultPrevented ||
        isVisible(qsa('#summary-overlay, #promotion-picker'))) return;
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
  on(byId('btn-summary-newgame'), 'click', function() {
    closeSummaryOverlay();
    startCoachGame();
  });
  on(byId('btn-summary-practice'), 'click', function() {
    const item = summaryPracticeItems[0];
    if (!item) return;
    closeSummaryOverlay();
    startCoachPracticeSession(summaryPracticeItems, item);
  });
  on(byId('btn-summary-close'), 'click', function() {
    closeSummaryOverlay();
  });
  // Reopen the review summary once the game has ended.
  on(byId('btn-coach-openreview'), 'click', function() {
    if (!coachLastEndMsg) return;
    showPostGameSummary(coachLastEndMsg);
  });
  // Copy PGN from within the summary — shares logic with the move-list copy button.
  on(byId('btn-summary-copypgn'), 'click', async function() {
    const btn = this;
    const pgn = coachGetPgn();
    if (!pgn) return;
    try {
      await copyToClipboard(pgn);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy PGN'; }, 1500);
    } catch (e) {
      btn.textContent = 'Copy unavailable';
      setTimeout(() => { btn.textContent = 'Copy PGN'; }, 1500);
    }
  });
  // Click a critical/best moment to close the overlay and jump to that position.
  on(document, 'click', '.moment-row', function() {
    const ply = parseInt(this.dataset.ply, 10);
    if (!Number.isInteger(ply)) return;
    closeSummaryOverlay();
    coachGotoPly(ply);
    // Surface the "Open review" button so the user can get back to the summary.
    updateCoachControlsState();
  });
  // Allow pressing Escape to dismiss the summary overlay.
  on(document, 'keydown', function(e) {
    const summary = document.getElementById('summary-overlay');
    if (!summary || !isVisible(byId('summary-overlay'))) return;
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
  on(qsa('.db-btn'), 'click', function() {
    currentDb = this.dataset.db;
    qsa('.db-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });
    this.classList.add('active');
    this.setAttribute('aria-pressed', 'true');
    if (exploreMode) fetchExploreData();
  });

  // Explore: token save
  on(byId('lichess-token-form'), 'submit', function(event) {
    event.preventDefault();
    const token = byId('lichess-token-input').value.trim();
    const tokenError = byId('token-error');
    const showTokenError = message => {
      tokenError.textContent = message;
      showEl(tokenError);
    };
    if (!token) {
      showTokenError('Paste a Lichess token first.');
      byId('lichess-token-input').focus();
      return;
    }
    hideEl(tokenError);
    // While the token is checked the Connect button says so; the field stays.
    const button = byId('btn-save-token');
    const setBusy = busy => {
      button.disabled = busy;
      button.textContent = busy ? 'Checking…' : 'Connect';
    };
    setBusy(true);
    lichessExplorerGet('https://explorer.lichess.ovh/lichess',
      { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', topGames: 0, recentGames: 0 }, token).then(() => {
      setBusy(false);
      if (!setLichessToken(token)) {
        showTokenError('Could not store token for this tab. Check browser storage settings.');
        return;
      }
      showExploreTokenState();
      fetchExploreData();
    }, error => {
      setBusy(false);
      const msg = error.status === 401
        ? 'Invalid token — check you copied it correctly.'
        : (error.status === 429 ? LICHESS_RATE_LIMIT_MESSAGE : 'Could not reach Lichess. Try again.');
      showTokenError(msg);
    });
  });

  // Explore: disconnect Lichess
  on(byId('btn-disconnect-lichess'), 'click', function() {
    clearLichessToken();
    exploreCache.clear();
    byId('lichess-token-input').value = '';
    showExploreTokenState();
  });

  // Explore: undo last move
  on(byId('btn-explore-undo'), 'click', function() {
    if (!exploreMode || !exploreGame) return;
    if (exploreGame.fen() === exploreStartFen) return; // already at start
    exploreGame.undo();
    board.position(exploreGame.fen());
    librarySyncLastMove(exploreGame);
    fetchExploreData();
  });

  // Explore: reset to opening end position (or initial if no opening)
  on(byId('btn-explore-reset'), 'click', function() {
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
  on(window, 'resize', function() {
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
    const activeTab = qs('.cat-tab.active');
    const activeCat = (activeTab && activeTab.dataset.cat) || 'all';
    let visibleCount = 0;
    // When searching, ignore category filter and flatten view
    qsa('.library > .library-section').forEach(sec => {
      let secVisible = 0;
      qsa('.opening-btn', sec).forEach(btn => {
        const id = btn.dataset.id;
        const op = OPENINGS.find(o => o.id === id);
        const hay = ((btn.textContent || '') + ' ' + (op ? op.moves.join(' ') : '')).toLowerCase();
        const matchesQuery = !q || hay.includes(q);
        const matchesCat = q ? true : (activeCat === 'all' || op?.category === activeCat);
        const show = matchesQuery && matchesCat;
        toggleEl(btn, show);
        if (show) { secVisible++; visibleCount++; }
      });
      toggleEl(sec, secVisible > 0);
    });
    toggleEl(byId('library-empty'), visibleCount === 0);
    toggleEl(qsa('.cat-tabs'), !q);
    // Hide the SR due section while searching
    if (q) hideEl(byId('sr-due-section'));
    else updateSRSidebar();
  };
  on(byId('library-search-input'), 'input', function() { applySearch(this.value); });

  // ─── SHARE LINK ─────────────────────────
  on(byId('btn-share'), 'click', function() {
    const btn = this;
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      const original = btn.textContent;
      btn.textContent = 'Copy unavailable';
      setTimeout(() => { btn.textContent = original; }, 1500);
      return;
    }
    navigator.clipboard.writeText(location.href).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied ✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
    }).catch(() => {
      const original = btn.textContent;
      btn.textContent = 'Copy unavailable';
      setTimeout(() => { btn.textContent = original; }, 1500);
    });
  });

  // ─── KEYBOARD SHORTCUTS ─────────────────
  on(document, 'keydown', function (e) {
    if (e.defaultPrevented || isVisible(byId('summary-overlay'))) return;
    if (isVisible(byId('promotion-picker'))) {
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
      const usable = id => { const b = qs(id); return !!b && isVisible(b) && !b.disabled; };
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        byId('btn-coach-flip').click();
      } else if (e.key === 'ArrowLeft' && usable('#btn-coach-prev')) {
        e.preventDefault();
        byId('btn-coach-prev').click();
      } else if (e.key === 'ArrowRight' && usable('#btn-coach-next')) {
        e.preventDefault();
        byId('btn-coach-next').click();
      } else if (e.key === 'Home' && usable('#btn-coach-prev') && coachGame && coachGame.history().length) {
        e.preventDefault();
        coachGotoPly(0);
      } else if (e.key === 'End' && usable('#btn-coach-live')) {
        e.preventDefault();
        byId('btn-coach-live').click();
      }
      return;
    }

    // Arrow keys: prev/next in study mode
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (quizMode || exploreMode) return;
      e.preventDefault();
      if (!byId('btn-next').disabled) goToMove(currentMoveIdx + 1);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (quizMode || exploreMode) return;
      e.preventDefault();
      if (!byId('btn-prev').disabled) goToMove(currentMoveIdx - 1);
      return;
    }

    const k = e.key.toLowerCase();
    // Focus search
    if (k === '/' ) { e.preventDefault(); byId('library-search-input').focus(); byId('library-search-input').select(); return; }
    // Flip board
    if (k === 'f') {
      if (!currentOpening && !exploreMode) return;
      e.preventDefault();
      if (exploreMode) { boardFlipped = !boardFlipped; board.flip(); return; }
      byId('btn-flip').click();
      return;
    }
    // Reset
    if (k === 'r') {
      e.preventDefault();
      if (exploreMode) { byId('btn-explore-reset').click(); return; }
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
  on(qsa('.board-area'), 'touchstart', function(e) {
    if (quizMode || exploreMode) return;
    if (e.touches.length !== 1) return;
    // The phone layout puts the notation strip here; swiping it scrolls it.
    const target = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (target && target.closest('#library-moves, .notation-strip')) { touchStartX = touchStartY = null; return; }
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  });
  on(qsa('.board-area'), 'touchend', function(e) {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = touchStartY = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (quizMode || exploreMode) return;
    if (dx < 0) { if (!byId('btn-next').disabled) goToMove(currentMoveIdx + 1); }
    else { if (!byId('btn-prev').disabled) goToMove(currentMoveIdx - 1); }
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
