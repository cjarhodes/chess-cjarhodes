// Adaptive daily session: practice progress storage, focus choice and plan state.
// Classic script loaded before app.js (see index.html); its top-level
// declarations are shared globals, as they were inside app.js.

const PRACTICE_PROGRESS_KEY = 'coach:practice:v2';
const LEGACY_PRACTICE_PROGRESS_KEY = 'coach:practice:v1';
const PRACTICE_EVENT_LIMIT = 2000;
const DAILY_SPRINT_KEY = 'coach:daily-sprint:v1';
const DAILY_MOVE_TARGET = 10;
const DAILY_DRILL_TARGET = 2;
const DAILY_TRANSFER_TARGET = 6;
const DAILY_HISTORY_LIMIT = 60;
const practiceRemoteSyncChains = new Map();
let renderedAdaptivePlan = null;

function emptyPracticeProgress() {
  return { v: 2, records: {}, events: [] };
}

function activePracticeOwnerId() {
  return coachAuthUser && coachAuthUser.id ? coachAuthUser.id : null;
}

function practiceProgressStorageKey(ownerId = activePracticeOwnerId()) {
  return ownerId ? `${PRACTICE_PROGRESS_KEY}:${ownerId}` : PRACTICE_PROGRESS_KEY;
}

function loadPracticeProgress(ownerId = activePracticeOwnerId()) {
  try {
    const currentRaw = localStorage.getItem(practiceProgressStorageKey(ownerId));
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw);
      if (parsed && parsed.v === 2 && parsed.records && typeof parsed.records === 'object') {
        return {
          v: 2,
          records: parsed.records,
          events: Array.isArray(parsed.events) ? parsed.events.slice(-PRACTICE_EVENT_LIMIT) : []
        };
      }
    }
    const legacy = ownerId ? null : JSON.parse(localStorage.getItem(LEGACY_PRACTICE_PROGRESS_KEY));
    if (legacy && legacy.v === 1 && legacy.records && typeof legacy.records === 'object') {
      return { v: 2, records: legacy.records, events: [] };
    }
    return emptyPracticeProgress();
  } catch (e) {
    return emptyPracticeProgress();
  }
}

