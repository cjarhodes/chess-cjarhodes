// Optional Supabase account: sign-in, storage fallback and game/insight sync.
// Classic script loaded before app.js (see index.html); its top-level
// declarations are shared globals, as they were inside app.js.

// ─────────────────────────────────────────────
// ACCOUNT SYNC — optional Supabase-backed coach history
// ─────────────────────────────────────────────
function supabaseRuntimeConfig() {
  const cfg = window.COACH_SUPABASE_CONFIG || {};
  return {
    url: (cfg.url || cfg.supabaseUrl || '').trim(),
    anonKey: (cfg.publishableKey || cfg.anonKey || cfg.key || cfg.supabaseAnonKey || '').trim(),
    emailCodeEnabled: cfg.emailCodeEnabled === true
  };
}

// The emailed 6-digit code only exists when the project's Magic Link email
// template includes {{ .Token }}, which Supabase allows only with custom SMTP,
// a Pro plan, or a Send Email hook. Keep the field hidden until then.
function coachEmailCodeEnabled() {
  return supabaseRuntimeConfig().emailCodeEnabled;
}

function isSupabaseConfigured() {
  const cfg = supabaseRuntimeConfig();
  return /^https:\/\/.+\.supabase\.co$/.test(cfg.url) &&
         cfg.anonKey.length > 20 &&
         !cfg.anonKey.includes('YOUR_');
}

let coachAuthStoragePersistent = true;

function createMemoryAuthStorage() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = value;
    },
    removeItem(key) {
      delete store[key];
    }
  };
}

function coachAuthStorage() {
  const storage = coachAuthStoragePersistent ? localStorage : sessionStorage;
  return {
    getItem(key) {
      try { return storage.getItem(key); } catch (e) { return null; }
    },
    setItem(key, value) {
      try { storage.setItem(key, value); } catch (e) {}
    },
    removeItem(key) {
      try { storage.removeItem(key); } catch (e) {}
    }
  };
}
function checkCoachAuthStorage() {
  const key = 'coach:auth-storage-test';
  try {
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    // Older builds used sessionStorage. Preserve an existing Supabase session
    // when upgrading, while making future magic-link returns work across tabs.
    try {
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const storageKey = sessionStorage.key(i);
        if (!storageKey || !storageKey.startsWith('sb-') || localStorage.getItem(storageKey)) continue;
        const value = sessionStorage.getItem(storageKey);
        if (value) localStorage.setItem(storageKey, value);
      }
    } catch (migrationError) { /* a fresh session can still be created */ }
    coachAuthStoragePersistent = true;
    return { ok: true, storage: coachAuthStorage() };
  } catch (e) {
    try {
      sessionStorage.setItem(key, '1');
      sessionStorage.removeItem(key);
      coachAuthStoragePersistent = false;
      return { ok: true, storage: coachAuthStorage() };
    } catch (fallbackError) {
      coachAuthStoragePersistent = false;
      return { ok: false, storage: createMemoryAuthStorage(), error: fallbackError || e };
    }
  }
}

const COACH_AUTH_PENDING_EMAIL_KEY = 'coach:auth-pending-email';

function pendingCoachAuthEmail() {
  try { return sessionStorage.getItem(COACH_AUTH_PENDING_EMAIL_KEY) || ''; } catch (e) { return ''; }
}

function setPendingCoachAuthEmail(email) {
  try {
    if (email) sessionStorage.setItem(COACH_AUTH_PENDING_EMAIL_KEY, email);
    else sessionStorage.removeItem(COACH_AUTH_PENDING_EMAIL_KEY);
  } catch (e) { /* code entry still works within this page */ }
}

// Magic links return with the session (or an error) in the URL fragment.
// Read it before the Supabase client consumes it so expired-link errors can be
// shown, and strip it afterwards so tokens never linger in the address bar.
function readCoachAuthUrlState() {
  const hash = (location.hash || '').replace(/^#/, '');
  if (!hash) return { present: false, error: '' };
  const params = new URLSearchParams(hash);
  const present = ['access_token', 'refresh_token', 'error', 'error_description', 'error_code'].some(key => params.has(key));
  if (!present) return { present: false, error: '' };
  const error = params.get('error_description') || params.get('error') || '';
  return { present: true, error: error.replace(/\+/g, ' ') };
}

function clearCoachAuthUrlState() {
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* cosmetic */ }
}

