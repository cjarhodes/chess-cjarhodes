// Browser-specific recovery points. The account owns every row; continuing a
// remote/backup session creates a separate, unrated game with no remote IDs.
const ACCOUNT_CHECKPOINT_KEY = 'coach:checkpoint-import:v1';
const ACCOUNT_PREVIOUS_KEY = 'coach:checkpoint-previous:v1';
const ACCOUNT_IMPORT_JOURNAL_KEY = 'coach:import-journal:v1';
const ACCOUNT_CHECKPOINT_LIMIT = 240 * 1024;
const accountCheckpoint = { owner: null, revision: null, loaded: false, conflict: false, writing: false,
  candidate: null, timer: null, chain: Promise.resolve(), dirty: 0, saved: 0, message: '' };

function accountCheckpointDeviceId() {
  try { return sessionStorage.getItem(coachMemoryKey('coach:checkpoint-device:v1')) || coachDeviceId(); }
  catch (e) { return coachDeviceId(); }
}

function pauseAccountCheckpoint() {
  accountCheckpoint.conflict = true;
  try { sessionStorage.setItem(coachMemoryKey('coach:checkpoint-conflict:v1'), '1'); } catch (e) {}
}

function accountCheckpointKeys() {
  return { game: COACH_STATE_KEY, practice: COACH_PRACTICE_STATE_KEY, returnState: COACH_PRACTICE_RETURN_KEY };
}

function readLocalAccountCheckpoint() {
  const snapshot = { v: 1, owner: coachMemoryOwnerId(), savedAt: 0 };
  Object.entries(accountCheckpointKeys()).forEach(([name, key]) => {
    const raw = localStorage.getItem(coachMemoryKey(key));
    snapshot[name] = raw ? JSON.parse(raw) : null;
    snapshot.savedAt = Math.max(snapshot.savedAt, Number(snapshot[name] && snapshot[name].ts) || 0);
  });
  return snapshot.game || snapshot.practice ? snapshot : null;
}

function validateAccountCheckpoint(value) {
  if (!value || value.v !== 1 || typeof value.owner !== 'string' ||
      new TextEncoder().encode(JSON.stringify(value)).length > ACCOUNT_CHECKPOINT_LIMIT ||
      (!value.game && !value.practice)) throw new Error('That saved session is incomplete or too large. Export a smaller session backup.');
  const checkGame = game => {
    if (!game || game.v !== 1 || !['white', 'black', 'random'].includes(game.userSide) ||
        !Number.isFinite(game.engineElo) || game.engineElo < 400 || game.engineElo > 3000 ||
        !Array.isArray(game.reviewLog)) throw new Error('That saved game cannot be read. Your current session was kept.');
    loadCoachSavedPosition(game);
  };
  if (value.game) checkGame(value.game);
  if (value.returnState) checkGame(value.returnState);
  if (value.practice) {
    const saved = value.practice, session = saved.session, item = session && session.item;
    if (saved.v !== 1 || saved.owner !== value.owner || !item || !item.entry ||
        !isValidFen(item.entry.fenBefore) || !item.entry.bestUci || !saved.run ||
        !Array.isArray(saved.run.items) || !Number.isInteger(saved.run.index) || saved.run.index < 0 ||
        saved.run.index >= saved.run.items.length || saved.run.items[saved.run.index].id !== item.id ||
        !['initial', 'followup', 'complete'].includes(session.phase) ||
        !Number.isFinite(session.misses) || session.misses < 0 || !Number.isFinite(session.hintStage) ||
        session.hintStage < 0 || session.hintStage > 4 || (!!session.completed !== !!session.completionRecorded)) {
      throw new Error('That saved practice session cannot be read. Your current session was kept.');
    }
    loadCoachSavedPosition({ startFen: item.entry.fenBefore, pgn: saved.pgn, fen: saved.fen });
    if (!session.completed && !moveFromUci(saved.fen, session.expectedUci)) throw new Error('Saved practice answer is invalid.');
    if (saved.returnState) checkGame(saved.returnState);
  }
  return value;
}

