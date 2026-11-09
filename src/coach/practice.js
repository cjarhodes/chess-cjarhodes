// Practice drills: queue, prompts and hints, scheduling, trends and events.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

const PRACTICE_QUEUE_LIMIT = 10;

function buildPracticeQueue(entries, counts) {
  const used = new Set();
  const keyForEntry = (entry, tag) => `${entry.fenBefore}|${entry.bestUci}|${tag}`;
  const rankedTags = (counts || []).map(c => c.tag);
  const sorted = (entries || [])
    .filter(e => e && isInsightProblem(e.tier) && e.fenBefore && e.bestUci && practiceMoveFor(e.fenBefore, e.bestUci))
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const queue = [];

  for (const tag of rankedTags) {
    const entry = sorted.find(e => (e.tags || []).includes(tag) && !used.has(tag));
    if (!entry) continue;
    const key = keyForEntry(entry, tag);
    if (used.has(key)) continue;
    used.add(tag);
    used.add(key);
    queue.push({ entry, tag });
    if (queue.length >= PRACTICE_QUEUE_LIMIT) break;
  }

  for (const entry of sorted) {
    if (queue.length >= PRACTICE_QUEUE_LIMIT) break;
    const tag = insightTagForEntry(entry);
    const key = keyForEntry(entry, tag);
    if (used.has(key)) continue;
    used.add(key);
    queue.push({ entry, tag });
  }
  return queue;
}

function practiceItemsForEntries(entries, counts) {
  return buildPracticeQueue(entries, counts).map(item => {
    const meta = INSIGHT_TAG_META[item.tag] || INSIGHT_TAG_META.candidate_moves;
    return Object.assign(item, {
      id: practiceItemId(item.entry, item.tag),
      meta
    });
  });
}

function practiceItemFromReview(review) {
  if (!review || !isInsightProblem(review.tier) || !review.fenBefore || !review.bestUci) return null;
  const entry = insightEntryFromReview(Object.assign({}, review));
  const tag = insightTagForEntry(entry);
  return {
    entry,
    tag,
    id: practiceItemId(entry, tag),
    meta: INSIGHT_TAG_META[tag] || INSIGHT_TAG_META.candidate_moves
  };
}

const PRACTICE_SOUND_LOSS_CP = 80;
const PRACTICE_INACCURACY_LOSS_CP = 200;
const PRACTICE_ANALYSIS_DEPTH = 12;
const PRACTICE_MULTIPV = 8;

function practiceMoveFor(fen, uci) {
  if (!uci || !fen) return null;
  return moveFromUci(fen, uci);
}

function practiceIdeaForMove(fen, uci) {
  const move = practiceMoveFor(fen, uci);
  if (!move) return 'Find the move that best improves this position.';
  if (move.san && move.san.includes('#')) return 'Start with forcing moves: there is a checkmate to find.';
  if (move.san && move.san.includes('+')) return 'Start with checks: make the opponent answer a concrete threat.';
  if (move.captured) return 'Start with forcing moves: check whether you can win material safely.';
  if (move.promotion) return 'Calculate the pawn race: the promotion move is the critical idea.';
  if (move.flags && (move.flags.includes('k') || move.flags.includes('q'))) return 'King safety is the priority: look for the move that develops and protects your king.';
  if (move.piece === 'p' && ['c', 'd', 'e', 'f'].includes(move.from[0])) return 'Challenge the centre before choosing a quieter improvement.';
  if (move.piece === 'p' && ['f', 'g', 'h'].includes(move.from[0])) return 'Calculate what this pawn advance changes: captures, promotion chances, and squares around both kings.';
  if (['n', 'b'].includes(move.piece)) return move.from[1] === (move.color === 'w' ? '1' : '8')
    ? 'Compare bringing a minor piece off its home rank with the opponent’s forcing replies.'
    : 'Find a more active square for a minor piece, then calculate the opponent’s reply.';
  return 'Find the move that best improves this position. Compare forcing moves, development, and king safety.';
}

