// Different-position decisions are kept separate from rehearsal and live activity.
const LEARNING_TRANSFER_POSITIONS = [
  { id: 'back-rank', tags: ['missed_mate', 'missed_check', 'endgame_conversion', 'endgame_technique', 'back_rank'],
    fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', uci: 'e1e8',
    explanation: 'The king’s own pawns close its escape squares. Check every escape, capture and block before calling a checking move mate.' },
  { id: 'defended-square', tags: ['missed_mate', 'endgame_conversion', 'endgame_technique'],
    fen: '6rk/8/5KQ1/8/8/8/8/8 w - - 0 1', uci: 'g6h6',
    explanation: 'The rook changes the legal defenses: Qg7+ allows …Rxg7. A check along the h-file closes the mating net. Qh5# and Qh6# both work.' },
  { id: 'queen-safety', tags: ['hung_material', 'piece_left_en_prise', 'allowed_forcing', 'fork_risk', 'candidate_moves'],
    fen: '6k1/8/5n2/8/4Q3/8/8/6K1 w - - 0 1', uci: 'e4g6',
    explanation: 'The knight attacks e4. Move the queen to safety while comparing forcing checks and the opponent’s reply.' },
  { id: 'black-passer', tags: ['passed_pawns'],
    fen: '7K/8/8/4k3/8/8/1p6/8 b - - 0 1', uci: 'b2b1q',
    explanation: 'Play from Black’s side: compare promoting with improving the king. More than one winning move can be sound.' },
  { id: 'new-development', tags: ['development', 'opening_principles'],
    fen: 'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3', uci: 'b1c3',
    explanation: 'In this central structure, compare bringing a minor piece into play with the opponent’s central captures. The previous drill’s move is not a rule.' }
];

function learningPositionKey(fen) { return String(fen || '').split(/\s+/).slice(0, 4).join(' '); }

function learningTransferOffer(item) {
  if (!item || !item.entry || item.learningTransfer || item.id.startsWith('opening-bridge:')) return null;
  const known = new Set([learningPositionKey(item.entry.fenBefore)]);
  (currentInsightEntries() || []).forEach(entry => known.add(learningPositionKey(entry.fenBefore)));
  const records = loadGrowthState().learningTransfers;
  records.forEach(record => known.add(learningPositionKey(record.challengeFen)));
  return LEARNING_TRANSFER_POSITIONS.find(position => position.tags.includes(item.tag) && !known.has(learningPositionKey(position.fen))) || null;
}

function currentLearningTransferRecord(item = coachPracticeSession && coachPracticeSession.item) {
  const info = item && item.learningTransfer;
  if (!info || !coachPracticeSession || coachPracticeSession.owner !== coachMemoryOwnerId()) return null;
  const record = loadGrowthState().learningTransfers.find(row => row.id === info.recordId);
  const position = LEARNING_TRANSFER_POSITIONS.find(row => row.id === info.challengeId);
  return record && position && record.challengeId === position.id && record.challengeFen === item.entry.fenBefore && position.fen === record.challengeFen ? record : null;
}

function updateLearningTransferRecord(record) {
  const state = loadGrowthState();
  record.updatedAt = Date.now();
  state.learningTransfers = normalizeLearningTransferRecords([record, ...state.learningTransfers]);
  const result = saveGrowthState(state);
  if (!result.ok) setCoachStatus('This browser could not save the check. Try again before leaving the position.');
  renderLearningTransferProgress();
  return result.ok;
}

function startLearningTransferCheck() {
  const session = coachPracticeSession;
  if (!session || !session.completed || session.owner !== coachMemoryOwnerId() || coachThinking) return;
  const source = session.item, position = learningTransferOffer(source);
  if (!position) return;
  const now = Date.now();
  const record = { id: createCoachGameId(), at: now, updatedAt: now,
    sourceId: source.id, sourceFen: source.entry.fenBefore, tag: source.tag, title: source.meta.title,
    cue: practiceCarryForwardCue(source), challengeId: position.id, challengeFen: position.fen,
    firstResult: 'pending', firstAt: 0, firstUci: '', firstSan: '', completed: false, helpUsed: false,
    playGameId: '', observations: [] };
  if (!updateLearningTransferRecord(record)) return;
  startCoachPractice(learningTransferPracticeItem(record));
}