function savePracticeProgress(state, ownerId = activePracticeOwnerId()) {
  try {
    localStorage.setItem(practiceProgressStorageKey(ownerId), JSON.stringify({
      v: 2,
      records: state.records || {},
      events: (state.events || []).slice(-PRACTICE_EVENT_LIMIT)
    }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function clearPracticeProgress() {
  try {
    const ownerId = activePracticeOwnerId();
    localStorage.removeItem(practiceProgressStorageKey(ownerId));
    if (!ownerId) localStorage.removeItem(LEGACY_PRACTICE_PROGRESS_KEY);
  } catch (e) {}
}

function adoptAnonymousPracticeProgress(ownerId) {
  if (!ownerId) return;
  const anonymous = loadPracticeProgress(null);
  const hasAnonymousData = Object.keys(anonymous.records).length || anonymous.events.length;
  if (!hasAnonymousData) return;

  const account = loadPracticeProgress(ownerId);
  Object.entries(anonymous.records).forEach(([drillId, record]) => {
    const existing = account.records[drillId];
    const recordIsNewer = !existing ||
      (record.lastAttemptAt || 0) > (existing.lastAttemptAt || 0) ||
      ((record.lastAttemptAt || 0) === (existing.lastAttemptAt || 0) &&
       (record.attempts || 0) > (existing.attempts || 0));
    if (recordIsNewer) account.records[drillId] = record;
  });

  const eventIds = new Set(account.events.map(event => event.id));
  anonymous.events.forEach(event => {
    if (!event || !event.id || eventIds.has(event.id)) return;
    account.events.push(Object.assign({}, event, {
      ownerId,
      synced: false
    }));
    eventIds.add(event.id);
  });
  const adopted = savePracticeProgress(account, ownerId);
  if (!adopted.ok) return;
  try {
    localStorage.removeItem(PRACTICE_PROGRESS_KEY);
    localStorage.removeItem(LEGACY_PRACTICE_PROGRESS_KEY);
  } catch (e) {}
}

function dailySprintStorageKey(ownerId = activePracticeOwnerId()) {
  return ownerId ? `${DAILY_SPRINT_KEY}:${ownerId}` : DAILY_SPRINT_KEY;
}

function emptyDailySprintHistory() {
  return { v: 1, days: {} };
}

function loadDailySprintHistory(ownerId = activePracticeOwnerId()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(dailySprintStorageKey(ownerId)));
    if (!parsed || parsed.v !== 1 || !parsed.days || typeof parsed.days !== 'object') {
      return emptyDailySprintHistory();
    }
    return { v: 1, days: parsed.days };
  } catch (e) {
    return emptyDailySprintHistory();
  }
}

function saveDailySprintHistory(history, ownerId = activePracticeOwnerId()) {
  try {
    const days = Object.entries(history.days || {})
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, DAILY_HISTORY_LIMIT)
      .reduce((result, [key, value]) => {
        result[key] = value;
        return result;
      }, {});
    localStorage.setItem(dailySprintStorageKey(ownerId), JSON.stringify({ v: 1, days }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function adoptAnonymousDailySprint(ownerId) {
  if (!ownerId) return;
  const anonymous = loadDailySprintHistory(null);
  if (!Object.keys(anonymous.days).length) return;
  const account = loadDailySprintHistory(ownerId);
  Object.entries(anonymous.days).forEach(([day, value]) => {
    const existing = account.days[day];
    const incomingProgress = value && (value.completedUnits || 0);
    const existingProgress = existing && (existing.completedUnits || 0);
    const incomingComplete = !!(value && value.completedAt);
    const existingComplete = !!(existing && existing.completedAt);
    if (!existing ||
        (incomingComplete && !existingComplete) ||
        (incomingComplete === existingComplete && incomingProgress > existingProgress) ||
        (incomingComplete && existingComplete && value.completedAt > existing.completedAt)) {
      account.days[day] = value;
    }
  });
  const adopted = saveDailySprintHistory(account, ownerId);
  if (!adopted.ok) return;
  try { localStorage.removeItem(DAILY_SPRINT_KEY); } catch (e) {}
}

function dailySprintStringIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .filter(value => typeof value === 'string' && value.length <= 240)))
    .slice(0, 100);
}

function dailySprintIdsFrom(day, field) {
  return day && Array.isArray(day[field]) ? day[field] : [];
}

function mergeDailySprintDay(localDay, remoteDay) {
  if (!localDay) return remoteDay ? Object.assign({}, remoteDay) : null;
  if (!remoteDay) return Object.assign({}, localDay);
  const localProgress = Number(localDay.completedUnits) || 0;
  const remoteProgress = Number(remoteDay.completedUnits) || 0;
  const localUpdated = Number(localDay.updatedAt) || Number(localDay.completedAt) || Number(localDay.startedAt) || 0;
  const remoteUpdated = Number(remoteDay.updatedAt) || Number(remoteDay.completedAt) || Number(remoteDay.startedAt) || 0;
  const localRank = (localDay.completedAt ? 10000 : 0) + localProgress;
  const remoteRank = (remoteDay.completedAt ? 10000 : 0) + remoteProgress;
  const preferred = remoteRank > localRank || (remoteRank === localRank && remoteUpdated > localUpdated)
    ? remoteDay
    : localDay;
  const merged = Object.assign({}, preferred);
  merged.drillIds = dailySprintStringIds([...dailySprintIdsFrom(localDay, 'drillIds'), ...dailySprintIdsFrom(remoteDay, 'drillIds')]);
  merged.moveIds = dailySprintStringIds([...dailySprintIdsFrom(localDay, 'moveIds'), ...dailySprintIdsFrom(remoteDay, 'moveIds')]);
  merged.unitIds = dailySprintStringIds([
    ...dailySprintIdsFrom(localDay, 'unitIds'), ...dailySprintIdsFrom(remoteDay, 'unitIds'),
    ...merged.drillIds, ...merged.moveIds
  ]);
  merged.cleanDrillIds = dailySprintStringIds([...dailySprintIdsFrom(localDay, 'cleanDrillIds'), ...dailySprintIdsFrom(remoteDay, 'cleanDrillIds')]);
  merged.assistedDrillIds = dailySprintStringIds([...dailySprintIdsFrom(localDay, 'assistedDrillIds'), ...dailySprintIdsFrom(remoteDay, 'assistedDrillIds')]);
  merged.drillTarget = Math.max(0, Number(preferred.drillTarget) || 0);
  merged.moveTarget = Math.max(0, Number(preferred.moveTarget) || Number(preferred.target) || 0);
  merged.target = merged.drillTarget + merged.moveTarget;
  merged.drillsCompleted = Math.min(merged.drillTarget, Math.max(
    Number(localDay.drillsCompleted) || 0,
    Number(remoteDay.drillsCompleted) || 0,
    merged.drillIds.length
  ));
  merged.movesCompleted = Math.min(merged.moveTarget, Math.max(
    Number(localDay.movesCompleted) || 0,
    Number(remoteDay.movesCompleted) || 0,
    merged.moveIds.length
  ));
  merged.completedUnits = merged.drillsCompleted + merged.movesCompleted;
  merged.clean = Math.min(merged.drillsCompleted, Math.max(
    Number(localDay.clean) || 0,
    Number(remoteDay.clean) || 0,
    merged.cleanDrillIds.length
  ));
  merged.assisted = Math.min(merged.drillsCompleted, Math.max(
    Number(localDay.assisted) || 0,
    Number(remoteDay.assisted) || 0,
    merged.assistedDrillIds.length
  ));
  merged.startedAt = Math.min(
    Number(localDay.startedAt) || Number(remoteDay.startedAt) || Date.now(),
    Number(remoteDay.startedAt) || Number(localDay.startedAt) || Date.now()
  );
  merged.updatedAt = Math.max(localUpdated, remoteUpdated);
  merged.completedAt = localDay.completedAt && remoteDay.completedAt
    ? Math.min(Number(localDay.completedAt), Number(remoteDay.completedAt))
    : (Number(localDay.completedAt) || Number(remoteDay.completedAt) || null);
  if (merged.completedAt || (merged.target > 0 && merged.completedUnits >= merged.target)) {
    merged.completedAt = merged.completedAt || merged.updatedAt || Date.now();
    merged.phase = 'complete';
  } else {
    merged.phase = merged.drillsCompleted < merged.drillTarget ? 'drills' : 'moves';
  }
  return merged;
}

function mergeDailySprintHistories(localHistory, remoteRows) {
  const merged = { v: 1, days: Object.assign({}, (localHistory && localHistory.days) || {}) };
  (remoteRows || []).forEach(row => {
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.day_key) || !row.state || typeof row.state !== 'object') return;
    merged.days[row.day_key] = mergeDailySprintDay(merged.days[row.day_key], row.state);
  });
  return merged;
}