// Keep the original values in a single atomic journal before a multi-key
// import. If storage becomes unavailable during rollback, the originals remain
// recoverable and sync stays paused until recovery succeeds.
function restoreContinuityJournal(journal) {
  const allowed = new Set(trainingBackupKeys().concat([coachMemoryKey(ACCOUNT_CHECKPOINT_KEY), coachMemoryKey(ACCOUNT_PREVIOUS_KEY)]));
  if (!journal || journal.v !== 1 || journal.owner !== coachMemoryOwnerId() || !Array.isArray(journal.before) ||
      journal.before.some(pair => !Array.isArray(pair) || !allowed.has(pair[0]) || (pair[1] !== null && typeof pair[1] !== 'string'))) throw new Error('Import recovery cannot be read.');
  const rows = journal.before.slice().sort((a,b) => {
    const delta = pair => (pair[1] || '').length - (localStorage.getItem(pair[0]) || '').length;
    return delta(a) - delta(b);
  });
  rows.forEach(([key,raw]) => {
    if (localStorage.getItem(key) === raw) return;
    if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw);
  });
  localStorage.removeItem(coachMemoryKey(ACCOUNT_IMPORT_JOURNAL_KEY));
}

function recoverContinuityWrites() {
  try {
    const raw = localStorage.getItem(coachMemoryKey(ACCOUNT_IMPORT_JOURNAL_KEY));
    if (raw) restoreContinuityJournal(JSON.parse(raw));
    return true;
  } catch (error) {
    $('#account-checkpoint-status').text('Import recovery is paused because browser storage is unavailable. Your previous data is retained. Free space, then reload.');
    return false;
  }
}

function writeContinuityValues(values) {
  if (!recoverContinuityWrites()) throw new Error('Finish the previous import recovery before importing again.');
  const journal = { v: 1, owner: coachMemoryOwnerId(), before: Object.keys(values).map(key => [key, localStorage.getItem(key)]) };
  try {
    localStorage.setItem(coachMemoryKey(ACCOUNT_IMPORT_JOURNAL_KEY), JSON.stringify(journal));
  } catch (error) { throw new Error('This browser has insufficient storage for a safe import. Free some space, then retry. Nothing was imported.'); }
  try {
    Object.entries(values).forEach(([key, value]) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    });
    localStorage.removeItem(coachMemoryKey(ACCOUNT_IMPORT_JOURNAL_KEY));
  } catch (error) {
    try { restoreContinuityJournal(journal); }
    catch (recoveryError) { throw new Error('Import paused because storage became unavailable. Your previous data is retained for recovery. Free space, then reload before syncing.'); }
    throw new Error('This browser could not store the import. Free some space, then retry. Your previous data was restored.');
  }
}

function storedAccountCheckpoint(key) {
  try {
    const value = JSON.parse(localStorage.getItem(coachMemoryKey(key)));
    return value && value.owner === coachMemoryOwnerId() ? validateAccountCheckpoint(value) : null;
  } catch (e) { return null; }
}

function renderAccountCheckpoint() {
  const signedIn = hasCoachDbSession();
  const imported = storedAccountCheckpoint(ACCOUNT_CHECKPOINT_KEY);
  const candidate = imported || (accountCheckpoint.owner === coachMemoryOwnerId() ? accountCheckpoint.candidate : null);
  $('#btn-account-resume').prop('hidden', !candidate).text(imported ? 'Continue session from backup' : 'Continue saved session');
  $('#btn-account-previous').prop('hidden', !storedAccountCheckpoint(ACCOUNT_PREVIOUS_KEY));
  let message = accountCheckpoint.owner === coachMemoryOwnerId() ? accountCheckpoint.message : '';
  if (!message) message = signedIn ? 'Checking saved sessions…' : 'Sessions are saved here. Sign in or export a backup to continue elsewhere.';
  if (imported) message = 'Backup ready. Continue a separate copy; your current session will be kept below.';
  else if (candidate) message += ' Continue a separate copy; the original browser keeps its session.';
  $('#account-checkpoint-status').text(message);
}

function handleAccountCheckpointError(error, owner = coachMemoryOwnerId()) {
  if (owner !== coachMemoryOwnerId()) return;
  accountCheckpoint.owner = owner;
  accountCheckpoint.message = 'Session sync unavailable. Your browser copy is kept; use Sync now to retry or export a backup.';
  renderAccountCheckpoint();
}

