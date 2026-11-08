// Playwright CLI body: behavioural checks for logic that used to be guarded
// only by regexes over the source (docs/behaviour-checklist.md, Phase 2).
// Each check drives the real functions in the running app and stubs only the
// boundary (Worker, Supabase client, storage, clipboard, network), so the
// code can be reorganised freely as long as the behaviour holds.
async page => {
  const failures = [];
  const passed = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push((error.stack || error.message).split('\n').slice(0, 4).join(' <- ')));
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

  await check('in check, the threat panel says so instead of calling the king hanging', () => page.evaluate(async () => {
    const problems = [];
    const realGame = coachGame;
    const realEvaluate = engineClient.evaluate;
    const asked = [];
    try {
      engineClient.evaluate = fen => { asked.push(fen); return Promise.resolve({ bestmove: null, info: { cp: 0, mate: null, pv: [] } }); };
      coachGame = new Chess();
      ['e4', 'e5', 'd4', 'Bb4+'].forEach(san => coachGame.move(san));
      await showThreats();
      await new Promise(resolve => setTimeout(resolve, 20));
      const text = $('#threats-list').text();
      if (/King/.test(text) || /No immediate threats/.test(text)) problems.push('the panel misdescribed a check: ' + text);
      if (!/in check/i.test(text)) problems.push('the panel did not say the king is in check: ' + text);
      if (asked.length) problems.push('the mate scan sent a position with the side not to move in check');
    } finally {
      coachGame = realGame;
      engineClient.evaluate = realEvaluate;
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

  await check('a timed-out search hands over only after its late bestmove', () => page.evaluate(async () => {
    const problems = [];
    // Start from no worker at all, so the fake one below is used.
    engineClient.failAll(createAbortError('test reset'));
    const RealWorker = window.Worker;
    const realSetTimeout = window.setTimeout;
    const timers = [];
    // Capture the engine's safety timers so the test can fire them at once.
    window.setTimeout = (fn, ms, ...rest) => {
      if (ms === 30000 || ms === 5000) { timers.push({ fn, ms }); return -1; }
      return realSetTimeout(fn, ms, ...rest);
    };
    const workers = [];
    window.Worker = function FakeWorker() {
      workers.push(this);
      this.posted = [];
      this.postMessage = message => this.posted.push(message);
      this.terminate = () => { this.terminated = true; };
    };
    const tick = () => new Promise(resolve => realSetTimeout(resolve, 0));
    const fire = ms => { const i = timers.findIndex(t => t.ms === ms); if (i < 0) return false; timers.splice(i, 1)[0].fn(); return true; };
    const goes = w => w.posted.filter(m => m.startsWith('go depth')).length;
    const handshake = async w => { w.onmessage({ data: 'uciok' }); w.onmessage({ data: 'readyok' }); await tick(); };
    try {
      const fen = '8/8/8/8/8/8/8/K6k w - - 0 1';
      const a = engineClient.evaluate(fen, 4);
      const b = engineClient.evaluate(fen, 5);
      await handshake(workers[0]);
      if (goes(workers[0]) !== 1) problems.push('the first search did not start alone');
      if (!fire(30000)) problems.push('no safety timer for the first search');
      const first = await a;
      if (first.bestmove !== null) problems.push('a timed-out search should resolve empty');
      if (goes(workers[0]) !== 1) problems.push('the next search started before the stopped one answered');
      workers[0].onmessage({ data: 'info depth 3 score cp 10 pv a1a2' });
      workers[0].onmessage({ data: 'bestmove a1a2' });
      await tick();
      if (goes(workers[0]) !== 2) problems.push('the next search did not start after the late bestmove');
      let settled = null;
      b.then(r => { settled = r; });
      await tick();
      if (settled) problems.push('the late bestmove was read as the next search\'s answer');
      workers[0].onmessage({ data: 'info depth 5 score cp 20 pv a1b1' });
      workers[0].onmessage({ data: 'bestmove a1b1' });
      const second = await b;
      if (second.bestmove !== 'a1b1') problems.push('the next search got ' + second.bestmove + ', not its own answer');

      // A stopped search that never answers: the worker is replaced and the
      // queued search still runs.
      timers.length = 0;
      const c = engineClient.evaluate(fen, 4);
      const d = engineClient.evaluate(fen, 6);
      await tick();
      // The first captured timer is c's, which is the running search.
      if (!fire(30000)) problems.push('no safety timer for the running search');
      await c;
      if (!fire(5000)) problems.push('no restart timer for a silent stopped search');
      await tick();
      if (!workers[0].terminated) problems.push('a silent worker was not replaced');
      if (workers.length !== 2) problems.push('no new worker was started for the queued search');
      else {
        await handshake(workers[1]);
        if (goes(workers[1]) !== 1) problems.push('the queued search did not run on the new worker');
        workers[1].onmessage({ data: 'info depth 6 score cp 5 pv a1a2' });
        workers[1].onmessage({ data: 'bestmove a1a2' });
        const last = await d;
        if (last.bestmove !== 'a1a2') problems.push('the queued search did not resolve on the new worker');
      }
    } finally {
      window.Worker = RealWorker;
      window.setTimeout = realSetTimeout;
      engineClient.failAll(createAbortError('test reset'));
    }
    return problems;
  }));

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

  await check('an empty engine reply keeps the opponent on move and offers a retry', async () => {
    const problems = [];
    await page.evaluate(() => { window.__realChoose = window.chooseCalibratedOpponentMove; window.chooseCalibratedOpponentMove = () => null; });
    try {
      const plies = await page.evaluate(() => coachGame.history().length);
      // A sound developing move: later checks share this game, so it must
      // not drift into a lost position.
      await playMove(await page.evaluate(() => { const legal = coachGame.moves(); return ['d4', 'd3', 'e3', 'Nc3', 'Nf3', 'c3', 'Be2', 'O-O'].find(m => legal.includes(m)) || legal[0]; }));
      await page.waitForFunction(() => document.getElementById('btn-coach-retry-opponent'), null, { timeout: 60000 });
      const status = await page.locator('#coach-status').textContent();
      if (!/did not answer/.test(status)) problems.push('status should say the opponent did not answer: ' + status);
      if (await page.evaluate(() => coachIsUserTurn())) problems.push('it should still be the opponent\'s turn');
      await page.evaluate(() => { window.chooseCalibratedOpponentMove = window.__realChoose; });
      await page.locator('#btn-coach-retry-opponent').click();
      await page.waitForFunction(n => coachGame.history().length >= n + 2 && !coachThinking && coachIsUserTurn(), plies, { timeout: 60000 });
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

  await check('a take-back makes the game unrated but never erases a rated result', async () => {
    const problems = [];
    const rating = () => page.evaluate(() => { const p = loadGrowthState().profile; return { estimate: p.ratingEstimate, games: p.ratingGames, ids: p.ratingHistory.map(h => h.gameId) }; });
    const hideSummary = () => page.evaluate(() => { if (typeof closeCoachSummary === 'function') closeCoachSummary(); $('#coach-summary-overlay, #summary-overlay').hide(); });
    const playOne = async () => {
      await playMove('e4');
      await page.waitForFunction(() => coachGame.history().length >= 2 && !coachThinking, null, { timeout: 60000 });
      await settle();
      // The rating rule needs four reviewed moves; the take-back rule is what is under test.
      return page.evaluate(() => { coachStats.moves = Math.max(coachStats.moves, 4); return coachLocalGameId; });
    };
    // A standard game is rated; taking back its result keeps that rating
    // (a take-back must not erase a loss), and play after it is unrated.
    await newGame();
    const before = await rating();
    const id = await playOne();
    await page.evaluate(() => $('#btn-coach-resign').trigger('click'));
    await page.waitForFunction(gameId => loadGrowthState().profile.ratingHistory.some(h => h.gameId === gameId), id, { timeout: 10000 })
      .catch(() => problems.push('a standard finished game was not rated'));
    await hideSummary();
    await page.evaluate(() => $('#btn-coach-takeback').prop('disabled', false).trigger('click'));
    const kept = await rating();
    if (kept.games !== before.games + 1 || !kept.ids.includes(id)) problems.push('taking back a rated result should keep its rating: ' + JSON.stringify({ before, kept }));
    if (!/unrated/.test(await page.locator('#coach-status').textContent())) problems.push('the status should say a game with a take-back is unrated');
    // A take-back mid-game survives a reload and keeps the finished game unrated.
    await newGame();
    await playOne();
    await page.evaluate(() => $('#btn-coach-takeback').prop('disabled', false).trigger('click'));
    await page.reload();
    await page.waitForFunction(() => typeof coachGameActive !== 'undefined' && coachGame && coachGameActive && !coachThinking, null, { timeout: 60000 });
    const id2 = await playOne();
    const midBefore = await rating();
    await page.evaluate(() => $('#btn-coach-resign').trigger('click'));
    await page.waitForFunction(() => !coachGameActive, null, { timeout: 10000 });
    const eligibility = await page.evaluate(() => ratedCoachEligibility(coachLastEndMsg));
    if (eligibility.eligible || eligibility.reason !== 'take-back used') problems.push('a game with a take-back should be unrated because of it: ' + JSON.stringify(eligibility));
    const midAfter = await rating();
    if (midAfter.games !== midBefore.games || midAfter.ids.includes(id2)) problems.push('a game with a take-back was rated: ' + JSON.stringify({ midBefore, midAfter }));
    await hideSummary();
    return problems;
  });

  await check('a pasted PGN counts once in Insights, signed in or pasted again', async () => {
    const problems = [];
    const pgn = '[Event "Club"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *';
    const paste = text => page.evaluate(async text => {
      $('#game-inbox-side').val('white');
      $('#game-inbox-pgn').val(text);
      await analyseImportedPgn();
      return $('#game-inbox-status').text();
    }, text);
    await freshCoach();
    // Signed in: the shown game's moves sync to the account and must not be
    // counted again from this browser's copy. Only the database is faked.
    const signedIn = await page.evaluate(async pgn => {
      const saved = { client: coachDbClient, user: coachAuthUser, insights: coachRemoteInsightEntries, loaded: coachRemoteInsightsLoaded,
        ensure: window.ensureRemoteCoachGame, arts: window.syncRemoteLearningArtifacts, update: window.updateRemoteCoachGame };
      let serial = 0;
      const fakeClient = {
        from(table) {
          const result = () => (table === 'coach_moves' ? { data: { id: 'remote-move-' + (++serial) }, error: null } : { data: null, error: null });
          const query = new Proxy(function () {}, {
            get(_, prop) {
              if (prop === 'then') return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
              return () => (prop === 'single' || prop === 'maybeSingle' ? Promise.resolve(result()) : query);
            }
          });
          return query;
        },
        rpc: async () => ({ data: null, error: null })
      };
      try {
        coachDbClient = fakeClient;
        coachAuthUser = { id: 'behaviour-import-user' };
        coachRemoteInsightEntries = [];
        coachRemoteInsightsLoaded = true;
        window.ensureRemoteCoachGame = async () => 'remote-import-game';
        window.syncRemoteLearningArtifacts = async () => {};
        window.updateRemoteCoachGame = async () => {};
        $('#game-inbox-side').val('white');
        $('#game-inbox-pgn').val(pgn);
        await analyseImportedPgn();
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && coachRemoteInsightEntries.length < 3) await new Promise(resolve => setTimeout(resolve, 100));
        await new Promise(resolve => setTimeout(resolve, 300));
        return { graded: coachReviewLog.filter(r => r.tier !== 'unknown').length, remote: coachRemoteInsightEntries.length, shown: currentInsightEntries().length };
      } finally {
        coachDbClient = saved.client;
        coachAuthUser = saved.user;
        coachRemoteInsightEntries = saved.insights;
        coachRemoteInsightsLoaded = saved.loaded;
        Object.assign(window, { ensureRemoteCoachGame: saved.ensure, syncRemoteLearningArtifacts: saved.arts, updateRemoteCoachGame: saved.update });
        Object.keys(localStorage).filter(k => k.includes('behaviour-import-user')).forEach(k => localStorage.removeItem(k));
      }
    }, pgn);
    if (signedIn.graded !== 3 || signedIn.remote !== 3) problems.push('the signed-in paste should sync its three graded moves: ' + JSON.stringify(signedIn));
    if (signedIn.shown !== signedIn.graded) problems.push(`Insights counted the shown game ${signedIn.shown} times over ${signedIn.graded} moves`);
    // Signed out: pasting the same game again replaces its evidence.
    await freshCoach();
    await paste(pgn);
    const once = await page.evaluate(() => ({ id: coachLocalGameId, entries: loadInsights().entries.length, games: loadGrowthState().repertoire.observed.reduce((n, r) => n + r.games, 0), lifetime: loadLifetime().games }));
    const status = await paste(pgn);
    const twice = await page.evaluate(() => ({ id: coachLocalGameId, entries: loadInsights().entries.length, games: loadGrowthState().repertoire.observed.reduce((n, r) => n + r.games, 0), lifetime: loadLifetime().games }));
    if (!/reviewed/.test(status)) problems.push('the second paste did not finish: ' + status);
    if (once.entries !== 3 || twice.entries !== 3) problems.push('pasting the same game again added a second set of Insights entries: ' + JSON.stringify({ once, twice }));
    if (once.games !== 1 || twice.games !== 1) problems.push('pasting the same game again counted it twice in the repertoire: ' + JSON.stringify({ once, twice }));
    if (twice.id !== once.id || twice.lifetime !== once.lifetime) problems.push('pasting the same game again counted it twice in lifetime stats: ' + JSON.stringify({ once, twice }));
    // Later checks reopen Coach expecting a live game, not the ended import.
    await freshCoach();
    await newGame();
    return problems;
  });
  await check('signing in adds guest lifetime stats to the account instead of keeping one side', () => page.evaluate(() => {
    const problems = [];
    const account = 'behaviour-lifetime-user';
    const savedUser = coachAuthUser;
    const anonKey = `${LIFETIME_KEY}:anon:${coachDeviceId()}`, accountKey = `${LIFETIME_KEY}:user:${account}`;
    const previousAnon = localStorage.getItem(anonKey);
    const game = (id, moves, blunders) => [id, { games: 1, moves, accuracySum: 80 * moves, best: 0, excellent: 0, good: moves - blunders, inaccuracies: 0, mistakes: 0, blunders }];
    const lifetime = rows => Object.assign(emptyLifetime(), rows.reduce((lt, [id, c]) => {
      ['games', 'moves', 'accuracySum', 'good', 'blunders'].forEach(k => { lt[k] = (lt[k] || 0) + c[k]; });
      lt.rollups[id] = c; return lt;
    }, { rollups: {} }));
    const adopt = (anonRows, accountRows) => {
      localStorage.setItem(anonKey, JSON.stringify(lifetime(anonRows)));
      localStorage.setItem(accountKey, JSON.stringify(lifetime(accountRows)));
      adoptAnonymousCoachMemory(account);
      coachAuthUser = { id: account };
      const merged = loadLifetime();
      coachAuthUser = savedUser;
      return merged;
    };
    try {
      let merged = adopt([game('guest-1', 20, 1), game('guest-2', 30, 2)], [game('acct-1', 10, 0), game('acct-2', 10, 1), game('acct-3', 10, 0)]);
      if (merged.games !== 5 || merged.moves !== 80 || merged.blunders !== 4) problems.push(`account with more games lost the guest games: ${merged.games} games, ${merged.moves} moves`);
      merged = adopt([game('guest-3', 20, 0), game('guest-4', 20, 0)], [game('acct-4', 40, 3)]);
      if (merged.games !== 3 || merged.moves !== 80 || merged.blunders !== 3) problems.push(`guest with more games replaced the account games: ${merged.games} games, ${merged.moves} moves`);
      if (Object.keys(merged.rollups).sort().join() !== 'acct-4,guest-3,guest-4') problems.push('per-game rollups were not merged, so a later take-back cannot undo them');
      if (localStorage.getItem(anonKey) !== null) problems.push('guest lifetime was not consumed after the merge');
    } finally {
      coachAuthUser = savedUser;
      localStorage.removeItem(accountKey);
      Object.keys(localStorage).filter(k => k.includes(account)).forEach(k => localStorage.removeItem(k));
      if (previousAnon === null) localStorage.removeItem(anonKey); else localStorage.setItem(anonKey, previousAnon);
    }
    return problems;
  }));

  // ── Sign-in adopts a guest game, drill and return point only as one unit ──
  await check('sign-in never adopts guest practice beside the account\'s saved game', async () => {
    const problems = [];
    await newGame();
    await playMove('e4');
    await page.waitForFunction(() => coachGame.history().length >= 2 && !coachThinking, null, { timeout: 60000 });
    await settle();
    const account = 'behaviour-adopt-user';
    const guestGameId = await page.evaluate(acct => {
      // The account already has a saved game of its own on this browser.
      const own = JSON.parse(localStorage.getItem(coachMemoryKey(COACH_STATE_KEY)));
      own.localGameId = 'account-saved-game';
      own.remoteGameId = null;
      localStorage.setItem(`${COACH_STATE_KEY}:user:${acct}`, JSON.stringify(own));
      return coachLocalGameId;
    }, account);
    await page.locator('#tab-practice').click();
    await page.locator('#endgame-track-list .endgame-item button').first().click();
    await page.waitForFunction(() => coachPracticeSession && coachPracticeSession.analysisReady, null, { timeout: 60000 });
    try {
      await page.evaluate(acct => { saveCoachPracticeState(); applyCoachRecoveryUser({ id: acct }); }, account);
      await page.waitForTimeout(300);
      await page.evaluate(() => { if (coachPracticeSession) exitCoachPractice(); });
      const after = await page.evaluate(acct => {
        const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
        const anon = `anon:${coachDeviceId()}`;
        return {
          accountGame: (read(`${COACH_STATE_KEY}:user:${acct}`) || {}).localGameId || null,
          guestGameKept: !!read(`${COACH_STATE_KEY}:${anon}`),
          guestPracticeKept: !!read(`${COACH_PRACTICE_STATE_KEY}:${anon}`),
          guestReturnKept: !!read(`${COACH_PRACTICE_RETURN_KEY}:${anon}`),
          accountPractice: !!read(`${COACH_PRACTICE_STATE_KEY}:user:${acct}`),
          accountReturn: !!read(`${COACH_PRACTICE_RETURN_KEY}:user:${acct}`)
        };
      }, account);
      if (after.accountGame !== 'account-saved-game') problems.push(`the account's saved game was replaced by ${after.accountGame === guestGameId ? 'the guest game' : after.accountGame}`);
      if (after.accountPractice || after.accountReturn) problems.push('guest practice was adopted beside the account game');
      if (!after.guestGameKept || !after.guestPracticeKept || !after.guestReturnKept) problems.push('the guest session was not kept intact for the guest');
      // An account with no saved session takes the whole guest session.
      const adopted = await page.evaluate(acct => {
        applyCoachRecoveryUser(null);
        localStorage.removeItem(`${COACH_STATE_KEY}:user:${acct}`);
        applyCoachRecoveryUser({ id: acct });
        const anon = `anon:${coachDeviceId()}`;
        return [COACH_STATE_KEY, COACH_PRACTICE_STATE_KEY, COACH_PRACTICE_RETURN_KEY]
          .map(base => [!!localStorage.getItem(`${base}:user:${acct}`), !localStorage.getItem(`${base}:${anon}`)]);
      }, account);
      if (!adopted.every(([moved, cleared]) => moved && cleared)) problems.push('an account with no saved session did not adopt the whole guest session: ' + JSON.stringify(adopted));
    } finally {
      await page.evaluate(acct => {
        applyCoachRecoveryUser(null);
        if (coachPracticeSession) exitCoachPractice();
        Object.keys(localStorage).filter(k => k.includes(acct)).forEach(k => localStorage.removeItem(k));
      }, account);
      // Leave a live guest game for the checks that follow.
      await page.locator('#tab-game').click();
      await newGame();
      await playMove('e4');
      await page.waitForFunction(() => coachGame.history().length >= 2 && !coachThinking, null, { timeout: 60000 });
    }
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
    // Retry the blunder: the game move is refused, a weak move is graded by
    // the engine, and the engine's choice is accepted.
    await page.locator('#btn-game-viewer-retry').click();
    const retry = (move) => page.evaluate(m => { const i = document.getElementById('gv-retry-input'); i.value = m; document.getElementById('gv-retry-form').requestSubmit(); }, move);
    await retry('g4');
    if (!/what you played/.test(await page.locator('#game-viewer-note').textContent())) problems.push('retrying the game move was not called out');
    await retry('Kf2');
    await page.waitForFunction(() => /not it|also strong/.test(document.getElementById('game-viewer-note').textContent), null, { timeout: 45000 });
    if (!/not it/.test(await page.locator('#game-viewer-note').textContent())) problems.push('a weak king move was accepted on retry');
    await retry('Nc3');
    if (!/engine's choice/.test(await page.locator('#game-viewer-note').textContent()) || await page.evaluate(() => !GameArchive._viewer().retry.solved)) problems.push('the engine move was not accepted on retry');
    await page.locator('#btn-gv-retry-done').click();
    if (await page.evaluate(() => GameArchive._viewer().retry || GameArchive._viewer().cursor !== 3)) problems.push('leaving the retry did not return to the game position');
    await page.locator('#game-viewer-moves .ply[data-ply="1"]').click();
    if (await page.evaluate(() => GameArchive._viewer().cursor) !== 1) problems.push('clicking a move did not jump to it');
    if (await page.evaluate(() => coachGame.fen()) !== liveFen || await page.evaluate(() => coachReviewCursor) !== null) problems.push('the viewer changed the live Coach game');
    await page.keyboard.press('Escape');
    if (await page.locator('#game-viewer').isVisible()) problems.push('Escape did not close the viewer');
    if (await page.evaluate(() => (document.activeElement.className || '').includes('game-archive-open')) !== true) problems.push('focus did not return to the archive row');
    // A retry ends when you jump elsewhere; focus stays in the dialog; a
    // later retry offers Show answer again.
    await row.click();
    await page.locator('#game-viewer-moves .ply[data-ply="3"]').click();
    await page.locator('#btn-game-viewer-retry').click();
    await page.locator('#game-viewer-moves .ply[data-ply="1"]').click();
    const jumped = await page.evaluate(() => ({ retry: !!GameArchive._viewer().retry, cursor: GameArchive._viewer().cursor }));
    if (jumped.retry || jumped.cursor !== 1) problems.push('jumping to another move did not end the retry: ' + JSON.stringify(jumped));
    await page.locator('#game-viewer-moves .ply[data-ply="3"]').click();
    await page.locator('#btn-game-viewer-retry').click();
    await page.locator('#gv-retry-input').fill('Nc3');
    await page.keyboard.press('Enter');
    if (!(await page.evaluate(() => document.getElementById('game-viewer').contains(document.activeElement) && document.activeElement.offsetParent !== null))) problems.push('focus left the dialog after solving a typed retry');
    await page.keyboard.press('Escape');
    await row.click();
    await page.locator('#game-viewer-moves .ply[data-ply="3"]').click();
    await page.locator('#btn-game-viewer-retry').click();
    if (!(await page.locator('#btn-gv-retry-answer').isVisible())) problems.push('Show answer stayed hidden on a later retry');
    await page.locator('#btn-gv-retry-done').click();
    if (!(await page.evaluate(() => document.getElementById('game-viewer').contains(document.activeElement) && document.activeElement.offsetParent !== null))) problems.push('focus left the dialog after Back to the game');
    await page.keyboard.press('Escape');

    // Training backups carry the archive; importing twice does not duplicate it.
    const restored = await page.evaluate(() => {
      const backup = readTrainingBackup();
      const exported = Object.keys(backup.data).some(key => key.startsWith('coach:archive:v1'));
      localStorage.removeItem('coach:archive:v1');
      mergeImportedTrainingData(backup);
      mergeImportedTrainingData(backup);
      return { exported, games: GameArchive.load().length, reviews: GameArchive.load()[0] && GameArchive.load()[0].reviews.length };
    });
    if (!restored.exported || restored.games !== 1 || restored.reviews !== 2) problems.push('the archive did not round-trip through a training backup: ' + JSON.stringify(restored));
    // An archive still stored in the first (bare array) format exports and imports.
    const legacy = await page.evaluate(() => {
      const games = GameArchive.load();
      localStorage.setItem('coach:archive:v1', JSON.stringify(games));
      const backup = readTrainingBackup();
      localStorage.removeItem('coach:archive:v1');
      let error = null;
      try { mergeImportedTrainingData(backup); } catch (e) { error = e.message; }
      const old = JSON.parse(JSON.stringify(backup)); old.data['coach:archive:v1'] = games;
      localStorage.removeItem('coach:archive:v1');
      try { mergeImportedTrainingData(old); } catch (e) { error = error || e.message; }
      return { error, games: GameArchive.load().length };
    });
    if (legacy.error || legacy.games !== 1) problems.push('a legacy-format archive broke the backup: ' + JSON.stringify(legacy));
    await page.locator('#tab-game').click();
    await page.locator('#tab-progress').click();
    await row.click();
    await page.locator('#btn-game-viewer-delete').click();
    await page.locator('#btn-game-viewer-delete').click();
    if ((await page.evaluate(() => GameArchive.load().length)) !== 0) problems.push('delete (confirmed) did not remove the game');
    await page.evaluate(() => localStorage.setItem('coach:archive:v1', JSON.stringify({ v: 1, games: [{ id: 'x' }, null, { id: 'ok', pgn: '1. e4', at: 5, reviews: [{ ply: 1, tier: 'nonsense' }] }] })));
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
    if (!/Rosa · 800/.test(await page.locator('#opponent-tag').textContent())) problems.push('the opponent is not named above the board');
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

  await check('online games import, review, archive and count in Insights without touching the live game', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => window.GameImport && document.getElementById('game-import-form'));
    const lichessLine = JSON.stringify({ id: 'q7ZvsdUF', rated: true, variant: 'standard', speed: 'blitz', lastMoveAt: 1514505592843, status: 'draw',
      players: { white: { user: { name: 'Lance5500' }, rating: 2389 }, black: { user: { name: 'TryingHard87' }, rating: 2498 } },
      opening: { name: 'Semi-Slav Defense: Marshall Gambit' }, clock: { initial: 300, increment: 3 },
      pgn: '[White "Lance5500"]\n[Black "TryingHard87"]\n[Result "1/2-1/2"]\n\n1. d4 d5 2. c4 c6 3. Nc3 e6 4. e4 Nd7 5. exd5 cxd5 6. cxd5 exd5 7. Nxd5 Nb6 8. Bb5+ Bd7 9. Qe2+ Ne7 10. Nxb6 Qxb6 1/2-1/2' });
    await page.evaluate(line => {
      window.__requests = [];
      window.__mode = 'ok';
      const month = { games: [{ url: 'https://www.chess.com/game/live/111', uuid: 'aaaa-1111', rules: 'chess', rated: true, time_class: 'rapid', time_control: '600', end_time: 1762300000,
        white: { username: 'Alex', rating: 1210, result: 'checkmated' }, black: { username: 'Opp1', rating: 1250, result: 'win' },
        pgn: '[White "Alex"]\n[Black "Opp1"]\n[Result "0-1"]\n\n1. f3 {[%clk 0:09:58]} 1... e5 {[%clk 0:09:57]} 2. g4 {[%clk 0:09:50]} 2... Qh4# 0-1' }] };
      window.fetch = async (url, init) => {
        window.__requests.push({ url: String(url), accept: init && init.headers ? init.headers.Accept : null });
        if (window.__mode === '404') return new Response('{}', { status: 404 });
        if (window.__mode === '429') return new Response('{}', { status: 429 });
        if (window.__mode === 'offline') throw new TypeError('Failed to fetch');
        if (/^https:\/\/lichess\.org\/api\/games\/user\//.test(url)) return new Response(line + '\n', { status: 200 });
        if (/archives$/.test(url)) return new Response(JSON.stringify({ archives: ['https://api.chess.com/pub/player/alex/games/2026/10', 'https://api.chess.com/pub/player/alex/games/2026/11'] }), { status: 200 });
        if (/2026\/11$/.test(url)) return new Response(JSON.stringify(month), { status: 200 });
        if (/2026\/10$/.test(url)) return new Response(JSON.stringify({ games: [] }), { status: 200 });
        return new Response('{}', { status: 500 });
      };
    }, lichessLine);
    const liveBefore = await page.evaluate(() => ({ pgn: coachGame ? coachGame.pgn() : null, id: coachLocalGameId }));
    await page.locator('#group-inbox').evaluate(el => { el.open = true; });
    const statusText = () => page.locator('#game-import-status').textContent();
    const find = async name => { await page.locator('#game-import-user').fill(name); await page.locator('#btn-game-import-find').click(); };

    await find('a b');
    if (!/Enter a username/.test(await statusText())) problems.push('a bad username should be refused before any request');
    if (await page.evaluate(() => window.__requests.length)) problems.push('a bad username was sent');
    for (const [mode, pattern] of [['404', /no player with that username/], ['429', /limiting requests/], ['offline', /Could not reach Chess\.com/]]) {
      await page.evaluate(m => { window.__mode = m; }, mode);
      await find('alex');
      await page.waitForFunction(() => !document.getElementById('btn-game-import-find').disabled);
      if (!pattern.test(await statusText())) problems.push(`${mode} should say ${pattern}: ${await statusText()}`);
    }
    await page.evaluate(() => { window.__mode = 'ok'; window.__requests = []; });
    await find('alex');
    await page.waitForFunction(() => document.querySelectorAll('#game-import-list li').length === 1);
    const urls = await page.evaluate(() => window.__requests.map(r => r.url));
    if (urls.join(' ') !== 'https://api.chess.com/pub/player/alex/games/archives https://api.chess.com/pub/player/alex/games/2026/11 https://api.chess.com/pub/player/alex/games/2026/10')
      problems.push('Chess.com requests should be the archive list, then the newest months: ' + urls.join(' '));
    const row = await page.locator('#game-import-list li').textContent();
    if (!/Lost/.test(row) || !/White vs Opp1 \(1250\)/.test(row) || !/rapid/.test(row)) problems.push('the game row should read Lost, White vs Opp1 (1250), rapid: ' + row);

    await page.locator('.game-import-review').click();
    await page.waitForFunction(() => { const v = document.getElementById('game-viewer'); return v && !v.hidden; }, null, { timeout: 60000 });
    const game = await page.evaluate(() => GameArchive.load().find(g => g.id === 'chesscom-aaaa-1111'));
    if (!game) problems.push('the reviewed game was not archived');
    else {
      if (game.source !== 'chesscom' || game.opponent !== 'Opp1' || game.elo !== 1250 || game.side !== 'white') problems.push('archived game fields are wrong: ' + JSON.stringify({ source: game.source, opponent: game.opponent, elo: game.elo, side: game.side }));
      if (game.reviews.map(r => r.ply).join() !== '1,3') problems.push('only the user\'s two moves should be reviewed: ' + game.reviews.map(r => r.ply).join());
      const g4 = game.reviews.find(r => r.ply === 3);
      if (!g4 || g4.tier !== 'blunder') problems.push('2.g4, allowing mate in one, should be a blunder: ' + JSON.stringify(g4));
      if (!(game.accuracy >= 0 && game.accuracy < 50)) problems.push('two bad moves should give a low accuracy: ' + game.accuracy);
      if (/clk/.test(game.pgn)) problems.push('clock comments should not be stored');
    }
    const sub = await page.locator('#game-viewer-sub').textContent();
    if (!/vs Opp1 \(1250\)/.test(sub) || !/Chess\.com rapid/.test(sub)) problems.push('the viewer should name the opponent and site: ' + sub);
    if (await page.locator('#game-viewer-source').getAttribute('href') !== 'https://www.chess.com/game/live/111') problems.push('the viewer should link to the game on Chess.com');
    await page.locator('#btn-game-viewer-close').click();
    if (await page.locator('.game-import-review').textContent() !== 'Open review') problems.push('a reviewed game should offer Open review');
    const row2 = await page.evaluate(() => { GameArchive.render(); const li = [...document.querySelectorAll('#game-archive-list .game-archive-meta')].find(el => /Opp1/.test(el.textContent)); return li ? li.textContent : ''; });
    if (!/ 2 moves/.test(row2)) problems.push('the archive should count the game\'s two moves, not digits in its headers: ' + row2);
    // Reviewing again after deleting it from the archive replaces, not adds.
    await page.evaluate(() => GameArchive.remove('chesscom-aaaa-1111'));
    await page.evaluate(() => GameImport._state().found.length || null);
    await page.locator('.game-import-review').click();
    await page.waitForFunction(() => { const v = document.getElementById('game-viewer'); return v && !v.hidden; }, null, { timeout: 60000 });
    await page.locator('#btn-game-viewer-close').click();
    const twice = await page.evaluate(() => loadInsights().entries.filter(e => e.localGameId === 'chesscom-aaaa-1111').length);
    if (twice !== 2) problems.push('a second review should replace the game\'s Insights entries, not add more: ' + twice);
    const evidence = await page.evaluate(() => loadInsights().entries.filter(e => e.localGameId === 'chesscom-aaaa-1111').map(e => [e.ply, e.tier, e.gameId]));
    if (evidence.length !== 2 || evidence.some(e => e[2] !== null)) problems.push('both graded moves should count in Insights, tied to the imported game: ' + JSON.stringify(evidence));
    const liveAfter = await page.evaluate(() => ({ pgn: coachGame ? coachGame.pgn() : null, id: coachLocalGameId }));
    if (JSON.stringify(liveAfter) !== JSON.stringify(liveBefore)) problems.push('reviewing an imported game should leave the live Coach game alone');

    // Lichess: the NDJSON request, then a long review stopped part-way.
    await page.locator('#game-import-sources [data-source=lichess]').click();
    await page.evaluate(() => { window.__requests = []; });
    await find('TryingHard87');
    await page.waitForFunction(() => { const f = GameImport._state().found; return f.length === 1 && f[0].source === 'lichess'; });
    const req = await page.evaluate(() => window.__requests[0]);
    if (!/^https:\/\/lichess\.org\/api\/games\/user\/TryingHard87\?/.test(req.url) || req.accept !== 'application/x-ndjson') problems.push('the Lichess request should ask for NDJSON: ' + JSON.stringify(req));
    if (!/Draw/.test(await page.locator('#game-import-list li').textContent())) problems.push('the Lichess draw should read as a draw');
    await page.locator('.game-import-review').click();
    await page.waitForFunction(() => /Reviewing your moves: [2-9]/.test(document.getElementById('game-import-status').textContent), null, { timeout: 60000 });
    await page.locator('.game-import-review').click();
    await page.waitForFunction(() => /stopped/.test(document.getElementById('game-import-status').textContent), null, { timeout: 60000 });
    if (await page.evaluate(() => GameArchive.has('lichess-q7ZvsdUF'))) problems.push('a stopped review should not be saved');
    if (await page.locator('.game-import-review').textContent() !== 'Review') problems.push('after stopping, the game can be reviewed again');
    if (await page.evaluate(() => JSON.parse(localStorage.getItem('ui:import:v1')).source) !== 'lichess') problems.push('the chosen site should be remembered');

    // A game older than every kept imported game is reported, not blamed on storage.
    await page.evaluate(() => {
      const filler = Array.from({ length: GameArchive.LIMIT }, (_, i) => ({ id: 'lichess-new' + i, at: Date.now() - i, result: 'Draw.', side: 'white', elo: 1500, startFen: '', pgn: '1. e4 e5 *', reviews: [], source: 'lichess', opponent: 'X', url: 'https://lichess.org/new' + i }));
      localStorage.setItem(GameArchive.KEY, JSON.stringify({ v: 1, games: filler }));
    });
    await page.locator('#game-import-sources [data-source=chesscom]').click();
    await find('alex');
    await page.waitForFunction(() => { const f = GameImport._state().found; return f.length === 1 && f[0].source === 'chesscom'; });
    await page.locator('.game-import-review').click();
    await page.waitForFunction(() => /older than the/.test(document.getElementById('game-import-status').textContent), null, { timeout: 60000 })
      .catch(async () => problems.push('a game outside the archive cap should say so: ' + await statusText()));

    // Imported games have their own cap, so they never push out Coach games.
    const kept = await page.evaluate(() => {
      const base = { result: 'Draw.', side: 'white', elo: 1200, startFen: '', pgn: '1. e4 e5 *', reviews: [] };
      const coach = [1, 2, 3].map(i => Object.assign({ id: 'coach-' + i, at: 1000 + i }, base));
      const imported = Array.from({ length: GameArchive.LIMIT + 5 }, (_, i) => Object.assign({ id: 'lichess-x' + i, at: 5000 + i, source: 'lichess', opponent: 'X', url: 'https://lichess.org/x' + i }, base));
      localStorage.setItem(GameArchive.KEY, JSON.stringify({ v: 1, games: coach.concat(imported) }));
      const list = GameArchive.load();
      return { coach: list.filter(g => g.source === 'coach').length, imported: list.filter(g => g.source === 'lichess').length, badUrl: GameArchive.merge([], [Object.assign({ id: 'z', at: 1, source: 'lichess', url: 'javascript:alert(1)' }, base)]).games[0].url };
    });
    if (kept.coach !== 3 || kept.imported !== await page.evaluate(() => GameArchive.LIMIT)) problems.push('archive caps should be per source: ' + JSON.stringify(kept));
    if (kept.badUrl !== '') problems.push('only Chess.com and Lichess links are kept');
    return problems;
  });

  await check('repertoire trainer drills starred lines with spaced repetition', async () => {
    const problems = [];
    await page.goto(base + '/?view=puzzles&mode=repertoire');
    await page.evaluate(() => { localStorage.clear(); });
    // The trainer needs only the Library, so it opens even if the puzzle set never loads.
    await page.route('**/puzzle-data.js', route => route.abort());
    await page.goto(base + '/?view=puzzles&mode=repertoire');
    await page.waitForFunction(() => window.PuzzlesView && PuzzlesView._debug().mode === 'repertoire' && !document.getElementById('puzzle-panel-repertoire').hidden, null, { timeout: 10000 })
      .catch(() => problems.push('the repertoire trainer should open without the puzzle set'));
    await page.unroute('**/puzzle-data.js');
    if (await page.locator('#rep-empty').isHidden() || await page.locator('#btn-rep-start').isVisible()) problems.push('with nothing starred, the trainer should point to the Library');
    await page.locator('#btn-rep-library').click();
    if (await page.evaluate(() => appView) !== 'library') problems.push('Open the Library should switch to the Library');
    await page.goto(base + '/?opening=italian');
    await page.locator('#btn-repertoire-toggle').click();
    await page.goto(base + '/?view=puzzles&mode=repertoire');
    await page.waitForFunction(() => !document.getElementById('btn-rep-start').hidden);
    if (await page.locator('#btn-rep-start').textContent() !== 'Review 3 lines') problems.push('three Italian lines should be ready: ' + await page.locator('#btn-rep-start').textContent());
    const play = async move => { await page.locator('#puzzle-keyboard-move').evaluate(e => { e.open = true; }); await page.locator('#puzzle-keyboard-move-input').fill(move); await page.locator('#puzzle-keyboard-move-form button').click(); };
    const ready = () => page.waitForFunction(() => { const x = PuzzlesView._debug().session; return x && x.kind === 'repertoire' && x.phase === 'solving' && !x.busy; }, null, { timeout: 15000 });
    const current = () => page.evaluate(() => { const x = PuzzlesView._debug().session; return { id: x.card.id, ply: x.ply, uci: x.plies[x.ply].uci, fen: x.plies[x.ply].fenBefore, mistakes: x.mistakes }; });
    const status = () => page.locator('#puzzle-status').textContent();
    // Plays the current line to its end; `twist(step)` may return a move to try first.
    const playLine = async twist => {
      await ready();
      const { id } = await current();
      let notes = [];
      for (let step = 0; step < 40; step++) {
        await ready().catch(() => {});
        const still = await page.evaluate(id => { const x = PuzzlesView._debug().session; return x && x.card.id === id && x.phase === 'solving'; }, id);
        if (!still) break;
        const c = await current();
        const extra = twist ? await twist(step, c) : null;
        if (extra) { await play(extra.move); await page.waitForTimeout(150); notes.push({ kind: extra.kind, status: await status(), mistakes: (await current()).mistakes }); if (extra.kind === 'wrong') { await page.waitForTimeout(1700); continue; } }
        await play(c.uci);
        await page.waitForTimeout(100);
      }
      await page.waitForFunction(id => { const d = PuzzlesView._debug(); return !d.session || d.session.card.id !== id || d.session.phase === 'solved'; }, id, { timeout: 15000 });
      return { id, notes };
    };
    // Leaving Puzzles mid-line stops the review; finished lines stay saved.
    await page.locator('#btn-rep-start').click();
    await ready();
    await page.locator('#nav-library').click();
    await page.locator('#nav-puzzles').click();
    await page.waitForFunction(() => !PuzzlesView._debug().repRun && /Review stopped when you left/.test(document.getElementById('puzzle-status').textContent), null, { timeout: 5000 })
      .catch(() => problems.push('leaving Puzzles should stop the review'));
    await page.locator('#btn-rep-start').click();
    const first = await playLine(null);
    const rec = await page.evaluate(id => JSON.parse(localStorage.getItem(PuzzlesView.repertoireKey())).records[id], first.id);
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d.getTime(); });
    if (!rec || rec.reps !== 1 || rec.dueAt !== tomorrow) problems.push('a clean line should be due at the next local midnight: ' + JSON.stringify(rec));
    // Second line: first try a move from a sibling line where the lines part.
    let siblingTried = false;
    const second = await playLine(async (step, c) => {
      const sibling = await page.evaluate(c => {
        const cards = RepertoireCore.cardsFor(OPENINGS, ['italian'], OpponentPersonas.lineSide);
        const index = RepertoireCore.moveIndex(Chess, cards);
        const moves = index.get('w|' + c.fen.split(' ').slice(0, 4).join(' '));
        return moves ? [...moves.keys()].find(u => u !== c.uci) || null : null;
      }, c);
      if (sibling && !siblingTried) { siblingTried = true; return { kind: 'sibling', move: sibling }; }
      return null;
    });
    const sib = second.notes.find(n => n.kind === 'sibling');
    if (!sib) problems.push('the Italian lines should part on one of White\'s moves');
    else if (!/That is your move in/.test(sib.status) || sib.mistakes !== 0) problems.push('a sibling line\'s move should be named and not counted: ' + JSON.stringify(sib));
    const secondRec = await page.evaluate(id => JSON.parse(localStorage.getItem(PuzzlesView.repertoireKey())).records[id], second.id);
    if (!secondRec || secondRec.reps !== 1) problems.push('the sibling move should leave the line clean: ' + JSON.stringify(secondRec));
    // Third line: one real mistake.
    const third = await playLine(async (step, c) => {
      if (step !== 1) return null;
      const wrong = await page.evaluate(c => {
        const cards = RepertoireCore.cardsFor(OPENINGS, ['italian'], OpponentPersonas.lineSide);
        const index = RepertoireCore.moveIndex(Chess, cards);
        const known = index.get('w|' + c.fen.split(' ').slice(0, 4).join(' ')) || new Map();
        const g = new Chess(c.fen);
        const m = g.moves({ verbose: true }).find(x => !known.has(x.from + x.to + (x.promotion || '')));
        return m.from + m.to + (m.promotion || '');
      }, c);
      return { kind: 'wrong', move: wrong };
    });
    if (!/^[A-Za-z0-9+#=-]+\. Your move\.$/.test(await status()) && !/Line complete|reviewed/.test(await status())) problems.push('the opponent\'s move should be announced: ' + await status());
    const miss = third.notes.find(n => n.kind === 'wrong');
    if (!miss || !/Not this line\. It plays/.test(miss.status) || miss.mistakes !== 1) problems.push('a wrong move should show the line\'s move and count: ' + JSON.stringify(miss));
    const thirdRec = await page.evaluate(id => JSON.parse(localStorage.getItem(PuzzlesView.repertoireKey())).records[id], third.id);
    if (!thirdRec || thirdRec.lapses !== 1 || thirdRec.reps !== 0 || thirdRec.dueAt - thirdRec.lastAt !== 10 * 60 * 1000) problems.push('a line with a mistake should come back in ten minutes: ' + JSON.stringify(thirdRec));
    await page.waitForFunction(() => !document.getElementById('rep-summary').hidden, null, { timeout: 15000 });
    const summary = await page.locator('#rep-summary').textContent();
    if (summary !== '3 lines reviewed, 2 first try. 1 comes back in ten minutes.') problems.push('session summary: ' + summary);
    if (await page.locator('#btn-rep-start').textContent() !== 'Nothing due' || !await page.locator('#btn-rep-start').isDisabled()) problems.push('with every line reviewed, nothing should be due');
    if (!await page.evaluate(() => trainingBackupKeys().includes(PuzzlesView.repertoireKey()))) problems.push('repertoire records should be in training backups');
    return problems;
  });

  await check('Coach clocks charge the side to move, pause, survive a reload and end the game on time', async () => {
    const problems = [];
    // The clock's only boundary is its time source: advance performance.now.
    const fakeTime = () => page.evaluate(() => { const real = performance.now.bind(performance); window.__offset = 0; performance.now = () => real() + window.__offset; });
    const advance = ms => page.evaluate(ms => { window.__offset += ms; }, ms);
    const clock = () => page.evaluate(() => CoachClock._state());
    const play = async m => { await page.locator('#coach-keyboard-move').evaluate(e => { e.open = true; }); await page.locator('#coach-keyboard-move-input').fill(m); await page.locator('#coach-keyboard-move-form button').click(); };
    const settled = n => page.waitForFunction(n => coachGameActive && !coachThinking && coachIsUserTurn() && coachGame.history().length === n, n, { timeout: 60000 });
    await page.goto(base + '/?view=coach');
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(base + '/?view=coach');
    await fakeTime();
    await page.locator('#btn-coach-newgame').click();
    await page.waitForFunction(() => coachGameActive);
    await page.waitForTimeout(300);
    if (await clock() !== null || await page.locator('#coach-clock-bottom').isVisible()) problems.push('games are untimed by default');
    // Choosing a control before the first move times the game on the board.
    await page.locator('#coach-game-options').evaluate(el => { el.open = true; });
    await page.locator('#coach-clock-control').selectOption('3+2');
    await page.waitForFunction(() => CoachClock._state() && CoachClock._state().running === 'w');
    await advance(5000);
    await play('e4');
    await settled(2);
    let s = await clock();
    // Real time keeps passing on White's clock after the reply, so allow a
    // little below 3:00 − 5 s + 2 s.
    if (s.ms.w > 177200 || s.ms.w < 175000) problems.push('White should have about 3:00 − 5 s + 2 s: ' + s.ms.w);
    // Black is charged only for its own search (Coach's grading pauses the
    // clocks), then gets the increment.
    if (s.ms.b < 179000 || s.ms.b > 182000) problems.push('Black should have its time plus the increment, less its own search: ' + s.ms.b);
    const face = await page.evaluate(() => { CoachClock.tick(); const el = document.getElementById('coach-clock-bottom'); return { text: el.textContent, want: ClockCore.format(CoachClock._state().ms.w), running: el.classList.contains('running') }; });
    if (face.text !== face.want || !face.running) problems.push('the bottom clock should show White\'s running time: ' + JSON.stringify(face));
    // Leaving Coach pauses the clock.
    await page.locator('#nav-library').click();
    await page.waitForTimeout(250);
    const away = (await clock()).ms.w;
    await advance(60000);
    await page.waitForTimeout(250);
    if ((await clock()).ms.w !== away) problems.push('the clock should not run while Coach is not on screen');
    await page.locator('#nav-coach').click();
    // A reload keeps the game's clock.
    const beforeReload = (await clock()).ms.w;
    await page.reload();
    await fakeTime();
    await page.waitForFunction(() => CoachClock._state());
    const after = await clock();
    if (Math.abs(after.ms.w - beforeReload) > 1500 || after.control !== '3+2') problems.push('a reload should keep the clock: ' + JSON.stringify({ beforeReload, after: after.ms.w }));
    // Mid-game, a new choice waits for the next game.
    await page.locator('#coach-game-options').evaluate(el => { el.open = true; });
    await page.locator('#coach-clock-control').selectOption('10+0');
    if (!/next game/.test(await page.locator('#coach-clock-note').textContent()) || (await clock()).control !== '3+2') problems.push('changing the control mid-game should apply to the next game');
    // Running out on your move loses, and the result is recorded like a resignation.
    await advance(200000);
    await page.waitForFunction(() => !coachGameActive, null, { timeout: 5000 });
    const end = await page.evaluate(() => ({ msg: coachLastEndMsg, result: remoteGameResult(coachLastEndMsg), clock: CoachClock._state() }));
    if (end.msg !== 'Time — Black wins.' || end.result !== '0-1' || end.clock.flagged !== 'w') problems.push('a flag should lose on time: ' + JSON.stringify(end));
    if (!(await page.locator('#coach-clock-bottom').getAttribute('class')).includes('flagged')) problems.push('the flagged clock should show it');
    await page.waitForFunction(() => GameArchive.load().length === 1, null, { timeout: 5000 }).catch(() => problems.push('the timed-out game should be archived'));
    // The next game uses the newly chosen control, and a stalled opponent
    // (the engine gave no move) is not charged while Retry waits.
    await page.locator('#btn-summary-newgame').waitFor({ timeout: 10000 });
    await page.locator('#btn-summary-newgame').click();
    await page.waitForFunction(() => coachGameActive && CoachClock._state() && CoachClock._state().control === '10+0', null, { timeout: 5000 }).catch(() => problems.push('the next game should use 10+0'));
    await page.evaluate(() => { window.__realChoose = window.chooseCalibratedOpponentMove; window.chooseCalibratedOpponentMove = () => null; });
    try {
      await play('d4');
      await page.waitForFunction(() => document.getElementById('btn-coach-retry-opponent'), null, { timeout: 60000 });
      await page.evaluate(() => CoachClock.tick());
      const stalled = (await clock()).ms.b;
      await advance(120000);
      await page.waitForTimeout(250);
      if ((await clock()).ms.b !== stalled) problems.push('the opponent\'s clock should not run while its move failed and Retry waits');
    } finally {
      await page.evaluate(() => { if (window.__realChoose) window.chooseCalibratedOpponentMove = window.__realChoose; });
    }
    return problems;
  });

  // ── Unscored moves and failed practice analysis ──
  await check('taking back an unscored move leaves the scored move count alone', async () => {
    const problems = [];
    await freshCoach();
    await newGame();
    await playMove('e4');
    await page.waitForFunction(() => coachGame.history().length >= 2 && !coachThinking && coachIsUserTurn(), null, { timeout: 60000 });
    const scored = await page.evaluate(() => coachStats.moves);
    // The engine stalls (no bestmove, no PV) for this move's review only.
    await page.evaluate(() => {
      window.__realEvaluate = engineClient.evaluate;
      let stalls = 2;
      engineClient.evaluate = function (...args) {
        if (stalls-- > 0) return Promise.resolve({ lines: [], bestmove: null, info: {} });
        return window.__realEvaluate.apply(this, args);
      };
    });
    try {
      await playMove(await page.evaluate(() => ['d4', 'd3', 'Nf3', 'Nc3'].find(m => coachGame.moves().includes(m))));
      await page.waitForFunction(() => coachReviewLog.length >= 2 && !coachThinking, null, { timeout: 60000 });
      if (await page.evaluate(() => coachLastReview.tier) !== 'unknown') problems.push('setup: the stalled review should be unscored');
    } finally {
      await page.evaluate(() => { engineClient.evaluate = window.__realEvaluate; });
    }
    await page.evaluate(() => $('#btn-coach-takeback').prop('disabled', false).trigger('click'));
    const after = await page.evaluate(() => ({ moves: coachStats.moves, accuracy: accuracyFromTallies(coachStats, coachStats.moves) }));
    if (after.moves !== scored) problems.push(`take-back of an unscored move changed the scored count from ${scored} to ${after.moves}`);
    if (after.accuracy !== null && after.accuracy > 100) problems.push('accuracy rose past 100%: ' + after.accuracy);
    return problems;
  });

  await check('a failed practice analysis is retried on the next attempt', async () => {
    const problems = [];
    await freshCoach();
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    await page.evaluate(fen => {
      window.__realEvaluate = engineClient.evaluate;
      window.__practiceSearches = 0;
      engineClient.evaluate = function (searchFen, ...rest) {
        if (searchFen === fen) {
          window.__practiceSearches += 1;
          // The opening analysis and the first attempt's retry both fail.
          if (window.__practiceSearches <= 2) return Promise.reject(new Error('engine timed out'));
        }
        return window.__realEvaluate.call(this, searchFen, ...rest);
      };
      startCoachPractice({ id: 'drill-analysis-retry', tag: 'development', meta: INSIGHT_TAG_META.development,
        entry: { fenBefore: fen, bestUci: 'e2e4', bestSan: 'e4', userSan: 'a3', pairNum: 1, ply: 1 } });
    }, start);
    try {
      await page.waitForFunction(() => coachPracticeSession && coachPracticeSession.analysisReady, null, { timeout: 30000 });
      await playMove('d4');
      await page.waitForFunction(() => !coachPracticeSession.grading && /could not verify/.test($('#coach-practice-status').text()), null, { timeout: 30000 })
        .catch(() => problems.push('setup: the first attempt should be ungraded while the engine is down'));
      if (await page.evaluate(() => window.__practiceSearches) > 2) problems.push('a failed retry analysed again in a loop');
      await playMove('d4');
      await page.waitForFunction(() => !coachPracticeSession.grading && !/could not verify|Checking/.test($('#coach-practice-status').text()), null, { timeout: 60000 })
        .catch(() => problems.push('the second attempt was not graded: analysis was never retried'));
      if (await page.evaluate(() => window.__practiceSearches) < 3) problems.push('the practice position was not analysed again on the next attempt');
    } finally {
      await page.evaluate(() => { engineClient.evaluate = window.__realEvaluate; if (coachPracticeSession) exitCoachPractice(); });
    }
    return problems;
  });

  await check('server practice schedules land on this browser\'s local midnight', () => page.evaluate(() => {
    const problems = [];
    const attemptAt = new Date(2026, 10, 7, 21, 30).getTime();   // 7 Nov, 21:30 local
    mergeRemotePracticeRecords([{
      drill_key: 'merge-midnight', fen: '8/8/8/8/8/8/4K3/7k w - - 0 1', best_uci: 'e2e3', tag: 'candidate_moves',
      reps: 2, ease: 2.6, interval_days: 3, due_at: new Date(attemptAt + 3 * 86400000).toISOString(),
      attempts: 2, correct: 2, last_result: 'correct', last_attempt_at: new Date(attemptAt).toISOString()
    }]);
    const record = loadPracticeProgress().records['merge-midnight'];
    const want = new Date(2026, 10, 10).getTime();                // local midnight, three calendar days on
    if (!record || record.dueAt !== want) problems.push('a three-day server interval should be due at local midnight on 10 Nov: ' + (record && new Date(record.dueAt).toString()));
    return problems;
  }));

  await check('Library quiz hides the moves you have not reached', async () => {
    const problems = [];
    await page.goto(base + '/?opening=italian&mode=quiz');
    await page.waitForFunction(() => quizMode && document.querySelectorAll('#move-list .move-chip').length > 4);
    const shown = () => page.evaluate(() => Array.from(document.querySelectorAll('#move-list .move-chip')).filter(c => !c.classList.contains('quiz-hidden')).map(c => c.textContent));
    let visible = await shown();
    if (visible.length !== 0) problems.push('the quiz showed moves before any were played: ' + visible.join(' '));
    await page.locator('#library-keyboard-move').evaluate(e => { e.open = true; });
    await page.locator('#library-keyboard-move-input').fill('e4');
    await page.locator('#library-keyboard-move-form button').click();
    await page.waitForFunction(() => game.history().length >= 2, null, { timeout: 5000 });
    await page.waitForTimeout(200);
    visible = await shown();
    if (visible.join(' ') !== 'e4 e5') problems.push('after 1.e4 e5 the quiz should show exactly those moves: ' + visible.join(' '));
    await page.locator('#btn-study').click();
    if ((await shown()).length !== await page.locator('#move-list .move-chip').count()) problems.push('Study mode did not show the whole line');
    return problems;
  });

  await check('Library quiz plays the side that owns the line', async () => {
    const problems = [];
    await page.goto(base + '/?opening=fools-mate&mode=quiz');
    await page.waitForFunction(() => quizMode && currentOpening && currentOpening.id === 'fools-mate');
    await page.waitForFunction(() => game.history().length >= 1, null, { timeout: 3000 }).catch(() => {});
    let state = await page.evaluate(() => ({ side: getUserColor(), orientation: board.orientation(), history: game.history() }));
    if (state.side !== 'black' || state.orientation !== 'black' || state.history[0] !== 'f3') problems.push('Fool\'s Mate should be quizzed as Black after White\'s f3: ' + JSON.stringify(state));
    // A Black-owned variation of a White opening.
    await page.goto(base + '/?opening=italian&mode=quiz');
    await page.waitForFunction(() => quizMode && currentOpening && currentOpening.id === 'italian');
    await page.locator('.line-btn[data-line="blackburne-shilling"]').click();
    await page.waitForFunction(() => game.history().length >= 1, null, { timeout: 3000 }).catch(() => {});
    state = await page.evaluate(() => ({ side: getUserColor(), orientation: board.orientation(), history: game.history() }));
    if (state.side !== 'black' || state.orientation !== 'black' || state.history[0] !== 'e4') problems.push('the Blackburne Shilling line should be quizzed as Black: ' + JSON.stringify(state));
    return problems;
  });

  await check('choosing another opening mid-quiz restarts the quiz for that opening', async () => {
    const problems = [];
    await page.goto(base + '/?opening=italian&mode=quiz');
    await page.waitForFunction(() => quizMode && currentOpening && currentOpening.id === 'italian');
    await page.evaluate(() => $('.opening-btn[data-id="sicilian"]').first().trigger('click'));
    await page.waitForFunction(() => currentOpening.id === 'sicilian' && game.history().length >= 1, null, { timeout: 3000 }).catch(() => {});
    const state = await page.evaluate(() => ({ quizMode, orientation: board.orientation(), history: game.history(), idx: currentMoveIdx }));
    if (!state.quizMode || state.orientation !== 'black' || state.history.join(' ') !== 'e4' || state.idx !== 0) problems.push('the Sicilian quiz should face Black with 1.e4 played: ' + JSON.stringify(state));
    return problems;
  });

  await check('a pending quiz reply is dropped when the opening or line changes', async () => {
    const problems = [];
    await page.goto(base + '/?opening=sicilian&mode=quiz');
    await page.waitForFunction(() => quizMode && currentOpening && currentOpening.id === 'sicilian' && game.history().length === 1);
    // Restarting the line queues White's 1.e4; switch to a White opening before it plays.
    await page.evaluate(() => { switchOpeningLine('main'); loadOpening('italian'); });
    await page.waitForTimeout(1000);
    const state = await page.evaluate(() => ({ id: currentOpening.id, history: game.history(), idx: currentMoveIdx, orientation: board.orientation() }));
    if (state.id !== 'italian' || state.history.length || state.idx !== -1 || state.orientation !== 'white') problems.push('the old line\'s reply was played into the new quiz: ' + JSON.stringify(state));
    return problems;
  });

  await check('typed SAN respects piece case', () => page.evaluate(() => {
    const problems = [];
    const position = new Chess('4k3/8/8/8/8/2n5/1P1B4/4K3 w - - 0 1');
    const pick = text => { const m = resolveAccessibleMove(position, text); return m ? m.piece + m.from : null; };
    if (pick('Bxc3') !== 'bd2') problems.push('Bxc3 should move the bishop, got ' + pick('Bxc3'));
    if (pick('bxc3') !== 'pb2') problems.push('bxc3 should move the pawn, got ' + pick('bxc3'));
    if (pick('BXC3') !== null) problems.push('an ambiguous case-insensitive entry should not guess');
    if (pick('kf2') !== 'ke1') problems.push('a unique lower-case entry should still work');
    return problems;
  }));

  await check('Explore explains a Lichess rate limit', async () => {
    const problems = [];
    await page.evaluate(key => sessionStorage.setItem(key, 'behaviour-test-token'), await page.evaluate(() => LICHESS_TOKEN_KEY));
    await page.goto(base + '/?opening=italian&mode=explore');
    await page.waitForFunction(() => exploreMode && exploreGame);
    await page.evaluate(() => {
      window.__realAjax = $.ajax;
      $.ajax = options => { setTimeout(() => options.error && options.error({ status: 429 }), 0); return { abort() {} }; };
      exploreCache.clear();
      fetchExploreData();
    });
    await page.waitForFunction(() => !/Fetching/.test($('#continuations-list').text()), null, { timeout: 3000 }).catch(() => {});
    const text = await page.evaluate(() => $('#continuations-list').text());
    if (!/limiting requests/.test(text) || /Could not reach/.test(text)) problems.push('a 429 was shown as: ' + text);
    await page.evaluate(() => { $.ajax = window.__realAjax; sessionStorage.removeItem(LICHESS_TOKEN_KEY); });
    return problems;
  });

  await check('Coach opening label says where the game left the book', () => page.evaluate(() => {
    const problems = [];
    const saved = { game: coachGame, transfer: coachOpeningTransfer, cursor: coachReviewCursor };
    try {
      coachGame = new Chess();
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5', 'Nf5'].forEach(san => coachGame.move(san));
      coachOpeningTransfer = null;
      coachReviewCursor = null;
      updateOpeningLabel();
      const text = $('#coach-opening-name').text();
      if (!/out of book after move 5$/.test(text)) problems.push('5.Nc3 is a book move, so the label should say move 5: ' + text);
    } finally {
      coachGame = saved.game; coachOpeningTransfer = saved.transfer; coachReviewCursor = saved.cursor;
      updateOpeningLabel();
    }
    return problems;
  }));

  if (pageErrors.length) failures.push('page errors: ' + pageErrors.join(' | '));
  if (failures.length) throw new Error(failures.join('\n'));
  return { passed: passed.length, checks: passed };
}
