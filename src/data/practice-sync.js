// Account sync for practice attempts and daily sessions.
// Classic script loaded before app.js (see index.html); its top-level
// declarations are shared globals, as they were inside app.js.

function queueRemotePracticeProgressSync(event) {
  if (!hasCoachDbSession() || !event) return;
  const previous = practiceRemoteSyncChains.get(event.drillId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => syncRemotePracticeEvent(event))
    .catch(handleCoachDbError)
    .finally(() => {
      if (practiceRemoteSyncChains.get(event.drillId) === next) {
        practiceRemoteSyncChains.delete(event.drillId);
      }
    });
  practiceRemoteSyncChains.set(event.drillId, next);
}

function mergeRemotePracticeRecords(rows, ownerId = activePracticeOwnerId()) {
  if (!Array.isArray(rows) || !rows.length) return;
  const state = loadPracticeProgress(ownerId);
  let changed = false;
  rows.forEach(row => {
    if (!row || !row.fen || !row.best_uci || !row.tag) return;
    const id = row.drill_key || practiceItemId({ fenBefore: row.fen, bestUci: row.best_uci }, row.tag);
    const local = state.records[id];
    const remoteAttemptAt = row.last_attempt_at ? Date.parse(row.last_attempt_at) : 0;
    if (local && (local.lastAttemptAt || 0) > remoteAttemptAt) return;
    state.records[id] = Object.assign({}, local || {}, {
      reps: row.reps || 0,
      ease: Number(row.ease) || 2.5,
      intervalDays: row.interval_days || 0,
      // The server steps whole days from the attempt; this browser schedules
      // to its own local midnight, as recordPracticeAttempt does.
      dueAt: remoteAttemptAt && (row.interval_days || 0) > 0 && typeof practiceDayStart === 'function'
        ? practiceDayStart(remoteAttemptAt, row.interval_days)
        : (row.due_at ? Date.parse(row.due_at) : 0),
      attempts: row.attempts || 0,
      correct: row.correct || 0,
      lastResult: row.last_result || null,
      lastAttemptAt: remoteAttemptAt,
      remoteUpdatedAt: row.updated_at ? Date.parse(row.updated_at) : 0
    });
    changed = true;
  });
  if (changed) savePracticeProgress(state, ownerId);
}

function mergeRemotePracticeEvents(rows, ownerId = activePracticeOwnerId()) {
  if (!Array.isArray(rows) || !rows.length) return;
  const state = loadPracticeProgress(ownerId);
  const byId = new Map(state.events.map(event => [event.id, event]));
  let changed = false;
  rows.forEach(row => {
    if (!row || !row.id || !row.drill_key || !row.attempted_at) return;
    const existing = byId.get(row.id);
    if (existing) {
      if (!existing.synced) {
        existing.synced = true;
        changed = true;
      }
      return;
    }
    const event = {
      id: row.id,
      ownerId,
      drillId: row.drill_key,
      sourceMoveId: row.source_move_id || null,
      tag: row.tag,
      at: Date.parse(row.attempted_at),
      correct: !!row.correct,
      revealed: !!row.revealed,
      result: row.result,
      synced: true
    };
    state.events.push(event);
    byId.set(event.id, event);
    changed = true;
  });
  if (changed) savePracticeProgress(state, ownerId);
}

async function syncRemotePracticeEvent(event) {
  if (!hasCoachDbSession() || !event) return;
  const ownerId = event.ownerId || activePracticeOwnerId();
  if (!ownerId || activePracticeOwnerId() !== ownerId) return;
  const send = sourceMoveId => coachDbClient.rpc('record_practice_attempt', {
    p_event_id: event.id,
    p_drill_key: event.drillId,
    p_source_move_id: sourceMoveId,
    p_tag: event.tag,
    p_fen: event.fen,
    p_best_uci: event.bestUci,
    p_best_san: event.bestSan || null,
    p_prompt: event.prompt || null,
    p_correct: !!event.correct,
    p_revealed: !!event.revealed,
    p_attempted_at: new Date(event.at).toISOString()
  });
  let { data, error } = await send(event.sourceMoveId || null);
  // The source move can be taken back after the attempt (foreign key or
  // ownership check fails); the attempt still counts for its drill.
  if (error && event.sourceMoveId && ['23503', '42501'].includes(String(error.code))) ({ data, error } = await send(null));
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (row) mergeRemotePracticeRecords([row], ownerId);
  markPracticeEventSynced(event.id, ownerId);
}