async function refreshAccountCheckpoints() {
  const owner = coachMemoryOwnerId();
  if (accountCheckpoint.owner !== owner) {
    if (accountCheckpoint.timer) clearTimeout(accountCheckpoint.timer);
    Object.assign(accountCheckpoint, { owner, revision: null, loaded: false, conflict: false, writing: false,
      candidate: null, timer: null, dirty: 0, saved: 0, message: '' });
    try { accountCheckpoint.conflict = sessionStorage.getItem(coachMemoryKey('coach:checkpoint-conflict:v1')) === '1'; } catch (e) {}
  }
  if (!hasCoachDbSession()) { renderAccountCheckpoint(); return; }
  const userId = coachAuthUser.id, device = accountCheckpointDeviceId();
  const [own, others] = await Promise.all([
    coachDbClient.from('coach_checkpoints').select('snapshot,revision,updated_at,device_id').eq('user_id', userId).eq('device_id', device).maybeSingle(),
    coachDbClient.from('coach_checkpoints').select('snapshot,revision,updated_at,device_id').eq('user_id', userId).neq('device_id', device).order('updated_at', { ascending: false }).limit(5)
  ]);
  if (owner !== coachMemoryOwnerId()) return;
  if (own.error) throw own.error;
  if (others.error) throw others.error;
  // Refresh must not silently advance a stale tab's write revision.
  if (!accountCheckpoint.loaded) {
    accountCheckpoint.revision = own.data ? own.data.revision : null;
    const local = readLocalAccountCheckpoint();
    if (own.data && (!local || (own.data.snapshot.savedAt || 0) > (local.savedAt || 0))) {
      pauseAccountCheckpoint();
    }
  } else if (own.data && !accountCheckpoint.writing && Number(own.data.revision) > Number(accountCheckpoint.revision || 0)) pauseAccountCheckpoint();
  accountCheckpoint.loaded = true;
  const candidates = (accountCheckpoint.conflict && own.data ? [own.data] : []).concat(others.data || []);
  accountCheckpoint.candidate = null;
  for (const row of candidates) {
    try {
      if (row.snapshot.owner !== owner) continue;
      accountCheckpoint.candidate = validateAccountCheckpoint(row.snapshot);
      break;
    } catch (e) { /* malformed remote checkpoints never replace a local board */ }
  }
  accountCheckpoint.message = accountCheckpoint.conflict
    ? 'Another tab saved a newer session. Automatic session sync is paused here. Export a backup or continue the saved copy.'
    : own.data ? 'This browser has a saved account session.' : 'No session uploaded from this browser yet.';
  renderAccountCheckpoint();
  if (!accountCheckpoint.conflict && readLocalAccountCheckpoint()) queueAccountCheckpoint();
}

function queueAccountCheckpoint() {
  if (!hasCoachDbSession()) return;
  if (typeof updatePendingAccountGame === 'function') {
    try { updatePendingAccountGame(); } catch (error) { handleAccountCheckpointError(error); }
  }
  accountCheckpoint.dirty++;
  if (accountCheckpoint.owner === coachMemoryOwnerId() && !accountCheckpoint.conflict) {
    accountCheckpoint.message = navigator.onLine === false
      ? 'Offline. Changes are saved here; reconnect and use Sync now.'
      : 'Changes saved here. Session upload pending…';
    renderAccountCheckpoint();
  }
  if (accountCheckpoint.timer) clearTimeout(accountCheckpoint.timer);
  accountCheckpoint.timer = setTimeout(() => {
    accountCheckpoint.timer = null;
    flushAccountCheckpoint().catch(handleAccountCheckpointError);
  }, 1000);
}