function coachAccountSyncStatus() {
  if (!coachAuthStoragePersistent) {
    return 'Account sync cannot persist in this browser session.';
  }
  return coachAuthUser ? 'Account sync on.' : '';
}

function setCoachAuthStatus(msg) {
  $('#coach-auth-status').text(msg || '');
}

function setCoachDbStatus(msg) {
  coachDbStatus = msg || '';
  if (coachAuthUser) setCoachAuthStatus(msg || 'Account sync on.');
}

function authCallbackDetected() {
  const params = new URLSearchParams(location.search);
  return params.has('code') || params.has('token_hash') || params.has('error') ||
    /(?:^|&)access_token=/.test((location.hash || '').slice(1));
}

function cleanAuthCallbackUrl() {
  if (!authCallbackDetected() || !window.history || !history.replaceState) return;
  history.replaceState({}, document.title, `${location.pathname}?view=coach`);
}

function renderCoachAuth() {
  const configured = isSupabaseConfigured();
  $('#coach-auth-local').toggle(!configured);
  $('#coach-auth-form').toggle(configured && !coachAuthUser);
  $('#coach-auth-session').toggle(configured && !!coachAuthUser);
  if (!configured) {
    coachAuthPhase = 'local';
    setCoachAuthStatus('Add Supabase config to enable account history.');
    $('#coach-memory-status').text('Progress is saved on this browser. Account sync is not configured.');
    return;
  }
  if (coachAuthUser) {
    coachAuthPhase = 'signed-in';
    $('#coach-auth-user').text(coachAuthUser.email || coachAuthUser.id);
    setCoachAuthStatus(coachDbStatus || 'Account sync on.');
    $('#coach-memory-status').text(coachRemoteInsightsLoaded
      ? 'Account history loaded. Saved-session status is shown below.'
      : 'Progress is saved here. Account history has not finished syncing.');
  } else {
    const pendingEmail = pendingCoachAuthEmail();
    $('#coach-auth-code-form').toggle(coachEmailCodeEnabled() && !!pendingEmail);
    if (pendingEmail && !$('#coach-auth-email').val()) $('#coach-auth-email').val(pendingEmail);
    if (coachAuthPhase !== 'sending' && coachAuthPhase !== 'callback') coachAuthPhase = 'signed-out';
    setCoachAuthStatus(coachDbStatus === 'loading' ? 'Connecting...' : (coachDbStatus || 'Sign in to sync games.'));
    $('#coach-memory-status').text('Progress is saved on this browser. Sign in to sync it across browsers.');
  }
}

function loadSupabaseScript() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  if (window.__coachSupabaseScriptPromise) return window.__coachSupabaseScriptPromise;
  window.__coachSupabaseScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/supabase/supabase-2.114.0.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Supabase client failed to load'));
    document.head.appendChild(script);
  });
  return window.__coachSupabaseScriptPromise;
}

