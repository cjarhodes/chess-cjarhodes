// Saving and restoring the in-progress Coach game, scoped per account.
// Classic script loaded before app.js (see index.html); its top-level
// declarations are shared globals, as they were inside app.js.

// ─────────────────────────────────────────────
// COACH GAME PERSISTENCE
// ─────────────────────────────────────────────
// Snapshot enough state to restore an in-progress (or freshly ended) game on
// next page load. Saved on every move; cleared when the user starts a new
// game or dismisses the review summary after a game ends.
let coachPendingReview = null;
let coachContinuityCopy = false;
// Set by a take-back; a game with any take-back is unrated.
let coachTakebackUsed = false;
const COACH_STATE_KEY = 'coach:state:v1';
const COACH_STATE_BACKUP_KEY = 'coach:state:corrupt:v1';
const COACH_PRACTICE_RETURN_KEY = 'coach:practice-return:v1';
const COACH_PRACTICE_STATE_KEY = 'coach:practice-state:v1';

function cloneCoachValue(value, fallback) {
  try { return value == null ? fallback : JSON.parse(JSON.stringify(value)); }
  catch (e) { return fallback; }
}

// Practice temporarily borrows the board. Keep the live game in its own
// recoverable snapshot so entering a drill cannot erase a user's analysis,
// review log, or opponent settings. Ended games are deliberately excluded:
// practice should not make an ended game look live when it closes.
function captureCoachPracticeReturnState() {
  if (!coachGame || !coachGameActive || coachGame.game_over()) return null;
  return {
    v: 1,
    owner: coachMemoryOwnerId(),
    pgn: coachGame.pgn(),
    startFen: coachStartFen,
    openingTransfer: cloneCoachValue(coachOpeningTransfer, null),
    userSide: coachUserSide,
    engineElo: coachEngineElo,
    localGameId: coachLocalGameId,
    continuityCopy: coachContinuityCopy,
    takebackUsed: coachTakebackUsed,
    remoteGameId: coachRemoteGameId,
    reviewLog: cloneCoachValue(coachReviewLog, []),
    stats: cloneCoachValue(coachStats, null),
    reviewCursor: coachReviewCursor,
    lastEndMsg: coachLastEndMsg,
    endedAt: coachEndedAt,
    boardFlipped: coachBoardFlipped,
    dailySprint: typeof dailySprintToday === 'function' ? cloneCoachValue(dailySprintToday(), null) : null,
    ts: Date.now()
  };
}

function persistCoachPracticeReturnState(snapshot) {
  try {
    if (snapshot) localStorage.setItem(coachMemoryKey(COACH_PRACTICE_RETURN_KEY), JSON.stringify(snapshot));
    else localStorage.removeItem(coachMemoryKey(COACH_PRACTICE_RETURN_KEY));
    if (typeof queueAccountCheckpoint === 'function') queueAccountCheckpoint();
  } catch (e) { /* recovery is best effort */ }
}

// Keep drill recovery separate from the rated-game snapshot. Only stable
// state is saved: workers, pending promises, and speculative moves are rebuilt.
function clearCoachPracticeState(owner = coachMemoryOwnerId()) {
  try { localStorage.removeItem(`${COACH_PRACTICE_STATE_KEY}:${owner}`); } catch (e) {}
}

function loadCoachPracticeState() {
  try {
    const raw = localStorage.getItem(coachMemoryKey(COACH_PRACTICE_STATE_KEY));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || saved.v !== 1 || saved.owner !== coachMemoryOwnerId()) throw new Error('Invalid practice owner');
    return saved;
  } catch (e) {
    return { invalid: true };
  }
}

function saveCoachPracticeState() {
  const session = coachPracticeSession;
  if (!session || !coachGame || session.owner !== coachMemoryOwnerId()) return;
  const stable = {};
  ['item', 'misses', 'revealed', 'hintUsed', 'completed', 'completionRecorded', 'hintStage',
    'phase', 'expectedUci', 'initialExpectedUci'].forEach(key => { stable[key] = session[key]; });
  try {
    localStorage.setItem(coachMemoryKey(COACH_PRACTICE_STATE_KEY), JSON.stringify({
      v: 1, owner: session.owner, session: stable, run: coachPracticeRun,
      pgn: coachGame.pgn(), fen: coachGame.fen(), returnState: coachPracticeReturnState,
      boardFlipped: coachBoardFlipped,
      prompt: $('#coach-practice-prompt').text(), status: $('#coach-practice-status').text(), ts: Date.now()
    }));
    if (typeof queueAccountCheckpoint === 'function') queueAccountCheckpoint();
    return true;
  } catch (e) {
    setCoachStatus('Practice is available, but this browser could not save its resume point.');
    return false;
  }
}

