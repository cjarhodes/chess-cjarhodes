// Opening study -> free coached play -> observed review. Plain browser script.
const OPENING_TRANSFER_REVIEW_TARGET = 4;
let openingTransferFinishPending = false;

function openingTransferTarget(opening, line, requestedPly) {
  if (!opening || !line || !Array.isArray(line.moves) || !line.moves.length) return null;
  const side = opening.category === 'black' ? 'black' : 'white';
  const positions = [new Chess().fen()];
  const terminal = [false];
  const position = new Chess();
  try {
    for (const san of line.moves) {
      if (!position.move(san)) return null;
      positions.push(position.fen()); terminal.push(position.game_over());
    }
  } catch (e) { return null; }
  let ply = Number.isInteger(requestedPly) && requestedPly > 0 ? Math.min(requestedPly, line.moves.length) : line.moves.length;
  const requested = ply;
  // A completed trap cannot be played. Back up to the student's last decision.
  if (terminal[ply]) {
    while (ply > 0 && (terminal[ply] || positions[ply].split(' ')[1] !== side[0])) ply--;
  }
  if (terminal[ply] || ply === 0) return null;
  const ideas = (line.keyIdeas || opening.keyIdeas || []).filter(idea => typeof idea === 'string');
  return {
    openingId: opening.id, lineId: line.id, title: opening.name,
    lineName: line.name, side, sourceFen: positions[ply], sourcePly: ply,
    adjusted: ply !== requested, ideas: ideas.length ? ideas : ['Develop your pieces, protect your king, and check the opponent’s threats.']
  };
}

function openingTransferDefinition(id, lineId = 'main', ply) {
  const opening = OPENINGS.find(item => item.id === id);
  const line = getOpeningLines(opening).find(item => item.id === lineId);
  return openingTransferTarget(opening, line, ply);
}

function normalizeOpeningTransfer(value) {
  if (!value || value.v !== 1 || value.owner !== coachMemoryOwnerId() || typeof value.id !== 'string') return null;
  const definition = openingTransferDefinition(value.openingId, value.lineId, value.sourcePly);
  if (!definition || definition.sourceFen !== value.sourceFen || definition.side !== value.side) return null;
  const returnState = value.returnState && value.returnState.owner === coachMemoryOwnerId() && !value.returnState.openingTransfer
    ? cloneCoachValue(value.returnState, null) : null;
  return Object.assign({}, definition, {
    v: 1, id: value.id, owner: value.owner,
    cue: definition.ideas.includes(value.cue) ? value.cue : definition.ideas[0],
    startedAt: Number(value.startedAt) || Date.now(),
    reflection: ['applied', 'adapted', 'unsure'].includes(value.reflection) ? value.reflection : 'unsure',
    returnState
  });
}

function openingTransferSummary(context = coachOpeningTransfer, reviews = coachReviewLog) {
  if (!context) return null;
  const reviewed = (reviews || []).filter(review => review && review.tier && review.tier !== 'unknown');
  const problems = reviewed.filter(review => isInsightProblem(review.tier));
  const examples = (problems.length ? problems : reviewed).slice(-2).map(review => ({
    move: formatMoveRef(review), lesson: review.lesson || review.decisionCue || review.explanation || 'Compare this move with the opponent’s reply.'
  }));
  return {
    id: context.id, at: Date.now(), openingId: context.openingId, lineId: context.lineId,
    sourcePly: context.sourcePly, side: context.side, cue: context.cue,
    reflection: context.reflection || 'unsure', reviewed: reviewed.length, problems: problems.length, examples
  };
}

function saveOpeningTransferReview() {
  const record = openingTransferSummary();
  if (!record || !record.reviewed) return { ok: true };
  const state = loadGrowthState();
  state.openingTransfers = normalizeOpeningTransferRecords([record, ...state.openingTransfers]);
  const result = saveGrowthState(state);
  if (!result.ok) setCoachStatus('The opening review could not be saved in this browser.');
  renderOpeningTransferHistory();
  return result;
}

function openingTransferReflectionLabel(value) {
  return value === 'applied' ? 'You reported finding a way to use the idea.'
    : value === 'adapted' ? 'You reported changing plans after the opponent’s reply.'
      : 'You are still working out when the idea fits.';
}