function practicePromptForItem(item) {
  if (!item || !item.entry) return 'Find a sound move for this position.';
  const side = fenSideToUserSide(item.entry.fenBefore) === 'black' ? 'Black' : 'White';
  const objective = item.meta && item.meta.practice;
  return `${side} to move. ${objective || 'What is the opponent threatening? Compare your candidates and find a sound move.'}`;
}

function practiceCarryForwardCue(item) {
  if (!item || !item.entry) return 'Compare candidates and calculate the opponent’s strongest reply.';
  const entry = item.entry;
  if (entry.decisionCue) return entry.decisionCue;
  if (entry.openingId && item.meta && item.meta.practice) return item.meta.practice;
  // Older records may predate the saved cue. Rebuild the position to recover
  // board facts such as stalemate, without inventing an unsaved engine reply.
  const position = new Chess(entry.fenBefore);
  const user = moveFromUci(entry.fenBefore, entry.userUci);
  if (user) position.move(user);
  return coachExplanationContext(entry.fenBefore, entry.userUci, entry.bestUci, position.fen(), null).cue;
}

function practiceUciEqual(a, b) {
  if (!a || !b) return false;
  const normalize = value => String(value).toLowerCase().replace(/q$/, 'q');
  return normalize(a) === normalize(b);
}

function practiceEngineScore(result) {
  if (!result) return null;
  if (result.info && (result.info.pv || result.info.cp != null || result.info.mate != null)) return scoreToCp(result.info);
  return null;
}

function practiceHintForSession(session, stage) {
  const fen = session && session.phase === 'followup' ? coachGame && coachGame.fen() : session && session.item && session.item.entry.fenBefore;
  const expected = session && session.expectedUci;
  const move = practiceMoveFor(fen, expected);
  if (!move) return 'Find the move that best improves this position.';
  if (stage <= 1) return practiceIdeaForMove(fen, expected);
  if (stage === 2) return `Look at the ${PIECE_NAME[move.piece]?.toLowerCase() || 'piece'} on ${move.from}.`;
  if (stage === 3) return `Move it to ${move.to}.`;
  return `Answer: ${move.san}. Play it on the board to complete the drill.`;
}

function currentGameDuePracticeItems() {
  const entries = (coachReviewLog || [])
    .filter(review => review && isInsightProblem(review.tier))
    .map(insightEntryFromReview);
  return practiceItemsForEntries(entries, insightTagCounts(entries))
    .filter(item => practiceIsDue(item));
}

function formatPracticeContext(entry) {
  const ref = formatMoveRef(entry);
  const played = entry.userSan ? `You played ${entry.userSan}.` : 'Review the candidate moves.';
  const opening = entry.opening ? ` ${entry.opening}.` : '';
  return `${ref}: ${played}${opening}`;
}