function learningTransferPracticeItem(record) {
  const position = LEARNING_TRANSFER_POSITIONS.find(row => row.id === record.challengeId);
  if (!position || position.fen !== record.challengeFen) return null;
  const move = moveFromUci(position.fen, position.uci);
  return {
    id: 'learning-check:' + record.id, tag: record.tag,
    entry: { fenBefore: position.fen, bestUci: position.uci, bestSan: move.san, pairNum: Number(position.fen.split(' ')[5]), ply: 1, decisionCue: record.cue },
    learningTransfer: { recordId: record.id, challengeId: position.id },
    meta: { title: record.firstResult === 'pending' ? 'Different-position check' : 'Rehearse this check', practice: `${record.cue} Check what has changed in this position before choosing a move.`, theory: position.explanation }
  };
}

function rehearseLearningTransfer(id) {
  const record = loadGrowthState().learningTransfers.find(row => row.id === id);
  if (!record || record.firstResult === 'pending' || coachThinking) return;
  if (coachPracticeSession) { showCoachPanel('practice'); return; }
  const item = learningTransferPracticeItem(record);
  if (item) startCoachPractice(item);
}

function recordLearningTransferDecision(session, uci, result) {
  if (!session.item.learningTransfer) return true;
  const record = currentLearningTransferRecord(session.item);
  if (!record) return false;
  if (record.firstResult !== 'pending') return true;
  const move = moveFromUci(coachGame.fen(), uci);
  if (!move || result.unknown || result.stale) return false;
  record.firstResult = session.hintUsed || session.revealed ? 'assisted' : result.sound ? 'sound' : 'needs-work';
  record.firstAt = Date.now(); record.firstUci = uci; record.firstSan = move.san;
  record.helpUsed = !!(session.hintUsed || session.revealed);
  return updateLearningTransferRecord(record);
}

function recordLearningTransferHelp(item, revealed) {
  const record = currentLearningTransferRecord(item);
  if (record && revealed) { record.helpUsed = true; updateLearningTransferRecord(record); }
  // Check attempts never enter the rehearsal queue or count as daily drills.
  return { attempts: 0, correct: 0, reps: 0, dueAt: 0 };
}

function learningTransferResultText(record) {
  if (record.firstResult === 'sound') return 'First decision: sound, without a hint or answer.';
  if (record.firstResult === 'needs-work') return 'First decision: needs work. Solving a retry does not replace that result.';
  if (record.firstResult === 'assisted') return 'First decision: assisted. Help was used before the graded move.';
  return 'No graded decision yet. Opening the check or requesting help is not a result.';
}

function finishLearningTransferCheck(session, played) {
  if (session.completionRecorded) return;
  const record = currentLearningTransferRecord(session.item);
  if (!record) return;
  record.completed = true; record.helpUsed = record.helpUsed || session.hintUsed || session.revealed;
  if (!updateLearningTransferRecord(record)) return;
  session.completed = true; session.completionRecorded = true;
  if (coachPracticeRun) { coachPracticeRun.completed = 1; coachPracticeRun.clean = record.firstResult === 'sound' ? 1 : 0; }
  const position = LEARNING_TRANSFER_POSITIONS.find(row => row.id === record.challengeId);
  $('#coach-practice-status').text(`${played.san}. ${learningTransferResultText(record)}`);
  $('#coach-practice-prompt').text(position.explanation);
  $('#coach-practice-takeaway').text(`Use in play: ${record.cue}`).show();
  $('#btn-coach-practice-hint, #btn-coach-practice-answer').prop('disabled', true);
  $('#btn-coach-practice-next').text('Use this cue in play').show().prop('disabled', false);
  setCoachStatus('Different-position check saved. Try the cue in play.');
  updateCoachControlsState(); saveCoachPracticeState(); renderInsights(); focusPracticeTarget();
}

function continueLearningTransferPlay(id) {
  const record = loadGrowthState().learningTransfers.find(row => row.id === id);
  if (!record || coachThinking) return;
  if (coachPracticeSession) { showCoachPanel('practice'); return; }
  if (coachIsReviewing()) coachGotoLive();
  if (!coachGameActive) {
    if (coachOpeningTransfer) { showCoachPanel('game'); return; }
    startCoachGame();
  }
  record.playGameId = coachLocalGameId;
  updateLearningTransferRecord(record);
  showCoachPanel('game');
  setCoachStatus(`Use this cue when it fits: ${record.cue}`);
  document.getElementById('coachBoard')?.focus({ preventScroll: true });
}

