// Coach practice: drills on positions from your own mistakes. Choosing
// and ordering a run, practice focus in the rails, grading a move with
// the engine, hints, revealing the answer, advancing and leaving. The
// queue and scheduling are in src/coach/practice.js and sync in
// src/data/practice-sync.js.
// Classic script (see index.html): its top-level declarations are shared
// globals with src/, the other view scripts, growth.js and the feature
// modules, as they were inside app.js. Nothing here runs at load except
// plain initialisers, so the view scripts can call each other freely.

function distinctPracticeItems(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    if (!item || !item.entry) return false;
    const key = `${item.entry.fenBefore.split(/\s+/).slice(0, 4).join(' ')}|${item.entry.bestUci}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function practiceRecommendation() {
  const due = orderedPracticeRunItems(Array.from(renderedPracticeItems.values()));
  if (due.length) return { items: due, title: due[0].meta.title,
    detail: `${due.length} position${due.length === 1 ? '' : 's'} from your games. Revisit the decision, then take the idea back into play.`,
    label: `Start ${due.length}-position practice` };
  if (typeof ENDGAME_LESSONS === 'undefined') return null;
  const lesson = ENDGAME_LESSONS.find(row => !practiceRecordFor({ id: row.id })?.correct) || ENDGAME_LESSONS[0];
  const item = endgamePracticeItem(lesson);
  return { items: [item], title: lesson.title, detail: `One short lesson. ${lesson.detail}`,
    label: practiceRecordFor(item)?.correct ? 'Revisit this lesson' : 'Start this lesson' };
}

function renderPracticeRecommendation() {
  const recommendation = practiceRecommendation();
  if (!recommendation) return;
  $('#practice-start-title').text(recommendation.title);
  $('#practice-start-detail').text(recommendation.detail);
  $('#practice-start-context').text(coachGameActive ? 'Your game will be saved while you practise.' : 'Play a move, get feedback, then choose your next step.');
  $('#btn-practice-session-start').text(recommendation.label).prop('disabled', coachThinking);
}

function orderedPracticeRunItems(items, firstItem) {
  const unique = [];
  const seen = new Set();
  const ordered = distinctPracticeItems([firstItem].concat(items || []));
  ordered.forEach(item => {
    if (!item || seen.has(item.id) || !practiceIsDue(item)) return;
    seen.add(item.id);
    unique.push(item);
  });
  // While today's drills phase is open, size the run from the saved day:
  // the rendered plan is not rebuilt after a reload once a day exists.
  const sprint = dailySprintToday();
  const target = sprint && !sprint.completedAt && sprint.mode === 'adaptive' && sprint.phase === 'drills'
    ? (Number(sprint.drillTarget) || 0) - (Number(sprint.drillsCompleted) || 0)
    : renderedAdaptivePlan ? renderedAdaptivePlan.drillTarget : DAILY_DRILL_TARGET;
  return unique.slice(0, Math.max(1, target));
}

function startCoachPracticeSession(items, firstItem) {
  const runItems = orderedPracticeRunItems(items, firstItem || (items && items[0]));
  if (!runItems.length) {
    setCoachStatus('No practice drills are due right now.');
    return;
  }
  coachPracticeRun = {
    items: runItems,
    index: 0,
    completed: 0,
    clean: 0,
    assisted: 0,
    startedAt: Date.now()
  };
  beginDailyDrillSprint(runItems);
  startCoachPractice(runItems[0], { preserveRun: true });
}

function practiceRunPositionText() {
  if (!coachPracticeRun) return 'Single drill';
  return `Drill ${coachPracticeRun.index + 1} of ${coachPracticeRun.items.length}`;
}

// Practice focus: while a drill is active the rails drop everything that is
// not about the drill (play controls, setup groups, metrics, other tabs) and
// the right rail shows only the practice queue with the current drill marked.
function setPracticeFocus(active) {
  const $view = $('#coach-view');
  const wasActive = $view.hasClass('practice-active');
  $view.toggleClass('practice-active', !!active);
  if (active) showCoachPanel('practice');
  else if (wasActive) showCoachPanel('game');
  markActivePracticeRow();
}

function markActivePracticeRow() {
  $('.practice-row').removeClass('is-active');
  const item = coachPracticeSession && coachPracticeSession.item;
  if (!item) return;
  $('.practice-load[data-practice-id="' + item.id + '"]').closest('.practice-row').addClass('is-active');
}

function startCoachPractice(item, opts = {}) {
  if (coachThinking && !coachPracticeSession) {
    setCoachStatus('Wait for the current move to finish before starting practice.');
    return;
  }
  if (!item || !item.entry || !isValidFen(item.entry.fenBefore) || !item.entry.bestUci) {
    setCoachStatus('Practice position is no longer valid.');
    return;
  }
  if (!coachPracticeReturnState) {
    coachPracticeReturnState = captureCoachPracticeReturnState();
    persistCoachPracticeReturnState(coachPracticeReturnState);
    // Keep the normal game's local snapshot available during a refresh while
    // the practice board is borrowed.
    if (coachPracticeReturnState) saveCoachState();
  }
  if (!opts.preserveRun) {
    coachPracticeRun = {
      items: [item],
      index: 0,
      completed: 0,
      clean: 0,
      assisted: 0,
      startedAt: Date.now()
    };
  }
  resetCoachState(item.entry.fenBefore, { preservePracticeRun: true });
  coachPracticeSession = {
    owner: coachMemoryOwnerId(),
    item,
    misses: 0,
    revealed: false,
    hintUsed: false,
    completed: false,
    completionRecorded: false,
    hintStage: 0,
    phase: 'initial',
    expectedUci: item.entry.bestUci,
    initialExpectedUci: item.entry.bestUci,
    analysis: null,
    analysisReady: false,
    analysisPromise: null,
    pendingMove: null,
    positionFen: coachGame.fen(),
    analysisToken: 0,
    requestId: coachGameGeneration
  };
  coachUserSide = fenSideToUserSide(item.entry.fenBefore);
  coachGameActive = true;
  CoachController.setPhase('practice');
  coachBoardFlipped = coachUserColor() === 'black';
  createCoachBoard(coachGame.fen(), coachBoardFlipped ? 'black' : 'white');
  $('#coach-view').addClass('game-active');
  $('#coach-practice-title').text(item.meta.title);
  $('#coach-practice-prompt').text(practicePromptForItem(item));
  $('#coach-practice-session-status').text(practiceRunPositionText());
  $('#coach-practice-status').text('Choose your move. You can ask for a hint at any time.');
  $('#coach-practice-takeaway').hide().empty();
  $('#btn-coach-practice-answer').prop('disabled', false);
  $('#btn-coach-practice-answer').text('Show answer');
  $('#btn-coach-practice-hint').text('Hint').prop('disabled', false).show();
  $('#btn-coach-practice-next').hide().prop('disabled', true);
  $('#coach-practice-banner').show().css('display', 'flex');
  $('#coach-keyboard-move-status').text('');
  setCoachStatus('Play on the board or enter a move below.');
  updateCoachControlsState();
  renderCoachDailyPlan();
  setPracticeFocus(true);
  preparePracticeAnalysis(coachPracticeSession);
  saveCoachPracticeState();
  focusPracticeTarget();
}

function coachPracticeMoveLabel(item) {
  if (!item || !item.entry) return 'the best move';
  if (item.entry.bestSan) return item.entry.bestSan;
  const move = moveFromUci(item.entry.fenBefore, item.entry.bestUci);
  return move ? move.san : item.entry.bestUci;
}

function practicePositionIsCurrent(session) {
  return !!(session && (!session.owner || session.owner === coachMemoryOwnerId()) && coachPracticeSession === session && coachGame && coachGameActive &&
    session.requestId === coachGameGeneration && (!session.positionFen || session.positionFen === coachGame.fen()) && !session.completed);
}

function practiceAfterMoveScore(fen, result) {
  const after = new Chess(fen);
  if (after.in_checkmate()) return 10000;
  if (after.in_draw()) return 0;
  const score = practiceEngineScore(result);
  return score == null ? null : -score;
}

function practiceMoveIsMate(fen, uci) {
  if (!fen || !uci) return false;
  const position = new Chess(fen);
  const move = position.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  return !!(move && position.in_checkmate());
}

function preparePracticeAnalysis(session) {
  if (!session || session.analysisPromise) return session && session.analysisPromise;
  const fen = coachGame && coachGame.fen();
  const token = (session.analysisToken || 0) + 1;
  session.analysisToken = token;
  session.analysisPromise = engineClient.evaluate(fen, PRACTICE_ANALYSIS_DEPTH, { multipv: PRACTICE_MULTIPV })
    .then(result => {
      if (!practicePositionIsCurrent(session) || session.analysisToken !== token || session.positionFen !== fen) return null;
      const lines = (result && result.lines) || [];
      const bestLine = lines[0] || null;
      const bestUci = (bestLine && bestLine.pv && bestLine.pv[0]) || (result && result.bestmove) || null;
      const bestCp = bestLine ? scoreToCp(bestLine) : null;
      const known = {};
      lines.forEach(line => {
        const uci = line && line.pv && line.pv[0];
        if (uci) known[uci] = scoreToCp(line);
      });
      session.analysis = {
        fen,
        bestUci,
        bestCp,
        bestMate: bestLine && bestLine.mate != null ? bestLine.mate : null,
        known,
        candidatePvs: Object.fromEntries(lines.filter(line => line.pv && line.pv[0]).map(line => [line.pv[0], line.pv])),
        pv: bestLine && bestLine.pv ? bestLine.pv.slice() : []
      };
      session.analysisReady = true;
      return session.analysis;
    })
    .catch(err => {
      if (!practicePositionIsCurrent(session) || session.analysisToken !== token || session.positionFen !== fen) return null;
      // A timed-out engine must not turn every legal move into a false error.
      // The saved solution remains playable; alternatives require a reliable
      // score and therefore remain ungraded until a later retry: clearing the
      // promise lets the next attempt analyse the position again.
      session.analysis = { fen, bestUci: null, bestCp: null, known: {}, pv: [], error: err };
      session.analysisReady = true;
      session.analysisPromise = null;
      return session.analysis;
    });
  return session.analysisPromise;
}

async function evaluatePracticeMove(session, actualUci) {
  if (!practicePositionIsCurrent(session)) return { stale: true };
  const expected = session.expectedUci;
  const currentFen = coachGame.fen();
  // Mate is a board fact, so equivalent mating moves need no engine score.
  if (practiceMoveIsMate(currentFen, actualUci)) {
    return { sound: true, exact: practiceUciEqual(actualUci, expected), loss: 0 };
  }
  if (practiceMoveIsMate(currentFen, expected)) {
    return { sound: false, inaccurate: false, loss: 250 };
  }
  if (practiceUciEqual(actualUci, expected)) return { sound: true, exact: true, loss: 0 };
  const analysis = session.analysis || {};
  let replyUci = analysis.candidatePvs && analysis.candidatePvs[actualUci] && analysis.candidatePvs[actualUci][1];
  let candidateCp = analysis.known && analysis.known[actualUci];
  if (candidateCp == null && analysis.bestCp != null) {
    const temp = new Chess(coachGame.fen());
    const mv = temp.move({ from: actualUci.slice(0, 2), to: actualUci.slice(2, 4), promotion: actualUci[4] || 'q' });
    if (!mv) return { legal: false };
    const afterFen = temp.fen();
    const afterResult = await engineClient.evaluate(afterFen, PRACTICE_ANALYSIS_DEPTH, {});
    if (!practicePositionIsCurrent(session)) return { stale: true };
    candidateCp = practiceAfterMoveScore(afterFen, afterResult);
    replyUci = (afterResult.info && afterResult.info.pv && afterResult.info.pv[0]) || (afterResult.lines && afterResult.lines[0] && afterResult.lines[0].pv && afterResult.lines[0].pv[0]);
  }
  if (analysis.bestCp == null || candidateCp == null) return { unknown: true };
  const loss = Math.max(0, Math.round(analysis.bestCp - candidateCp));
  const candidatePosition = new Chess(coachGame.fen());
  const candidateMove = candidatePosition.move({
    from: actualUci.slice(0, 2),
    to: actualUci.slice(2, 4),
    promotion: actualUci[4] || 'q'
  });
  const candidateIsMate = !!(candidateMove && candidatePosition.in_checkmate());
  const expectedIsMate = practiceMoveIsMate(analysis.fen || coachGame.fen(), expected);
  const forcedMateMiss = (analysis.bestMate === 1 || expectedIsMate) && !candidateIsMate;
  return {
    sound: !forcedMateMiss && loss <= PRACTICE_SOUND_LOSS_CP,
    inaccurate: !forcedMateMiss && loss > PRACTICE_SOUND_LOSS_CP && loss <= PRACTICE_INACCURACY_LOSS_CP,
    loss: forcedMateMiss ? Math.max(loss, 250) : loss,
    replyUci
  };
}

function practiceContinuationFor(session, playedUci) {
  if (session.item && session.item.learningTransfer) return null;
  if (!practiceUciEqual(playedUci, session.initialExpectedUci)) return null;
  const authored = session.item && session.item.entry && session.item.entry.continuation;
  const authoredStep = Array.isArray(authored) ? authored[0] : null;
  if (authoredStep && authoredStep.opponentUci && authoredStep.followupUci) {
    const authoredPosition = new Chess(coachGame.fen());
    const opponent = authoredPosition.move({
      from: authoredStep.opponentUci.slice(0, 2),
      to: authoredStep.opponentUci.slice(2, 4),
      promotion: authoredStep.opponentUci[4] || undefined
    });
    const follow = opponent && authoredPosition.move({
      from: authoredStep.followupUci.slice(0, 2),
      to: authoredStep.followupUci.slice(2, 4),
      promotion: authoredStep.followupUci[4] || undefined
    });
    if (follow) return { opponentUci: authoredStep.opponentUci, followupUci: authoredStep.followupUci };
  }
  const pv = session.analysis && session.analysis.pv;
  if (!pv || pv.length < 3 || !practiceUciEqual(playedUci, pv[0])) return null;
  const opponentUci = pv[1];
  const followupUci = pv[2];
  const temp = new Chess(coachGame.fen());
  const opponent = temp.move({ from: opponentUci.slice(0, 2), to: opponentUci.slice(2, 4), promotion: opponentUci[4] || 'q' });
  if (!opponent) return null;
  const follow = temp.move({ from: followupUci.slice(0, 2), to: followupUci.slice(2, 4), promotion: followupUci[4] || 'q' });
  return follow ? { opponentUci, followupUci } : null;
}

function finishCoachPracticeMove(session, played, quality, revealed) {
  if (session.item.learningTransfer && typeof finishLearningTransferCheck === 'function') return finishLearningTransferCheck(session, played);
  if (session.completionRecorded) return;
  session.completed = true;
  session.completionRecorded = true;
  const assisted = !!(revealed || session.hintUsed);
  const record = recordPracticeAttempt(session.item, true, assisted);
  if (typeof recordRepertoirePracticeResult === 'function') {
    recordRepertoirePracticeResult(session.item, !assisted && session.misses === 0, assisted);
  }
  const sprint = recordDailySprintDrill(session.item, assisted, !assisted && session.misses === 0);
  const due = formatPracticeDue(record);
  $('#coach-practice-status').text(`${quality}: ${played.san}. ${due}.`);
  $('#coach-practice-prompt').text('Position solved. Carry the cue into your next game.');
  setCoachStatus(`${quality}. Practice progress saved.`);
  $('#coach-practice-takeaway').text(`Carry into your next game: ${practiceCarryForwardCue(session.item)}`).show();
  $('#btn-coach-practice-answer').prop('disabled', true);
  $('#btn-coach-practice-hint').prop('disabled', true);
  if (coachPracticeRun) {
    coachPracticeRun.completed += 1;
    if (assisted) coachPracticeRun.assisted += 1;
    else if (session.misses === 0) coachPracticeRun.clean += 1;
    const hasNext = coachPracticeRun.index + 1 < coachPracticeRun.items.length;
    const transferNext = !hasNext && sprint && !sprint.completedAt && sprint.mode === 'adaptive' && sprint.phase === 'moves';
    $('#btn-coach-practice-next')
      .text(hasNext ? 'Next drill' : session.item.id.startsWith('opening-bridge:') ? 'Continue this opening in play' : (transferNext ? 'Continue to live play' : coachPracticeReturnState ? 'Return to saved game' : 'Choose another lesson'))
      .show()
      .prop('disabled', false);
    if (!hasNext) $('#coach-practice-status').text(`${quality}: ${played.san}. Practice complete — ${coachPracticeRun.clean}/${coachPracticeRun.completed} first-try.${transferNext ? ' Next: use the same focus in live play.' : ''}`);
  }
  updateCoachControlsState();
  renderInsights();
  if (sprint && sprint.completedAt) renderCoachDailyPlan();
  saveCoachPracticeState();
  focusPracticeTarget();
}

function applyCoachPracticeMove(session, source, target, promotion, evaluation, opts) {
  if (!practicePositionIsCurrent(session)) return 'stale';
  const played = coachGame.move({ from: source, to: target, promotion: promotion || 'q' });
  if (!played) return 'snapback';
  const actualUci = uciFromMove(played);
  session.hintStage = 0;
  const continuation = !evaluation.revealed && practiceContinuationFor(session, actualUci);
  if (continuation && session.phase === 'initial') {
    const opponent = coachGame.move({
      from: continuation.opponentUci.slice(0, 2),
      to: continuation.opponentUci.slice(2, 4),
      promotion: continuation.opponentUci[4] || undefined
    });
    if (opponent) {
      session.phase = 'followup';
      session.expectedUci = continuation.followupUci;
      session.analysis = null;
      session.analysisReady = false;
      session.analysisPromise = null;
      session.analysisToken += 1;
      session.positionFen = coachGame.fen();
      session.requestId = coachGameGeneration;
      preparePracticeAnalysis(session);
      $('#coach-practice-prompt').text('Good first move. Now find the follow-up that keeps the advantage.');
      $('#coach-practice-status').text(`The opponent replies ${opponent.san}. Find your next move.`);
      $('#btn-coach-practice-answer').prop('disabled', false).text('Show answer');
      $('#btn-coach-practice-hint').prop('disabled', false).text('Hint').show();
    }
  } else {
    session.phase = 'complete';
    finishCoachPracticeMove(session, played, evaluation.sound && !evaluation.exact ? 'Sound alternative' : (session.revealed ? 'Solved after revealing the answer' : (session.hintUsed ? 'Solved with hints' : (session.misses ? `Correct after ${session.misses + 1} attempts` : 'Correct on the first try'))), !!evaluation.revealed);
  }
  if (opts && opts.updateBoard !== false && coachBoard) coachBoard.position(coachGame.fen());
  coachSyncLastMove();
  updateCapturedDisplay(coachGame.fen());
  updateCoachBoardAccessibility();
  updateMoveList();
  playSound(soundForMove(played, coachGame));
  saveCoachPracticeState();
  return 'correct';
}

function coachHandlePracticeMove(source, target, promotion, opts) {
  const session = coachPracticeSession;
  if (!session || session.completed || !coachGameActive || !coachGame) return 'snapback';
  const temp = new Chess(coachGame.fen());
  const move = temp.move({ from: source, to: target, promotion: promotion || 'q' });
  if (!move) return 'snapback';
  const actualUci = uciFromMove(move);
  // The last analysis failed: analyse again for this attempt, once (the
  // marked opts stop a second failure from retrying in a loop).
  if (session.analysis && session.analysis.error && !session.analysisPromise && !session.pendingMove && !session.grading &&
      !(opts && opts.analysisRetried)) {
    session.analysis = null;
    session.analysisReady = false;
    preparePracticeAnalysis(session);
    opts = Object.assign({}, opts, { analysisRetried: true });
  }
  if (session.pendingMove) {
    const pendingUci = session.pendingMove.source + session.pendingMove.target + (session.pendingMove.promotion || '');
    if (pendingUci === actualUci) return 'pending';
    return 'snapback';
  }
  const evaluate = () => evaluatePracticeMove(session, actualUci).catch(() => ({ unknown: true })).then(result => {
    if (!practicePositionIsCurrent(session)) return 'stale';
    if (result.unknown) {
      $('#coach-practice-status').text('Engine could not verify that candidate. Try again when analysis is ready.');
      setCoachStatus('Practice move was not scored.');
      return 'ungraded';
    }
    if (typeof recordLearningTransferDecision === 'function' && !recordLearningTransferDecision(session, actualUci, result)) return 'ungraded';
    if (result.sound) {
      return applyCoachPracticeMove(session, source, target, promotion, Object.assign({}, result, { revealed: session.revealed }), opts || {});
    }
    session.misses += 1;
    recordPracticeAttempt(session.item, false, false);
    $('#coach-practice-status').text(practiceMistakeFeedback(session, actualUci, result));
    setCoachStatus('Board reset. Compare another candidate.');
    focusPracticeTarget();
    saveCoachPracticeState();
    renderInsights();
    return 'snapback';
  });
  if (!session.analysisReady && session.analysisPromise) {
    if (session.grading) return 'pending';
    session.grading = true;
    renderCoachPresentation();
    session.pendingMove = { source, target, promotion, opts: opts || {} };
    $('#coach-practice-status').text('Checking the position…');
    return session.analysisPromise.then(() => {
      if (!practicePositionIsCurrent(session)) return 'stale';
      session.pendingMove = null;
      session.grading = false;
      return coachHandlePracticeMove(source, target, promotion, opts || {});
    }).finally(() => {
      session.grading = false;
      renderCoachPresentation();
    });
  }
  if (session.grading) return 'pending';
  session.grading = true;
  renderCoachPresentation();
  return evaluate().finally(() => {
    session.grading = false;
    renderCoachPresentation();
  });
}

function resumeCoachPracticeAfterNavigation() {
  const previous = coachPracticeSession;
  if (!previous || !coachGame || previous.owner !== coachMemoryOwnerId()) return;
  // A new object keeps a cancelled candidate search from becoming current
  // again when the player returns quickly from Library.
  coachPracticeSession = Object.assign({}, previous, {
    requestId: coachGameGeneration, positionFen: coachGame.fen(),
    analysis: null, analysisReady: false, analysisPromise: null,
    analysisToken: (previous.analysisToken || 0) + 1, pendingMove: null, grading: false
  });
  if (coachBoard) coachBoard.position(coachGame.fen(), false);
  coachSyncLastMove();
  updateCoachBoardAccessibility();
  CoachController.setPhase('practice');
  setPracticeFocus(true);
  setCoachStatus(previous.completed ? 'Practice saved. Choose your next step.' : 'Practice resumed. Continue from this position.');
  if (!previous.completed) preparePracticeAnalysis(coachPracticeSession);
  saveCoachPracticeState();
  focusPracticeTarget();
}

function focusPracticeTarget() {
  requestAnimationFrame(() => {
    if (!coachPracticeSession) return;
    const id = coachPracticeSession.completed ? 'btn-coach-practice-next'
      : document.getElementById('coach-keyboard-move')?.open ? 'coach-keyboard-move-input' : 'coachBoard';
    document.getElementById(id)?.focus({ preventScroll: true });
  });
}

function renderPracticeBoardCue() {
  if (!coachBoard) return;
  const session = coachPracticeSession;
  const move = session && !session.completed && session.hintStage >= 2 ? practiceMoveFor(coachGame.fen(), session.expectedUci) : null;
  coachBoard.setMarks('practice-cue-source', move ? [move.from] : []);
  coachBoard.setMarks('practice-cue-target', move && session.hintStage >= 3 ? [move.to] : []);
}

function practiceMistakeFeedback(session, uci, result) {
  const fen = coachGame.fen(), after = new Chess(fen);
  const move = after.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  if (!move) return 'Try another legal move.';
  if (after.in_stalemate()) return `${move.san} leaves no legal reply without giving check: stalemate is a draw. Leave the king a move, or find a checkmate.`;
  if (practiceMoveIsMate(fen, session.expectedUci)) return `${move.san} misses a mate in one. Look for a check, then count the king’s escapes, captures and blocks.`;
  const context = coachExplanationContext(fen, uci, session.expectedUci, after.fen(), result.replyUci ? { pv: [result.replyUci] } : null);
  return `${context.consequence || `${move.san} gives the opponent a stronger position than the best candidates.`} ${context.cue}`;
}

function revealCoachPracticeAnswer() {
  const session = coachPracticeSession;
  if (!session || session.completed) return;
  session.hintStage = 4;
  const text = practiceHintForSession(session, 4);
  if (!session.revealed) {
    session.revealed = true;
    // Record the reveal once. Completion is recorded separately, once, when
    // the requested move is finally played.
    recordPracticeAttempt(session.item, false, true);
    renderInsights();
  }
  $('#coach-practice-status').text(text);
  $('#btn-coach-practice-answer').prop('disabled', true);
  $('#btn-coach-practice-hint').prop('disabled', true);
  setCoachStatus('Practice answer revealed — now play the move.');
  saveCoachPracticeState();
}

function showCoachPracticeHint() {
  const session = coachPracticeSession;
  if (!session || session.completed) return;
  session.hintUsed = true;
  session.hintStage = Math.min(4, (session.hintStage || 0) + 1);
  const text = practiceHintForSession(session, session.hintStage);
  $('#coach-practice-status').text(text);
  if (session.hintStage >= 4) {
    if (!session.revealed) {
      session.revealed = true;
      recordPracticeAttempt(session.item, false, true);
      renderInsights();
    }
    $('#btn-coach-practice-hint').prop('disabled', true);
    $('#btn-coach-practice-answer').prop('disabled', true);
    setCoachStatus('Practice answer revealed — now play the move.');
  } else {
    $('#btn-coach-practice-answer').text('Show answer');
    setCoachStatus('Practice hint shown.');
  }
  saveCoachPracticeState();
}

function advanceCoachPractice() {
  if (!coachPracticeRun || !coachPracticeSession || !coachPracticeSession.completed) return;
  if (coachPracticeSession.item.learningTransfer && typeof continueLearningTransferPlay === 'function') {
    const id = coachPracticeSession.item.learningTransfer.recordId;
    exitCoachPractice('Different-position check saved.');
    continueLearningTransferPlay(id);
    return;
  }
  if (coachPracticeRun.index + 1 >= coachPracticeRun.items.length) {
    const completed = coachPracticeRun.completed;
    const clean = coachPracticeRun.clean;
    const openingItem = coachPracticeSession.item.id.startsWith('opening-bridge:') ? coachPracticeSession.item : null;
    const sprint = dailySprintToday();
    const transferNext = sprint && !sprint.completedAt && sprint.mode === 'adaptive' && sprint.phase === 'moves';
    exitCoachPractice(`Practice session complete — ${clean}/${completed} solved on the first try.`);
    if (openingItem && typeof beginOpeningTransfer === 'function') {
      beginOpeningTransfer(openingItem.entry.openingId, 'main', openingItem.entry.ply + (Array.isArray(openingItem.entry.continuation) && openingItem.entry.continuation.length ? 2 : 0));
      return;
    }
    if (!transferNext && !coachGameActive) showCoachPanel('practice');
    if (transferNext) {
      if (!coachGameActive) startCoachGame();
      else setCoachStatus(`Your game is restored. Use this focus: ${sprint.focusCue || sprint.focus}`);
      document.getElementById('coachBoard')?.focus({ preventScroll: true });
    }
    return;
  }
  coachPracticeRun.index += 1;
  startCoachPractice(coachPracticeRun.items[coachPracticeRun.index], { preserveRun: true });
}

function exitCoachPractice(message) {
  if (!coachPracticeSession) return;
  $('#coach-keyboard-move-status').text('');
  clearCoachPracticeState(coachPracticeSession.owner || coachMemoryOwnerId());
  const returnState = coachPracticeReturnState;
  coachPracticeSession = null;
  coachPracticeReturnState = null;
  coachPracticeRun = null;
  const restoredLive = !!(returnState && restoreCoachPracticeReturnState(returnState));
  if (restoredLive) {
    // The underlying game remains live and its PGN, review log, stats, side,
    // and local/remote identity are back in place.
    persistCoachPracticeReturnState(null);
    CoachController.setPhase(coachIsUserTurn() ? 'userTurn' : 'opponentThinking');
    setCoachStatus(message || (coachIsUserTurn() ? 'Your game is restored. Your move.' : 'Your game is restored. Opponent thinking…'));
    if (!coachIsUserTurn() && !coachGame.game_over()) coachOpponentRespond();
  } else {
    resetCoachState();
    coachGameActive = false;
    CoachController.setPhase('idle');
    createCoachBoard('start', 'white');
    $('#coach-view').removeClass('game-active');
    persistCoachPracticeReturnState(null);
  }
  $('#coach-practice-banner').hide();
  setPracticeFocus(false);
  if (!restoredLive) setCoachStatus(message || 'Practice closed. Start a game or choose another due drill.');
  updateCoachControlsState();
  renderInsights();
}