// Auth restoration is asynchronous. Checkpoint the outgoing local owner
// before selecting the incoming owner's resume points. Token refreshes for
// the same user leave the board untouched.
function applyCoachRecoveryUser(user) {
  const previousOwner = coachMemoryOwnerId();
  const nextOwner = user && user.id ? `user:${user.id}` : `anon:${coachDeviceId()}`;
  if (previousOwner === nextOwner) { coachAuthUser = user || null; return; }
  saveCoachState();
  saveCoachPracticeState();
  coachAuthUser = user || null;
  if (typeof recoverContinuityWrites === 'function') recoverContinuityWrites();
  coachRemoteInsightEntries = null;
  coachRemoteInsightsLoaded = false;
  if (previousOwner.startsWith('anon:') && nextOwner.startsWith('user:')) {
    // Adopt guest recovery only if this account has no corresponding resume
    // point. Never move recovery between two signed-in users.
    [COACH_STATE_KEY, COACH_PRACTICE_STATE_KEY, COACH_PRACTICE_RETURN_KEY].forEach(base => {
      try {
        const oldKey = `${base}:${previousOwner}`;
        const newKey = `${base}:${nextOwner}`;
        const raw = localStorage.getItem(oldKey);
        if (!raw || localStorage.getItem(newKey)) return;
        const saved = JSON.parse(raw);
        if (saved.owner) saved.owner = nextOwner;
        if (saved.returnState) saved.returnState.owner = nextOwner;
        [saved.openingTransfer, saved.returnState && saved.returnState.openingTransfer].forEach(transfer => {
          if (!transfer || transfer.owner !== previousOwner) return;
          transfer.owner = nextOwner;
          if (transfer.returnState && transfer.returnState.owner === previousOwner) transfer.returnState.owner = nextOwner;
        });
        localStorage.setItem(newKey, JSON.stringify(saved));
        localStorage.removeItem(oldKey);
      } catch (e) { /* retain the outgoing copy when adoption cannot finish */ }
    });
  }
  resetCoachState();
  coachPracticeReturnState = null;
  coachPracticeRun = null;
  coachGame = null;
  coachGameActive = false;
  if (coachMode) switchView('coach');
}

function renderCoachPracticeNextAction() {
  if (!coachPracticeSession || !coachPracticeSession.completed || !coachPracticeRun) return;
  const sprint = dailySprintToday();
  const hasNext = coachPracticeRun.index + 1 < coachPracticeRun.items.length;
  const transfer = !hasNext && sprint && !sprint.completedAt && sprint.mode === 'adaptive' && sprint.phase === 'moves';
  $('#btn-coach-practice-next').text(hasNext ? 'Next drill' : coachPracticeSession.item.id.startsWith('opening-bridge:') ? 'Continue this opening in play' : (transfer ? 'Continue to live play' : coachPracticeReturnState ? 'Return to saved game' : 'Choose another lesson')).show().prop('disabled', false);
}