function renderOpeningTransferEntry() {
  const $entry = $('#opening-transfer-entry');
  if (!currentOpening || !currentLine || exploreMode || (quizMode && currentMoveIdx < activeMoves().length - 1)) {
    $entry.hide(); return;
  }
  const target = openingTransferTarget(currentOpening, currentLine, currentMoveIdx + 1);
  if (!target) { $entry.hide(); return; }
  const $select = $('#opening-transfer-cue');
  const key = `${currentOpening.id}|${currentLineId}`;
  if ($select.attr('data-line-key') !== key) {
    $select.empty().attr('data-line-key', key);
    target.ideas.forEach((idea, index) => $('<option></option>').val(index).text(idea).appendTo($select));
    // Prefer an explicitly named plan for the side being studied. Other
    // lesson ideas remain selectable; none is treated as a move requirement.
    const preferred = target.ideas.findIndex(idea => new RegExp(`^${target.side}.*(?:plan|goal|counterplay)`, 'i').test(idea));
    const practical = target.ideas.findIndex(idea => /key (break|tension)|central (plan|break)/i.test(idea));
    $select.val(preferred >= 0 ? preferred : Math.max(0, practical));
  }
  const existing = coachOpeningTransfer;
  const waiting = coachThinking || (coachGameActive && !coachIsUserTurn());
  $('#btn-library-transfer').text(coachPracticeSession ? 'Resume current drill'
    : existing ? 'Resume opening game' : waiting ? 'Return to current game'
      : target.adjusted ? 'Play before the finish' : currentMoveIdx < 0 ? 'Play after this line' : 'Play this position');
  const move = target.sourceFen.split(' ')[5];
  $select.prop('disabled', !!coachPracticeSession || !!existing || waiting);
  $('#opening-transfer-detail').text(coachPracticeSession
    ? `Your ${coachPracticeSession.item.meta.title} lesson is still in progress. Resume it before starting an opening game.`
    : waiting ? 'A move is in progress in Coach. Return to your game before starting an opening position.'
    : existing ? `Opening session in progress: ${existing.title}. Finish or return from it before starting another.`
    : `Start at move ${move} as ${target.side === 'black' ? 'Black' : 'White'}. ${target.adjusted ? 'The final position is over, so this starts at your last decision. ' : ''}The opponent chooses its own moves. Any unfinished Coach game is kept for your return.`);
  $entry.show();
}

function beginOpeningTransfer(id, lineId, ply, cueIndex = 0) {
  const target = openingTransferDefinition(id, lineId, ply);
  if (!target) return;
  switchView('coach');
  if (coachPracticeSession || coachOpeningTransfer || coachThinking || (coachGameActive && !coachIsUserTurn())) {
    showCoachPanel(coachPracticeSession ? 'practice' : 'game');
    setCoachStatus(coachOpeningTransfer ? 'Your opening game is still in progress. Review it or return before starting another.' : 'Continue the current session before starting this opening position.');
    document.getElementById('coachBoard')?.focus({ preventScroll: true });
    return;
  }
  if (coachIsReviewing()) coachGotoLive();
  const context = Object.assign({}, target, {
    v: 1, id: createCoachGameId(), owner: coachMemoryOwnerId(),
    startedAt: Date.now(), cue: target.ideas[cueIndex] || target.ideas[0],
    reflection: 'unsure', returnState: captureCoachPracticeReturnState()
  });
  startCoachGame({ openingTransfer: context });
}

function renderOpeningTransfer() {
  const context = coachOpeningTransfer;
  $('#coach-opening-transfer').toggle(!!context && !coachPracticeSession);
  $('#btn-coach-newgame').text(context ? 'Return from opening' : '▶ New game');
  renderOpeningTransferEntry();
  if (!context || coachPracticeSession) return;
  const reviewed = coachStats ? coachStats.moves : 0;
  $('#opening-transfer-title').text(`${context.title}${context.lineId === 'main' ? '' : ' · ' + context.lineName}`);
  $('#opening-transfer-plan').text(context.cue);
  $('#opening-transfer-count').text(reviewed >= OPENING_TRANSFER_REVIEW_TARGET ? `${reviewed} reviewed moves. Review what changed, or keep playing.` : `${reviewed}/${OPENING_TRANSFER_REVIEW_TARGET} reviewed moves to explore the idea. Use it when it fits; answer threats first.`);
  $('#btn-opening-transfer-review').prop('disabled', reviewed < 1 || coachThinking || coachIsReviewing()).text(reviewed >= OPENING_TRANSFER_REVIEW_TARGET ? 'Review opening session' : 'Review so far');
  $('#btn-opening-transfer-return').text(context.returnState ? 'Return to saved game' : 'Back to lesson').prop('disabled', coachThinking || openingTransferFinishPending);
}

function renderOpeningTransferSummary() {
  const context = coachOpeningTransfer;
  $('#summary-opening-transfer, #btn-summary-opening-return').toggle(!!context);
  $('#summary-overlay').toggleClass('opening-transfer-summary', !!context);
  $('#btn-summary-newgame').toggle(!context);
  $('#btn-summary-close').text(context && coachGameActive ? 'Keep playing' : 'Close');
  if (!context) { $('#btn-summary-opening-return').removeClass('primary'); return; }
  const record = openingTransferSummary();
  $('#summary-transfer-cue').text(`${context.title} · ${context.cue}`);
  $('#summary-transfer-observation').text(`${record.reviewed} reviewed moves; ${record.problems} flagged as inaccuracies, mistakes, or blunders. The engine grades move quality, not whether you applied the opening plan. This short exercise does not establish learning.`);
  $('#summary-opening-section').show();
  $('#summary-opening-line').text(`${context.title} · ${context.lineName} · free play from move ${context.sourceFen.split(' ')[5]}.`);
  $('#summary-transfer-reflection').val(context.reflection);
  $('.summary-actions .primary').removeClass('primary');
  $('#btn-summary-opening-return').addClass('primary').text(context.returnState ? 'Save & return to your game' : 'Save & return to lesson');
  saveOpeningTransferReview();
}