async function initCoachDb() {
  if (coachDbInitPromise) return coachDbInitPromise;
  coachDbInitStarted = true;
  coachDbInitPromise = (async () => {
    renderCoachAuth();
    if (!isSupabaseConfigured()) return;
    if (authCallbackDetected()) coachAuthPhase = 'callback';
    coachDbStatus = 'loading';
    renderCoachAuth();
    try {
      await loadSupabaseScript();
      const cfg = supabaseRuntimeConfig();
      const storageCheck = checkCoachAuthStorage();
      if (!storageCheck.ok) coachDbStatus = coachAccountSyncStatus();
      const authUrlState = readCoachAuthUrlState();
      coachDbClient = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: storageCheck.storage
        }
      });
      const { data, error: sessionError } = await Promise.race([
        coachDbClient.auth.getSession(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Account connection timed out. Reload to reconnect; your local session is kept.')), 12000))
      ]);
      if (sessionError) throw sessionError;
      applyCoachRecoveryUser(data && data.session ? data.session.user : null);
      if (authUrlState.present) clearCoachAuthUrlState();
      if (coachAuthUser) {
        setPendingCoachAuthEmail('');
        adoptAnonymousCoachMemory(coachAuthUser.id);
        adoptAnonymousPracticeProgress(coachAuthUser.id);
        adoptAnonymousDailySprint(coachAuthUser.id);
        if (typeof adoptAnonymousGrowthState === 'function') adoptAnonymousGrowthState(coachAuthUser.id);
      }
      coachDbStatus = coachAccountSyncStatus();
      if (!coachAuthUser && authUrlState.present) {
        coachDbStatus = authUrlState.error
          ? 'Sign-in link is invalid or has expired. Send a new link.'
          : 'Sign-in link could not be used. Send a new link.';
      }
      renderCoachAuth();
      renderInsights();
      if (coachAuthUser) {
        coachSync.loadInsights({ silent: true }).catch(handleCoachDbError);
        if (coachGameActive) ensureRemoteCoachGame().catch(handleCoachDbError);
      }
      coachDbClient.auth.onAuthStateChange((event, session) => {
        // The initial session was already applied above; replaying it here
        // would blank a link-error status and reload insights a second time.
        if (event === 'INITIAL_SESSION') return;
        // Leave the auth lock before starting any database request.
        const authRevision = ++coachAuthEventRevision;
        setTimeout(() => {
          if (authRevision !== coachAuthEventRevision) return;
          const nextUser = session ? session.user : null;
          if (nextUser && coachAuthUser && nextUser.id === coachAuthUser.id) {
            coachAuthUser = nextUser;
            return;
          }
          applyCoachRecoveryUser(session ? session.user : null);
          if (session) cleanAuthCallbackUrl();
          if (coachAuthUser) {
            setPendingCoachAuthEmail('');
            adoptAnonymousCoachMemory(coachAuthUser.id);
            adoptAnonymousPracticeProgress(coachAuthUser.id);
            adoptAnonymousDailySprint(coachAuthUser.id);
            if (typeof adoptAnonymousGrowthState === 'function') adoptAnonymousGrowthState(coachAuthUser.id);
          }
          coachRemoteInsightEntries = null;
          coachRemoteInsightsLoaded = false;
          coachDbStatus = event === 'SIGNED_OUT'
            ? (coachDbStatus.startsWith('Signed out on this browser.') ? coachDbStatus : 'Signed out on this browser. Other devices stay signed in.')
            : coachAccountSyncStatus();
          renderCoachAuth();
          renderInsights();
          if (coachAuthUser) {
            coachSync.loadInsights({ silent: true }).catch(handleCoachDbError);
            if (coachGameActive) ensureRemoteCoachGame().catch(handleCoachDbError);
          }
          if (typeof refreshAccountCheckpoints === 'function') refreshAccountCheckpoints().catch(handleAccountCheckpointError);
        }, 0);
      });
    } catch (err) {
      coachAuthPhase = 'error';
      coachDbStatus = 'Account sync unavailable. Your local session is kept; reload to reconnect.';
      $('#btn-coach-reconnect').show();
      setCoachAuthStatus((err && err.message) || coachDbStatus);
    }
  })();
  return coachDbInitPromise;
}

function hasCoachDbSession() {
  return !!(coachDbClient && coachAuthUser);
}

function handleCoachDbError(err) {
  const msg = err && err.message ? err.message : 'Sync failed';
  setCoachDbStatus('Sync issue: ' + msg);
}

async function sendCoachLoginLink() {
  if (!coachDbClient) {
    await coachSync.init();
  }
  if (!coachDbClient || coachAuthPhase === 'sending') return;
  const email = ($('#coach-auth-email').val() || '').trim();
  if (!email) {
    setCoachAuthStatus('Enter an email address.');
    return;
  }
  coachDbStatus = '';
  setCoachAuthStatus('Sending link...');
  coachAuthPhase = 'sending';
  const redirectTo = location.origin + location.pathname + '?view=coach';
  $('#btn-coach-login').prop('disabled', true);
  let result;
  try {
    result = await coachDbClient.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  } catch (error) {
    coachAuthPhase = 'error';
    setCoachAuthStatus('The link could not be sent. Reconnect and try again.');
    return;
  } finally { $('#btn-coach-login').prop('disabled', false); }
  const { error } = result;
  if (error) {
    coachAuthPhase = 'error';
    setCoachAuthStatus(error.message);
    return;
  }
  coachAuthPhase = 'link-sent';
  setPendingCoachAuthEmail(email);
  if (coachEmailCodeEnabled()) {
    $('#coach-auth-code-form').show();
    $('#coach-auth-code').val('').trigger('focus');
    coachDbStatus = 'Link sent to ' + email + '. Open it in this browser, or enter the 6-digit code from that email here.';
  } else {
    coachDbStatus = 'Link sent to ' + email + '. Open it in this browser to finish signing in.';
  }
  setCoachAuthStatus(coachDbStatus);
}