function tryRestoreCoachPractice() {
  const saved = loadCoachPracticeState();
  if (!saved) return { restored: false };
  try {
    const stable = saved.session;
    const item = stable && stable.item;
    if (!item || !item.entry || !isValidFen(item.entry.fenBefore) || !item.entry.bestUci) throw new Error('Invalid drill');
    const position = loadCoachSavedPosition({startFen: item.entry.fenBefore, pgn: saved.pgn, fen: saved.fen});
    if (!stable.completed && !moveFromUci(saved.fen, stable.expectedUci)) throw new Error('Invalid practice answer');
    if (!saved.run || !Array.isArray(saved.run.items) || !Number.isInteger(saved.run.index) || saved.run.index < 0 ||
        saved.run.index >= saved.run.items.length || saved.run.items[saved.run.index].id !== item.id) throw new Error('Invalid drill run');
    if (!['initial', 'followup', 'complete'].includes(stable.phase) || !Number.isFinite(stable.misses) || stable.misses < 0 ||
        !Number.isFinite(stable.hintStage) || stable.hintStage < 0 || stable.hintStage > 4 ||
        (!!stable.completed !== !!stable.completionRecorded)) throw new Error('Invalid drill progress');
    resetCoachState(item.entry.fenBefore, { preservePracticeRun: true });
    coachGame = position;
    coachPracticeReturnState = saved.returnState || null;
    coachPracticeRun = saved.run;
    coachPracticeSession = Object.assign({}, stable, {
      owner: saved.owner, positionFen: position.fen(), requestId: coachGameGeneration,
      analysis: null, analysisReady: false, analysisPromise: null, analysisToken: 0,
      pendingMove: null, grading: false
    });
    coachUserSide = fenSideToUserSide(item.entry.fenBefore);
    coachGameActive = true;
    coachBoardFlipped = !!saved.boardFlipped;
    createCoachBoard(position.fen(), coachBoardFlipped ? 'black' : 'white');
    $('#coach-view').addClass('game-active');
    CoachController.setPhase('practice');
    $('#coach-practice-title').text(item.meta.title);
    $('#coach-practice-session-status').text(practiceRunPositionText());
    $('#coach-practice-prompt').text(saved.prompt || practicePromptForItem(item));
    $('#coach-practice-status').text(saved.status || 'Continue from this position.');
    $('#btn-coach-practice-answer').text('Show answer').prop('disabled', stable.completed || stable.revealed);
    $('#btn-coach-practice-hint').text('Hint').show().prop('disabled', stable.completed || stable.revealed);
    $('#btn-coach-practice-next').hide().prop('disabled', true);
    $('#coach-practice-takeaway').text(stable.completed ? `Carry into your next game: ${practiceCarryForwardCue(item)}` : '').toggle(!!stable.completed);
    $('#coach-practice-banner').show().css('display', 'flex');
    setPracticeFocus(true);
    renderCoachPracticeNextAction();
    updateCapturedDisplay(position.fen());
    updateMoveList();
    updateCoachControlsState();
    renderCoachDailyPlan();
    focusPracticeTarget();
    setCoachStatus(stable.completed ? 'Practice restored — your result is already saved. Continue when ready.' : 'Practice restored — continue from your saved position.');
    if (!stable.completed) preparePracticeAnalysis(coachPracticeSession);
    return { restored: true };
  } catch (e) {
    clearCoachPracticeState();
    return { restored: false, warning: 'The interrupted drill could not be restored. Coach will use any saved game and practice results it can read.' };
  }
}

function loadCoachSavedPosition(snapshot) {
  if (snapshot.startFen && !isValidFen(snapshot.startFen)) throw new Error('Invalid starting position');
  const position = new Chess(snapshot.startFen || undefined);
  // chess.js 0.10 rejects header-only PGN and resets to the standard board.
  // An explicitly started custom game/drill with zero moves uses its start FEN.
  const moveText = String(snapshot.pgn || '').replace(/\[[^\]]*\]/g, '').trim();
  if (moveText && moveText !== '*' && position.load_pgn(snapshot.pgn, { sloppy: true }) === false) throw new Error('Invalid saved moves');
  if (snapshot.fen && position.fen() !== snapshot.fen) throw new Error('Saved position mismatch');
  return position;
}