async function finishOpeningTransfer() {
  const context = coachOpeningTransfer;
  if (!context || context.owner !== coachMemoryOwnerId() || coachThinking || openingTransferFinishPending) return;
  if (coachIsReviewing()) coachGotoLive();
  saveOpeningTransferReview();
  closeSummaryOverlay();
  openingTransferFinishPending = true;
  coachGameActive = false;
  coachLastEndMsg = 'Opening session saved';
  saveCoachState();
  updateCoachControlsState();
  let timeout;
  try {
    // Flush the exercise's normal account game lifecycle before restoring a
    // different game identity. Local-only completion resolves immediately.
    await Promise.race([
      coachSync.saveGame('Opening exercise finished'),
      new Promise(resolve => { timeout = setTimeout(resolve, 5000); })
    ]);
  } catch (error) { handleCoachDbError(error); }
  finally { clearTimeout(timeout); openingTransferFinishPending = false; }
  if (coachOpeningTransfer !== context || context.owner !== coachMemoryOwnerId()) return;
  coachOpeningTransfer = null;
  if (context.returnState && restoreCoachPracticeReturnState(context.returnState)) {
    CoachController.setPhase(coachIsUserTurn() ? 'userTurn' : 'opponentThinking');
    showCoachPanel('game');
    setCoachStatus('Opening session saved. Your original game is restored.');
    if (!coachIsUserTurn()) coachOpponentRespond();
    document.getElementById('coachBoard')?.focus({ preventScroll: true });
  } else {
    invalidateCoachAsyncWork('Opening session finished.');
    coachGameActive = false;
    coachLastEndMsg = 'Opening session saved';
    CoachController.setPhase('ended');
    saveCoachState();
    loadOpening(context.openingId, context.lineId);
    goToMove(context.sourcePly - 1);
  }
  renderInsights();
  renderOpeningTransferHistory();
}

function renderOpeningTransferHistory() {
  const records = loadGrowthState().openingTransfers;
  const $section = $('#opening-transfer-history').toggle(records.length > 0);
  const $list = $('#opening-transfer-history-list').empty();
  records.forEach(record => {
    const definition = openingTransferDefinition(record.openingId, record.lineId, record.sourcePly);
    if (!definition) return;
    const $row = $('<details class="opening-transfer-history-item"></details>');
    $row.append($('<summary></summary>').text(`${definition.title}${definition.lineId === 'main' ? '' : ' · ' + definition.lineName} · ${record.reviewed} reviewed moves`));
    $row.append($('<p></p>').text(`Idea: ${record.cue}`));
    $row.append($('<p></p>').text(`${record.problems} engine-flagged moves. ${openingTransferReflectionLabel(record.reflection)} Reflection is self-reported; this is not a mastery score.`));
    record.examples.forEach(example => $row.append($('<p></p>').text(`${example.move} · ${example.lesson}`)));
    const $actions = $('<div class="opening-transfer-actions"></div>');
    $('<button type="button" class="movelist-copy">Study this line</button>').on('click', () => {
      loadOpening(record.openingId, record.lineId); goToMove(record.sourcePly - 1);
    }).appendTo($actions);
    $('<button type="button" class="movelist-copy">Try the idea again</button>').on('click', () =>
      beginOpeningTransfer(record.openingId, record.lineId, record.sourcePly, Math.max(0, definition.ideas.indexOf(record.cue)))
    ).appendTo($actions);
    $row.append($actions);$list.append($row);
  });
  $section.toggle($list.children().length > 0);
}

function initOpeningTransfer() {
  $('#btn-library-transfer').on('click', () => {
    if (currentOpening && currentLine) beginOpeningTransfer(currentOpening.id, currentLineId, currentMoveIdx + 1, Number($('#opening-transfer-cue').val()) || 0);
  });
  $('#btn-opening-transfer-review').on('click', () => {
    if (!coachOpeningTransfer || coachThinking || coachIsReviewing() || !coachStats.moves) return;
    saveCoachState();showPostGameSummary('Opening transfer review');
  });
  $('#btn-opening-transfer-return, #btn-summary-opening-return').on('click', finishOpeningTransfer);
  $('#summary-transfer-reflection').on('change', function() {
    if (!coachOpeningTransfer) return;
    coachOpeningTransfer.reflection = this.value;
    saveOpeningTransferReview();saveCoachState();
  });
  renderOpeningTransfer();renderOpeningTransferHistory();
}
$(initOpeningTransfer);
