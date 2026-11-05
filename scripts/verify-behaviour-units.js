// Playwright CLI body: behavioural checks for logic that used to be guarded
// only by regexes over the source (docs/behaviour-checklist.md, Phase 2).
// Each check drives the real functions in the running app and stubs only the
// boundary (Worker, Supabase client, storage, clipboard, network), so the
// code can be reorganised freely as long as the behaviour holds.
async page => {
  const failures = [];
  const passed = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const check = async (name, fn) => {
    try {
      const problems = await fn();
      if (problems && problems.length) failures.push(`${name}: ${problems.join('; ')}`);
      else passed.push(name);
    } catch (error) {
      failures.push(`${name}: threw ${error.message}`);
    }
  };
  const expect = (problems, condition, message) => { if (!condition) problems.push(message); };
  // The pinned CI runner has no URL global in this sandbox, so parse the origin directly.
  const base = page.url().match(/^https?:\/\/[^/]+/)[0];
  const settle = () => page.waitForFunction(() => !coachThinking, null, { timeout: 60000 });
  const freshCoach = async () => {
    await page.goto(base + '/?view=coach');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof engineClient !== 'undefined' && typeof coachGameActive !== 'undefined');
  };
  const newGame = async () => {
    await page.locator('#btn-coach-newgame').click();
    await page.waitForFunction(() => coachGameActive && !coachThinking, null, { timeout: 60000 });
  };
  const playMove = async move => {
    await page.locator('#coach-keyboard-move').evaluate(el => { el.open = true; });
    await page.locator('#coach-keyboard-move-input').fill(move);
    await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await freshCoach();

  // ── Engine: worker failures and cancellation reject every pending search ──
  await check('engine worker error rejects the active and queued searches', () => page.evaluate(async () => {
    const problems = [];
    engineClient.cancel('test reset');
    const RealWorker = window.Worker;
    let fake = null;
    window.Worker = function FakeWorker() {
      fake = this;
      this.posted = [];
      this.postMessage = message => this.posted.push(message);
      this.terminate = () => { this.terminated = true; };
    };
    try {
      const fen = '8/8/8/8/8/8/8/K6k w - - 0 1';
      const a = engineClient.evaluate(fen, 4).then(() => 'resolved', e => 'rejected:' + e.message);
      const b = engineClient.evaluate(fen, 4).then(() => 'resolved', e => 'rejected:' + e.message);
      fake.onmessage({ data: 'option name Skill Level type spin default 20 min 0 max 20' });
      fake.onmessage({ data: 'uciok' });
      fake.onmessage({ data: 'readyok' });
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!fake.posted.some(m => m.startsWith('go depth'))) problems.push('first search never started');
      fake.onerror({ message: 'boom' });
      const results = await Promise.all([a, b]);
      if (!results.every(r => r.startsWith('rejected:Engine failed'))) problems.push('searches were not rejected: ' + results.join(', '));
      if (engineClient.status !== 'idle' || engineClient.worker !== null) problems.push('engine did not reset to idle');
      if (!fake.terminated) problems.push('failed worker was not terminated');
    } finally {
      window.Worker = RealWorker;
    }
    return problems;
  }));

  await check('engine cancel rejects pending searches as aborts', () => page.evaluate(async () => {
    const problems = [];
    const RealWorker = window.Worker;
    let fake = null;
    window.Worker = function FakeWorker() {
      fake = this;
      this.posted = [];
      this.postMessage = message => this.posted.push(message);
      this.terminate = () => {};
    };
    try {
      const fen = '8/8/8/8/8/8/8/K6k w - - 0 1';
      const a = engineClient.evaluate(fen, 4).then(() => null, e => e);
      const b = engineClient.evaluate(fen, 4).then(() => null, e => e);
      fake.onmessage({ data: 'uciok' });
      fake.onmessage({ data: 'readyok' });
      await new Promise(resolve => setTimeout(resolve, 0));
      engineClient.cancel('Position changed');
      const errors = await Promise.all([a, b]);
      if (!errors.every(e => e && isAbortError(e))) problems.push('cancelled searches were not abort errors');
    } finally {
      window.Worker = RealWorker;
    }
    return problems;
  }));

  await check('position reset invalidates async work and cancels the engine', () => page.evaluate(() => {
    const problems = [];
    const realCancel = engineClient.cancel;
    let cancelled = 0;
    engineClient.cancel = function (...args) { cancelled++; return realCancel.apply(this, args); };
    try {
      const before = { game: coachGameGeneration, candidate: candidateRequestId, threat: threatRequestId };
      const generation = invalidateCoachAsyncWork('test');
      if (generation !== before.game + 1 || coachGameGeneration !== before.game + 1) problems.push('game generation did not advance');
      if (candidateRequestId !== before.candidate + 1 || threatRequestId !== before.threat + 1) problems.push('request guards did not advance');
      if (cancelled !== 1) problems.push('engine work was not cancelled');
    } finally {
      engineClient.cancel = realCancel;
    }
    return problems;
  }));

  // ── Threats: a failed mate scan is "unavailable", not "no threat" ──
  await check('mate scan distinguishes unavailable from no threat', () => page.evaluate(async () => {
    const problems = [];
    const realEvaluate = engineClient.evaluate;
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    try {
      engineClient.evaluate = () => Promise.reject(new Error('worker gone'));
      const failed = await detectMateThreat(fen);
      engineClient.evaluate = () => Promise.resolve({ bestmove: 'e7e5', info: { mate: 2, pv: ['e7e5'] } });
      const mate = await detectMateThreat(fen);
      engineClient.evaluate = () => Promise.resolve({ bestmove: 'e7e5', info: { cp: 20, mate: null, pv: ['e7e5'] } });
      const none = await detectMateThreat(fen);
      if (failed.status !== 'unavailable') problems.push('engine failure reported as ' + failed.status);
      if (mate.status !== 'ok' || mate.mateIn !== 2) problems.push('mate in 2 not reported');
      if (none.status !== 'ok' || none.mateIn !== null) problems.push('quiet position reported a mate');
    } finally {
      engineClient.evaluate = realEvaluate;
    }
    return problems;
  }));

  await newGame();
  await check('threat panel renders static threats first and ignores stale mate scans', () => page.evaluate(async () => {
    const problems = [];
    const realDetect = window.detectMateThreat;
    const tick = () => new Promise(resolve => setTimeout(resolve, 20));
    try {
      let resolveScan;
      window.detectMateThreat = () => new Promise(resolve => { resolveScan = resolve; });
      await showThreats();
      const staticText = $('#threats-list').text();
      if (!staticText.trim()) problems.push('static threats were not rendered before the mate scan finished');
      threatRequestId++;
      resolveScan({ status: 'ok', mateIn: 1 });
      await tick();
      if ($('#threats-list').text() !== staticText) problems.push('a stale mate scan changed the threat panel');
      window.detectMateThreat = () => Promise.resolve({ status: 'unavailable' });
      await showThreats();
      await tick();
      if (!/unavailable/i.test($('#threats-list').text())) problems.push('mate-scan failure was not shown');
    } finally {
      window.detectMateThreat = realDetect;
    }
    return problems;
  }));

  // ── Sign-in: the magic-link fragment survives URL syncing until consumed ──
  await check('magic-link fragment is kept until the session is read, then stripped', () => page.evaluate(() => {
    const problems = [];
    const original = location.pathname + location.search + location.hash;
    try {
      history.replaceState(null, '', location.pathname + '?view=coach#access_token=abc&refresh_token=def&type=magiclink');
      const signedIn = readCoachAuthUrlState();
      updateURL();
      if (!signedIn.present) problems.push('token fragment not recognised');
      if (!location.hash.includes('access_token')) problems.push('URL sync dropped the token fragment before it was read');
      clearCoachAuthUrlState();
      if (location.hash) problems.push('token fragment was not stripped after use');
      history.replaceState(null, '', location.pathname + '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired');
      const expired = readCoachAuthUrlState();
      if (!expired.present || !/invalid or has expired/.test(expired.error)) problems.push('expired-link error not decoded');
      history.replaceState(null, '', location.pathname + '#some-section');
      const unrelated = readCoachAuthUrlState();
      updateURL();
      if (unrelated.present) problems.push('an unrelated fragment was treated as sign-in state');
      if (location.hash) problems.push('URL sync kept an unrelated fragment');
    } finally {
      history.replaceState(null, '', original);
    }
    return problems;
  }));

  await check('auth storage falls back from local to session to memory, visibly', () => page.evaluate(() => {
    const problems = [];
    const proto = Storage.prototype;
    const realSet = proto.setItem;
    const key = 'sb-behaviour-test-auth-token';
    try {
      localStorage.removeItem(key);
      sessionStorage.setItem(key, 'legacy-session');
      const persistent = checkCoachAuthStorage();
      if (!persistent.ok || !coachAuthStoragePersistent) problems.push('working localStorage was not used');
      if (localStorage.getItem(key) !== 'legacy-session') problems.push('legacy session-scoped auth was not migrated');
      proto.setItem = function (k, v) {
        if (this === localStorage) throw new DOMException('blocked', 'SecurityError');
        return realSet.call(this, k, v);
      };
      const sessionOnly = checkCoachAuthStorage();
      if (!sessionOnly.ok || coachAuthStoragePersistent) problems.push('blocked localStorage did not fall back to session storage');
      if (!/cannot persist/.test(coachAccountSyncStatus())) problems.push('non-persistent auth was not explained to the user');
      proto.setItem = function () { throw new DOMException('blocked', 'SecurityError'); };
      const memory = checkCoachAuthStorage();
      memory.storage.setItem('k', 'v');
      if (memory.ok !== false || memory.storage.getItem('k') !== 'v') problems.push('memory fallback did not work');
    } finally {
      proto.setItem = realSet;
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      checkCoachAuthStorage();
    }
    return problems;
  }));

  // ── Sync: per-move writes update insights incrementally and debounce the game row ──
  await playMove('e4');
  await settle();
  await page.waitForFunction(() => coachReviewLog.some(r => r.tier && r.tier !== 'unknown'), null, { timeout: 60000 });
  await check('per-move sync is incremental, debounced and ignores stale games', () => page.evaluate(async () => {
    const problems = [];
    const review = coachReviewLog.filter(r => r.tier && r.tier !== 'unknown').pop();
    const saved = {
      client: coachDbClient, user: coachAuthUser, remoteId: coachRemoteGameId, insights: coachRemoteInsightEntries,
      ensure: window.ensureRemoteCoachGame, arts: window.syncRemoteLearningArtifacts, delArts: window.deleteRemoteLearningArtifacts,
      refresh: window.refreshRemoteInsights, update: window.updateRemoteCoachGame,
    };
    const calls = { refresh: 0, update: 0, db: 0 };
    const fakeClient = {
      from(table) {
        const ops = [];
        calls.db++;
        const result = () => (table === 'coach_moves'
          ? (ops.includes('delete') ? { error: null } : { data: { id: 'move-behaviour-1' }, error: null })
          : { data: null, error: null });
        const query = new Proxy(function () {}, {
          get(_, prop) {
            if (prop === 'then') return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
            return (...args) => {
              ops.push(prop);
              return prop === 'single' || prop === 'maybeSingle' ? Promise.resolve(result()) : query;
            };
          }
        });
        return query;
      }
    };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      coachDbClient = fakeClient;
      coachAuthUser = { id: 'behaviour-test-user' };
      coachRemoteInsightEntries = [];
      window.ensureRemoteCoachGame = async () => 'game-behaviour-1';
      window.syncRemoteLearningArtifacts = async () => {};
      window.deleteRemoteLearningArtifacts = async () => {};
      window.refreshRemoteInsights = async () => { calls.refresh++; };
      window.updateRemoteCoachGame = async () => { calls.update++; };

      await syncRemoteCoachMove(review);
      await syncRemoteCoachMove(review);
      if (JSON.stringify(coachRemoteInsightEntries.map(e => e.id)) !== '["move-behaviour-1"]') problems.push('synced move was not upserted into insights exactly once');
      if (calls.update !== 0) problems.push('game row updated without debouncing');
      await wait(REMOTE_GAME_SYNC_DEBOUNCE_MS + 300);
      if (calls.update !== 1) problems.push(`two move syncs produced ${calls.update} game updates, expected 1`);

      const dbBefore = calls.db;
      await syncRemoteCoachMove(Object.assign({}, review, { gameGeneration: coachGameGeneration - 1 }));
      if (calls.db !== dbBefore) problems.push('a review from a replaced game still wrote to the database');

      coachRemoteGameId = 'game-behaviour-1';
      await deleteRemoteCoachMove(review);
      if (coachRemoteInsightEntries.length !== 0) problems.push('take-back did not remove the insight locally');
      await wait(REMOTE_GAME_SYNC_DEBOUNCE_MS + 300);
      if (calls.update !== 2) problems.push('take-back did not queue one debounced game update');
      if (calls.refresh !== 0) problems.push('sync reloaded every remote insight');
    } finally {
      clearQueuedRemoteCoachGameUpdate();
      coachDbClient = saved.client;
      coachAuthUser = saved.user;
      coachRemoteGameId = saved.remoteId;
      coachRemoteInsightEntries = saved.insights;
      Object.assign(window, {
        ensureRemoteCoachGame: saved.ensure, syncRemoteLearningArtifacts: saved.arts, deleteRemoteLearningArtifacts: saved.delArts,
        refreshRemoteInsights: saved.refresh, updateRemoteCoachGame: saved.update,
      });
      Object.keys(localStorage).filter(k => k.includes('behaviour-test-user')).forEach(k => localStorage.removeItem(k));
    }
    return problems;
  }));

  await check('manual sync reports partial failures', () => page.evaluate(async () => {
    const problems = [];
    const saved = { client: coachDbClient, user: coachAuthUser, load: coachSync.loadInsights, save: coachSync.saveGame, flush: window.flushAccountCheckpoint };
    const run = async () => {
      $('#btn-coach-sync').trigger('click');
      await new Promise(resolve => setTimeout(resolve, 50));
      return coachDbStatus;
    };
    try {
      coachDbClient = {};
      coachAuthUser = { id: 'behaviour-test-user' };
      window.flushAccountCheckpoint = () => Promise.resolve();
      coachSync.loadInsights = () => Promise.reject(new Error('insights down'));
      coachSync.saveGame = () => Promise.resolve();
      if (!/Game saved, insights failed/.test(await run())) problems.push('insight failure not reported');
      coachSync.loadInsights = () => Promise.resolve();
      coachSync.saveGame = () => Promise.reject(new Error('game down'));
      if (!/Insights loaded, game save failed/.test(await run())) problems.push('game failure not reported');
      coachSync.loadInsights = () => Promise.reject(new Error('insights down'));
      if (!/Sync failed/.test(await run())) problems.push('total failure not reported');
    } finally {
      coachDbClient = saved.client;
      coachAuthUser = saved.user;
      coachSync.loadInsights = saved.load;
      coachSync.saveGame = saved.save;
      window.flushAccountCheckpoint = saved.flush;
      Object.keys(localStorage).filter(k => k.includes('behaviour-test-user')).forEach(k => localStorage.removeItem(k));
    }
    return problems;
  }));

  // ── Board and accessibility: what a keyboard or screen-reader user relies on ──
  await check('board uses vendored pieces and keeps the last-move highlight across redraws', () => page.evaluate(async () => {
    const problems = [];
    const pieces = [...document.querySelectorAll('#coachBoard img')];
    if (!pieces.length || !pieces.every(img => img.getAttribute('src').includes('vendor/pieces/cburnett/'))) problems.push('pieces are not the vendored cburnett set');
    const before = document.querySelectorAll('#coachBoard .last-move').length;
    coachBoard.position(coachGame.fen(), false);
    coachBoard.resize();
    await new Promise(resolve => setTimeout(resolve, 0));
    const after = document.querySelectorAll('#coachBoard .last-move').length;
    if (before !== 2 || after !== 2) problems.push(`last-move squares before/after redraw: ${before}/${after}`);
    return problems;
  }));

  await check('move review shows before/after diagrams and announces status', () => page.evaluate(() => {
    const problems = [];
    if (document.querySelectorAll('.review-board-square').length < 64) problems.push('before/after diagrams missing from the review');
    for (const id of ['coach-status', 'feedback-bar', 'network-status']) {
      const el = document.getElementById(id);
      if (!el || !(el.getAttribute('aria-live') || el.getAttribute('role') === 'status')) problems.push(`#${id} is not a live region`);
    }
    return problems;
  }));

  await check('tabs and dialogs expose complete accessible relationships', () => page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('[role="tablist"]').forEach(list => {
      const tabs = list.querySelectorAll('[role="tab"]');
      if (tabs.length < 2) problems.push(`tablist "${list.getAttribute('aria-label')}" has ${tabs.length} tabs`);
      tabs.forEach(tab => {
        const panel = document.getElementById(tab.getAttribute('aria-controls'));
        if (!panel || panel.getAttribute('role') !== 'tabpanel') problems.push(`tab #${tab.id} controls no tabpanel`);
        else if (panel.getAttribute('aria-labelledby') !== tab.id) problems.push(`tabpanel #${panel.id} is not labelled by #${tab.id}`);
        if (!tab.hasAttribute('aria-selected')) problems.push(`tab #${tab.id} has no aria-selected`);
      });
    });
    document.querySelectorAll('[role="dialog"]').forEach(dialog => {
      const label = dialog.getAttribute('aria-labelledby');
      const named = (label && (document.getElementById(label) || {}).textContent || '').trim() || dialog.getAttribute('aria-label');
      if (!named) problems.push(`dialog #${dialog.id} has no accessible name`);
      if (dialog.getAttribute('aria-modal') !== 'true') problems.push(`dialog #${dialog.id} is not modal`);
    });
    return problems;
  }));

  await check('arrow keys move between top-level and Coach panel tabs', async () => {
    const problems = [];
    await page.locator('#nav-coach').focus();
    await page.keyboard.press('ArrowLeft');
    if (await page.evaluate(() => document.activeElement && document.activeElement.id) !== 'nav-library') problems.push('ArrowLeft did not reach the Library tab');
    await page.keyboard.press('ArrowRight');
    if (await page.evaluate(() => document.activeElement && document.activeElement.id) !== 'nav-coach') problems.push('ArrowRight did not return to the Coach tab');
    await page.locator('#tab-game').focus();
    await page.keyboard.press('ArrowRight');
    const panelTab = await page.evaluate(() => document.activeElement && document.activeElement.id);
    if (panelTab !== 'tab-practice') problems.push('ArrowRight did not move to the Practice panel tab');
    await page.evaluate(() => document.getElementById('tab-game').click());
    return problems;
  });

  // ── Opponent failures are recoverable ──
  await check('a failed opponent move offers a working retry', async () => {
    const problems = [];
    await page.evaluate(() => { window.__realChoose = window.chooseCalibratedOpponentMove; window.chooseCalibratedOpponentMove = () => 'a1a1'; });
    try {
      const plies = await page.evaluate(() => coachGame.history().length);
      await playMove('Nf3');
      await page.waitForFunction(() => document.getElementById('btn-coach-retry-opponent'), null, { timeout: 60000 });
      if (!/Opponent move failed/.test(await page.locator('#coach-status').textContent())) problems.push('failure message missing');
      await page.evaluate(() => { window.chooseCalibratedOpponentMove = window.__realChoose; });
      await page.locator('#btn-coach-retry-opponent').click();
      await page.waitForFunction(n => coachGame.history().length >= n + 2 && !coachThinking, plies, { timeout: 60000 });
    } finally {
      await page.evaluate(() => { if (window.__realChoose) window.chooseCalibratedOpponentMove = window.__realChoose; });
    }
    return problems;
  });

  await check('coordinate keyboard moves are accepted', async () => {
    const plies = await page.evaluate(() => coachGame.history().length);
    const from = await page.evaluate(() => coachGame.moves({ verbose: true })[0]);
    await playMove(from.from + from.to + (from.promotion || ''));
    await page.waitForFunction(n => coachGame.history().length >= n + 1, plies, { timeout: 30000 });
    await settle();
    return [];
  });

  // ── Show why: the live game is read-only while an analysis line is shown ──
  await check('drag and tap input are ignored during Show why analysis', async () => {
    const problems = [];
    await page.waitForFunction(() => !coachThinking && coachIsUserTurn() && !coachIsReviewing() &&
      coachReviewLog.some(r => r.fenBefore && r.bestUci), null, { timeout: 60000 });
    const started = await page.evaluate(() => {
      startCoachReviewAnalysis(coachReviewLog.filter(r => r.fenBefore && r.bestUci).pop());
      return !!coachReviewAnalysis && coachIsReviewing();
    });
    if (!started) return ['analysis did not start from a completed review'];
    const before = await page.evaluate(() => ({ pgn: coachGame.pgn(), move: coachGame.moves({ verbose: true })[0] }));
    await page.locator(`#coachBoard .square-${before.move.from}`).dragTo(page.locator(`#coachBoard .square-${before.move.to}`)).catch(() => {});
    await page.locator(`#coachBoard .square-${before.move.from}`).click({ force: true });
    await page.locator(`#coachBoard .square-${before.move.to}`).click({ force: true });
    await page.waitForTimeout(400);
    const during = await page.evaluate(() => ({ pgn: coachGame.pgn(), reviewing: coachIsReviewing() }));
    if (during.pgn !== before.pgn) problems.push('a drag or tap changed the live game during analysis');
    if (!during.reviewing) problems.push('board input ended the analysis');
    const cleared = await page.evaluate(() => { coachGotoLive(); return !coachReviewAnalysis && !coachIsReviewing(); });
    if (!cleared) problems.push('returning to live play did not clear the analysis');
    const reset = await page.evaluate(() => {
      startCoachReviewAnalysis(coachReviewLog.filter(r => r.fenBefore && r.bestUci).pop());
      if (!coachReviewAnalysis) return 'not-started';
      invalidateCoachAsyncWork('test');
      return !coachReviewAnalysis;
    });
    if (reset !== true) problems.push(reset === 'not-started' ? 'analysis did not restart for the reset check' : 'a position reset left the analysis in place');
    return problems;
  });

  // ── Lifetime stats roll back when a finished game is taken back ──
  await check('take-back after game over removes the lifetime rollup', async () => {
    const problems = [];
    await newGame();
    await playMove('e4');
    await page.waitForFunction(() => coachGame.history().length >= 2 && !coachThinking, null, { timeout: 60000 });
    await settle();
    if (!(await page.evaluate(() => !!captureCoachPracticeReturnState()))) problems.push('a live game could not be kept to return to after practice');
    await page.locator('#btn-coach-resign').click();
    await page.waitForFunction(() => coachLifetimeRolledForThisGame, null, { timeout: 30000 });
    if (await page.evaluate(() => captureCoachPracticeReturnState() !== null)) problems.push('a finished game would be restored after practice');
    const id = await page.evaluate(() => coachLocalGameId);
    if (!(await page.evaluate(gameId => !!loadLifetime().rollups[gameId], id))) problems.push('finished game was not rolled into lifetime stats');
    const rowsAreButtons = await page.evaluate(() => [...document.querySelectorAll('.moment-row')].every(row => row.tagName === 'BUTTON'));
    if (!rowsAreButtons) problems.push('post-game moment rows are not buttons');
    await page.evaluate(() => { if (typeof closeCoachSummary === 'function') closeCoachSummary(); $('#coach-summary-overlay, #summary-overlay').hide(); });
    await page.evaluate(() => $('#btn-coach-takeback').prop('disabled', false).trigger('click'));
    await page.waitForFunction(() => !coachLifetimeRolledForThisGame, null, { timeout: 30000 }).catch(() => problems.push('take-back left the game counted as finished'));
    if (await page.evaluate(gameId => !!loadLifetime().rollups[gameId], id)) problems.push('lifetime rollup survived the take-back');
    return problems;
  });

  // ── Library: spaced-repetition save failures are reported ──
  await page.goto(base + '/?opening=italian');
  await page.waitForFunction(() => currentOpening && currentOpening.id === 'italian');
  await check('quiz completion warns when progress cannot be saved', () => page.evaluate(() => {
    const problems = [];
    const realSet = Storage.prototype.setItem;
    let direct;
    try {
      quizSessionMisses = 0;
      quizMissedMoves = [];
      Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
      direct = saveSR({});
      finishQuiz();
    } finally {
      Storage.prototype.setItem = realSet;
    }
    if (!direct || direct.ok !== false) problems.push('saveSR did not report the storage failure');
    if (!/could not be saved/.test($('#feedback-bar').text())) problems.push('quiz did not warn that progress was not saved');
    return problems;
  }));

  await check('share-link clipboard failure is handled visibly', async () => {
    const problems = [];
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    });
    await page.locator('#btn-share').click();
    await page.waitForFunction(() => /unavailable/i.test($('#btn-share').text()), null, { timeout: 5000 })
      .catch(() => problems.push('share button did not report the clipboard failure'));
    return problems;
  });

  // ── Explore: the Lichess token never reaches localStorage ──
  await check('Lichess token is session-only and an empty submit explains itself', async () => {
    const problems = [];
    const token = 'behaviour-test-token';
    await page.evaluate(key => localStorage.setItem(key, 'legacy-token'), await page.evaluate(() => LICHESS_TOKEN_KEY));
    await page.goto(base + '/?opening=italian');
    await page.waitForFunction(() => currentOpening && currentOpening.id === 'italian');
    if (await page.evaluate(() => localStorage.getItem(LICHESS_TOKEN_KEY)) !== null) problems.push('legacy localStorage token was not cleared on load');
    await page.locator('#btn-explore').click();
    await page.evaluate(() => { $('#lichess-token-input').val(''); $('#lichess-token-form').trigger('submit'); });
    if (!/Paste a Lichess token first/.test(await page.evaluate(() => $('#token-error').is(':visible') ? $('#token-error').text() : ''))) problems.push('empty submit gave no feedback');
    await page.evaluate(value => {
      window.__realAjax = $.ajax;
      $.ajax = options => {
        const isTokenCheck = options && options.data && options.data.topGames === 0;
        if (isTokenCheck && options.success) setTimeout(() => options.success({ moves: [], white: 0, draws: 0, black: 0 }), 0);
        return { abort() {} };
      };
      $('#lichess-token-input').val(value);
      $('#lichess-token-form').trigger('submit');
    }, token);
    await page.waitForFunction(() => sessionStorage.getItem(LICHESS_TOKEN_KEY), null, { timeout: 5000 }).catch(() => problems.push('valid token was not kept for the session'));
    const leaked = await page.evaluate(value => Object.keys(localStorage).some(k => localStorage.getItem(k) && localStorage.getItem(k).includes(value)), token);
    if (leaked) problems.push('token was written to localStorage');
    await page.evaluate(() => { $.ajax = window.__realAjax; sessionStorage.removeItem(LICHESS_TOKEN_KEY); });
    return problems;
  });

  // ── Appearance: colour and board themes apply, persist and migrate ──
  await check('appearance and board themes change the page and survive reload', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof applyBoardTheme === 'function');
    await page.evaluate(() => { document.getElementById('group-board').open = true; });
    await page.locator('#color-theme').selectOption('dark');
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (darkBg === 'rgb(245, 239, 227)') problems.push('choosing Dark left the light page colour');
    await page.locator('#board-theme').selectOption('contrast');
    const lightSquare = await page.evaluate(() => getComputedStyle(document.querySelector('#coachBoard .white-1e1d7')).backgroundColor);
    if (lightSquare !== 'rgb(255, 255, 255)') problems.push('High contrast did not recolour the light squares: ' + lightSquare);
    await page.reload();
    await page.waitForFunction(() => typeof applyBoardTheme === 'function');
    const persisted = await page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.boardTheme]);
    if (persisted[0] !== 'dark' || persisted[1] !== 'contrast') problems.push('theme choices did not survive reload: ' + persisted.join('/'));
    await page.evaluate(() => { localStorage.setItem('ui:board-theme', 'ivory'); localStorage.removeItem('ui:theme'); });
    await page.reload();
    await page.waitForFunction(() => typeof applyBoardTheme === 'function');
    const migrated = await page.evaluate(() => [document.documentElement.dataset.theme || 'auto', document.documentElement.dataset.boardTheme]);
    if (migrated[0] !== 'auto' || migrated[1] !== 'walnut') problems.push('retired Ivory or Match device did not apply: ' + migrated.join('/'));
    return problems;
  });

  await check('board overlay shows quality badges, best-move arrows and an evaluation bar', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.evaluate(() => { localStorage.removeItem('ui:board-feedback'); });
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof CoachOverlay !== 'undefined' && !!coachBoard);
    // Review fixtures stand in for the engine: 1.e4 (best) e5 2.Qh5 (mistake, Nc3 preferred) Nc6.
    const state = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      const svg = document.querySelector('#coachBoard-wrap .board-overlay');
      const bar = document.querySelector('#coachBoard-wrap .board-eval-bar');
      resolve({ arrows: svg ? svg.querySelectorAll('.board-arrow').length : 0, badges: svg ? Array.from(svg.querySelectorAll('.board-badge')).map(g => g.getAttribute('class')) : [],
        bar: !!(bar && !bar.hidden), barLabel: bar ? bar.getAttribute('aria-label') : '', fill: bar ? bar.firstChild.style.height : '' });
    }))));
    await page.evaluate(() => {
      coachGame = new Chess();
      ['e4', 'e5', 'Qh5', 'Nc6'].forEach(m => coachGame.move(m));
      const fens = []; const g = new Chess(); fens.push(g.fen()); ['e4', 'e5', 'Qh5', 'Nc6'].forEach(m => { g.move(m); fens.push(g.fen()); });
      coachReviewLog = [
        { ply: 1, userUci: 'e2e4', bestUci: 'e2e4', tier: 'best', fenBefore: fens[0], fenAfter: fens[1], evalAfter: { cp: -30, mate: null }, localGameId: coachLocalGameId },
        { ply: 3, userUci: 'd1h5', bestUci: 'b1c3', tier: 'mistake', fenBefore: fens[2], fenAfter: fens[3], evalAfter: { cp: 140, mate: null }, localGameId: coachLocalGameId }
      ];
      coachReviewCursor = null;
      coachBoard.position(coachGame.fen(), false);
      CoachOverlay.refresh();
    });
    let s = await state();
    if (s.arrows !== 0) problems.push('a best-move arrow was drawn on a position after the opponent replied');
    if (!s.badges.some(c => c.includes('mistake'))) problems.push('the badge did not stay on the queen after the reply: ' + s.badges.join(','));
    if (!s.bar || !/-1\.4/.test(s.barLabel) || !/stale|before the last move/.test(s.barLabel)) problems.push('eval bar missing, wrong sign, or not marked as from before the last move: ' + s.barLabel);
    await page.evaluate(() => { coachReviewCursor = 3; coachBoard.position(coachFenAtPly(3), false); CoachOverlay.refresh(); });
    s = await state();
    if (s.arrows !== 1 || !s.badges.some(c => c.includes('mistake'))) problems.push('the reviewed mistake did not show its arrow and badge: ' + JSON.stringify(s));
    if (parseFloat(s.fill) >= 50) problems.push('White is worse but the white part of the bar is ' + s.fill);
    await page.evaluate(() => { coachReviewCursor = 1; coachBoard.position(coachFenAtPly(1), false); CoachOverlay.refresh(); });
    s = await state();
    if (s.arrows !== 0 || !s.badges.some(c => c.includes('best'))) problems.push('a best move should show a badge and no arrow: ' + JSON.stringify(s));
    await page.evaluate(() => { coachReviewLog[0].flair = 'great'; CoachOverlay.refresh(); updateMoveList(); renderCoachReview(Object.assign({}, coachReviewLog[0], { label: 'Best move', emoji: '★' })); });
    s = await state();
    if (!s.badges.some(c => c.includes('great'))) problems.push('a great move did not get its own badge');
    const listed = await page.evaluate(() => [document.querySelector('#movelist .ply[data-ply="1"] .ply-flair.great') !== null, document.getElementById('coach-classification').textContent]);
    if (!listed[0]) problems.push('the move list did not mark the great move');
    if (!/Great move/.test(listed[1])) problems.push('the review badge did not say Great move: ' + listed[1]);
    await page.evaluate(() => { coachPracticeSession = { completed: false }; CoachOverlay.refresh(); });
    s = await state();
    if (s.arrows || s.badges.length || s.bar) problems.push('the overlay leaked information into a drill');
    await page.evaluate(() => { coachPracticeSession = null; document.getElementById('group-board').open = true; });
    await page.locator('#board-feedback-toggle').uncheck();
    s = await state();
    if (s.arrows || s.badges.length || s.bar) problems.push('turning board feedback off did not clear it');
    await page.reload();
    await page.waitForFunction(() => typeof CoachOverlay !== 'undefined');
    if (await page.locator('#board-feedback-toggle').isChecked()) problems.push('the board feedback setting did not survive reload');
    await page.evaluate(() => localStorage.removeItem('ui:board-feedback'));
    return problems;
  });

  await check('? opens the shortcut sheet for the current view and arrow keys step through a Coach game', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof ShortcutSheet !== 'undefined' && !!coachBoard);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('?');
    const sheet = page.locator('#shortcut-sheet');
    if (!(await sheet.isVisible())) problems.push('? did not open the sheet');
    else {
      if (!(await sheet.textContent()).includes('Coach')) problems.push('the sheet did not list Coach shortcuts');
      if (await page.evaluate(() => document.activeElement.id) !== 'btn-shortcut-close') problems.push('focus did not move into the sheet');
      await page.keyboard.press('Escape');
      if (await sheet.isVisible()) problems.push('Escape did not close the sheet');
    }
    await page.locator('#nav-puzzles').click();
    await page.locator('#btn-shortcuts').click();
    if (!(await sheet.textContent()).includes('Hint')) problems.push('the header button did not show Puzzles shortcuts');
    await page.locator('#btn-shortcut-close').click();
    if (await page.evaluate(() => document.activeElement.id) !== 'btn-shortcuts') problems.push('closing did not return focus to the header button');
    await page.locator('#nav-coach').click();
    await page.locator('#coach-keyboard-move').evaluate(el => { el.open = true; });
    await page.locator('#coach-keyboard-move-input').focus();
    await page.keyboard.press('?');
    await page.locator('#coach-keyboard-move-input').fill('');
    if (await sheet.isVisible()) problems.push('? inside a form field opened the sheet');
    await page.evaluate(() => {
      coachGame = new Chess(); ['e4', 'e5', 'Nf3', 'Nc6'].forEach(m => coachGame.move(m));
      coachGameActive = false; coachReviewCursor = null;
      coachBoard.position(coachGame.fen(), false); updateCoachControlsState();
      document.activeElement.blur();
    });
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    if (await page.evaluate(() => coachReviewCursor) !== 2) problems.push('ArrowLeft did not step back through the game: ' + await page.evaluate(() => coachReviewCursor));
    await page.keyboard.press('ArrowRight');
    if (await page.evaluate(() => coachReviewCursor) !== 3) problems.push('ArrowRight did not step forward');
    await page.keyboard.press('Home');
    if (await page.evaluate(() => coachReviewCursor) !== 0) problems.push('Home did not go to the first position');
    await page.keyboard.press('End');
    if (await page.evaluate(() => coachReviewCursor) !== null) problems.push('End did not return to the live position');
    return problems;
  });

  await check('Explore analysis shows engine lines, plays a line, loads FEN/PGN and stays out of quizzes', async () => {
    const problems = [];
    await page.goto(base + '/?view=library&mode=explore');
    await page.evaluate(() => { localStorage.removeItem('ui:explore-engine'); });
    await page.goto(base + '/?view=library&mode=explore');
    const analysed = () => page.waitForFunction(() => { const s = ExploreAnalysis._state(); return s.result && exploreGame && s.result.fen === exploreGame.fen() && document.querySelectorAll('.explore-engine-line').length > 0; }, null, { timeout: 45000 });
    await analysed();
    const first = await page.evaluate(() => ({ lines: document.querySelectorAll('.explore-engine-line').length, arrows: document.querySelectorAll('#board-wrap .board-arrow.best').length, bar: !!document.querySelector('#board-wrap .board-eval-bar:not([hidden])') }));
    if (first.lines < 2 || first.arrows !== 1 || !first.bar) problems.push('the start position did not show lines, an arrow and a bar: ' + JSON.stringify(first));
    const fits = await page.evaluate(() => { const bar = document.querySelector('#board-wrap .board-eval-bar').getBoundingClientRect(); const area = document.querySelector('#library-view .board-area').getBoundingClientRect(); return bar.left >= area.left; });
    if (!fits) problems.push('the eval bar is clipped by the board area');
    await page.locator('.explore-engine-line').first().click();
    if (await page.evaluate(() => exploreGame.history().length) !== 1) problems.push('clicking a line did not play its first move');
    await analysed();
    await page.locator('.explore-load summary').click();
    await page.locator('#explore-load-input').fill('8/8/8/8/8/5k2/6q1/7K w - - 0 1');
    await page.locator('#explore-load-form button').click();
    if (await page.evaluate(() => exploreGame.fen()) !== '8/8/8/8/8/5k2/6q1/7K w - - 0 1') problems.push('a FEN did not load');
    await page.locator('#explore-load-input').fill('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#');
    await page.locator('#explore-load-form button').click();
    await page.waitForTimeout(400);
    const mated = await page.evaluate(() => ({ moves: exploreGame.history().length, status: document.getElementById('explore-engine-status').textContent, arrows: document.querySelectorAll('#board-wrap .board-arrow').length }));
    if (mated.moves !== 7 || !/Checkmate/.test(mated.status) || mated.arrows) problems.push('a mating PGN did not load as checkmate without arrows: ' + JSON.stringify(mated));
    await page.locator('#explore-load-input').fill('not chess');
    await page.locator('#explore-load-form button').click();
    if (!/not a FEN or PGN/.test(await page.locator('#explore-load-status').textContent())) problems.push('invalid input was not explained');
    await page.locator('#explore-engine-toggle').uncheck();
    await page.waitForTimeout(400);
    const off = await page.evaluate(() => ({ lines: document.querySelectorAll('.explore-engine-line').length, bar: !!document.querySelector('#board-wrap .board-eval-bar:not([hidden])') }));
    if (off.lines || off.bar) problems.push('turning the engine off left analysis on screen');
    await page.locator('#explore-engine-toggle').check();
    await page.locator('#explore-load-input').fill('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
    await page.locator('#explore-load-form button').click();
    await page.waitForFunction(() => engineClient.current && engineClient.current.multipv === 3, null, { timeout: 15000 }).catch(() => {});
    await page.locator('#nav-coach').click();
    await page.waitForTimeout(150);
    if (await page.evaluate(() => !!(engineClient.current && engineClient.current.multipv === 3))) problems.push('leaving Explore kept its engine search running ahead of Coach');
    await page.locator('#nav-library').click();
    await page.evaluate(() => { const op = document.querySelector('.opening-btn[data-id="italian"]'); op.click(); });
    await page.locator('#btn-quiz').click();
    await page.waitForTimeout(500);
    const quiz = await page.evaluate(() => ({ arrows: document.querySelectorAll('#board-wrap .board-arrow').length, bar: !!document.querySelector('#board-wrap .board-eval-bar:not([hidden])') }));
    if (quiz.arrows || quiz.bar) problems.push('engine analysis leaked into a quiz');
    return problems;
  });

  await check('finished games are archived and reopen in a viewer that leaves the live game alone', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof GameArchive !== 'undefined' && !!coachBoard);
    // A finished game with review fixtures standing in for the engine.
    await page.evaluate(() => {
      coachStartFen = new Chess().fen();
      coachLocalGameId = 'fixture-archive-game';
      coachGame = new Chess();
      const fens = [coachGame.fen()];
      ['f3', 'e5', 'g4', 'Qh4#'].forEach(m => { coachGame.move(m); fens.push(coachGame.fen()); });
      coachUserSide = 'white';
      coachReviewLog = [
        { ply: 1, userUci: 'f2f3', userSan: 'f3', bestUci: 'e2e4', bestSan: 'e4', tier: 'inaccuracy', fenBefore: fens[0], evalAfter: { cp: 20 }, localGameId: coachLocalGameId },
        { ply: 3, userUci: 'g2g4', userSan: 'g4', bestUci: 'b1c3', bestSan: 'Nc3', tier: 'blunder', fenBefore: fens[2], evalAfter: { mate: 1 }, localGameId: coachLocalGameId }
      ];
      coachStats = { moves: 2, best: 0, excellent: 0, good: 0, inaccuracy: 1, mistake: 0, blunder: 1 };
      GameArchive.record('Checkmate — Black wins.');
      GameArchive.record('Checkmate — Black wins.');
    });
    const stored = await page.evaluate(() => GameArchive.load());
    if (stored.length !== 1) problems.push('reopening a summary duplicated the game: ' + stored.length);
    else if (stored[0].reviews.length !== 2 || stored[0].reviews[1].cp >= -9000) problems.push('the archive lost reviews or the mate evaluation sign: ' + JSON.stringify(stored[0].reviews));
    const liveFen = await page.evaluate(() => coachGame.fen());
    await page.locator('#tab-progress').click();
    const row = page.locator('.game-archive-open').first();
    if (!/Lost/.test(await row.textContent())) problems.push('a checkmate loss was not listed as Lost: ' + await row.textContent());
    await row.click();
    await page.locator('#game-viewer').waitFor({ state: 'visible' });
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const at3 = await page.evaluate(() => ({ cursor: GameArchive._viewer().cursor, note: document.getElementById('game-viewer-note').textContent, arrows: document.querySelectorAll('#archiveBoard-wrap .board-arrow').length }));
    if (at3.cursor !== 3 || !/Blunder/.test(at3.note) || !/Nc3/.test(at3.note) || at3.arrows !== 1) problems.push('the viewer did not show the blunder with the engine move: ' + JSON.stringify(at3));
    await page.locator('#game-viewer-moves .ply[data-ply="1"]').click();
    if (await page.evaluate(() => GameArchive._viewer().cursor) !== 1) problems.push('clicking a move did not jump to it');
    if (await page.evaluate(() => coachGame.fen()) !== liveFen || await page.evaluate(() => coachReviewCursor) !== null) problems.push('the viewer changed the live Coach game');
    await page.keyboard.press('Escape');
    if (await page.locator('#game-viewer').isVisible()) problems.push('Escape did not close the viewer');
    if (await page.evaluate(() => (document.activeElement.className || '').includes('game-archive-open')) !== true) problems.push('focus did not return to the archive row');
    await row.click();
    await page.locator('#btn-game-viewer-delete').click();
    await page.locator('#btn-game-viewer-delete').click();
    if ((await page.evaluate(() => GameArchive.load().length)) !== 0) problems.push('delete (confirmed) did not remove the game');
    await page.evaluate(() => localStorage.setItem('coach:archive:v1', JSON.stringify([{ id: 'x' }, null, { id: 'ok', pgn: '1. e4', at: 5, reviews: [{ ply: 1, tier: 'nonsense' }] }])));
    const cleaned = await page.evaluate(() => GameArchive.load());
    if (cleaned.length !== 1 || cleaned[0].reviews.length !== 0) problems.push('malformed archive rows were kept');
    await page.evaluate(() => localStorage.removeItem('coach:archive:v1'));
    return problems;
  });

  await check('opponent personalities set the level and play their book openings', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof OpponentPersonas !== 'undefined' && !!coachBoard);
    await page.evaluate(() => { document.getElementById('coach-game-options').open = true; });
    const oneRow = await page.evaluate(() => new Set(Array.from(document.querySelectorAll('.opponent-card')).map(b => Math.round(b.getBoundingClientRect().top))).size === 1);
    if (!oneRow) problems.push('the opponent avatars wrap onto a second row');
    await page.locator('.opponent-card[data-opponent="rosa"]').click();
    const chosen = await page.evaluate(() => ({ elo: coachEngineElo, auto: document.getElementById('coach-auto-elo').checked, pressed: document.querySelector('.opponent-card[data-opponent="rosa"]').getAttribute('aria-pressed'), current: document.getElementById('opponent-current').textContent }));
    if (chosen.elo !== 800 || chosen.auto || chosen.pressed !== 'true' || !/Rosa/.test(chosen.current)) problems.push('choosing Rosa did not set her level: ' + JSON.stringify(chosen));
    await page.locator('.side-toggle button[data-side="black"]').click();
    await page.evaluate(() => { window.__opponentSearches = 0; const orig = engineClient.evaluate; engineClient.evaluate = function(fen, depth, opts) { if (opts && opts.multipv && opts.skill !== undefined) window.__opponentSearches++; return orig.apply(this, arguments); }; });
    await page.locator('#btn-coach-newgame').click();
    await page.waitForFunction(() => coachGameActive && !coachThinking && coachIsUserTurn(), null, { timeout: 60000 });
    const opened = await page.evaluate(() => ({ first: coachGame.history()[0], searches: window.__opponentSearches }));
    if (!['e4', 'd4'].includes(opened.first) || opened.searches !== 0) problems.push('Rosa did not open from her book without an engine search: ' + JSON.stringify(opened));
    await page.evaluate(() => { document.getElementById('coach-game-options').open = true; });
    await page.locator('#coach-strength').evaluate(el => { el.value = '1500'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    if (await page.evaluate(() => OpponentPersonas.coachBookMove()) !== null) problems.push('a custom level still used the persona book');
    if (!/Custom level/.test(await page.locator('#opponent-current').textContent())) problems.push('a custom level was not shown as custom');
    await page.locator('.opponent-card[data-opponent="coach"]').click();
    if (!(await page.locator('#coach-auto-elo').isChecked())) problems.push('choosing Coach did not turn adaptive level back on');
    return problems;
  });

  await check('Progress offers puzzles that train the current focus', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof PuzzleCore !== 'undefined' && typeof INSIGHT_TAG_META !== 'undefined');
    const unknown = await page.evaluate(() => Object.keys(PuzzleCore.INSIGHT_GROUPS).filter(tag => !INSIGHT_TAG_META[tag]));
    if (unknown.length) problems.push('puzzle mapping names tags Coach does not have: ' + unknown.join(', '));
    // Stand in for review evidence: a focus on forks.
    await page.evaluate(() => {
      window.__realRecommendation = progressRecommendation;
      progressRecommendation = entries => Object.assign(window.__realRecommendation(entries), { focusTag: 'fork_risk' });
      document.getElementById('progress-next-title').textContent = 'Fork awareness';
    });
    await page.locator('#tab-progress').click();
    const btn = page.locator('#btn-progress-puzzles');
    await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (!(await btn.isVisible()) || !/fork/i.test(await btn.textContent())) problems.push('no fork puzzle action for a fork focus');
    else {
      await btn.click();
      await page.waitForFunction(() => { const d = PuzzlesView._debug(); return appView === 'puzzles' && d.session && d.session.phase === 'solving'; }, null, { timeout: 20000 });
      const state = await page.evaluate(() => ({ theme: document.getElementById('puzzle-theme').value, fork: PuzzlesView._debug().session.puzzle.themes.includes('fork') }));
      if (state.theme !== 'fork' || !state.fork) problems.push('the action did not open fork puzzles: ' + JSON.stringify(state));
    }
    await page.evaluate(() => {
      progressRecommendation = entries => Object.assign(window.__realRecommendation(entries), { focusTag: 'candidate_moves' });
      document.getElementById('progress-next-title').textContent = 'Candidate moves';
    });
    await page.waitForTimeout(100);
    if (!(await page.evaluate(() => document.getElementById('btn-progress-puzzles').hidden))) problems.push('a focus without a puzzle theme still offered puzzles');
    await page.evaluate(() => { progressRecommendation = window.__realRecommendation; localStorage.removeItem('ui:puzzle-theme'); });
    return problems;
  });

  await check('the activity calendar counts training across Coach, drills, puzzles and games', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof TrainingActivity !== 'undefined' && typeof PuzzleCore !== 'undefined');
    await page.locator('#tab-progress').click();
    if (!/will appear here/.test(await page.locator('#activity-summary').textContent())) problems.push('an empty calendar did not explain itself');
    await page.evaluate(() => {
      const day = 86400000, now = Date.now();
      let s = PuzzleCore.emptyState();
      [0, 1, 2].forEach(d => { s = PuzzleCore.recordAttempt(s, { id: 'act' + d, rating: 1200, themes: ['fork'] }, { win: true }, now - d * day).state; });
      localStorage.setItem('chess_puzzles_v1', JSON.stringify(s));
    });
    await page.locator('#tab-game').click();
    await page.locator('#tab-progress').click();
    const state = await page.evaluate(() => ({ summary: document.getElementById('activity-summary').textContent, streak: document.getElementById('activity-streak').textContent, cells: document.querySelectorAll('#activity-calendar .activity-cell').length, active: document.querySelectorAll('#activity-calendar .activity-cell.level-1').length, label: document.getElementById('activity-calendar').getAttribute('aria-label') }));
    if (state.cells !== 84) problems.push('the calendar should show 84 days, showed ' + state.cells);
    if (state.active < 3 || !/3 puzzles/.test(state.summary) || !/3-day streak/.test(state.streak)) problems.push('puzzle activity was not counted: ' + JSON.stringify(state));
    if (!/Training calendar/.test(state.label || '')) problems.push('the calendar has no text alternative');
    await page.evaluate(() => localStorage.removeItem('chess_puzzles_v1'));
    return problems;
  });

  await check('engine work regressions: mate shows as a win and leaving Explore never stalls Coach', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof CoachOverlay !== 'undefined' && !!coachBoard);
    // A mating move stores evalAfter { mate: 0 } (the side to move is mated).
    const mate = await page.evaluate(() => {
      coachGame = new Chess(); ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'].forEach(m => coachGame.move(m));
      const before = new Chess(); ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'].forEach(m => before.move(m));
      coachReviewLog = [{ ply: 7, userUci: 'h5f7', bestUci: 'h5f7', tier: 'best', fenBefore: before.fen(), evalAfter: { mate: 0, pv: [] }, localGameId: coachLocalGameId }];
      coachReviewCursor = null; return CoachOverlay.spec().eval;
    });
    if (!mate || !(mate.mate > 0)) problems.push('a mate delivered by White did not read as White winning: ' + JSON.stringify(mate));
    // Start an Explore search, leave for Coach, and ask the engine for a Coach
    // search in the same tick: it must complete promptly.
    await page.goto(base + '/?view=library&mode=explore');
    await page.waitForFunction(() => ExploreAnalysis._state().result, null, { timeout: 45000 });
    await page.locator('.explore-engine-line').first().click();
    await page.waitForFunction(() => engineClient.current && engineClient.current.multipv === 3, null, { timeout: 15000 });
    const ms = await page.evaluate(() => {
      const t0 = Date.now();
      switchView('coach');
      return engineClient.evaluate(new Chess().fen(), 6).then(r => (r && r.bestmove ? Date.now() - t0 : -1));
    });
    if (ms < 0 || ms > 8000) problems.push('a Coach search after leaving Explore took ' + ms + ' ms (or returned nothing)');
    return problems;
  });

  if (pageErrors.length) failures.push('page errors: ' + pageErrors.join(' | '));
  if (failures.length) throw new Error(failures.join('\n'));
  return { passed: passed.length, checks: passed };
}