// Database errors a retry cannot fix: invalid data (22xxx), constraint
// violations (23xxx), permission (42501) and the RPC's own checks (P0001).
// Network and server outages carry no such code and stay pending.
function isPermanentPracticeSyncError(error) {
  const code = String((error && error.code) || '');
  return /^2[23]/.test(code) || code === '42501' || code === 'P0001';
}

function markPracticeEventRejected(eventId, ownerId, error) {
  const state = loadPracticeProgress(ownerId);
  const event = state.events.find(item => item.id === eventId);
  if (!event || event.synced) return;
  event.syncRejected = String(error.code);
  savePracticeProgress(state, ownerId);
}

async function syncPendingPracticeEvents() {
  if (!hasCoachDbSession()) return;
  const ownerId = activePracticeOwnerId();
  const pending = loadPracticeProgress(ownerId).events.filter(event => !event.synced && !event.syncRejected);
  for (const event of pending) {
    if (!event.ownerId) event.ownerId = ownerId;
    try {
      await syncRemotePracticeEvent(event);
    } catch (error) {
      // One attempt the account rejects must not hold back every later one.
      if (!isPermanentPracticeSyncError(error)) throw error;
      markPracticeEventRejected(event.id, ownerId, error);
    }
  }
}

function queueRemoteDailySprintSync() {
  if (!hasCoachDbSession()) return;
  if (dailySprintSyncTimer) clearTimeout(dailySprintSyncTimer);
  dailySprintSyncTimer = setTimeout(() => {
    dailySprintSyncTimer = null;
    dailySprintSyncChain = dailySprintSyncChain
      .catch(() => {})
      .then(() => syncRemoteDailySprints({ silent: true }))
      .catch(handleCoachDbError);
  }, DAILY_SPRINT_SYNC_DEBOUNCE_MS);
}

async function syncRemoteDailySprints(opts = {}) {
  if (!hasCoachDbSession()) return;
  const ownerId = activePracticeOwnerId();
  if (!opts.silent) setCoachDbStatus('Syncing training sessions...');
  const { data, error } = await coachDbClient
    .from('daily_training_sessions')
    .select('day_key,state,updated_at')
    .eq('user_id', ownerId)
    .order('day_key', { ascending: false })
    .limit(DAILY_HISTORY_LIMIT);
  if (error) throw error;
  if (activePracticeOwnerId() !== ownerId) return;

  const merged = mergeDailySprintHistories(loadDailySprintHistory(ownerId), data || []);
  const saved = saveDailySprintHistory(merged, ownerId);
  if (!saved.ok) throw saved.error || new Error('Training history could not be saved locally');
  const latest = loadDailySprintHistory(ownerId);
  const payload = Object.entries(latest.days).map(([dayKey, state]) => ({
    user_id: ownerId,
    day_key: dayKey,
    state,
    client_updated_at: new Date(Number(state.updatedAt) || Number(state.completedAt) || Number(state.startedAt) || Date.now()).toISOString()
  }));
  if (payload.length) {
    const result = await coachDbClient
      .from('daily_training_sessions')
      .upsert(payload, { onConflict: 'user_id,day_key' });
    if (result.error) throw result.error;
  }
  if (activePracticeOwnerId() !== ownerId) return;
  renderCoachDailyPlan();
  if (!opts.silent) setCoachDbStatus('Training sessions synced.');
}