function flushAccountCheckpoint() {
  const owner = coachMemoryOwnerId();
  accountCheckpoint.chain = accountCheckpoint.chain.catch(() => {}).then(async () => {
    if (owner !== coachMemoryOwnerId() || !hasCoachDbSession()) return;
    if (!recoverContinuityWrites()) throw new Error('Import recovery must finish before syncing.');
    if (!accountCheckpoint.loaded || accountCheckpoint.owner !== owner) await refreshAccountCheckpoints();
    if (owner !== coachMemoryOwnerId() || accountCheckpoint.conflict) return;
    if (accountCheckpoint.timer) { clearTimeout(accountCheckpoint.timer); accountCheckpoint.timer = null; }
    const snapshot = readLocalAccountCheckpoint();
    if (!snapshot) return;
    validateAccountCheckpoint(snapshot);
    const dirty = accountCheckpoint.dirty, revision = accountCheckpoint.revision;
    const userId = coachAuthUser.id, device = accountCheckpointDeviceId();
    const payload = { user_id: userId, device_id: device, snapshot };
    const query = revision === null
      ? coachDbClient.from('coach_checkpoints').insert(payload)
      : coachDbClient.from('coach_checkpoints').update({ snapshot }).eq('user_id', userId).eq('device_id', device).eq('revision', revision);
    accountCheckpoint.writing = true;
    let result;
    try { result = await query.select('revision,updated_at').maybeSingle(); }
    finally { if (accountCheckpoint.owner === owner) accountCheckpoint.writing = false; }
    if (owner !== coachMemoryOwnerId()) return;
    if ((result.error && result.error.code === '23505') || (!result.error && !result.data)) {
      pauseAccountCheckpoint();
      await refreshAccountCheckpoints();
      return;
    }
    if (result.error) throw result.error;
    accountCheckpoint.revision = result.data.revision;
    accountCheckpoint.saved = dirty;
    accountCheckpoint.message = 'Session saved to your account. Continue it from Account on another browser.';
    renderAccountCheckpoint();
    if (dirty !== accountCheckpoint.dirty) queueAccountCheckpoint();
  });
  return accountCheckpoint.chain;
}

function copiedAccountCheckpoint(source) {
  const snapshot = cloneCoachValue(validateAccountCheckpoint(source), null);
  const owner = coachMemoryOwnerId(), gameIds = new Map();
  const rewrite = value => {
    if (!value || typeof value !== 'object') return;
    if (value.localGameId && Array.isArray(value.reviewLog)) value.continuityCopy = true;
    Object.entries(value).forEach(([key, item]) => {
      if (key === 'owner') value[key] = owner;
      else if (key === 'remoteGameId') value[key] = null;
      else if (key === 'localGameId' && item) {
        if (!gameIds.has(item)) gameIds.set(item, createCoachGameId());
        value[key] = gameIds.get(item);
      } else rewrite(item);
    });
  };
  rewrite(snapshot);
  [snapshot.game, snapshot.returnState, snapshot.practice && snapshot.practice.returnState].filter(Boolean).forEach(game => {
    game.continuityCopy = true;
    game.ts = Date.now();
  });
  snapshot.owner = owner;
  snapshot.savedAt = Date.now();
  return { snapshot, gameIds };
}

function continueAccountCheckpoint(source, opts = {}) {
  if (!source || source.owner !== coachMemoryOwnerId()) throw new Error('This saved session belongs to another account.');
  if (coachThinking || (coachPracticeSession && (coachPracticeSession.grading || coachPracticeSession.pendingMove))) {
    throw new Error('Wait for the current move to finish, then continue the saved session.');
  }
  if (coachPracticeSession) saveCoachPracticeState(); else saveCoachState();
  const current = readLocalAccountCheckpoint();
  const { snapshot, gameIds } = copiedAccountCheckpoint(source);
  const values = {};
  if (current) values[coachMemoryKey(ACCOUNT_PREVIOUS_KEY)] = current;
  Object.entries(accountCheckpointKeys()).forEach(([name, key]) => { values[coachMemoryKey(key)] = snapshot[name] || null; });
  if (opts.imported) values[coachMemoryKey(ACCOUNT_CHECKPOINT_KEY)] = null;
  writeContinuityValues(values);
  resetCoachState();
  coachGame = null;
  coachGameActive = false;
  coachPracticeReturnState = null;
  switchView('coach');
  // Keep the learning follow-up linked to the game that now continues here.
  if (typeof loadGrowthState === 'function') {
    const growth = loadGrowthState();
    (growth.learningTransfers || []).forEach(record => { if (gameIds.has(record.playGameId)) record.playGameId = gameIds.get(record.playGameId); });
    saveGrowthState(growth);
  }
  if (accountCheckpoint.conflict) {
    sessionStorage.setItem(coachMemoryKey('coach:checkpoint-device:v1'), createCoachGameId());
    sessionStorage.removeItem(coachMemoryKey('coach:checkpoint-conflict:v1'));
    accountCheckpoint.conflict = false;
    accountCheckpoint.loaded = false;
    accountCheckpoint.revision = null;
  }
  queueAccountCheckpoint();
  accountCheckpoint.message = 'Session continued here as an unrated copy. Earlier reviews are kept without adding another lifetime game.';
  renderAccountCheckpoint();
}