function restoreCoachPracticeReturnState(snapshot) {
  if (!snapshot || !snapshot.pgn && !snapshot.startFen) return false;
  if (snapshot.owner && snapshot.owner !== coachMemoryOwnerId()) return false;
  try {
    invalidateCoachAsyncWork('The practice drill ended. Restoring the live game.');
    const restored = loadCoachSavedPosition(snapshot);
    if (restored.game_over()) return false;
    coachGame = restored;
    coachStartFen = snapshot.startFen || restored.fen();
    coachOpeningTransfer = typeof normalizeOpeningTransfer === 'function' ? normalizeOpeningTransfer(snapshot.openingTransfer) : null;
    coachGameGeneration++;
    coachLocalGameId = snapshot.localGameId || createCoachGameId();
    coachContinuityCopy = !!snapshot.continuityCopy;
    coachTakebackUsed = !!snapshot.takebackUsed;
    coachRemoteGameId = snapshot.remoteGameId || null;
    coachUserSide = snapshot.userSide || 'white';
    coachEngineElo = typeof snapshot.engineElo === 'number' ? snapshot.engineElo : coachEngineElo;
    coachReviewLog = Array.isArray(snapshot.reviewLog) ? snapshot.reviewLog : [];
    coachStats = snapshot.stats || { moves: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    coachLastReview = coachReviewLog.length ? coachReviewLog[coachReviewLog.length - 1] : null;
    coachReviewCursor = null;
    coachLastEndMsg = null;
    coachEndedAt = null;
    coachThinking = false;
    coachGameActive = true;
    coachLifetimeRolledForThisGame = false;
    $('#coach-strength').val(coachEngineElo);
    $('#coach-strength-value').text(coachEngineElo);
    $('#coach-strength-tier').text(strengthTierLabel(coachEngineElo));
    $('.side-toggle button').removeClass('active').attr('aria-pressed', 'false');
    $('.side-toggle button[data-side="' + coachUserSide + '"]').addClass('active').attr('aria-pressed', 'true');
    coachBoardFlipped = typeof snapshot.boardFlipped === 'boolean'
      ? snapshot.boardFlipped
      : coachUserColor() === 'black';
    createCoachBoard(restored.fen(), coachBoardFlipped ? 'black' : 'white');
    $('#coach-view').addClass('game-active');
    updateCapturedDisplay(restored.fen());
    updateMoveList();
    updateOpeningLabel();
    updateCoachSummary();
    updateCoachControlsState();
    renderCoachReview(coachLastReview);
    setCoachStatus(coachIsUserTurn() ? (coachContinuityCopy ? 'Continued copy (unrated). Your move.' : 'Your game is restored. Your move.') : (coachContinuityCopy ? 'Continued copy (unrated). Opponent thinking…' : 'Your game is restored. Opponent thinking…'));
    saveCoachState();
    persistCoachPracticeReturnState(null);
    return true;
  } catch (e) {
    return false;
  }
}

function createCoachGameId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveCoachState() {
  try {
    if (!coachGame) return;
    // Practice attempts have their own persistence model and must never be
    // restored as unfinished rated games.
    if (coachPracticeSession) return;
    const total = coachGame.history().length;
    // Skip persisting empty initial state — nothing to recover.
    if (total === 0 && !coachGameActive && !coachLastEndMsg && !coachRemoteGameId) {
      localStorage.removeItem(coachMemoryKey(COACH_STATE_KEY));
      return;
    }
    const snapshot = {
      v: 1,
      pgn: coachGame.pgn(),
      fen: coachGame.fen(),
      startFen: coachStartFen,
      openingTransfer: cloneCoachValue(coachOpeningTransfer, null),
      userSide: coachUserSide,
      engineElo: coachEngineElo,
      localGameId: coachLocalGameId,
      continuityCopy: coachContinuityCopy,
      takebackUsed: coachTakebackUsed,
      remoteGameId: coachRemoteGameId,
      reviewLog: coachReviewLog,
      pendingReview: coachPendingReview,
      boardFlipped: coachBoardFlipped,
      stats: coachStats,
      ended: !coachGameActive,
      lastEndMsg: coachLastEndMsg,
      ts: Date.now()
    };
    localStorage.setItem(coachMemoryKey(COACH_STATE_KEY), JSON.stringify(snapshot));
    if (typeof queueAccountCheckpoint === 'function') queueAccountCheckpoint();
    return true;
  } catch (e) {
    // Keep play available, but let backup export detect an unsaved latest move.
    return false;
  }
}
function loadCoachState() {
  let raw = null;
  try {
    raw = localStorage.getItem(coachMemoryKey(COACH_STATE_KEY));
    if (!raw) return { ok: false, missing: true };
    const s = JSON.parse(raw);
    if (!s || s.v !== 1) {
      return { ok: false, reason: 'Saved game format is no longer supported.', raw };
    }
    return { ok: true, state: s, raw };
  } catch (e) {
    return { ok: false, reason: 'Saved game data was unreadable.', raw };
  }
}
function clearCoachState() {
  try { localStorage.removeItem(coachMemoryKey(COACH_STATE_KEY)); } catch (e) {}
}
function backupCorruptCoachState(raw, reason) {
  if (!raw) return;
  try {
    localStorage.setItem(coachMemoryKey(COACH_STATE_BACKUP_KEY), JSON.stringify({
      raw,
      reason: reason || 'Unknown restore failure',
      ts: Date.now()
    }));
  } catch (e) {}
}

// Restore a saved game (in-progress or just-ended) into the coach UI.
// Returns true if a game was restored, false otherwise. Callers should fall
// back to the empty-board "set a level" state when this returns false.
function tryRestoreCoachGame() {
  const loaded = loadCoachState();
  if (!loaded.ok) {
    if (loaded.missing) return { restored: false };
    backupCorruptCoachState(loaded.raw, loaded.reason);
    clearCoachState();
    return { restored: false, warning: 'Previous game could not be restored; starting fresh.' };
  }
  const s = loaded.state;
  try {
    const g = loadCoachSavedPosition(s);
    let pending = s.pendingReview || null;
    if (pending && !(s.reviewLog || []).some(review => review.ply === pending.ply && review.userUci === pending.userUci)) {
      if (g.fen() !== pending.fenAfter || g.history().length !== pending.ply) throw new Error('Interrupted move mismatch');
      const undone = g.undo();
      if (!undone || uciFromMove(undone) !== pending.userUci || g.fen() !== pending.fenBefore) throw new Error('Interrupted move was invalid');
    } else pending = null;
    coachPendingReview = null;
    coachGame = g;
    coachStartFen = s.startFen || g.fen();
    coachOpeningTransfer = typeof normalizeOpeningTransfer === 'function' ? normalizeOpeningTransfer(s.openingTransfer) : null;
    coachGameGeneration++;
    coachLocalGameId = s.localGameId || createCoachGameId();
    coachContinuityCopy = !!s.continuityCopy;
    coachTakebackUsed = !!s.takebackUsed;
    coachUserSide = s.userSide || 'white';
    coachEngineElo = typeof s.engineElo === 'number' ? s.engineElo : 1200;
    coachRemoteGameId = s.remoteGameId || null;
    coachReviewLog = Array.isArray(s.reviewLog) ? s.reviewLog : [];
    coachStats = s.stats || { moves: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    coachLastReview = coachReviewLog.length ? coachReviewLog[coachReviewLog.length - 1] : null;
    coachReviewCursor = null;
    coachThinking = false;
    coachLastEndMsg = s.lastEndMsg || null;
    coachGameActive = !s.ended && !g.game_over();
    coachEndedAt = s.ended ? (s.ts || Date.now()) : null;
    // If we're restoring an ended game, lifetime totals were already rolled
    // when the game ended — don't double-count if the user opens the review.
    coachLifetimeRolledForThisGame = !!s.ended;
    if (s.ended) registerRestoredLifetimeRollup();
    // Sync slider + tier label.
    $('#coach-strength').val(coachEngineElo);
    $('#coach-strength-value').text(coachEngineElo);
    $('#coach-strength-tier').text(strengthTierLabel(coachEngineElo));
    // Sync side toggle.
    $('.side-toggle button').removeClass('active');
    $('.side-toggle button').attr('aria-pressed', 'false');
    $('.side-toggle button[data-side="' + coachUserSide + '"]').addClass('active').attr('aria-pressed', 'true');
    // Build the board oriented for the user.
    coachBoardFlipped = typeof s.boardFlipped === 'boolean' ? s.boardFlipped : (coachUserColor() === 'black');
    createCoachBoard(g.fen(), coachBoardFlipped ? 'black' : 'white');
    $('#coach-view').addClass('game-active');
    // Repopulate panels.
    updateCapturedDisplay(g.fen());
    updateMoveList();
    updateOpeningLabel();
    updateCoachSummary();
    updateCoachControlsState();
    // Status: live game vs ended game.
    if (coachGameActive) {
      const tier = strengthTierLabel(coachEngineElo);
      setCoachStatus(coachIsUserTurn()
        ? `${coachContinuityCopy ? 'Continued copy (unrated)' : 'Resumed'} — Opponent ${coachEngineElo} (${tier}). Your move.`
        : `${coachContinuityCopy ? 'Continued copy (unrated)' : 'Resumed'} — Opponent ${coachEngineElo} (${tier}). Opponent thinking…`);
      // Re-render last review card if we have one.
      if (coachLastReview) renderCoachReview(coachLastReview);
      if (pending) {
        // Replay only the interrupted user move through normal classification.
        // It was not counted in the saved stats/log, so it is credited once.
        coachHandleUserMove(pending.userUci.slice(0, 2), pending.userUci.slice(2, 4), pending.userUci[4] || 'q');
        return { restored: true };
      }
      // Pre-warm the engine and hand off to the opponent if it's their turn.
      const timed = Promise.race([
        engineClient.init(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Engine load timed out')), 15000))
      ]);
      const generation = coachGameGeneration;
      timed.then(() => {
        if (generation !== coachGameGeneration || !coachGameActive) return;
        if (!coachIsUserTurn() && !g.game_over()) coachOpponentRespond();
      }).catch((err) => {
        if (generation !== coachGameGeneration || isAbortError(err)) return;
        showEngineLoadError(err);
      });
    } else {
      // Game is over — show a status that nudges towards reopening the review.
      setCoachStatus((coachLastEndMsg || 'Game over.') + ' Click Open review to revisit.');
      if (coachLastReview) renderCoachReview(coachLastReview);
    }
    return { restored: true };
  } catch (e) {
    // Corrupted snapshot — drop it so the user gets a fresh start next time.
    backupCorruptCoachState(loaded.raw, e && e.message);
    clearCoachState();
    return { restored: false, warning: 'Previous game could not be restored; starting fresh.' };
  }
}