function dailySprintDayKey(now = Date.now()) {
  return practiceDayKey(now);
}

function dailySprintToday(ownerId = activePracticeOwnerId()) {
  const history = loadDailySprintHistory(ownerId);
  return history.days[dailySprintDayKey()] || null;
}

function dailySprintStreak(history = loadDailySprintHistory(), now = Date.now()) {
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!history.days[dailySprintDayKey(cursor.getTime())]?.completedAt) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (history.days[dailySprintDayKey(cursor.getTime())]?.completedAt) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function updateDailySprint(mutator) {
  const ownerId = activePracticeOwnerId();
  const history = loadDailySprintHistory(ownerId);
  const key = dailySprintDayKey();
  const current = Object.assign({
    mode: null,
    target: 0,
    completedUnits: 0,
    unitIds: [],
    clean: 0,
    assisted: 0,
    focus: null,
    focusTag: null,
    focusCue: null,
    phase: null,
    drillTarget: 0,
    drillsCompleted: 0,
    drillIds: [],
    moveTarget: 0,
    movesCompleted: 0,
    moveIds: [],
    takeaway: null,
    startedAt: Date.now(),
    completedAt: null
  }, history.days[key] || {});
  const next = mutator(current) || current;
  next.updatedAt = Date.now();
  history.days[key] = next;
  const saved = saveDailySprintHistory(history, ownerId);
  if (!saved.ok) setCoachStatus('Daily Sprint progress could not be saved in this browser.');
  else queueRemoteDailySprintSync();
  return next;
}