async function verifyCoachLoginCode() {
  if (!coachDbClient) {
    await coachSync.init();
  }
  if (!coachDbClient) return;
  if (!coachEmailCodeEnabled()) {
    setCoachAuthStatus('Code sign-in is not enabled for this project yet. Use the emailed link.');
    return;
  }
  const email = (($('#coach-auth-email').val() || '').trim()) || pendingCoachAuthEmail();
  const code = ($('#coach-auth-code').val() || '').replace(/\D/g, '');
  if (!email) {
    setCoachAuthStatus('Enter the email address you requested the code with.');
    $('#coach-auth-email').trigger('focus');
    return;
  }
  if (code.length !== 6) {
    setCoachAuthStatus('Enter the 6-digit code from the sign-in email.');
    $('#coach-auth-code').trigger('focus');
    return;
  }
  setCoachAuthStatus('Checking code...');
  const { error } = await coachDbClient.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) {
    setCoachAuthStatus('That code is invalid or has expired. Send a new link for a fresh code.');
    $('#coach-auth-code').trigger('focus');
    return;
  }
  setPendingCoachAuthEmail('');
  $('#coach-auth-code').val('');
  setCoachAuthStatus('Signed in.');
}

async function signOutCoach() {
  if (!coachDbClient) return;
  clearQueuedRemoteCoachGameUpdate();
  if (dailySprintSyncTimer) {
    clearTimeout(dailySprintSyncTimer);
    dailySprintSyncTimer = null;
  }
  if (typeof growthRemoteSync !== 'undefined' && growthRemoteSync.timer) {
    clearTimeout(growthRemoteSync.timer);
    growthRemoteSync.timer = null;
  }
  $('#btn-coach-logout').prop('disabled', true);
  let result;
  try {
    result = await Promise.race([
      coachDbClient.auth.signOut({ scope: 'local' }),
      new Promise(resolve => setTimeout(() => resolve({ error: new Error('Sign-out timed out') }), 8000))
    ]);
  } catch (error) { result = { error }; }
  finally { $('#btn-coach-logout').prop('disabled', false); }
  if (result.error) {
    // This SDK can clear its local session even if the server rejects logout.
    // Reconcile the real session before describing the result to the user.
    let sessionResult = null;
    try {
      sessionResult = await Promise.race([
        coachDbClient.auth.getSession(),
        new Promise(resolve => setTimeout(() => resolve(null), 3000))
      ]);
    } catch (error) { /* leave the last known owner until auth confirms */ }
    if (sessionResult && !sessionResult.error) {
      applyCoachRecoveryUser(sessionResult.data && sessionResult.data.session ? sessionResult.data.session.user : null);
      coachDbStatus = coachAuthUser
        ? 'Sign-out did not finish. You are still signed in here; reconnect and try again.'
        : 'Signed out on this browser. Server confirmation was unavailable; other devices stay signed in.';
      renderCoachAuth();
      renderInsights();
      if (typeof refreshAccountCheckpoints === 'function') refreshAccountCheckpoints().catch(handleAccountCheckpointError);
    } else setCoachAuthStatus('Sign-out could not be confirmed. Reload to check this browser’s session.');
    return;
  }
  setPendingCoachAuthEmail('');
  applyCoachRecoveryUser(null);
  coachRemoteInsightEntries = null;
  coachRemoteInsightsLoaded = false;
  coachRemoteGamePromise = null;
  coachRemoteGamePromiseGeneration = null;
  coachDbStatus = 'Signed out on this browser. Other devices stay signed in.';
  if (typeof refreshAccountCheckpoints === 'function') refreshAccountCheckpoints().catch(handleAccountCheckpointError);
  renderCoachAuth();
  renderInsights();
}

