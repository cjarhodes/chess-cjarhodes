// Personal training layer: profile, repertoire, imported games, endgames,
// effectiveness reporting, and cross-device Library sync.

const PLAYER_GROWTH_KEY = 'coach:growth:v1';
const PLAYER_GROWTH_VERSION = 1;
const TRAINING_BACKUP_VERSION = 1;
const REPERTOIRE_OBSERVED_LIMIT = 30;
const REPERTOIRE_REPAIR_LIMIT = 24;
const REPERTOIRE_COMPARISON_LIMIT = 8;
// This is a practical evidence floor for a descriptive comparison, not a
// statistical significance claim. Short sessions should remain inconclusive.
const TRANSFER_MIN_SAMPLES = 30;
const IMPORT_CANCEL_BUTTON_ID = 'btn-cancel-pgn';
const growthRemoteSync = { timer: null, chain: Promise.resolve() };
let importedGameAnalysisActive = false;
let importedAnalysisRun = null;
let importedAnalysisRunId = 0;

const ENDGAME_LESSONS = [
  {
    id: 'endgame-queen-mate', title: 'Queen mate',
    detail: 'Coordinate king and queen to finish a boxed-in king.',
    fen: '7k/8/5KQ1/8/8/8/8/8 w - - 0 1', bestUci: 'g6g7', bestSan: 'Qg7#',
    prompt: 'Find the immediate checkmate.', tag: 'endgame_conversion',
    scenarios: [
      { fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', bestUci: 'f7f8', bestSan: 'Qf8#',
        prompt: 'Find the mating net from this new king position.' }
    ]
  },
  {
    id: 'endgame-rook-mate', title: 'Rook mate',
    detail: 'Use the king to cover the escape squares before checking.',
    fen: '7k/8/6K1/8/8/8/8/R7 w - - 0 1', bestUci: 'a1a8', bestSan: 'Ra8#',
    prompt: 'Deliver mate with the rook.', tag: 'endgame_conversion',
    scenarios: [
      { fen: '7k/8/5K2/8/8/8/8/R7 w - - 0 1', bestUci: 'f6g6', bestSan: 'Kg6',
        prompt: 'Improve the king, then finish with the rook.',
        continuation: [{ opponentUci: 'h8g8', followupUci: 'a1a8' }] }
    ]
  },
  {
    id: 'endgame-promote', title: 'Clean promotion',
    detail: 'Convert the passed pawn without adding an unnecessary move.',
    fen: '8/4P3/8/8/8/8/4K3/7k w - - 0 1', bestUci: 'e7e8q', bestSan: 'e8=Q',
    prompt: 'Promote the pawn now.', tag: 'passed_pawns',
    scenarios: [
      { fen: '8/8/4P3/8/8/8/4K3/7k w - - 0 1', bestUci: 'e6e7', bestSan: 'e7',
        prompt: 'Advance the passer, then finish the promotion.',
        continuation: [{ opponentUci: 'h1g1', followupUci: 'e7e8q' }] }
    ]
  },
  {
    id: 'endgame-stop-pawn', title: 'Stop the passer',
    detail: 'Block the promotion square and give the king time to arrive.',
    fen: '1k6/8/8/8/8/8/5K1p/R7 w - - 0 1', bestUci: 'a1h1', bestSan: 'Rh1',
    prompt: 'Stop the h-pawn from promoting.', tag: 'passed_pawns',
    scenarios: [
      { fen: '1k6/8/8/8/8/7p/5K2/R7 w - - 0 1', bestUci: 'a1h1', bestSan: 'Rh1',
        prompt: 'Block the passer, then capture it on the promotion square.',
        continuation: [{ opponentUci: 'h3h2', followupUci: 'h1h2' }] }
    ]
  }
];

function growthOwnerId() {
  return typeof activePracticeOwnerId === 'function' ? activePracticeOwnerId() : null;
}

function growthStorageKey(ownerId = growthOwnerId()) {
  return ownerId ? `${PLAYER_GROWTH_KEY}:${ownerId}` : PLAYER_GROWTH_KEY;
}

function emptyGrowthState() {
  return {
    v: PLAYER_GROWTH_VERSION,
    updatedAt: 0,
    profile: {
      rating: 1200,
      ratingEstimate: 1200,
      ratingDeviation: 350,
      ratingGames: 0,
      ratedGameIds: [],
      ratingHistory: [],
      minutes: 10,
      goal: 'balanced',
      sessionStyle: 'balanced',
      autoElo: true,
      onboarded: false,
      updatedAt: 0
    },
    repertoire: { ids: [], updatedAt: 0, focusKey: null, focusUpdatedAt: 0, observed: [], repairs: [], comparisons: [] },
    openingTransfers: [],
    library: { records: {} }
  };
}

function normalizeGrowthState(value) {
  const base = emptyGrowthState();
  if (!value || value.v !== PLAYER_GROWTH_VERSION) return base;
  const rawProfile = value.profile || {};
  const profile = Object.assign({}, base.profile, rawProfile);
  profile.rating = Math.max(400, Math.min(2800, Number(profile.rating) || 1200));
  profile.ratingEstimate = Math.max(400, Math.min(2800,
    rawProfile.ratingEstimate == null ? profile.rating : (Number(rawProfile.ratingEstimate) || profile.rating)
  ));
  profile.ratingGames = Math.max(0, Math.floor(Number(profile.ratingGames) || 0));
  profile.ratingDeviation = Math.max(80, Math.min(350, Number(profile.ratingDeviation) || 350));
  profile.ratedGameIds = Array.isArray(profile.ratedGameIds)
    ? profile.ratedGameIds.filter(id => typeof id === 'string').slice(-50)
    : [];
  profile.ratingHistory = Array.isArray(profile.ratingHistory)
    ? profile.ratingHistory.filter(item => item && Number.isFinite(item.at)).slice(-30)
    : [];
  profile.minutes = Math.max(5, Math.min(60, Number(profile.minutes) || 10));
  profile.goal = ['balanced', 'tactics', 'repertoire', 'endgames'].includes(profile.goal) ? profile.goal : 'balanced';
  profile.sessionStyle = ['balanced', 'drills', 'play'].includes(profile.sessionStyle) ? profile.sessionStyle : 'balanced';
  profile.autoElo = profile.autoElo !== false;
  const repertoireIds = value.repertoire && Array.isArray(value.repertoire.ids)
    ? value.repertoire.ids.filter(id => typeof id === 'string' && OPENINGS.some(opening => opening.id === id))
    : [];
  const rawRepertoire = value.repertoire || {};
  const observed = Array.isArray(rawRepertoire.observed)
    ? rawRepertoire.observed.filter(item => item && typeof item.key === 'string' && typeof item.name === 'string')
      .map(item => Object.assign({}, item, {
        games: Math.max(0, Math.floor(Number(item.games) || 0)),
        moves: Math.max(0, Math.floor(Number(item.moves) || 0)),
        deviations: Math.max(0, Math.floor(Number(item.deviations) || 0)),
        mistakes: Math.max(0, Math.floor(Number(item.mistakes) || 0)),
        bookMoves: Math.max(0, Math.floor(Number(item.bookMoves) || 0)),
        practiceAttempts: Math.max(0, Math.floor(Number(item.practiceAttempts) || 0)),
        practiceCorrect: Math.max(0, Math.floor(Number(item.practiceCorrect) || 0)),
        practiceAssisted: Math.max(0, Math.floor(Number(item.practiceAssisted) || 0)),
        confidence: Math.max(0, Math.min(100, Number(item.confidence) || 0)),
        updatedAt: Number(item.updatedAt) || 0,
        lastSeen: Number(item.lastSeen) || 0,
        lastPracticedAt: Number(item.lastPracticedAt) || 0,
        openingId: typeof item.openingId === 'string' ? item.openingId : null,
        side: item.side === 'black' ? 'black' : 'white'
      })).slice(-REPERTOIRE_OBSERVED_LIMIT)
    : [];
  const repairs = Array.isArray(rawRepertoire.repairs)
    ? rawRepertoire.repairs.filter(item => item && typeof item.id === 'string' && item.entry && typeof item.entry === 'object')
      .slice(-REPERTOIRE_REPAIR_LIMIT)
    : [];
  const comparisons = Array.isArray(rawRepertoire.comparisons)
    ? rawRepertoire.comparisons.filter(item => item && Number(item.at) > 0).slice(-REPERTOIRE_COMPARISON_LIMIT)
    : [];
  return {
    v: PLAYER_GROWTH_VERSION,
    updatedAt: Number(value.updatedAt) || 0,
    profile,
    repertoire: {
      ids: Array.from(new Set(repertoireIds)),
      updatedAt: Number(rawRepertoire.updatedAt) || 0,
      focusKey: typeof rawRepertoire.focusKey === 'string' ? rawRepertoire.focusKey : null,
      focusUpdatedAt: Number(rawRepertoire.focusUpdatedAt) || 0,
      observed,
      repairs,
      comparisons
    },
    openingTransfers: normalizeOpeningTransferRecords(value.openingTransfers),
    library: {
      records: value.library && value.library.records && typeof value.library.records === 'object'
        ? value.library.records
        : {}
    }
  };
}

// A bounded review history shares the existing owner-scoped training JSON,
// backup, and merge path. It stores observations and self-reports, not mastery.
function normalizeOpeningTransferRecords(value) {
  const records = new Map();
  (Array.isArray(value) ? value : []).forEach(item => {
    if (!item || typeof item.id !== 'string' || !Number.isFinite(item.at) ||
        !OPENINGS.some(opening => opening.id === item.openingId)) return;
    const existing = records.get(item.id);
    if (existing && existing.at >= item.at) return;
    records.set(item.id, {
      id: item.id, at: item.at, openingId: item.openingId,
      lineId: typeof item.lineId === 'string' ? item.lineId : 'main',
      sourcePly: Math.max(0, Math.floor(Number(item.sourcePly) || 0)),
      side: item.side === 'black' ? 'black' : 'white',
      cue: String(item.cue || '').slice(0, 500),
      reflection: ['applied', 'adapted', 'unsure'].includes(item.reflection) ? item.reflection : 'unsure',
      reviewed: Math.max(0, Math.floor(Number(item.reviewed) || 0)),
      problems: Math.max(0, Math.floor(Number(item.problems) || 0)),
      examples: (Array.isArray(item.examples) ? item.examples : []).filter(example => example && typeof example === 'object').slice(0, 2).map(example => ({
        move: String(example.move || '').slice(0, 40), lesson: String(example.lesson || '').slice(0, 500)
      }))
    });
  });
  return Array.from(records.values()).sort((a, b) => b.at - a.at).slice(0, 6);
}