function applyAdaptiveGoalBoost(profiles) {
  const goal = typeof playerProfile === 'function' ? playerProfile().goal : 'balanced';
  const tags = {
    tactics: new Set(['missed_mate', 'missed_check', 'missed_capture', 'allowed_mate', 'allowed_forcing', 'fork_risk', 'hung_material', 'piece_left_en_prise', 'pin_pressure']),
    repertoire: new Set(['development', 'time_to_castle', 'missed_center_break', 'pawn_structure', 'opening_principles', 'premature_queen', 'candidate_moves']),
    endgames: new Set(['endgame_technique', 'endgame_conversion', 'passed_pawns', 'back_rank'])
  }[goal];
  if (tags) Object.values(profiles).forEach(profile => { if (tags.has(profile.tag)) profile.score += 0.75; });
}

function adaptiveFocusProfile(entries, now = Date.now()) {
  const profiles = {};
  const ensure = tag => {
    if (!INSIGHT_TAG_META[tag]) return null;
    if (!profiles[tag]) profiles[tag] = {
      tag, score: 0, occurrences: 0, attempts: 0, correct: 0, latestAt: 0
    };
    return profiles[tag];
  };
  (entries || []).forEach(entry => {
    if (!entry || !isInsightProblem(entry.tier)) return;
    const ageDays = Math.max(0, (now - (entry.ts || 0)) / DAY_MS);
    const recency = ageDays <= 7 ? 1.5 : (ageDays <= 30 ? 1 : 0.55);
    const severity = INSIGHT_TIER_WEIGHT[entry.tier] || 1;
    (entry.tags || []).forEach(tag => {
      const profile = ensure(tag);
      if (!profile) return;
      profile.score += severity * recency;
      profile.occurrences += 1;
      profile.latestAt = Math.max(profile.latestAt, entry.ts || 0);
    });
  });
  loadPracticeProgress().events.forEach(event => {
    if (!event || !event.tag || !Number.isFinite(event.at) || now - event.at > 30 * DAY_MS) return;
    const profile = ensure(event.tag);
    if (!profile) return;
    profile.attempts += 1;
    if (event.correct && !event.revealed) {
      profile.correct += 1;
      profile.score = Math.max(0, profile.score - 0.4);
    } else {
      profile.score += event.revealed ? 2 : 2.5;
    }
    profile.latestAt = Math.max(profile.latestAt, event.at);
  });
  applyAdaptiveGoalBoost(profiles);
  return Object.values(profiles).sort((a, b) =>
    b.score - a.score || b.occurrences - a.occurrences || b.latestAt - a.latestAt
  );
}

function adaptiveFocusReason(profile) {
  if (!profile) return 'Coach needs a short baseline before choosing a focus.';
  const mistakes = `${profile.occurrences} reviewed error${profile.occurrences === 1 ? '' : 's'}`;
  if (!profile.attempts) return `${mistakes}; this pattern has not been rehearsed yet.`;
  const rate = Math.round(profile.correct / profile.attempts * 100);
  return `${mistakes} and ${rate}% unassisted correct attempts across ${profile.attempts} practice attempt${profile.attempts === 1 ? '' : 's'}.`;
}

function prioritizeAdaptivePractice(items, profiles) {
  const scoreByTag = new Map((profiles || []).map(profile => [profile.tag, profile.score]));
  return (items || []).slice().sort((a, b) => {
    const score = (scoreByTag.get(b.tag) || 0) - (scoreByTag.get(a.tag) || 0);
    if (score) return score;
    const aDue = (practiceRecordFor(a) || {}).dueAt || 0;
    const bDue = (practiceRecordFor(b) || {}).dueAt || 0;
    return aDue - bDue;
  });
}