function remoteGameResult(endReason) {
  if (!coachGame) return '*';
  if (coachGame.in_checkmate()) {
    return coachGame.turn() === 'w' ? '0-1' : '1-0';
  }
  if (coachGame.in_stalemate() || coachGame.in_draw() || coachGame.in_threefold_repetition() || coachGame.insufficient_material()) {
    return '1/2-1/2';
  }
  if (endReason && endReason.includes('Resigned')) {
    return coachUserColor() === 'white' ? '0-1' : '1-0';
  }
  // Clock results (coach-clock.js): "Time — White wins." or a draw when the
  // winner had nothing left to mate with.
  if (endReason && /^Time — (White|Black) wins\./.test(endReason)) return endReason.includes('White wins') ? '1-0' : '0-1';
  if (endReason && endReason.startsWith('Draw: time ran out')) return '1/2-1/2';
  return '*';
}

function remoteGamePayload(endReason) {
  const total = coachStats ? coachStats.moves : 0;
  return {
    user_id: coachAuthUser.id,
    user_side: coachUserColor(),
    opponent_level: coachEngineElo,
    start_fen: coachStartFen || (coachGame ? coachGame.fen() : null),
    final_fen: coachGame ? coachGame.fen() : null,
    pgn: coachGame ? coachGetPgn() : '',
    opening_name: currentCoachOpeningName(),
    result: remoteGameResult(endReason),
    end_reason: endReason || null,
    ended_at: endReason ? new Date(coachEndedAt || Date.now()).toISOString() : null,
    moves_count: total,
    accuracy: total ? accuracyFromTallies(coachStats, total) : null,
    acpl: coachReviewLog && coachReviewLog.length ? computeACPL(coachReviewLog) : null,
    stats: coachStats || {},
    updated_at: new Date().toISOString()
  };
}

async function ensureRemoteCoachGame(generation = coachGameGeneration) {
  if (!hasCoachDbSession() || !coachGame || coachPracticeSession) return null;
  const syncOwner = coachMemoryOwnerId();
  if (typeof ensureAccountWritePermission === 'function') await ensureAccountWritePermission();
  if (syncOwner !== coachMemoryOwnerId() || generation !== coachGameGeneration) return null;
  if (coachRemoteGameId) return coachRemoteGameId;
  if (coachRemoteGamePromise && coachRemoteGamePromiseGeneration === generation) {
    return coachRemoteGamePromise;
  }
  const gameRef = coachGame;
  const userId = coachAuthUser.id;
  const payload = remoteGamePayload(null);
  coachRemoteGamePromiseGeneration = generation;
  coachRemoteGamePromise = (async () => {
    const { data, error } = await coachDbClient
      .from('coach_games')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw error;
    if (generation !== coachGameGeneration || coachGame !== gameRef ||
        !coachAuthUser || coachAuthUser.id !== userId) {
      // The insert completed after the user replaced the game. Remove the
      // now-orphaned row when the session still permits it, and never attach it
      // to the current game.
      coachDbClient.from('coach_games').delete().eq('id', data.id).eq('user_id', userId).then(() => {});
      return null;
    }
    coachRemoteGameId = data.id;
    saveCoachState();
    setCoachDbStatus('Game sync started.');
    return coachRemoteGameId;
  })();
  try {
    return await coachRemoteGamePromise;
  } finally {
    if (coachRemoteGamePromiseGeneration === generation) {
      coachRemoteGamePromise = null;
      coachRemoteGamePromiseGeneration = null;
    }
  }
}

function updateRemoteCoachGame(endReason, generation = coachGameGeneration) {
  const owner = coachMemoryOwnerId(), localGameId = coachLocalGameId;
  const write = () => {
    if (owner !== coachMemoryOwnerId() || localGameId !== coachLocalGameId || generation !== coachGameGeneration) return;
    return commitRemoteCoachGame(endReason, generation);
  };
  return typeof runAccountGameWrite === 'function' ? runAccountGameWrite(write) : Promise.resolve(write());
}

async function commitRemoteCoachGame(endReason, generation = coachGameGeneration) {
  if (!hasCoachDbSession() || !coachGame) return;
  const gameRef = coachGame;
  const syncOwner = coachMemoryOwnerId();
  const gameId = await ensureRemoteCoachGame(generation);
  if (!gameId) return;
  if (generation !== coachGameGeneration || coachGame !== gameRef || !hasCoachDbSession()) return;
  const { error } = await coachDbClient
    .from('coach_games')
    .update(remoteGamePayload(endReason || null))
    .eq('id', gameId);
  if (syncOwner !== coachMemoryOwnerId() || generation !== coachGameGeneration) return;
  if (error) throw error;
  setCoachDbStatus(endReason ? 'Game saved.' : 'Game synced.');
}