function loadGrowthState(ownerId = growthOwnerId()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(growthStorageKey(ownerId)));
    const state = normalizeGrowthState(parsed);
    if (!Object.keys(state.library.records).length) {
      const legacy = JSON.parse(localStorage.getItem('chess_sr_v1'));
      if (legacy && typeof legacy === 'object') state.library.records = legacy;
    }
    return state;
  } catch (e) {
    return emptyGrowthState();
  }
}

function saveGrowthState(state, ownerId = growthOwnerId(), opts = {}) {
  const normalized = normalizeGrowthState(state);
  normalized.updatedAt = Math.max(Number(normalized.updatedAt) || 0, opts.preserveTimestamp ? 0 : Date.now());
  try {
    localStorage.setItem(growthStorageKey(ownerId), JSON.stringify(normalized));
    if (!ownerId) localStorage.setItem('chess_sr_v1', JSON.stringify(normalized.library.records));
    if (!opts.skipSync) queueGrowthRemoteSync();
    return { ok: true, state: normalized };
  } catch (error) {
    return { ok: false, error };
  }
}

function trainingBackupKeys(ownerId = growthOwnerId()) {
  return [
    growthStorageKey(ownerId),
    ...(ownerId ? [] : ['chess_sr_v1']),
    practiceProgressStorageKey(ownerId),
    dailySprintStorageKey(ownerId),
    coachMemoryKey(INSIGHTS_KEY),
    coachMemoryKey(LIFETIME_KEY)
  ];
}

function readTrainingBackup() {
  const data = {};
  trainingBackupKeys().forEach(key => {
    const raw = localStorage.getItem(key);
    if (raw === null) return;
    try { data[key] = JSON.parse(raw); } catch (e) { /* skip malformed local values */ }
  });
  return {
    schema: 'chess-coach-training-backup',
    version: TRAINING_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ownerScope: growthOwnerId() || 'local',
    data
  };
}