function adaptiveDailyPlan(entries, queue, due, totals) {
  const profiles = adaptiveFocusProfile(entries);
  const orderedDue = prioritizeAdaptivePractice(due, profiles);
  const focusProfile = orderedDue.length
    ? profiles.find(profile => profile.tag === orderedDue[0].tag) || { tag: orderedDue[0].tag, occurrences: 1, attempts: 0, correct: 0 }
    : profiles[0] || null;
  const meta = focusProfile ? INSIGHT_TAG_META[focusProfile.tag] : null;
  const returning = !!((entries || []).length || (queue || []).length || (totals && totals.attempts));
  if (orderedDue.length) {
    const plan = {
      kind: 'focus-transfer',
      focusTag: focusProfile.tag,
      focus: meta.title,
      cue: meta.practice,
      reason: adaptiveFocusReason(focusProfile),
      drillTarget: Math.min(DAILY_DRILL_TARGET, orderedDue.length),
      moveTarget: DAILY_TRANSFER_TARGET,
      orderedDue
    };
    return typeof personalizeAdaptivePlan === 'function' ? personalizeAdaptivePlan(plan) : plan;
  }
  if (returning && meta) {
    const plan = {
      kind: 'transfer', focusTag: focusProfile.tag, focus: meta.title,
      cue: meta.practice, reason: adaptiveFocusReason(focusProfile),
      drillTarget: 0, moveTarget: 8, orderedDue: []
    };
    return typeof personalizeAdaptivePlan === 'function' ? personalizeAdaptivePlan(plan) : plan;
  }
  const plan = {
    kind: 'baseline', focusTag: null, focus: 'Build your baseline',
    cue: 'Play naturally. Coach will turn recurring mistakes into tomorrow’s focus.',
    reason: 'No reviewed history yet.', drillTarget: 0, moveTarget: DAILY_MOVE_TARGET, orderedDue: []
  };
  return typeof personalizeAdaptivePlan === 'function' ? personalizeAdaptivePlan(plan) : plan;
}

function initializeAdaptiveDay(day, plan) {
  const selected = plan || renderedAdaptivePlan || adaptiveDailyPlan([], [], [], practiceProgressTotals());
  day.mode = 'adaptive';
  day.phase = selected.drillTarget ? 'drills' : 'moves';
  day.focusTag = selected.focusTag;
  day.focus = selected.focus;
  day.focusCue = selected.cue;
  day.focusReason = selected.reason;
  day.drillTarget = selected.drillTarget;
  day.moveTarget = selected.moveTarget;
  day.target = selected.drillTarget + selected.moveTarget;
  day.drillsCompleted = 0;
  day.movesCompleted = 0;
  day.completedUnits = 0;
  day.drillIds = [];
  day.moveIds = [];
  day.unitIds = [];
  day.clean = 0;
  day.assisted = 0;
  day.cleanDrillIds = [];
  day.assistedDrillIds = [];
  return day;
}

function upgradeLegacyDailySprint(day, plan) {
  if (!day || day.mode === 'adaptive') return day;
  const selected = plan || renderedAdaptivePlan || adaptiveDailyPlan([], [], [], practiceProgressTotals());
  const legacyMode = day.mode;
  const legacyIds = Array.isArray(day.unitIds) ? day.unitIds.slice() : [];
  const legacyCompleted = Math.min(day.target || legacyIds.length, day.completedUnits || legacyIds.length);
  day.mode = 'adaptive';
  day.focusTag = selected.focusTag;
  day.focus = day.focus || selected.focus;
  day.focusCue = selected.cue;
  day.focusReason = 'Continued from the Daily Sprint already started before this update.';
  day.clean = day.clean || 0;
  day.assisted = day.assisted || 0;
  if (legacyMode === 'drills') {
    day.drillsCompleted = legacyCompleted;
    day.drillIds = legacyIds;
    day.drillTarget = Math.max(
      day.drillsCompleted,
      Math.min(day.target || DAILY_DRILL_TARGET, selected.drillTarget || DAILY_DRILL_TARGET)
    );
    day.phase = day.drillsCompleted >= day.drillTarget ? 'moves' : 'drills';
    day.moveTarget = DAILY_TRANSFER_TARGET;
    day.movesCompleted = 0;
    day.moveIds = [];
  } else {
    day.phase = 'moves';
    day.drillTarget = 0;
    day.drillsCompleted = 0;
    day.drillIds = [];
    day.moveTarget = day.target || DAILY_MOVE_TARGET;
    day.movesCompleted = legacyCompleted;
    day.moveIds = legacyIds;
  }
  day.target = day.drillTarget + day.moveTarget;
  day.completedUnits = day.drillsCompleted + day.movesCompleted;
  return day;
}

function beginDailyMoveSprint() {
  const existing = dailySprintToday();
  if (existing && (existing.completedAt || existing.mode === 'adaptive')) return existing;
  return updateDailySprint(day => {
    if (day.mode) return upgradeLegacyDailySprint(day, renderedAdaptivePlan);
    return initializeAdaptiveDay(day, renderedAdaptivePlan);
  });
}