function remoteMovePayload(review, gameId) {
  const tags = review.insightTags || insightTagsForReview(review);
  review.insightTags = tags;
  return {
    user_id: coachAuthUser.id,
    game_id: gameId,
    ply: review.ply,
    pair_num: review.pairNum,
    phase: phaseOf(review.pairNum),
    played_at: new Date().toISOString(),
    fen_before: review.fenBefore,
    fen_after: review.fenAfter,
    user_uci: review.userUci,
    user_san: review.userSan || null,
    best_uci: review.bestUci || null,
    best_san: review.bestSan || null,
    classification: review.tier,
    centipawn_loss: Math.round(review.loss || 0),
    rank: review.rank || null,
    tags,
    explanation: [review.whyBetter, review.lesson, review.opponentThreat].filter(Boolean).join(' ') || null,
    pv_san: review.pvSan || [],
    top_alternatives: review.topAlternatives || [],
    eval_before: review.evalBefore || null,
    eval_after: review.evalAfter || null,
    opening_name: currentCoachOpeningName()
  };
}

function learningArtifactPayloads(review, moveId) {
  if (!review || !moveId || !isInsightProblem(review.tier) || !review.fenBefore) {
    return { drills: [], cards: [] };
  }
  const tags = (review.insightTags || insightTagsForReview(review))
    .filter(tag => INSIGHT_TAG_META[tag])
    .slice(0, 2);
  const now = new Date().toISOString();
  const drills = [];
  const cards = [];

  tags.forEach(tag => {
    const meta = INSIGHT_TAG_META[tag];
    if (review.bestUci) {
      drills.push({
        user_id: coachAuthUser.id,
        drill_key: practiceItemId({ fenBefore: review.fenBefore, bestUci: review.bestUci }, tag),
        source_move_id: moveId,
        tag,
        fen: review.fenBefore,
        best_uci: review.bestUci || null,
        best_san: review.bestSan || null,
        prompt: meta.practice,
        due_at: now,
        updated_at: now
      });
    }
    cards.push({
      user_id: coachAuthUser.id,
      source_move_id: moveId,
      tag,
      title: meta.title,
      body: meta.theory,
      retained: false,
      updated_at: now
    });
  });

  return { drills, cards };
}

async function syncRemoteLearningArtifacts(review, moveId, generation) {
  if (!hasCoachDbSession()) return;
  if (generation !== coachGameGeneration) return;
  const artifacts = learningArtifactPayloads(review, moveId);

  if (!artifacts.drills.length && !artifacts.cards.length) return;
  await deleteRemoteLearningArtifacts(moveId);
  if (generation !== coachGameGeneration) return;

  const writes = [];
  if (artifacts.drills.length) {
    writes.push(coachDbClient
      .from('drill_queue')
      .upsert(artifacts.drills, { onConflict: 'user_id,drill_key' }));
  }
  if (artifacts.cards.length) {
    writes.push(coachDbClient
      .from('theory_cards')
      .upsert(artifacts.cards, { onConflict: 'source_move_id,tag' }));
  }
  const results = await Promise.all(writes);
  for (const result of results) {
    if (result.error) throw result.error;
  }
}

async function deleteRemoteLearningArtifacts(moveId) {
  if (!hasCoachDbSession() || !moveId) return;
  const [drillDelete, cardDelete] = await Promise.all([
    coachDbClient
      .from('drill_queue')
      .delete()
      .eq('source_move_id', moveId)
      .eq('user_id', coachAuthUser.id),
    coachDbClient
      .from('theory_cards')
      .delete()
      .eq('source_move_id', moveId)
      .eq('user_id', coachAuthUser.id)
  ]);
  if (drillDelete.error) throw drillDelete.error;
  if (cardDelete.error) throw cardDelete.error;
}