$(function initAccountContinuity() {
  $('#btn-account-resume').on('click', () => {
    try {
      const imported = storedAccountCheckpoint(ACCOUNT_CHECKPOINT_KEY);
      continueAccountCheckpoint(imported || accountCheckpoint.candidate, { imported: !!imported });
    } catch (error) { $('#account-checkpoint-status').text(error.message); }
  });
  $('#btn-account-previous').on('click', () => {
    try { continueAccountCheckpoint(storedAccountCheckpoint(ACCOUNT_PREVIOUS_KEY)); }
    catch (error) { $('#account-checkpoint-status').text(error.message); }
  });
  window.addEventListener('online', () => {
    refreshAccountCheckpoints().then(() => flushPendingAccountReviews()).then(() => refreshRemoteInsights({ silent: true })).catch(handleAccountCheckpointError);
  });
  window.addEventListener('offline', () => {
    accountCheckpoint.message = 'Offline. Continue here; reconnect and use Sync now, or export a backup.';
    renderAccountCheckpoint();
  });
  renderAccountCheckpoint();
});

const ACCOUNT_REVIEW_OUTBOX_KEY = 'coach:review-outbox:v1';
let accountReviewSyncChain = Promise.resolve();

function pendingAccountReviews() {
  try {
    const data = JSON.parse(localStorage.getItem(coachMemoryKey(ACCOUNT_REVIEW_OUTBOX_KEY)));
    return data && data.v === 1 && Array.isArray(data.entries) ? data.entries : [];
  } catch (e) { return []; }
}

function savePendingAccountReviews(entries) {
  localStorage.setItem(coachMemoryKey(ACCOUNT_REVIEW_OUTBOX_KEY), JSON.stringify({ v: 1, entries }));
}

function queuePendingAccountReview(review) {
  if (!hasCoachDbSession() || !review || review.tier === 'unknown') return;
  const entries = pendingAccountReviews(), key = `${review.localGameId}|${review.ply}`;
  const item = { key, localGameId: review.localGameId, remoteGameId: coachRemoteGameId,
    game: remoteGamePayload(coachLastEndMsg), move: remoteMovePayload(review, coachRemoteGameId),
    artifacts: learningArtifactPayloads(review, '00000000-0000-4000-8000-000000000000') };
  const index = entries.findIndex(entry => entry.key === key);
  if (index < 0) entries.push(item); else entries[index] = item;
  savePendingAccountReviews(entries);
}

function markPendingAccountReviewSynced(review) {
  const key = `${review.localGameId}|${review.ply}`;
  savePendingAccountReviews(pendingAccountReviews().filter(entry => entry.key !== key || entry.deleted));
}

function updatePendingAccountGame() {
  if (!hasCoachDbSession() || coachPracticeSession || !coachGame) return;
  const entries = pendingAccountReviews();
  let changed = false;
  entries.forEach(entry => {
    if (entry.deleted || entry.localGameId !== coachLocalGameId) return;
    entry.game = remoteGamePayload(coachLastEndMsg);
    entry.remoteGameId = coachRemoteGameId || entry.remoteGameId;
    changed = true;
  });
  if (changed) savePendingAccountReviews(entries);
}

async function ensureAccountWritePermission() {
  await flushAccountCheckpoint();
  if (accountCheckpoint.conflict) throw new Error('A newer session exists in another tab. Session sync is paused here; continue the saved copy or export a backup.');
}

function runAccountMoveWrite(work) {
  const owner = coachMemoryOwnerId();
  accountReviewSyncChain = accountReviewSyncChain.catch(() => {}).then(() => {
    if (owner === coachMemoryOwnerId()) return work();
  });
  return accountReviewSyncChain;
}

function queueDeletedAccountReview(review) {
  if (!hasCoachDbSession() || !review) return;
  const key = `${review.localGameId}|${review.ply}`;
  const entries = pendingAccountReviews().filter(entry => entry.key !== key);
  const remoteGameId = review.remoteGameId || coachRemoteGameId;
  if (remoteGameId) entries.push({ key, localGameId: review.localGameId, remoteGameId, ply: review.ply, deleted: true });
  savePendingAccountReviews(entries);
}