function recordLearningTransferLiveMove(review) {
  if (coachPracticeSession || !review || review.tier === 'unknown') return;
  const record = loadGrowthState().learningTransfers.find(row => row.playGameId === coachLocalGameId && row.completed);
  if (!record || record.observations.length >= 6) return;
  const key = `${coachLocalGameId}|${review.ply}`;
  if (record.observations.some(row => row.key === key)) return;
  const tags = review.insightTags || insightTagsForReview(review);
  record.observations.push({ key, at: Date.now(), tier: review.tier, flagged: isInsightProblem(review.tier) && tags.includes(record.tag) });
  updateLearningTransferRecord(record);
}

function renderLearningTransfer() {
  const session = coachPracticeSession;
  const probe = session && session.item.learningTransfer;
  const offer = session && session.completed && !probe && learningTransferOffer(session.item);
  $('#btn-learning-transfer-test').toggle(!!offer);
  const exhausted = session && session.completed && !probe && !session.item.id.startsWith('opening-bridge:');
  $('#learning-transfer-note').toggle(!!offer || !!probe || !!exhausted).text(offer
    ? 'Optional: try the same decision process in a different position before returning to play.'
    : probe ? 'Try the idea without help first. You can use hints or retry; your first decision stays in your progress.'
      : exhausted ? 'No fresh authored check for this cue is available. Use it in play; repeating a known position is rehearsal.' : '');
  if (!probe) return;
  $('#coach-practice-session-status').text('Different-position check');
  if (session.completed) $('#btn-coach-practice-next').text('Use this cue in play');
}

function renderLearningTransferProgress() {
  const records = loadGrowthState().learningTransfers;
  const $list = $('#learning-transfer-progress-list');
  const owner = growthOwnerId() || 'local';
  const open = new Set($list.attr('data-owner') === owner
    ? $list.children('details[open]').toArray().map(row => row.getAttribute('data-record-id')) : []);
  $list.empty().attr('data-owner', owner);
  $('#learning-transfer-progress').toggle(records.length > 0);
  records.slice(0, 3).forEach(record => {
    const $row = $('<details class="learning-transfer-result"></details>').attr('data-record-id', record.id).prop('open', open.has(record.id));
    $row.append($('<summary></summary>').text(`${record.title} · ${record.firstResult === 'pending' ? 'no graded decision' : record.firstResult === 'sound' ? 'sound first decision' : record.firstResult === 'assisted' ? 'assisted decision' : 'revisit the cue'}`));
    $row.append($('<p></p>').text(learningTransferResultText(record)));
    if (record.firstSan) $row.append($('<p></p>').text(`First move: ${record.firstSan}. ${record.completed ? 'Check completed.' : 'The check can still be rehearsed.'}`));
    $row.append($('<p></p>').text(`Cue: ${record.cue}`));
    const n = record.observations.length, flags = record.observations.filter(row => row.flagged).length;
    $row.append($('<p></p>').text(n
      ? `${n}/6 follow-up moves reviewed; ${flags} flagged this pattern. Reviews do not identify every opportunity to use the idea. No matching flag is not proof of transfer.`
      : 'Next: use the cue in play. No follow-up moves reviewed yet.'));
    $row.append($('<p class="progress-method"></p>').text('One different-position decision is a small sample, not a mastery or retention score. Repeated checks are rehearsal.'));
    if (record.firstResult !== 'pending') $('<button type="button" class="ctrl-btn">Rehearse this position</button>').on('click', () => rehearseLearningTransfer(record.id)).appendTo($row);
    if (record.completed) $('<button type="button" class="ctrl-btn">Use this cue in play</button>').on('click', () => continueLearningTransferPlay(record.id)).appendTo($row);
    $list.append($row);
  });
}

$(function() {
  $('#btn-learning-transfer-test').on('click', startLearningTransferCheck);
  renderLearningTransfer(); renderLearningTransferProgress();
});