function downloadTrainingBackup() {
  const payload = readTrainingBackup();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `chess-coach-training-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Object.keys(payload.data).length;
}

function importedBackupValue(data, exactKey, prefixKey) {
  if (Object.prototype.hasOwnProperty.call(data, exactKey)) return data[exactKey];
  const match = Object.keys(data).find(key => key === prefixKey || key.startsWith(prefixKey + ':'));
  return match ? data[match] : null;
}

function mergeImportedTrainingData(payload) {
  if (!payload || payload.schema !== 'chess-coach-training-backup' || payload.version !== TRAINING_BACKUP_VERSION || !payload.data || typeof payload.data !== 'object') {
    throw new Error('That file is not a Chess Coach training backup.');
  }
  const ownerId = growthOwnerId();
  const data = payload.data;
  const incomingGrowth = importedBackupValue(data, growthStorageKey(ownerId), PLAYER_GROWTH_KEY);
  if (incomingGrowth) saveGrowthState(mergeGrowthStates(loadGrowthState(ownerId), incomingGrowth), ownerId);

  const incomingPractice = importedBackupValue(data, practiceProgressStorageKey(ownerId), PRACTICE_PROGRESS_KEY);
  if (incomingPractice && incomingPractice.v === 2) {
    const current = loadPracticeProgress(ownerId);
    const merged = { v: 2, records: Object.assign({}, current.records), events: current.events.slice() };
    Object.entries(incomingPractice.records || {}).forEach(([id, record]) => {
      const existing = merged.records[id];
      if (!existing || (record.lastAttemptAt || 0) > (existing.lastAttemptAt || 0) || ((record.lastAttemptAt || 0) === (existing.lastAttemptAt || 0) && (record.attempts || 0) > (existing.attempts || 0))) merged.records[id] = record;
    });
    const ids = new Set(merged.events.map(event => event && event.id));
    (incomingPractice.events || []).forEach(event => { if (event && event.id && !ids.has(event.id)) { merged.events.push(event); ids.add(event.id); } });
    savePracticeProgress(merged, ownerId);
  }

  const incomingDaily = importedBackupValue(data, dailySprintStorageKey(ownerId), DAILY_SPRINT_KEY);
  if (incomingDaily && incomingDaily.v === 1) {
    const current = loadDailySprintHistory(ownerId);
    Object.entries(incomingDaily.days || {}).forEach(([day, value]) => {
      current.days[day] = typeof mergeDailySprintDay === 'function' ? mergeDailySprintDay(current.days[day], value) : (current.days[day] || value);
    });
    saveDailySprintHistory(current, ownerId);
  }

  const incomingInsights = data[INSIGHTS_KEY];
  if (incomingInsights && incomingInsights.v === 1) {
    const current = loadInsights();
    const ids = new Set(current.entries.map(entry => entry && (entry.id || `${entry.ts}|${entry.fenBefore}|${entry.userUci}`)));
    (incomingInsights.entries || []).forEach(entry => {
      const id = entry && (entry.id || `${entry.ts}|${entry.fenBefore}|${entry.userUci}`);
      if (entry && !ids.has(id)) { current.entries.push(entry); ids.add(id); }
    });
    saveInsights(current);
  }

  const incomingLifetime = data[LIFETIME_KEY];
  if (incomingLifetime && typeof incomingLifetime === 'object') {
    const current = loadLifetime();
    const incomingRollups = incomingLifetime.rollups && typeof incomingLifetime.rollups === 'object' ? incomingLifetime.rollups : {};
    const currentRollups = current.rollups && typeof current.rollups === 'object' ? current.rollups : {};
    const mergedRollups = Object.assign({}, currentRollups, incomingRollups);
    const currentScore = (current.games || 0) * 100000 + (current.moves || 0);
    const incomingScore = (incomingLifetime.games || 0) * 100000 + (incomingLifetime.moves || 0);
    const richer = incomingScore > currentScore ? incomingLifetime : current;
    saveLifetime(Object.assign(emptyLifetime(), richer, { rollups: mergedRollups }));
  }
  hydrateGrowthUI();
  if (typeof renderInsights === 'function') renderInsights();
  return Object.keys(data).length;
}

async function importTrainingBackupFile(file) {
  if (!file || file.size > 5 * 1024 * 1024) throw new Error('Choose a JSON backup smaller than 5 MB.');
  const payload = JSON.parse(await file.text());
  return mergeImportedTrainingData(payload);
}

function loadSyncedLibrarySR() {
  return loadGrowthState().library.records;
}

function saveSyncedLibrarySR(records) {
  const state = loadGrowthState();
  state.library.records = records && typeof records === 'object' ? records : {};
  state.updatedAt = Date.now();
  return saveGrowthState(state);
}

function mergeGrowthStates(localValue, remoteValue) {
  const local = normalizeGrowthState(localValue);
  const remote = normalizeGrowthState(remoteValue);
  const merged = emptyGrowthState();
  merged.profile = (Number(remote.profile.updatedAt) || 0) > (Number(local.profile.updatedAt) || 0)
    ? remote.profile : local.profile;
  const newerRepertoire = (Number(remote.repertoire.updatedAt) || 0) > (Number(local.repertoire.updatedAt) || 0)
    ? remote.repertoire : local.repertoire;
  const observed = new Map();
  [...local.repertoire.observed, ...remote.repertoire.observed].forEach(item => {
    const key = `${item.key}|${item.side}`;
    const existing = observed.get(key);
    if (!existing) observed.set(key, Object.assign({}, item));
    else observed.set(key, Object.assign({}, existing, {
      games: Math.max(existing.games || 0, item.games || 0),
      moves: Math.max(existing.moves || 0, item.moves || 0),
      deviations: Math.max(existing.deviations || 0, item.deviations || 0),
      mistakes: Math.max(existing.mistakes || 0, item.mistakes || 0),
      bookMoves: Math.max(existing.bookMoves || 0, item.bookMoves || 0),
      practiceAttempts: Math.max(existing.practiceAttempts || 0, item.practiceAttempts || 0),
      practiceCorrect: Math.max(existing.practiceCorrect || 0, item.practiceCorrect || 0),
      practiceAssisted: Math.max(existing.practiceAssisted || 0, item.practiceAssisted || 0),
      confidence: Math.max(existing.confidence || 0, item.confidence || 0),
      updatedAt: Math.max(existing.updatedAt || 0, item.updatedAt || 0),
      lastSeen: Math.max(existing.lastSeen || 0, item.lastSeen || 0)
    }));
  });
  const repairs = new Map();
  [...local.repertoire.repairs, ...remote.repertoire.repairs].forEach(item => {
    const existing = repairs.get(item.id);
    if (!existing || (item.lastSeen || item.createdAt || 0) > (existing.lastSeen || existing.createdAt || 0)) repairs.set(item.id, item);
  });
  const comparisons = [...local.repertoire.comparisons, ...remote.repertoire.comparisons]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, REPERTOIRE_COMPARISON_LIMIT);
  const focusSource = (remote.repertoire.focusUpdatedAt || 0) > (local.repertoire.focusUpdatedAt || 0)
    ? remote.repertoire : local.repertoire;
  merged.repertoire = {
    ids: newerRepertoire.ids.slice(),
    updatedAt: Math.max(local.repertoire.updatedAt || 0, remote.repertoire.updatedAt || 0),
    focusKey: focusSource.focusKey || null,
    focusUpdatedAt: Math.max(local.repertoire.focusUpdatedAt || 0, remote.repertoire.focusUpdatedAt || 0),
    observed: Array.from(observed.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, REPERTOIRE_OBSERVED_LIMIT),
    repairs: Array.from(repairs.values()).sort((a, b) => (b.lastSeen || b.createdAt || 0) - (a.lastSeen || a.createdAt || 0)).slice(0, REPERTOIRE_REPAIR_LIMIT),
    comparisons
  };
  const ids = new Set([...Object.keys(local.library.records), ...Object.keys(remote.library.records)]);
  ids.forEach(id => {
    const a = local.library.records[id];
    const b = remote.library.records[id];
    if (!a) merged.library.records[id] = b;
    else if (!b) merged.library.records[id] = a;
    else {
      const aRank = (Number(a.lastReviewed) || 0) * 10000 + (Number(a.attempts) || 0);
      const bRank = (Number(b.lastReviewed) || 0) * 10000 + (Number(b.attempts) || 0);
      merged.library.records[id] = bRank > aRank ? b : a;
    }
  });
  merged.openingTransfers = normalizeOpeningTransferRecords([...local.openingTransfers, ...remote.openingTransfers]);
  merged.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  return normalizeGrowthState(merged);
}

function adoptAnonymousGrowthState(ownerId) {
  if (!ownerId) return;
  const anonymous = loadGrowthState(null);
  const hasData = anonymous.openingTransfers.length || anonymous.profile.onboarded || anonymous.repertoire.ids.length || anonymous.repertoire.observed.length || anonymous.repertoire.repairs.length || Object.keys(anonymous.library.records).length;
  if (!hasData) return;
  const merged = mergeGrowthStates(loadGrowthState(ownerId), anonymous);
  const saved = saveGrowthState(merged, ownerId, { skipSync: true, preserveTimestamp: true });
  if (!saved.ok) return;
  try {
    localStorage.removeItem(PLAYER_GROWTH_KEY);
    localStorage.removeItem('chess_sr_v1');
  } catch (e) {}
}

function adoptAnonymousCoachMemory(ownerId) {
  if (!ownerId || typeof coachMemoryKey !== 'function') return;
  const previousUser = coachAuthUser;
  const anon = `anon:${coachDeviceId()}`;
  let insightsCopied = false;
  let lifetimeCopied = false;
  try {
    coachAuthUser = null;
    const anonymousInsights = loadInsights();
    const anonymousLifetime = loadLifetime();
    coachAuthUser = { id: ownerId };
    const accountInsights = loadInsights();
    const accountLifetime = loadLifetime();
    const insightIds = new Set(accountInsights.entries.map(entry => entry && (entry.id || `${entry.ts}|${entry.fenBefore}|${entry.userUci}`)));
    anonymousInsights.entries.forEach(entry => {
      const id = entry && (entry.id || `${entry.ts}|${entry.fenBefore}|${entry.userUci}`);
      if (entry && !insightIds.has(id)) { accountInsights.entries.push(entry); insightIds.add(id); }
    });
    insightsCopied = saveInsights(accountInsights);
    const anonymousRicher = (anonymousLifetime.games || 0) > (accountLifetime.games || 0) ||
      ((anonymousLifetime.games || 0) === (accountLifetime.games || 0) && (anonymousLifetime.moves || 0) > (accountLifetime.moves || 0));
    lifetimeCopied = anonymousRicher ? saveLifetime(anonymousLifetime) : true;
  } finally {
    coachAuthUser = previousUser;
  }
  try {
    // Consume each anonymous data set only after its account write succeeds.
    if (insightsCopied) localStorage.removeItem(`${INSIGHTS_KEY}:${anon}`);
    if (lifetimeCopied) localStorage.removeItem(`${LIFETIME_KEY}:${anon}`);
  } catch (e) { /* best effort; retrying the merge is idempotent */ }
  return { insightsCopied, lifetimeCopied };
}

function queueGrowthRemoteSync() {
  if (typeof hasCoachDbSession !== 'function' || !hasCoachDbSession()) return;
  if (growthRemoteSync.timer) clearTimeout(growthRemoteSync.timer);
  growthRemoteSync.timer = setTimeout(() => {
    growthRemoteSync.timer = null;
    growthRemoteSync.chain = growthRemoteSync.chain
      .catch(() => {})
      .then(() => syncGrowthState({ silent: true }))
      .catch(handleCoachDbError);
  }, 800);
}

async function syncGrowthState(opts = {}) {
  if (typeof hasCoachDbSession !== 'function' || !hasCoachDbSession()) return;
  const ownerId = growthOwnerId();
  if (!opts.silent) setCoachDbStatus('Syncing profile and repertoire...');
  const result = await coachDbClient
    .from('player_training_profiles')
    .select('state,updated_at')
    .eq('user_id', ownerId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (growthOwnerId() !== ownerId) return;
  const merged = mergeGrowthStates(loadGrowthState(ownerId), result.data && result.data.state);
  const saved = saveGrowthState(merged, ownerId, { skipSync: true, preserveTimestamp: true });
  if (!saved.ok) throw saved.error;
  const write = await coachDbClient.from('player_training_profiles').upsert({
    user_id: ownerId,
    state: saved.state,
    client_updated_at: new Date(saved.state.updatedAt || Date.now()).toISOString()
  }, { onConflict: 'user_id' });
  if (write.error) throw write.error;
  if (growthOwnerId() !== ownerId) return;
  hydrateGrowthUI();
  updateSRSidebar();
  updateSRPanel();
  if (!opts.silent) setCoachDbStatus('Profile, repertoire, and Library progress synced.');
}

function playerProfile() {
  return loadGrowthState().profile;
}

function repertoireIds() {
  return loadGrowthState().repertoire.ids;
}

function savePlayerProfile(values) {
  const state = loadGrowthState();
  const suppliedRating = Number(values && values.rating);
  const ratingChanged = Number.isFinite(suppliedRating) && suppliedRating !== state.profile.rating;
  state.profile = Object.assign({}, state.profile, values, { onboarded: true, updatedAt: Date.now() });
  if (ratingChanged) {
    state.profile.ratingEstimate = suppliedRating;
    state.profile.ratingDeviation = 350;
    state.profile.ratingGames = 0;
    state.profile.ratedGameIds = [];
    state.profile.ratingHistory = [];
  }
  state.updatedAt = Date.now();
  return saveGrowthState(state);
}

function toggleRepertoireOpening(id) {
  if (!id || !OPENINGS.some(opening => opening.id === id)) return;
  const state = loadGrowthState();
  const ids = new Set(state.repertoire.ids);
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  state.repertoire = Object.assign({}, state.repertoire, { ids: Array.from(ids), updatedAt: Date.now() });
  state.updatedAt = Date.now();
  saveGrowthState(state);
  renderRepertoireUI();
  renderPersonalRepertoire();
  renderWeeklyReview();
}

function repertoireConfidence(record) {
  if (!record) return 0;
  const reviewed = Math.max(0, Number(record.moves) || 0);
  const mistakes = Math.max(0, Number(record.mistakes) || 0);
  const deviations = Math.max(0, Number(record.deviations) || 0);
  const practiceAttempts = Math.max(0, Number(record.practiceAttempts) || 0);
  const practiceCorrect = Math.max(0, Number(record.practiceCorrect) || 0);
  const practiceRate = practiceAttempts ? practiceCorrect / practiceAttempts : 0;
  const reviewPenalty = reviewed ? Math.min(55, mistakes / reviewed * 100 * 70) : 25;
  const deviationPenalty = Math.min(25, deviations * 8);
  const practiceBoost = practiceAttempts ? Math.min(40, practiceRate * 40) : 0;
  return Math.max(0, Math.min(100, Math.round(35 - reviewPenalty - deviationPenalty + practiceBoost + (reviewed ? Math.min(25, reviewed / 4) : 0))));
}

function repertoireConfidenceLabel(value) {
  const confidence = Math.max(0, Math.min(100, Number(value) || 0));
  if (confidence >= 75) return 'stable';
  if (confidence >= 45) return 'familiar';
  if (confidence >= 20) return 'shaky';
  return 'unseen';
}

function setRepertoireFocus(key) {
  const state = loadGrowthState();
  state.repertoire = Object.assign({}, state.repertoire, {
    focusKey: key || null,
    focusUpdatedAt: Date.now(),
    updatedAt: Date.now()
  });
  state.updatedAt = Date.now();
  saveGrowthState(state);
  renderPersonalRepertoire();
  renderOpeningBridgeTrack();
  if (typeof renderCoachDailyPlan === 'function') renderCoachDailyPlan();
}

function repertoireFocusOpening() {
  const focusKey = loadGrowthState().repertoire.focusKey;
  if (!focusKey) return null;
  return OPENINGS.find(opening => opening.id === focusKey) || null;
}

function openingBridgeItem(opening) {
  if (!opening || !Array.isArray(opening.moves) || opening.moves.length < 14) return null;
  const targetIndex = opening.category === 'black' ? 13 : 12;
  const position = new Chess();
  for (let i = 0; i < targetIndex; i++) {
    if (!position.move(opening.moves[i])) return null;
  }
  const fenBefore = position.fen();
  const best = position.move(opening.moves[targetIndex]);
  if (!best) return null;
  const reply = opening.moves[targetIndex + 1] && position.move(opening.moves[targetIndex + 1]);
  const followup = reply && opening.moves[targetIndex + 2] && position.move(opening.moves[targetIndex + 2]);
  const continuation = reply && followup ? [{
    opponentUci: `${reply.from}${reply.to}${reply.promotion || ''}`,
    followupUci: `${followup.from}${followup.to}${followup.promotion || ''}`
  }] : [];
  return {
    id: `opening-bridge:${opening.id}`,
    tag: 'opening_principles',
    entry: {
      id: `opening-bridge:${opening.id}`,
      fenBefore,
      bestUci: typeof uciFromMove === 'function' ? uciFromMove(best) : `${best.from}${best.to}${best.promotion || ''}`,
      bestSan: best.san,
      opening: opening.name,
      openingId: opening.id,
      pairNum: 7,
      ply: targetIndex + 1,
      phase: 'opening',
      continuation
    },
    meta: {
      title: `${opening.name} → middlegame`,
      practice: opening.keyIdeas && opening.keyIdeas[0]
        ? `Carry the opening idea forward: ${opening.keyIdeas[0]}.`
        : 'Find the first plan after development is complete.',
      theory: opening.description
    }
  };
}

function recordRepertoirePracticeResult(item, clean, revealed) {
  if (!item || !item.entry || !item.entry.openingId) return;
  const state = loadGrowthState();
  const side = item.entry.fenBefore && new Chess(item.entry.fenBefore).turn() === 'b' ? 'black' : 'white';
  const key = `${item.entry.openingId}|${side}`;
  const observed = state.repertoire.observed.find(record => `${record.key}|${record.side}` === key);
  if (!observed) return;
  observed.practiceAttempts = (observed.practiceAttempts || 0) + 1;
  if (clean) observed.practiceCorrect = (observed.practiceCorrect || 0) + 1;
  if (revealed) observed.practiceAssisted = (observed.practiceAssisted || 0) + 1;
  observed.lastPracticedAt = Date.now();
  observed.confidence = repertoireConfidence(observed);
  state.repertoire.updatedAt = Date.now();
  state.updatedAt = Date.now();
  saveGrowthState(state);
  renderPersonalRepertoire();
  renderOpeningBridgeTrack();
}

function renderRepertoireUI() {
  const ids = repertoireIds();
  const selected = new Set(ids);
  $('.opening-btn').each(function() {
    $(this).toggleClass('in-repertoire', selected.has($(this).data('id')));
  });
  const $section = $('#repertoire-section').empty();
  if (ids.length) {
    $section.append('<div class="library-label">My Repertoire</div>');
    ids.map(id => OPENINGS.find(opening => opening.id === id)).filter(Boolean).forEach(opening => {
      const $button = $('<button class="opening-btn in-repertoire" type="button"></button>')
        .attr({ 'data-id': opening.id, 'data-cat': opening.category })
        .text(opening.name + ' ');
      $button.append($('<span class="eco"></span>').text(opening.eco || ''));
      $button.on('click', () => loadOpening(opening.id));
      $section.append($button);
    });
  }
  const activeId = currentOpening && currentOpening.id;
  $('#btn-repertoire-toggle')
    .text(activeId && selected.has(activeId) ? '★ In my repertoire' : '☆ Add to my repertoire')
    .prop('disabled', !activeId);
}

function repertoireRepairItem(repair) {
  if (!repair || !repair.entry) return null;
  const entry = repair.entry;
  const tag = repair.tag || insightTagForEntry(entry);
  return {
    entry,
    tag,
    id: repair.id || practiceItemId(entry, tag),
    meta: INSIGHT_TAG_META[tag] || INSIGHT_TAG_META.candidate_moves
  };
}

function renderPersonalRepertoire() {
  const $summary = $('#personal-repertoire-summary');
  const $list = $('#personal-repertoire-list').empty();
  if (!$summary.length || !$list.length) return;
  const state = loadGrowthState();
  const selected = new Set(state.repertoire.ids);
  const observed = state.repertoire.observed.slice().sort((a, b) =>
    (b.games || 0) - (a.games || 0) || (b.lastSeen || 0) - (a.lastSeen || 0));
  const repairsByKey = {};
  state.repertoire.repairs.forEach(repair => {
    const key = repair.openingId || `name:${repair.openingName || 'unknown'}`;
    (repairsByKey[key] ||= []).push(repair);
  });
  const gameCount = observed.reduce((sum, item) => sum + (item.games || 0), 0);
  const repairCount = state.repertoire.repairs.length;
  const latestComparison = state.repertoire.comparisons[0];
  const comparisonText = latestComparison
    ? ` Last import: ${latestComparison.bookCoverage}% book coverage, ${latestComparison.deviations} deviation${latestComparison.deviations === 1 ? '' : 's'} and ${latestComparison.mistakes} repair${latestComparison.mistakes === 1 ? '' : 's'}.`
    : '';
  $summary.text(observed.length
    ? `${observed.length} opening${observed.length === 1 ? '' : 's'} found across ${gameCount} imported game${gameCount === 1 ? '' : 's'}. ${repairCount ? `${repairCount} repair position${repairCount === 1 ? '' : 's'} ready.` : 'Import more games to find repair opportunities.'}${comparisonText}`
    : 'Import your games to see the openings you actually play and the positions worth repairing.');
  if (!observed.length) return;
  observed.forEach(item => {
    const key = item.openingId || `name:${item.name}`;
    const repairs = repairsByKey[key] || [];
    const $row = $('<div class="repertoire-observed-row"></div>');
    const side = item.side === 'black' ? 'Black' : 'White';
    const deviations = item.deviations ? ` · ${item.deviations} out-of-book` : '';
    const confidence = Number.isFinite(item.confidence) ? item.confidence : repertoireConfidence(item);
    const focus = state.repertoire.focusKey === item.openingId;
    $row.append($('<div class="repertoire-observed-copy"></div>').append(
      $('<strong></strong>').text(item.name + (item.eco ? ` · ${item.eco}` : '')),
      $('<span></span>').text(`${side} · ${item.games} game${item.games === 1 ? '' : 's'} · ${item.moves} reviewed moves${deviations} · ${repertoireConfidenceLabel(confidence)} ${confidence}%`)
    ));
    const $actions = $('<div class="repertoire-observed-actions"></div>');
    if (item.openingId) {
      $('<button type="button" class="movelist-copy">Study</button>').on('click', () => loadOpening(item.openingId)).appendTo($actions);
      if (!selected.has(item.openingId)) {
        $('<button type="button" class="movelist-copy">Add</button>').on('click', () => toggleRepertoireOpening(item.openingId)).appendTo($actions);
      }
      $('<button type="button" class="movelist-copy"></button>').text(focus ? 'Focused' : 'Focus').prop('disabled', focus).on('click', () => setRepertoireFocus(item.openingId)).appendTo($actions);
    }
    if (repairs.length) {
      $('<button type="button" class="movelist-copy"></button>').text(`Repair ${repairs.length}`).on('click', () => {
        const items = repairs.map(repertoireRepairItem).filter(Boolean);
        if (!items.length) return;
        switchView('coach');
        startCoachPracticeSession(items, items[0]);
      }).appendTo($actions);
    }
    $row.append($actions);
    $list.append($row);
  });
}

function renderOpeningBridgeTrack() {
  const $section = $('#opening-bridge-section');
  const $list = $('#opening-bridge-list').empty();
  if (!$section.length || !$list.length) return;
  const state = loadGrowthState();
  const chosen = [];
  const ids = state.repertoire.ids.slice();
  if (state.repertoire.focusKey) ids.unshift(state.repertoire.focusKey);
  state.repertoire.observed.forEach(item => { if (item.openingId) ids.push(item.openingId); });
  ids.push('italian', 'sicilian', 'queens-gambit');
  Array.from(new Set(ids)).forEach(id => {
    const opening = OPENINGS.find(candidate => candidate.id === id);
    if (opening && !chosen.some(item => item.id === opening.id)) chosen.push(opening);
  });
  chosen.slice(0, 3).forEach(opening => {
    const item = openingBridgeItem(opening);
    if (!item) return;
    const record = typeof practiceRecordFor === 'function' ? practiceRecordFor(item) : null;
    const $row = $('<div class="opening-bridge-row"></div>');
    $row.append($('<div class="opening-bridge-copy"></div>').append(
      $('<strong></strong>').text(item.meta.title),
      $('<span></span>').text(`${item.meta.practice} ${record ? ` ${record.correct || 0}/${record.attempts || 0} correct.` : ' Not rehearsed yet.'}`)
    ));
    $('<button type="button" class="movelist-copy"></button>')
      .text(record && record.correct ? 'Review' : 'Rehearse')
      .on('click', () => { switchView('coach'); startCoachPractice(item); })
      .appendTo($row);
    $list.append($row);
  });
  $section.toggle($list.children().length > 0);
}

function recordImportedOpenings(parsedGames, side, reviews) {
  const state = loadGrowthState();
  const observed = new Map(state.repertoire.observed.map(item => [`${item.key}|${item.side}`, item]));
  const repairs = new Map(state.repertoire.repairs.map(item => [item.id, item]));
  let changed = false;
  (parsedGames || []).forEach((game, index) => {
    const definition = openingDefinitionForSans(game.history());
    if (!definition.info.match) return;
    const opening = definition.opening;
    const key = opening ? opening.id : `name:${definition.info.match.name}`;
    const name = opening ? opening.name : definition.info.match.name;
    const recordKey = `${key}|${side}`;
    const record = Object.assign({
      key,
      openingId: opening ? opening.id : null,
      name,
      eco: definition.info.match.eco,
      side,
      games: 0,
      moves: 0,
      deviations: 0,
      mistakes: 0,
      bookMoves: 0,
      practiceAttempts: 0,
      practiceCorrect: 0,
      practiceAssisted: 0,
      confidence: 0,
      lastSeen: 0,
      lastPracticedAt: 0,
      line: '',
      firstDeviationPly: null,
      updatedAt: 0
    }, observed.get(recordKey) || {});
    const gameReviews = (reviews || []).filter(review => review.gameIndex === index + 1);
    record.games += 1;
    record.moves += gameReviews.filter(review => review.tier !== 'unknown').length;
    record.mistakes += gameReviews.filter(review => isInsightProblem(review.tier)).length;
    record.bookMoves += gameReviews.filter(review => review.tier !== 'unknown' && review.ply <= definition.info.matchedPlies).length;
    record.line = game.history().slice(0, Math.min(definition.info.matchedPlies, 16)).join(' ');
    const firstDeviation = gameReviews.find(review => review.ply > definition.info.matchedPlies);
    if (firstDeviation && !record.firstDeviationPly) record.firstDeviationPly = firstDeviation.ply;
    if (!definition.info.exact) record.deviations += 1;
    record.lastSeen = Date.now();
    record.updatedAt = record.lastSeen;
    record.confidence = repertoireConfidence(record);
    observed.set(recordKey, record);
    changed = true;
    gameReviews.filter(review => isInsightProblem(review.tier)).forEach(review => {
      const entry = insightEntryFromReview(Object.assign({}, review, { opening: name, openingId: opening ? opening.id : null }));
      const tag = insightTagForEntry(entry);
      const id = practiceItemId(entry, tag);
      repairs.set(id, {
        id,
        openingId: opening ? opening.id : null,
        openingName: name,
        tag,
        entry,
        createdAt: Date.now(),
        lastSeen: Date.now()
      });
    });
  });
  if (!changed) return;
  const reviewedMoves = (reviews || []).filter(review => review && review.tier !== 'unknown').length;
  const bookMoves = (reviews || []).filter(review => review && review.tier !== 'unknown' && parsedGames.some((game, index) => {
    const definition = openingDefinitionForSans(game.history());
    return review.gameIndex === index + 1 && review.ply <= definition.info.matchedPlies;
  })).length;
  const deviations = parsedGames.reduce((total, game) => total + (openingDefinitionForSans(game.history()).info.exact ? 0 : 1), 0);
  const mistakes = (reviews || []).filter(review => review && isInsightProblem(review.tier)).length;
  const comparison = {
    at: Date.now(),
    side,
    games: parsedGames.length,
    reviewedMoves,
    bookMoves,
    bookCoverage: reviewedMoves ? Math.round(bookMoves / reviewedMoves * 100) : 0,
    deviations,
    mistakes,
    openings: parsedGames.map(game => {
      const definition = openingDefinitionForSans(game.history());
      return definition.info.match ? definition.info.match.name : null;
    }).filter(Boolean)
  };
  state.repertoire = Object.assign({}, state.repertoire, {
    updatedAt: Date.now(),
    observed: Array.from(observed.values()).map(item => Object.assign(item, { confidence: repertoireConfidence(item) })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, REPERTOIRE_OBSERVED_LIMIT),
    repairs: Array.from(repairs.values()).sort((a, b) => (b.lastSeen || b.createdAt || 0) - (a.lastSeen || a.createdAt || 0)).slice(0, REPERTOIRE_REPAIR_LIMIT),
    comparisons: [comparison, ...(state.repertoire.comparisons || [])].slice(0, REPERTOIRE_COMPARISON_LIMIT)
  });
  saveGrowthState(state);
  renderPersonalRepertoire();
  renderOpeningBridgeTrack();
}

const CHALLENGE_MIN_ACCURACY = 65;
const CHALLENGE_MAX_ACCURACY = 85;
const CHALLENGE_MIN_MOVES = 12;

function recentChallengeSnapshot(profile = playerProfile()) {
  const sessions = (profile.ratingHistory || [])
    .filter(item => Number.isFinite(item.accuracy) && Number.isFinite(item.moves) && item.moves > 0)
    .slice(-5);
  const moves = sessions.reduce((total, item) => total + item.moves, 0);
  if (moves < CHALLENGE_MIN_MOVES) return { ready: false, moves, accuracy: null, adjustment: 0 };
  const weighted = sessions.reduce((total, item) => total + item.accuracy * item.moves, 0);
  const accuracy = Math.round(weighted / moves);
  const adjustment = accuracy < 55 ? -100
    : accuracy < CHALLENGE_MIN_ACCURACY ? -50
      : accuracy > 95 ? 100
        : accuracy > CHALLENGE_MAX_ACCURACY ? 50
          : 0;
  return { ready: true, moves, accuracy, adjustment };
}

function recommendedCoachElo(profile = playerProfile()) {
  const base = Math.round(profile.ratingEstimate / 50) * 50;
  const challenge = recentChallengeSnapshot(profile);
  return Math.max(400, Math.min(2400, base + challenge.adjustment));
}

function playerRatingConfidence(profile = playerProfile()) {
  if (!profile.ratingGames) return 'provisional';
  if (profile.ratingGames < 5) return 'low confidence';
  if (profile.ratingGames < 15) return 'developing';
  return 'calibrated';
}

function userScoreFromGameResult(result) {
  if (result === '1/2-1/2') return 0.5;
  if (result === '1-0') return coachUserColor() === 'white' ? 1 : 0;
  if (result === '0-1') return coachUserColor() === 'black' ? 1 : 0;
  return null;
}

function ratedCoachEligibility(endReason) {
  if (typeof coachOpeningTransfer !== 'undefined' && coachOpeningTransfer) return { eligible: false, reason: 'opening exercise' };
  if (!coachGame || !coachLocalGameId) return { eligible: false, reason: 'missing game' };
  if (coachStartFen !== new Chess().fen()) return { eligible: false, reason: 'custom position' };
  if (!coachStats || coachStats.moves < 4) return { eligible: false, reason: 'fewer than four reviewed moves' };
  const result = remoteGameResult(endReason);
  if (result === '*') return { eligible: false, reason: 'unfinished result' };
  return { eligible: true, result, score: userScoreFromGameResult(result) };
}

function nextPlayerRatingEstimate(profileValue, opponent, score, gameId, at = Date.now(), session = {}) {
  const profile = Object.assign({}, profileValue, {
    ratedGameIds: (profileValue.ratedGameIds || []).slice(),
    ratingHistory: (profileValue.ratingHistory || []).slice()
  });
  if (!gameId || profile.ratedGameIds.includes(gameId)) {
    return { profile, rated: false, duplicate: true };
  }
  const before = profile.ratingEstimate;
  const expected = 1 / (1 + Math.pow(10, (opponent - before) / 400));
  const k = profile.ratingGames < 5 ? 64 : (profile.ratingGames < 15 ? 40 : 24);
  const after = Math.max(400, Math.min(2800, Math.round(before + k * (score - expected))));
  const games = profile.ratingGames + 1;
  const deviation = Math.max(80, Math.round(350 / Math.sqrt(1 + games * 0.35)));
  profile.ratingEstimate = after;
  profile.ratingDeviation = deviation;
  profile.ratingGames = games;
  profile.ratedGameIds = profile.ratedGameIds.concat(gameId).slice(-50);
  profile.ratingHistory = profile.ratingHistory.concat({
    gameId, at, opponent, score, before, after,
    accuracy: Number.isFinite(session.accuracy) ? Math.max(0, Math.min(100, Math.round(session.accuracy))) : null,
    moves: Number.isFinite(session.moves) ? Math.max(0, Math.round(session.moves)) : 0
  }).slice(-30);
  profile.updatedAt = at;
  return { profile, rated: true, before, after, games, deviation };
}

function recordRatedCoachResult(endReason) {
  const eligibility = ratedCoachEligibility(endReason);
  if (!eligibility.eligible || eligibility.score === null) return eligibility;
  const state = loadGrowthState();
  const update = nextPlayerRatingEstimate(
    state.profile, coachEngineElo, eligibility.score, coachLocalGameId, Date.now(), {
      accuracy: accuracyFromTallies(coachStats, coachStats.moves),
      moves: coachStats.moves
    }
  );
  if (!update.rated) return Object.assign({ eligible: true }, update);
  state.profile = update.profile;
  state.updatedAt = update.profile.updatedAt;
  const saved = saveGrowthState(state);
  if (saved.ok) {
    renderPlayerProfileStatus(saved.state.profile);
    renderAutoDifficultyNote(saved.state.profile);
  }
  return Object.assign({ eligible: true, saved: saved.ok }, update, { rated: saved.ok });
}

function renderPlayerProfileStatus(profile = playerProfile()) {
  const confidence = playerRatingConfidence(profile);
  $('#player-profile-status').text(profile.onboarded || profile.ratingGames
    ? `Player estimate ${Math.round(profile.ratingEstimate)} ±${Math.round(profile.ratingDeviation)} · ${confidence} · ${profile.ratingGames} rated game${profile.ratingGames === 1 ? '' : 's'}.`
    : 'Set a starting estimate; completed standard games will calibrate it.');
}

function renderAutoDifficultyNote(profile = playerProfile()) {
  const recommended = recommendedCoachElo(profile);
  const confidence = playerRatingConfidence(profile);
  const uncertainty = `Player estimate ${Math.round(profile.ratingEstimate)} ±${Math.round(profile.ratingDeviation)} · ${confidence}`;
  const challenge = recentChallengeSnapshot(profile);
  const evidence = profile.ratingGames
    ? `${profile.ratingGames} completed rated game${profile.ratingGames === 1 ? '' : 's'}`
    : 'your starting estimate';
  const challengeNote = !challenge.ready
    ? ` Complete ${Math.max(0, CHALLENGE_MIN_MOVES - challenge.moves)} more reviewed move${CHALLENGE_MIN_MOVES - challenge.moves === 1 ? '' : 's'} to tune the challenge band.`
    : challenge.adjustment < 0
      ? ` Recent accuracy is ${challenge.accuracy}%, below the ${CHALLENGE_MIN_ACCURACY}–${CHALLENGE_MAX_ACCURACY}% learning band, so the next opponent is eased by ${Math.abs(challenge.adjustment)} points.`
      : challenge.adjustment > 0
        ? ` Recent accuracy is ${challenge.accuracy}%, above the ${CHALLENGE_MIN_ACCURACY}–${CHALLENGE_MAX_ACCURACY}% learning band, so the next opponent rises by ${challenge.adjustment} points.`
        : ` Recent accuracy is ${challenge.accuracy}%, inside the ${CHALLENGE_MIN_ACCURACY}–${CHALLENGE_MAX_ACCURACY}% learning band.`;
  $('#coach-auto-elo-note').text(profile.autoElo
    ? `${uncertainty}. Next opponent target: ${recommended}, based on ${evidence}.${challengeNote}`
    : `${uncertainty}. Automatic adjustment is off; current evidence-based target: ${recommended}.`);
}

function personalizeAdaptivePlan(plan) {
  const profile = playerProfile();
  const adjusted = Object.assign({}, plan);
  adjusted.sessionStyle = profile.sessionStyle || 'balanced';
  if (profile.minutes <= 5) {
    adjusted.drillTarget = Math.min(adjusted.drillTarget, 1);
    adjusted.moveTarget = Math.min(adjusted.moveTarget, 4);
  } else if (profile.minutes >= 20) {
    adjusted.drillTarget = adjusted.drillTarget ? Math.min(3, adjusted.drillTarget + 1) : 0;
    adjusted.moveTarget = Math.max(adjusted.moveTarget, 10);
  }
  if (profile.goal === 'tactics' && adjusted.drillTarget) {
    adjusted.drillTarget = Math.min(3, adjusted.drillTarget + 1);
  }
  if (profile.sessionStyle === 'drills' && adjusted.moveTarget) {
    adjusted.drillTarget = Math.min(3, Math.max(1, adjusted.drillTarget || 1));
    adjusted.moveTarget = Math.max(4, adjusted.moveTarget - 2);
  } else if (profile.sessionStyle === 'play') {
    adjusted.drillTarget = 0;
    adjusted.moveTarget = Math.max(6, adjusted.moveTarget);
    adjusted.kind = adjusted.kind === 'focus-transfer' ? 'transfer' : adjusted.kind;
  }
  // Preferences can change the mix, but cannot invent positions to rehearse.
  adjusted.drillTarget = Math.min(adjusted.drillTarget, (adjusted.orderedDue || []).length);
  if (!adjusted.drillTarget && adjusted.kind === 'focus-transfer') adjusted.kind = 'transfer';
  const focus = typeof repertoireFocusOpening === 'function' ? repertoireFocusOpening() : null;
  if (profile.goal === 'repertoire' && focus) {
    adjusted.repertoireFocus = focus.name;
    adjusted.cue = `${focus.name}: ${adjusted.cue}`;
  }
  return adjusted;
}

function applyAdaptiveCoachElo() {
  const profile = playerProfile();
  $('#coach-auto-elo').prop('checked', profile.autoElo);
  const recommended = recommendedCoachElo();
  renderAutoDifficultyNote(profile);
  if (!profile.autoElo) return coachEngineElo;
  coachEngineElo = recommended;
  $('#coach-strength').val(recommended);
  $('#coach-strength-value').text(recommended);
  $('#coach-strength-tier').text(strengthTierLabel(recommended));
  return recommended;
}

// Retained review records are a descriptive sample, not learning outcomes.
function reviewedProgressEntries(entries, now = Date.now()) {
  const tiers = new Set(['best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder']);
  const seen = new Set();
  return (Array.isArray(entries) ? entries : []).filter(entry => {
    if (!entry || !tiers.has(entry.tier) || !Number.isFinite(entry.ts) || entry.ts <= 0 || entry.ts > now) return false;
    if (entry.id) {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
    }
    return true;
  }).slice().sort((a, b) => a.ts - b.ts);
}

function transferMeasurement(entries, tag, now = Date.now()) {
  const reviewed = reviewedProgressEntries(entries, now);
  const events = loadPracticeProgress().events
    .filter(event => event && event.tag === tag && event.correct && !event.revealed &&
      Number.isFinite(event.at) && event.at > 0 && event.at <= now)
    .slice().sort((a, b) => a.at - b.at);
  if (!events.length) return null;
  // Keep the earliest rehearsal with a retained baseline. Rehearsing again
  // must not erase follow-up evidence. Equal move windows avoid volume bias.
  const checkpoint = events.find(event => reviewed.filter(entry => entry.ts < event.at).length >= TRANSFER_MIN_SAMPLES)
    || events[events.length - 1];
  const before = reviewed.filter(entry => entry.ts < checkpoint.at).slice(-TRANSFER_MIN_SAMPLES);
  const after = reviewed.filter(entry => entry.ts >= checkpoint.at).slice(0, TRANSFER_MIN_SAMPLES);
  const errors = list => list.filter(entry => isInsightProblem(entry.tier) && (entry.tags || []).includes(tag)).length;
  const beforeErrors = errors(before);
  const afterErrors = errors(after);
  const beforeRate = before.length ? beforeErrors / before.length : null;
  const afterRate = after.length ? afterErrors / after.length : null;
  const baselineReady = before.length >= TRANSFER_MIN_SAMPLES;
  const enoughEvidence = baselineReady && after.length >= TRANSFER_MIN_SAMPLES;
  const change = enoughEvidence ? afterRate - beforeRate : null;
  const direction = !enoughEvidence ? 'insufficient' : change < 0 ? 'improved' : change > 0 ? 'worsened' : 'unchanged';
  return {
    anchor: checkpoint.at, baselineReady, beforeRate, afterRate,
    beforeSamples: before.length, afterSamples: after.length,
    beforeErrors, afterErrors,
    change: enoughEvidence ? Math.round(change * 1000) / 10 : null,
    direction, improved: direction === 'improved', enoughEvidence
  };
}

function progressRecommendation(entries, now = Date.now()) {
  const reviewed = reviewedProgressEntries(entries, now);
  const counts = insightTagCounts(reviewed.filter(entry => isInsightProblem(entry.tier)));
  const queue = practiceItemsForEntries(reviewed, counts);
  const due = queue.filter(item => practiceIsDue(item, now));
  const plan = adaptiveDailyPlan(reviewed, queue, due, practiceProgressTotals());
  const day = dailySprintToday();
  const continuing = !!(day && !day.completedAt);
  const focusTag = continuing ? day.focusTag : plan.focusTag;
  const flagged = reviewed.filter(entry => isInsightProblem(entry.tier) && (entry.tags || []).includes(focusTag)).length;
  let reason = !reviewed.length ? 'No reviewed moves yet. A short playing session will give Coach evidence for your next focus.'
    : !focusTag ? `${reviewed.length} retained reviewed moves. ${continuing ? 'Finish building this session’s baseline; Coach will then choose a focus.' : 'No flagged pattern stands out yet; keep building your baseline.'}`
    : flagged ? `${flagged} of ${reviewed.length} retained reviewed moves flagged this pattern. ${flagged === 1 ? 'This is an early signal from one review.' : 'Severity, recency and recent practice guide this focus.'}`
    : 'Recent practice suggests revisiting this cue; no matching flagged reviews are retained.';
  if (continuing) reason = 'Finish the session already in progress. ' + reason;
  let action, label;
  if (coachPracticeSession || continuing) {
    action = 'daily'; label = 'Continue current session';
  } else if (coachGameActive) {
    action = 'continue'; label = focusTag ? 'Use this cue in your game' : 'Continue your game';
  } else if (plan.drillTarget > 0) {
    action = 'practice'; label = `Practice ${plan.drillTarget} position${plan.drillTarget === 1 ? '' : 's'}`;
  } else {
    action = 'game'; label = focusTag ? 'Play with this cue' : 'Start training';
  }
  return {
    plan, focusTag, title: continuing ? (day.focus || 'Build your baseline') : plan.focus,
    cue: continuing ? (day.focusCue || plan.cue) : plan.cue,
    reason, action, label, optional: !!(day && day.completedAt),
    measurement: focusTag ? transferMeasurement(reviewed, focusTag, now) : null
  };
}

function renderProgressRecommendation(recommendation) {
  $('#progress-next-label').text(recommendation.optional ? 'Optional next focus' : 'Work on next');
  $('#progress-next-title').text(recommendation.title);
  $('#progress-next-reason').text(recommendation.reason);
  $('#progress-next-cue').text(recommendation.cue);
  $('#btn-progress-next').text(recommendation.label);
}

function runProgressRecommendation() {
  // Re-read the active owner's data and queue at click time, including a sync
  // or a due-date change since this panel was first opened.
  renderInsights();
  const next = progressRecommendation(currentInsightEntries());
  if (coachThinking || importedGameAnalysisActive) return;
  if (next.action === 'daily') {
    $('#btn-coach-next-action').trigger('click');
  } else if (next.action === 'continue') {
    if (coachIsReviewing()) coachGotoLive();
    showCoachPanel('game');
    document.getElementById('coachBoard')?.focus({ preventScroll: true });
  } else {
    renderedAdaptivePlan = next.plan;
    if (next.action === 'practice') startCoachPracticeSession(next.plan.orderedDue, next.plan.orderedDue[0]);
    else startCoachGame();
  }
}

function renderWeeklyReview(entriesOverride) {
  const now = Date.now();
  const entries = reviewedProgressEntries(Array.isArray(entriesOverride) ? entriesOverride : currentInsightEntries(), now);
  const recent = entries.filter(entry => entry.ts >= now - 7 * DAY_MS);
  const attempts = loadPracticeProgress().events.filter(event => event && Number.isFinite(event.at) && event.at > 0 && event.at <= now && event.at >= now - 7 * DAY_MS);
  const completed = Object.values(loadDailySprintHistory().days).filter(day => day.completedAt && day.completedAt <= now && day.completedAt >= now - 7 * DAY_MS);
  const recommendation = progressRecommendation(entries, now);
  renderProgressRecommendation(recommendation);
  const unassisted = attempts.filter(event => event.correct && !event.revealed).length;
  const assisted = attempts.filter(event => event.correct && event.revealed).length;
  const misses = attempts.filter(event => !event.correct).length;
  const measurement = recommendation.measurement;
  const $list = $('#weekly-review-list').empty();
  $list.append($('<div class="weekly-item"></div>').append(
    $('<strong></strong>').text('Activity · last 7 days'),
    $('<span></span>').text(`${completed.length} completed session${completed.length === 1 ? '' : 's'}, ${recent.length} reviewed move${recent.length === 1 ? '' : 's'}, ${attempts.length} practice attempt${attempts.length === 1 ? '' : 's'}.`)
  ));
  $list.append($('<div class="weekly-item"></div>').append(
    $('<strong></strong>').text('Practice · last 7 days'),
    $('<span></span>').text(attempts.length
      ? `${unassisted} unassisted correct, ${assisted} completed with a hint or answer, ${misses} missed attempts. Retries count as separate attempts.`
      : 'No attempts yet. Rehearse a saved position, then use the same cue in play.')
  ));
  let comparison = recommendation.focusTag
    ? 'Complete an unassisted practice attempt after at least 30 reviewed moves to start a comparison.'
    : 'Build a reviewed-move baseline. Once Coach identifies a focus, rehearse it and look for the same pattern in later reviews.';
  if (measurement) {
    const before = measurement.beforeSamples ? `${measurement.beforeErrors}/${measurement.beforeSamples} reviewed moves flagged before practice.` : 'No baseline reviews retained.';
    const after = measurement.afterSamples ? `${measurement.afterErrors}/${measurement.afterSamples} flagged after practice.` : 'No follow-up reviews yet.';
    const samples = `${before} ${after}`;
    if (!measurement.baselineReady) comparison = `${samples} Baseline incomplete (need ${TRANSFER_MIN_SAMPLES} moves). Collect more reviewed moves, then rehearse again to start a comparison.`;
    else if (!measurement.enoughEvidence) comparison = `${samples} Follow-up: ${measurement.afterSamples}/${TRANSFER_MIN_SAMPLES} reviewed moves. Play or review more moves with this cue; no conclusion yet.`;
    else {
      const trend = measurement.direction === 'unchanged' ? 'No observed change in flag rate.'
        : `Observed flag rate is ${Math.abs(measurement.change).toFixed(1)} percentage points ${measurement.direction === 'improved' ? 'lower' : 'higher'}.`;
      comparison = `${samples} ${trend} These are observed coaching flags, not proof of learning.`;
    }
    comparison += ` Checkpoint: ${new Date(measurement.anchor).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`;
  }
  $list.append($('<div class="weekly-item"></div>').append(
    $('<strong></strong>').text(recommendation.focusTag ? `After practice · ${recommendation.title}` : 'After practice · build evidence'),
    $('<span></span>').text(comparison)
  ));
  if (typeof renderOpeningTransferHistory === 'function') renderOpeningTransferHistory();
  renderCoachPresentation();
}

function endgameScenarioFor(lesson) {
  const scenarios = Array.isArray(lesson && lesson.scenarios) ? lesson.scenarios : [];
  const record = typeof practiceRecordFor === 'function' ? practiceRecordFor({ id: lesson.id }) : null;
  // Keep the original canonical position for a player's first attempt. This
  // preserves existing saved progress and the Qg7# smoke path.
  if (!scenarios.length || !record || !(record.attempts > 0)) return lesson;
  const index = Math.min(scenarios.length - 1, Math.floor((record && record.attempts || 0) / 2));
  return Object.assign({}, lesson, scenarios[index]);
}

function endgamePracticeItem(lesson) {
  const scenario = endgameScenarioFor(lesson);
  return {
    id: lesson.id,
    tag: scenario.tag,
    entry: {
      id: scenario.id,
      fenBefore: scenario.fen,
      bestUci: scenario.bestUci,
      bestSan: scenario.bestSan,
      pairNum: 26,
      ply: 51,
      phase: 'endgame',
      continuation: Array.isArray(scenario.continuation)
        ? scenario.continuation.map(step => ({
          opponentUci: step.opponentUci,
          followupUci: step.followupUci
        }))
        : []
    },
    meta: { title: lesson.title, practice: scenario.prompt, theory: scenario.detail || lesson.detail }
  };
}

function renderEndgameTrack() {
  const $list = $('#endgame-track-list').empty();
  let complete = 0;
  ENDGAME_LESSONS.forEach(lesson => {
    const item = endgamePracticeItem(lesson);
    const record = practiceRecordFor(item);
    const done = !!(record && record.correct > 0);
    if (done) complete += 1;
    const $row = $('<div class="endgame-item"></div>').toggleClass('is-complete', done);
    const $copy = $('<div></div>').append(
      $('<strong></strong>').text((done ? '✓ ' : '') + lesson.title),
      $('<span></span>').text(lesson.detail)
    );
    const $button = $('<button class="movelist-copy" type="button"></button>')
      .text(done ? 'Review' : 'Train')
      .on('click', () => {
        switchView('coach');
        startCoachPractice(item);
      });
    $row.append($copy, $button);
    $list.append($row);
  });
  $('#endgame-track-progress').text(`${complete}/${ENDGAME_LESSONS.length}`);
}

function hydrateGrowthUI() {
  const profile = playerProfile();
  $('#player-rating').val(profile.rating);
  $('#player-minutes').val(profile.minutes);
  $('#player-goal').val(profile.goal);
  $('#player-style').val(profile.sessionStyle || 'balanced');
  renderPlayerProfileStatus(profile);
  renderRepertoireUI();
  applyAdaptiveCoachElo();
  renderPersonalRepertoire();
  renderOpeningBridgeTrack();
  renderWeeklyReview();
  renderEndgameTrack();
}

function pgnStartFen(parsed) {
  try {
    const headers = parsed.header();
    return headers && headers.FEN ? headers.FEN : new Chess().fen();
  } catch (e) {
    return new Chess().fen();
  }
}

function splitPgnGames(pgn) {
  const source = String(pgn || '').trim();
  if (!source) return [];
  const markers = [];
  const markerRe = /(?:^|\n)\s*\[Event\b/g;
  let match;
  while ((match = markerRe.exec(source))) {
    markers.push(match.index + (match[0].startsWith('\n') ? 1 : 0));
  }
  if (markers.length <= 1) return [source];
  return markers.map((start, index) => source.slice(start, markers[index + 1] || source.length).trim()).filter(Boolean);
}

// Build the analysis queue without imposing a batch-wide move cap. Keeping
// this pure and separate from engine work makes source-game identity explicit
// and prevents later games from inheriting the first game's move mapping.
function collectImportedTargets(parsedEntries, side, gameMetadata) {
  const targets = [];
  (parsedEntries || []).forEach((parsedEntry, gameIndex) => {
    const parsed = parsedEntry && parsedEntry.game ? parsedEntry.game : parsedEntry;
    if (!parsed) return;
    const sourceIndex = parsedEntry && Number.isInteger(parsedEntry.sourceIndex)
      ? parsedEntry.sourceIndex
      : gameIndex;
    const metadata = (gameMetadata || [])[gameIndex] || {};
    const allMoves = parsed.history({ verbose: true });
    const replay = new Chess(pgnStartFen(parsed));
    allMoves.forEach((move, index) => {
      const fenBefore = replay.fen();
      const mover = replay.turn() === 'b' ? 'black' : 'white';
      const played = replay.move(move.san);
      if (!played || mover !== side) return;
      targets.push({
        fenBefore,
        fenAfter: replay.fen(),
        userUci: uciFromMove(played),
        userSan: played.san,
        ply: index + 1,
        pairNum: Math.ceil((index + 1) / 2),
        gameIndex: gameIndex + 1,
        gameKey: `import-${sourceIndex + 1}`,
        openingId: metadata.openingId || null,
        opening: metadata.opening || null
      });
    });
  });
  return targets;
}

function importRunOwnsBoard(run) {
  if (!run || run.generation !== coachGameGeneration || coachGame !== run.originalCoachGame || coachLocalGameId !== run.originalCoachGameId) return false;
  const currentPgn = coachGame && typeof coachGame.pgn === 'function' ? coachGame.pgn() : '';
  return currentPgn === run.originalCoachPgn;
}

async function analyseImportedPgn() {
  if (typeof coachOpeningTransfer !== 'undefined' && coachOpeningTransfer) {
    $('#game-inbox-status').addClass('error').text('Return from the current opening session before importing another game.');
    return;
  }
  if (importedGameAnalysisActive) return;
  const pgn = ($('#game-inbox-pgn').val() || '').trim();
  const side = $('#game-inbox-side').val() === 'black' ? 'black' : 'white';
  const sourceGames = splitPgnGames(pgn);
  const parseResults = sourceGames.map((gamePgn, sourceIndex) => {
    const game = new Chess();
    try {
      const loaded = gamePgn && game.load_pgn(gamePgn, { sloppy: true });
      return {
        sourceIndex,
        game: loaded && game.history().length ? game : null
      };
    } catch (e) {
      return { sourceIndex, game: null };
    }
  });
  const parsedEntries = parseResults.filter(result => result.game);
  const parsedGames = parsedEntries.map(result => result.game);
  const skippedGames = parseResults.length - parsedEntries.length;
  if (!parsedEntries.length) {
    $('#game-inbox-status').addClass('error').removeClass('success').text(
      `No complete games could be read${skippedGames ? `; ${skippedGames} skipped as invalid` : ''}. Paste one or more complete games and try again.`
    );
    return;
  }
  const gameMetadata = parsedGames.map(parsed => {
    const definition = openingDefinitionForSans(parsed.history());
    return {
      openingId: definition.opening ? definition.opening.id : null,
      opening: definition.info.match ? definition.info.match.name : null,
      exact: !!definition.info.exact
    };
  });
  const targets = collectImportedTargets(parsedEntries, side, gameMetadata);
  if (!targets.length) {
    $('#game-inbox-status').addClass('error').text('No moves were found for the selected side.');
    return;
  }

  importedGameAnalysisActive = true;
  renderCoachPresentation();
  const run = {
    id: ++importedAnalysisRunId,
    cancelled: false,
    completed: 0,
    total: targets.length,
    skippedGames,
    generation: coachGameGeneration,
    originalCoachGame: coachGame,
    originalCoachGameId: coachLocalGameId,
    originalCoachPgn: coachGame && typeof coachGame.pgn === 'function' ? coachGame.pgn() : ''
  };
  importedAnalysisRun = run;
  $('#btn-analyse-pgn').prop('disabled', true);
  const $cancel = $('#' + IMPORT_CANCEL_BUTTON_ID);
  $cancel.show().prop('disabled', false);
  const gameSummary = `${parsedGames.length} valid game${parsedGames.length === 1 ? '' : 's'}${skippedGames ? `; ${skippedGames} invalid game${skippedGames === 1 ? '' : 's'} skipped` : ''}`;
  $('#game-inbox-status').removeClass('error success').text(`Preparing Stockfish to review ${targets.length} moves from ${gameSummary}…`);
  $('#game-inbox-progress').css('width', '2%');
  // Stage the complete batch before touching the visible Coach game. This
  // preserves an existing game when the user cancels or starts another one.
  const generation = run.generation;
  const displayGame = parsedGames[parsedGames.length - 1];
  const displayGameKey = `import-${parsedEntries[parsedEntries.length - 1].sourceIndex + 1}`;
  try {
    await engineClient.init();
    if (run.cancelled || importedAnalysisRun !== run || generation !== coachGameGeneration || !importRunOwnsBoard(run)) throw createAbortError('Import review cancelled.');
    const allReviews = [];
    const stagedInsightEntries = [];
    for (let i = 0; i < targets.length; i++) {
      if (run.cancelled || importedAnalysisRun !== run || generation !== coachGameGeneration || !importRunOwnsBoard(run)) {
        throw createAbortError('Import review cancelled.');
      }
      const target = targets[i];
      $('#game-inbox-status').text(`Reviewing move ${i + 1} of ${targets.length} (${gameSummary})…`);
      $('#game-inbox-progress').css('width', `${Math.round(i / targets.length * 100)}%`);
      const result = await classifyMove(target.fenBefore, target.userUci, target.fenAfter);
      if (run.cancelled || importedAnalysisRun !== run || generation !== coachGameGeneration || !importRunOwnsBoard(run)) {
        throw createAbortError('Import review cancelled.');
      }
      const review = Object.assign({}, result, target, {
        gameGeneration: generation,
        localGameId: target.gameKey,
        source: 'import'
      });
      review.insightTags = insightTagsForReview(review);
      allReviews.push(review);
      if (review.tier !== 'unknown') {
        stagedInsightEntries.push(insightEntryFromReview(review));
      }
      run.completed = i + 1;
      $('#game-inbox-progress').css('width', `${Math.round(run.completed / targets.length * 100)}%`);
      // Yield between engine jobs so the cancel control can be handled even on
      // a large import. Only one classifyMove is in flight at a time.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (run.cancelled || importedAnalysisRun !== run || generation !== coachGameGeneration || !importRunOwnsBoard(run)) {
      throw createAbortError('Import review cancelled.');
    }
    // Commit the final parsed game to Coach while aggregating all games into
    // Insights and repertoire evidence. Each staged review retains its source
    // game key so later games cannot collapse onto the first game's moves.
    const displayReviews = allReviews.filter(review => review.gameKey === displayGameKey);
    resetCoachState(pgnStartFen(displayGame));
    const committedGeneration = coachGameGeneration;
    coachUserSide = side;
    coachGame = displayGame;
    coachStartFen = pgnStartFen(displayGame);
    coachLocalGameId = createCoachGameId();
    coachReviewLog = displayReviews.map(review => Object.assign({}, review, {
      gameGeneration: committedGeneration,
      localGameId: coachLocalGameId
    }));
    coachStats = coachReviewLog.reduce((stats, review) => {
      if (review.tier !== 'unknown') {
        stats.moves += 1;
        stats[review.tier] = (stats[review.tier] || 0) + 1;
      }
      return stats;
    }, { moves: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 });
    const insightState = loadInsights();
    insightState.entries.push(...stagedInsightEntries);
    saveInsights(insightState);
    recordImportedOpenings(parsedGames, side, allReviews);
    coachReviewLog.forEach(review => coachSync.saveMove(review).catch(handleCoachDbError));
    coachLastReview = coachReviewLog[coachReviewLog.length - 1] || null;
    coachGameActive = false;
    coachEndedAt = Date.now();
    coachLastEndMsg = 'Imported game reviewed';
    CoachController.setPhase('ended');
    coachBoardFlipped = side === 'black';
    createCoachBoard(coachGame.fen(), coachBoardFlipped ? 'black' : 'white');
    $('#coach-view').addClass('game-active');
    updateMoveList();
    updateOpeningLabel();
    updateCoachSummary();
    renderInsights();
    renderCoachDailyPlan();
    saveCoachState();
    rollGameIntoLifetime();
    coachSync.saveGame('Imported game reviewed').catch(handleCoachDbError);
    showPostGameSummary('Imported game reviewed');
    $('#game-inbox-status').addClass('success').text(`${targets.length} move${targets.length === 1 ? '' : 's'} reviewed from ${gameSummary}. Showing the last game in Coach; all valid games contributed to Insights and the practice queue.`);
  } catch (error) {
    if (run.cancelled) {
      $('#game-inbox-progress').css('width', `${Math.round(run.completed / Math.max(1, run.total) * 100)}%`);
      $('#game-inbox-status').addClass('error').removeClass('success').text(`Import cancelled after ${run.completed} of ${run.total} moves. No complete batch was saved.`);
    } else if (generation === coachGameGeneration && importedAnalysisRun === run) {
      $('#game-inbox-status').addClass('error').removeClass('success').text((error && error.message) || 'The imported games could not be analysed.');
    } else {
      // A new game reset the generation while this batch was waiting. Leave
      // the new game's status untouched and discard the stale staged batch.
    }
  } finally {
    if (importedAnalysisRun === run) importedAnalysisRun = null;
    importedGameAnalysisActive = false;
    renderCoachPresentation();
    $('#btn-analyse-pgn').prop('disabled', false);
    $cancel.prop('disabled', true).hide();
  }
}

function cancelImportedPgnAnalysis() {
  const run = importedAnalysisRun;
  if (!run || !importedGameAnalysisActive) return false;
  run.cancelled = true;
  // The normal Coach game may have replaced this batch already. In that case
  // leave its newer engine request alone and let the generation fence discard
  // this stale import.
  if (run.generation === coachGameGeneration) engineClient.cancel('Imported game analysis cancelled by the user.');
  $('#game-inbox-status').removeClass('success').text(`Cancelling after ${run.completed} of ${run.total} moves…`);
  return true;
}

function initGrowthFeatures() {
  hydrateGrowthUI();
  $('#btn-progress-next').on('click', runProgressRecommendation);
  $('#btn-repertoire-toggle').on('click', () => {
    if (currentOpening) toggleRepertoireOpening(currentOpening.id);
  });
  $('#player-profile-form').on('submit', event => {
    event.preventDefault();
    const result = savePlayerProfile({
      rating: Number($('#player-rating').val()),
      minutes: Number($('#player-minutes').val()),
      goal: $('#player-goal').val(),
      sessionStyle: $('#player-style').val(),
      autoElo: $('#coach-auto-elo').prop('checked')
    });
    if (!result.ok) {
      $('#player-profile-status').addClass('error').text('Profile could not be saved in this browser.');
      return;
    }
    const profile = result.state.profile;
    $('#player-profile-status').removeClass('error').addClass('success').text(
      `Profile saved. Player estimate ${Math.round(profile.ratingEstimate)} ±${Math.round(profile.ratingDeviation)} · ${playerRatingConfidence(profile)}.`
    );
    applyAdaptiveCoachElo();
    renderInsights();
    renderWeeklyReview();
  });
  $('#coach-auto-elo').on('change', function() {
    const profile = playerProfile();
    savePlayerProfile({ autoElo: $(this).prop('checked'), rating: profile.rating, minutes: profile.minutes, goal: profile.goal, sessionStyle: profile.sessionStyle });
    applyAdaptiveCoachElo();
  });
  $('#coach-strength').on('input', () => {
    if (!$('#coach-auto-elo').prop('checked')) return;
    $('#coach-auto-elo').prop('checked', false);
    const profile = playerProfile();
    savePlayerProfile({ autoElo: false, rating: profile.rating, minutes: profile.minutes, goal: profile.goal, sessionStyle: profile.sessionStyle });
    applyAdaptiveCoachElo();
  });
  $('#game-inbox-file').on('change', async function() {
    const file = this.files && this.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      $('#game-inbox-status').addClass('error').text('Choose a PGN smaller than 1 MB.');
      return;
    }
    $('#game-inbox-pgn').val(await file.text());
    $('#game-inbox-status').removeClass('error').text(`${file.name} loaded. Choose your side, then analyse.`);
  });
  $('#btn-analyse-pgn').on('click', () => analyseImportedPgn());
  $('#' + IMPORT_CANCEL_BUTTON_ID).on('click', () => cancelImportedPgnAnalysis());
  $('#btn-export-training-data').on('click', () => {
    try {
      const count = downloadTrainingBackup();
      $('#training-data-status').removeClass('error').addClass('success').text(`Backup downloaded with ${count} local data sets.`);
    } catch (error) {
      $('#training-data-status').removeClass('success').addClass('error').text('Backup could not be created in this browser.');
    }
  });
  $('#btn-import-training-data').on('click', () => $('#training-data-file').trigger('click'));
  $('#training-data-file').on('change', async function() {
    const file = this.files && this.files[0];
    if (!file) return;
    try {
      const count = await importTrainingBackupFile(file);
      $('#training-data-status').removeClass('error').addClass('success').text(`Merged ${count} data sets. Your existing progress was kept.`);
    } catch (error) {
      $('#training-data-status').removeClass('success').addClass('error').text((error && error.message) || 'That backup could not be imported.');
    } finally {
      this.value = '';
    }
  });
}

$(initGrowthFeatures);