async function syncRemoteCoachMove(review) {
  if (!hasCoachDbSession() || !review || review.tier === 'unknown') return;
  const generation = review.gameGeneration;
  if (generation !== coachGameGeneration || review.localGameId !== coachLocalGameId) return;
  const gameId = await ensureRemoteCoachGame(generation);
  if (!gameId) return;
  if (generation !== coachGameGeneration || review.localGameId !== coachLocalGameId) return;
  const { data, error } = await coachDbClient
    .from('coach_moves')
    .upsert(remoteMovePayload(review, gameId), { onConflict: 'game_id,ply' })
    .select('id')
    .single();
  if (error) throw error;
  if (generation !== coachGameGeneration || review.localGameId !== coachLocalGameId) return;
  if (data && data.id) await syncRemoteLearningArtifacts(review, data.id, generation);
  if (generation !== coachGameGeneration) return;
  if (data && data.id) {
    review.insightId = data.id;
    review.remoteGameId = gameId;
    const local = loadInsights();
    const entry = local.entries.find(e => e.localGameId === review.localGameId && e.ply === review.ply);
    if (entry) { entry.id = data.id; entry.gameId = gameId; saveInsights(local); }
    if (typeof markPendingAccountReviewSynced === 'function') markPendingAccountReviewSynced(review);
    upsertRemoteInsightEntry(remoteInsightEntryFromReview(review, data.id));
    saveCoachState();
  }
  queueRemoteCoachGameUpdate(null);
}

async function deleteRemoteCoachMove(review) {
  if (review && review.localGameId && review.localGameId !== coachLocalGameId) return;
  if (!hasCoachDbSession() || !coachRemoteGameId || !review || !review.ply) return;
  const deleteOwner = coachMemoryOwnerId(), gameId = coachRemoteGameId;
  const existing = await coachDbClient
    .from('coach_moves')
    .select('id')
    .eq('game_id', coachRemoteGameId)
    .eq('ply', review.ply)
    .maybeSingle();
  if (deleteOwner !== coachMemoryOwnerId() || gameId !== coachRemoteGameId) return;
  if (existing.error) throw existing.error;
  if (existing.data && existing.data.id) await deleteRemoteLearningArtifacts(existing.data.id);
  if (deleteOwner !== coachMemoryOwnerId() || gameId !== coachRemoteGameId) return;
  const { error } = await coachDbClient
    .from('coach_moves')
    .delete()
    .eq('game_id', coachRemoteGameId)
    .eq('ply', review.ply);
  if (deleteOwner !== coachMemoryOwnerId()) return;
  if (error) throw error;
  if (typeof pendingAccountReviews === 'function') {
    const key = `${review.localGameId}|${review.ply}`;
    savePendingAccountReviews(pendingAccountReviews().filter(entry => entry.key !== key || !entry.deleted));
  }
  if (existing.data && existing.data.id) removeRemoteInsightEntry(existing.data.id);
  queueRemoteCoachGameUpdate(null);
}

function remoteMoveToInsightEntry(row) {
  return {
    id: row.id || null,
    gameId: row.game_id || null,
    ts: row.played_at ? Date.parse(row.played_at) : Date.now(),
    tier: row.classification,
    loss: row.centipawn_loss || 0,
    phase: row.phase || phaseOf(row.pair_num || Math.ceil((row.ply || 1) / 2)),
    tags: Array.isArray(row.tags) ? row.tags : [],
    pairNum: row.pair_num || Math.ceil((row.ply || 1) / 2),
    ply: row.ply || 1,
    userSan: row.user_san || null,
    bestSan: row.best_san || null,
    fenBefore: row.fen_before || null,
    userUci: row.user_uci || null,
    bestUci: row.best_uci || null,
    opening: row.opening_name || null
  };
}

function remoteInsightEntryFromReview(review, id) {
  const entry = insightEntryFromReview(review);
  entry.id = id || entry.id || null;
  return entry;
}

function upsertRemoteInsightEntry(entry) {
  if (!entry || !entry.id) return;
  if (!Array.isArray(coachRemoteInsightEntries)) coachRemoteInsightEntries = [];
  const idx = coachRemoteInsightEntries.findIndex(existing => existing && existing.id === entry.id);
  if (idx >= 0) coachRemoteInsightEntries[idx] = entry;
  else coachRemoteInsightEntries.push(entry);
  coachRemoteInsightEntries = coachRemoteInsightEntries
    .filter(e => e && e.tier && e.tier !== 'unknown')
    .slice(-INSIGHTS_MAX_ENTRIES);
  renderInsights();
}

function removeRemoteInsightEntry(id) {
  if (!id || !Array.isArray(coachRemoteInsightEntries)) return;
  coachRemoteInsightEntries = coachRemoteInsightEntries.filter(entry => entry && entry.id !== id);
  renderInsights();
}