function beginDailyDrillSprint(items) {
  const existing = dailySprintToday();
  if (existing && (existing.completedAt || existing.mode === 'adaptive')) return existing;
  return updateDailySprint(day => {
    if (day.mode) return upgradeLegacyDailySprint(day, renderedAdaptivePlan);
    initializeAdaptiveDay(day, renderedAdaptivePlan);
    day.drillTarget = Math.min(day.drillTarget || DAILY_DRILL_TARGET, (items || []).length);
    day.target = day.drillTarget + day.moveTarget;
    return day;
  });
}

function dailyMoveSprintTakeaway(day) {
  const scored = (coachReviewLog || []).filter(review => review && review.tier && review.tier !== 'unknown');
  if (day && day.focusTag && INSIGHT_TAG_META[day.focusTag]) {
    const repeats = scored.filter(review => (review.insightTags || review.tags || []).includes(day.focusTag)).length;
    const result = scored.length
      ? `In this game's ${scored.length} reviewed moves, the pattern was flagged ${repeats} time${repeats === 1 ? '' : 's'}.`
      : 'No reviewed moves from this game are available for a transfer check.';
    return `${day.focus}: ${day.clean || 0}/${day.drillsCompleted || 0} drills first-try. ${result} This short sample does not establish improvement; the same challenge may not have occurred. Keep using this cue: ${day.focusCue}`;
  }
  const problem = scored.slice().reverse().find(review => isInsightProblem(review.tier));
  const tag = problem && (problem.tags || []).find(value => INSIGHT_TAG_META[value]);
  if (tag) return `Today’s focus: ${INSIGHT_TAG_META[tag].title}. ${INSIGHT_TAG_META[tag].practice}`;
  const accuracy = accuracyFromTallies(coachStats || {}, scored.length);
  return accuracy === null
    ? 'You completed the habit. Return tomorrow for the next focused sprint.'
    : `Session activity: ${accuracy}% accuracy across ${scored.length} reviewed moves in this game. Keep practising to build evidence over time.`;
}

function recordDailySprintMove(review) {
  const existing = dailySprintToday();
  if (existing && (existing.completedAt || existing.mode === 'drills' || (existing.mode === 'adaptive' && existing.phase === 'drills'))) return existing;
  const id = `${coachLocalGameId || 'local'}:${review.ply}`;
  return updateDailySprint(day => {
    if (day.mode && day.mode !== 'adaptive') upgradeLegacyDailySprint(day, renderedAdaptivePlan);
    else if (day.mode !== 'adaptive') initializeAdaptiveDay(day, renderedAdaptivePlan);
    day.phase = 'moves';
    day.moveIds = Array.isArray(day.moveIds) ? day.moveIds : [];
    if (!day.moveIds.includes(id)) day.moveIds.push(id);
    day.movesCompleted = Math.min(day.moveTarget, day.moveIds.length);
    day.completedUnits = (day.drillsCompleted || 0) + day.movesCompleted;
    if (day.completedUnits >= day.target && !day.completedAt) {
      day.completedAt = Date.now();
      day.phase = 'complete';
      day.takeaway = dailyMoveSprintTakeaway(day);
    }
    return day;
  });
}

function recordDailySprintDrill(item, revealed, clean) {
  const existing = dailySprintToday();
  if (existing && (existing.completedAt || existing.mode === 'moves')) return existing;
  return updateDailySprint(day => {
    if (day.mode && day.mode !== 'adaptive') upgradeLegacyDailySprint(day, renderedAdaptivePlan);
    else if (day.mode !== 'adaptive') initializeAdaptiveDay(day, renderedAdaptivePlan);
    day.drillIds = Array.isArray(day.drillIds) ? day.drillIds : [];
    day.cleanDrillIds = Array.isArray(day.cleanDrillIds) ? day.cleanDrillIds : [];
    day.assistedDrillIds = Array.isArray(day.assistedDrillIds) ? day.assistedDrillIds : [];
    if (!day.drillIds.includes(item.id)) {
      day.drillIds.push(item.id);
      if (clean) day.cleanDrillIds.push(item.id);
      if (revealed) day.assistedDrillIds.push(item.id);
    }
    day.drillsCompleted = Math.min(day.drillTarget, day.drillIds.length);
    day.clean = Math.min(day.drillsCompleted, Math.max(day.clean || 0, day.cleanDrillIds.length));
    day.assisted = Math.min(day.drillsCompleted, Math.max(day.assisted || 0, day.assistedDrillIds.length));
    day.completedUnits = day.drillsCompleted + (day.movesCompleted || 0);
    if (day.drillsCompleted >= day.drillTarget) day.phase = 'moves';
    return day;
  });
}