function hashPracticeValue(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function practiceItemId(entry, tag) {
  return 'drill-' + hashPracticeValue(`${entry.fenBefore}|${entry.bestUci}|${tag}`);
}

function practiceRecordFor(item) {
  const records = loadPracticeProgress().records;
  if (!item.entry || !item.id.startsWith('drill-')) return records[item.id] || null;
  // Older queues stored one schedule per weakness tag for the same position.
  // Respect the latest attempt across those tags without duplicating events or
  // rewriting historical IDs (including account-backed records).
  const tags = Array.from(new Set([item.tag].concat(item.entry.tags || []).filter(Boolean)));
  const related = [records[item.id]].concat(tags.map(tag => records[practiceItemId(item.entry, tag)])).filter(Boolean);
  return related.sort((a, b) => (b.lastAttemptAt || 0) - (a.lastAttemptAt || 0))[0] || null;
}

// Clean and helped solves for one practice item. record.correct counts both,
// since a solve after a hint or the answer still completes the attempt; the
// helped ones are counted on the record (record.assisted) and, for records
// older than that counter or merged from the account, in the attempt history.
function practiceSolveCounts(item, record = practiceRecordFor(item)) {
  if (!record) return { attempts: 0, correct: 0, clean: 0, assisted: 0 };
  const correct = record.correct || 0;
  const helpedEvents = loadPracticeProgress().events
    .filter(event => event && event.drillId === item.id && event.correct && event.revealed).length;
  const assisted = Math.min(correct, Math.max(Number(record.assisted) || 0, helpedEvents));
  return { attempts: record.attempts || 0, correct, clean: correct - assisted, assisted };
}

// "x/y correct" counts only clean solves; helped ones are named separately.
function practiceSolveSummary(counts) {
  const helped = counts.assisted ? `, ${counts.assisted} completed with a hint or answer` : '';
  return `${counts.clean}/${counts.attempts} correct unaided${helped}.`;
}

function practiceIsDue(item, now = Date.now()) {
  const record = practiceRecordFor(item);
  return !record || !record.dueAt || record.dueAt <= now;
}

function practiceProgressTotals() {
  const records = Object.values(loadPracticeProgress().records);
  return records.reduce((totals, record) => {
    totals.attempts += record.attempts || 0;
    totals.correct += record.correct || 0;
    if ((record.reps || 0) >= 3) totals.mastered += 1;
    return totals;
  }, { attempts: 0, correct: 0, mastered: 0 });
}

function practiceDayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function practiceTrendSnapshot(now = Date.now()) {
  const events = loadPracticeProgress().events.filter(event => Number.isFinite(event.at));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const currentStart = practiceDayStart(now, -6);
  const previousStart = practiceDayStart(now, -13);
  const current = events.filter(event => event.at >= currentStart);
  const previous = events.filter(event => event.at >= previousStart && event.at < currentStart);
  const summarize = list => ({
    attempts: list.length,
    correct: list.filter(event => event.correct).length
  });
  const currentTotals = summarize(current);
  const previousTotals = summarize(previous);
  const currentRate = currentTotals.attempts
    ? Math.round(currentTotals.correct / currentTotals.attempts * 100)
    : null;
  const previousRate = previousTotals.attempts
    ? Math.round(previousTotals.correct / previousTotals.attempts * 100)
    : null;

  const activeDays = new Set(events.map(event => practiceDayKey(event.at)));
  let streak = 0;
  const cursor = new Date(today);
  if (!activeDays.has(practiceDayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (activeDays.has(practiceDayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const days = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = practiceDayKey(date.getTime());
    const dayEvents = current.filter(event => practiceDayKey(event.at) === key);
    days.push({
      key,
      label: date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2),
      attempts: dayEvents.length,
      correct: dayEvents.filter(event => event.correct).length
    });
  }

  const tagStats = {};
  events.filter(event => event.at >= previousStart).forEach(event => {
    const tag = event.tag || 'candidate_moves';
    if (!tagStats[tag]) tagStats[tag] = { tag, attempts: 0, correct: 0 };
    tagStats[tag].attempts += 1;
    if (event.correct) tagStats[tag].correct += 1;
  });
  const focus = Object.values(tagStats)
    .sort((a, b) =>
      (b.attempts - b.correct) - (a.attempts - a.correct) ||
      b.attempts - a.attempts
    )[0] || null;

  return {
    attempts: currentTotals.attempts,
    rate: currentRate,
    previousRate,
    streak,
    days,
    focus
  };
}

function renderPracticeTrends() {
  const trend = practiceTrendSnapshot();
  byId('practice-progress-week').textContent = trend.attempts;
  byId('practice-progress-streak').textContent = trend.streak + 'd';
  const comparison = trend.rate === null
    ? 'No attempts in the last 7 days.'
    : trend.previousRate === null
      ? `${trend.rate}% completed attempts this week — your first trend baseline.`
      : `${trend.rate}% completed attempts this week, ${trend.rate - trend.previousRate >= 0 ? '+' : ''}${trend.rate - trend.previousRate} points vs the prior week.`;
  const focus = trend.focus && INSIGHT_TAG_META[trend.focus.tag]
    ? ` Focus next: ${INSIGHT_TAG_META[trend.focus.tag].title}.`
    : '';
  byId('practice-trend-summary').textContent = comparison + focus;

  const maxAttempts = Math.max(1, ...trend.days.map(day => day.attempts));
  const bars = byId('practice-trend-bars');
  bars.replaceChildren();
  trend.days.forEach(day => {
    const height = day.attempts ? Math.max(12, Math.round(day.attempts / maxAttempts * 100)) : 4;
    const success = day.attempts ? Math.round(day.correct / day.attempts * 100) : 0;
    const dayEl = makeEl('div', 'practice-trend-day');
    dayEl.setAttribute('aria-label', `${day.label}: ${day.attempts} attempt${day.attempts === 1 ? '' : 's'}, ${success}% completed attempts`);
    const bar = makeEl('span', 'practice-trend-bar');
    bar.style.setProperty('--bar-height', height + '%');
    bar.style.setProperty('--bar-success', success + '%');
    dayEl.append(bar);
    dayEl.append(makeEl('span', 'practice-trend-label', day.label));
    bars.append(dayEl);
  });
}

function practiceEventId() {
  return createCoachGameId();
}

function practiceEventFromAttempt(item, correct, revealed, at) {
  return {
    id: practiceEventId(),
    ownerId: activePracticeOwnerId(),
    drillId: item.id,
    sourceMoveId: item.entry.id || null,
    tag: item.tag,
    fen: item.entry.fenBefore,
    bestUci: item.entry.bestUci,
    bestSan: item.entry.bestSan || null,
    prompt: item.meta.practice,
    at,
    correct: !!correct,
    revealed: !!revealed,
    result: correct ? (revealed ? 'assisted' : 'correct') : 'incorrect',
    synced: false
  };
}

function nextPracticeInterval(record, clean) {
  if (!clean) return 0;
  if (record.reps <= 1) return 1;
  if (record.reps === 2) return 3;
  return Math.max(4, Math.round((record.intervalDays || 3) * (record.ease || 2.5)));
}

// Local midnight `days` calendar days after `timestamp` (DST-safe).
function practiceDayStart(timestamp, days = 0) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function recordPracticeAttempt(item, correct, revealed) {
  if (item && item.learningTransfer && typeof recordLearningTransferHelp === 'function') return recordLearningTransferHelp(item, revealed);
  const state = loadPracticeProgress();
  const now = Date.now();
  const event = practiceEventFromAttempt(item, correct, revealed, now);
  const own = state.records[item.id] || null;
  // The same position can return under another weakness tag (a new id).
  // Continue its schedule from the latest related record, but keep this
  // record's own counters so totals never count an attempt twice.
  const schedule = practiceRecordFor(item) || own || {};
  const record = Object.assign({ attempts: 0, correct: 0 }, own || {}, {
    reps: schedule.reps || 0,
    ease: Number(schedule.ease) || 2.5,
    intervalDays: schedule.intervalDays || 0,
    dueAt: schedule.dueAt || 0
  });
  record.attempts += 1;
  record.lastAttemptAt = now;
  record.lastResult = correct ? (revealed ? 'assisted' : 'correct') : 'incorrect';
  if (correct && revealed) {
    // A hint or the answer named the move: the attempt is completed, but it
    // is not recall, so it earns no rep and comes back tomorrow.
    record.correct += 1;
    record.assisted = (record.assisted || 0) + 1;
    record.ease = Math.max(1.3, record.ease - 0.05);
    record.intervalDays = 1;
    record.dueAt = practiceDayStart(now, 1);
  } else if (correct) {
    record.correct += 1;
    record.reps += 1;
    record.ease = Math.max(1.3, record.ease + 0.08);
    record.intervalDays = nextPracticeInterval(record, true);
    record.dueAt = practiceDayStart(now, record.intervalDays);
  } else {
    record.reps = 0;
    record.ease = Math.max(1.3, record.ease - 0.2);
    record.intervalDays = 0;
    record.dueAt = now;
  }
  state.records[item.id] = record;
  state.events.push(event);
  const saved = savePracticeProgress(state);
  if (!saved.ok) setCoachStatus('Practice result could not be saved in this browser.');
  queueRemotePracticeProgressSync(event);
  if (typeof renderEndgameTrack === 'function') renderEndgameTrack();
  if (typeof renderWeeklyReview === 'function') renderWeeklyReview();
  return record;
}

function markPracticeEventSynced(eventId, ownerId = activePracticeOwnerId()) {
  const state = loadPracticeProgress(ownerId);
  const event = state.events.find(item => item.id === eventId);
  if (!event || event.synced) return;
  event.synced = true;
  savePracticeProgress(state, ownerId);
}