function clearQueuedRemoteCoachGameUpdate() {
  if (remoteGameUpdateTimer) {
    clearTimeout(remoteGameUpdateTimer);
    remoteGameUpdateTimer = null;
  }
  pendingRemoteGameEndReason = null;
  pendingRemoteGameGeneration = null;
}

function queueRemoteCoachGameUpdate(endReason) {
  if (!hasCoachDbSession() || !coachGame) return;
  pendingRemoteGameGeneration = coachGameGeneration;
  if (endReason) pendingRemoteGameEndReason = endReason;
  if (remoteGameUpdateTimer) clearTimeout(remoteGameUpdateTimer);
  remoteGameUpdateTimer = setTimeout(() => {
    remoteGameUpdateTimer = null;
    const reason = pendingRemoteGameEndReason;
    const generation = pendingRemoteGameGeneration;
    pendingRemoteGameEndReason = null;
    pendingRemoteGameGeneration = null;
    if (generation !== coachGameGeneration) return;
    updateRemoteCoachGame(reason, generation).catch(handleCoachDbError);
  }, REMOTE_GAME_SYNC_DEBOUNCE_MS);
}

async function refreshRemoteInsights(opts = {}) {
  if (!hasCoachDbSession()) {
    coachRemoteInsightEntries = null;
    renderInsights();
    return;
  }
  const ownerId = activePracticeOwnerId();
  if (typeof refreshAccountCheckpoints === 'function') refreshAccountCheckpoints().catch(handleAccountCheckpointError);
  if (!opts.silent) setCoachDbStatus('Loading account insights...');
  await Promise.all([
    syncPendingPracticeEvents(),
    typeof flushPendingAccountReviews === 'function' ? flushPendingAccountReviews() : Promise.resolve(),
    syncRemoteDailySprints({ silent: true }),
    typeof syncGrowthState === 'function' ? syncGrowthState({ silent: true }) : Promise.resolve()
  ]);
  const [movesResult, drillsResult, attemptsResult] = await Promise.all([
    coachDbClient
      .from('coach_moves')
      .select('id,game_id,played_at,classification,centipawn_loss,phase,tags,pair_num,ply,fen_before,user_uci,user_san,best_uci,best_san,opening_name')
      .eq('user_id', ownerId)
      .order('played_at', { ascending: false })
      .limit(300),
    coachDbClient
      .from('drill_queue')
      .select('drill_key,source_move_id,tag,fen,best_uci,due_at,interval_days,ease,reps,attempts,correct,last_result,last_attempt_at,updated_at')
      .eq('user_id', ownerId)
      .limit(300),
    coachDbClient
      .from('practice_attempts')
      .select('id,drill_key,source_move_id,tag,attempted_at,correct,revealed,result')
      .eq('user_id', ownerId)
      .order('attempted_at', { ascending: false })
      .limit(PRACTICE_EVENT_LIMIT)
  ]);
  if (movesResult.error) throw movesResult.error;
  if (drillsResult.error) throw drillsResult.error;
  if (attemptsResult.error) throw attemptsResult.error;
  if (activePracticeOwnerId() !== ownerId) return;
  mergeRemotePracticeRecords(drillsResult.data || [], ownerId);
  mergeRemotePracticeEvents((attemptsResult.data || []).slice().reverse(), ownerId);
  coachRemoteInsightEntries = (movesResult.data || []).slice().reverse().map(remoteMoveToInsightEntry);
  coachRemoteInsightsLoaded = true;
  if (!opts.silent) setCoachDbStatus('Account insights loaded.');
  renderCoachAuth();
  renderInsights();
}

const coachSync = {
  init() {
    return initCoachDb();
  },
  saveMove(review) {
    return typeof runAccountMoveWrite === 'function'
      ? runAccountMoveWrite(() => syncRemoteCoachMove(review)) : syncRemoteCoachMove(review);
  },
  deleteMove(review) {
    if (typeof queueDeletedAccountReview === 'function') queueDeletedAccountReview(review);
    return typeof runAccountMoveWrite === 'function'
      ? runAccountMoveWrite(() => deleteRemoteCoachMove(review)) : deleteRemoteCoachMove(review);
  },
  saveGame(endReason) {
    return updateRemoteCoachGame(endReason);
  },
  loadInsights(opts) {
    return refreshRemoteInsights(opts || {});
  },
  syncDailySessions(opts) {
    return syncRemoteDailySprints(opts || {});
  }
};