function setDailySprintProgress(completed, target, unit) {
  const safeTarget = Math.max(1, target || 1);
  const safeCompleted = Math.max(0, Math.min(safeTarget, completed || 0));
  const percent = Math.round(safeCompleted / safeTarget * 100);
  $('#daily-sprint-progress-label').text(`${safeCompleted} of ${safeTarget} ${unit}${safeTarget === 1 ? '' : 's'}`);
  $('#daily-sprint-progress-percent').text(`${percent}%`);
  $('#daily-sprint-fill').css('width', `${percent}%`);
}

function dailySprintProgressUnit(day) {
  if (!day || day.mode !== 'adaptive') return day && day.mode === 'drills' ? 'drill' : 'move';
  return day.drillTarget > 0 ? 'step' : 'move';
}

function renderDailySprintChrome(day) {
  const history = loadDailySprintHistory();
  const streak = dailySprintStreak(history);
  $('#daily-sprint-streak').text(streak ? `${streak}-day streak` : 'Start a streak');
  $('#coach-daily-plan').toggleClass('is-complete', !!(day && day.completedAt));
  const focus = day && day.focus
    ? { title: day.focus, cue: day.focusCue, reason: day.focusReason }
    : renderedAdaptivePlan && { title: renderedAdaptivePlan.focus, cue: renderedAdaptivePlan.cue, reason: renderedAdaptivePlan.reason };
  const style = renderedAdaptivePlan && renderedAdaptivePlan.sessionStyle === 'drills'
    ? 'Drills-first session.'
    : renderedAdaptivePlan && renderedAdaptivePlan.sessionStyle === 'play'
      ? 'Play-first session.'
      : 'Balanced session.';
  const repertoire = renderedAdaptivePlan && renderedAdaptivePlan.repertoireFocus
    ? ` Repertoire focus: ${renderedAdaptivePlan.repertoireFocus}.`
    : '';
  $('#daily-sprint-focus-title').text(focus ? `Focus · ${focus.title}` : '');
  $('#daily-sprint-focus-cue').text(focus ? focus.cue : '');
  $('#daily-sprint-focus-detail').text(focus ? `${focus.reason} ${style}${repertoire}${day && day.recoveryNote ? ' ' + day.recoveryNote : ''}` : '');
  const hasFocus = !!(day ? day.focusTag : renderedAdaptivePlan && renderedAdaptivePlan.focusTag);
  $('#daily-sprint-focus').toggle(!!focus && hasFocus);
  renderCoachPresentation();
  $('#daily-sprint-takeaway')
    .text(day && day.takeaway ? day.takeaway : '')
    .toggle(!!(day && day.completedAt && day.takeaway));
}

function formatPracticeDue(record) {
  if (!record || !record.dueAt || record.dueAt <= Date.now()) return 'Due now';
  const days = Math.max(1, Math.ceil((record.dueAt - Date.now()) / DAY_MS));
  return `Due in ${days}d`;
}

// Older saved plans may require more positions than still exist in the due
// queue. Keep earned work, remove only unavailable rehearsal slots, and retain
// the live-play target so recovery never invents a completed session.
function recoverDailySprintPlan(day, availableDrills) {
  if (!day || day.completedAt || day.mode !== 'adaptive' || day.phase !== 'drills') return day;
  const completed = Math.max(0, Number(day.drillsCompleted) || 0);
  const target = Math.max(completed, Number(day.drillTarget) || 0);
  const reachable = completed + Math.min(target - completed, Math.max(0, availableDrills));
  if (reachable === target) return day;
  const moveTarget = Math.max(Number(day.movesCompleted) || 0, Number(day.moveTarget) || DAILY_TRANSFER_TARGET);
  return Object.assign({}, day, {
    drillTarget: reachable, moveTarget, target: reachable + moveTarget,
    completedUnits: completed + (Number(day.movesCompleted) || 0),
    phase: completed >= reachable ? 'moves' : 'drills',
    recoveryNote: 'Saved session adjusted: unavailable drills were removed. Your completed work is kept; live play remains.'
  });
}