function flushPendingAccountReviews() {
  const owner = coachMemoryOwnerId();
  return runAccountMoveWrite(async () => {
    if (!hasCoachDbSession() || owner !== coachMemoryOwnerId()) return;
    await ensureAccountWritePermission();
    if (owner !== coachMemoryOwnerId()) return;
    for (const pending of pendingAccountReviews()) {
      if (owner !== coachMemoryOwnerId()) return;
      if (pending.deleted) {
        const move = await coachDbClient.from('coach_moves').select('id').eq('game_id', pending.remoteGameId).eq('ply', pending.ply).eq('user_id', coachAuthUser.id).maybeSingle();
        if (owner !== coachMemoryOwnerId()) return;
        if (move.error) throw move.error;
        if (move.data) {
          for (const table of ['drill_queue', 'theory_cards']) {
            const removed = await coachDbClient.from(table).delete().eq('source_move_id', move.data.id).eq('user_id', coachAuthUser.id);
            if (owner !== coachMemoryOwnerId()) return;
            if (removed.error) throw removed.error;
          }
        }
        const result = await coachDbClient.from('coach_moves').delete().eq('game_id', pending.remoteGameId).eq('ply', pending.ply).eq('user_id', coachAuthUser.id);
        if (owner !== coachMemoryOwnerId()) return;
        if (result.error) throw result.error;
        savePendingAccountReviews(pendingAccountReviews().filter(entry => entry.key !== pending.key || !entry.deleted));
        continue;
      }
      let gameId = (pendingAccountReviews().find(entry => entry.key === pending.key) || pending).remoteGameId;
      if (!gameId) {
        if (coachLocalGameId === pending.localGameId && !coachPracticeSession) gameId = await ensureRemoteCoachGame();
        else {
          const created = await coachDbClient.from('coach_games').insert(pending.game).select('id').single();
          if (created.error) throw created.error;
          gameId = created.data.id;
        }
        if (owner !== coachMemoryOwnerId() || !gameId) return;
        const entries = pendingAccountReviews();
        entries.forEach(entry => { if (entry.localGameId === pending.localGameId) entry.remoteGameId = gameId; });
        savePendingAccountReviews(entries);
        if (coachLocalGameId === pending.localGameId && !coachPracticeSession) {
          coachRemoteGameId = gameId;
          saveCoachState();
        }
      }
      const result = await coachDbClient.from('coach_moves').upsert(Object.assign({}, pending.move, { game_id: gameId }), { onConflict: 'game_id,ply' }).select('id').single();
      if (owner !== coachMemoryOwnerId()) return;
      if (result.error) throw result.error;
      const artifacts = pending.artifacts || { drills: [], cards: [] };
      for (const [table, rows, conflict] of [['drill_queue', artifacts.drills, 'user_id,drill_key'], ['theory_cards', artifacts.cards, 'source_move_id,tag']]) {
        if (!rows || !rows.length) continue;
        const write = await coachDbClient.from(table).upsert(rows.map(row => Object.assign({}, row, { source_move_id: result.data.id })), { onConflict: conflict, ignoreDuplicates: true });
        if (owner !== coachMemoryOwnerId()) return;
        if (write.error) throw write.error;
      }
      const local = loadInsights();
      const entry = local.entries.find(entry => entry.localGameId === pending.localGameId && entry.ply === pending.move.ply);
      if (entry) { entry.id = result.data.id; entry.gameId = gameId; saveInsights(local); }
      savePendingAccountReviews(pendingAccountReviews().filter(entry => entry.key !== pending.key || entry.deleted));
    }
  });
}

// Run before DOM-ready restores a game; account changes repeat this per owner.
recoverContinuityWrites();

// Keep successive game snapshots in order even on a slow connection. Separate
// owners/games never wait behind an unrelated game's write.
const accountGameWriteChains = new Map();
function runAccountGameWrite(work) {
  const key = `${coachMemoryOwnerId()}|${coachLocalGameId}`;
  const previous = accountGameWriteChains.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  accountGameWriteChains.set(key, next);
  const cleanup = () => { if (accountGameWriteChains.get(key) === next) accountGameWriteChains.delete(key); };
  next.then(cleanup, cleanup);
  return next;
}
