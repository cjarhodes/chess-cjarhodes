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
  // Settings (src/ui/settings.js): through the gear and the section tab, as
  // a person would. Closing waits for the history step back.
  const openSettings = async (p, section) => {
    if (!(await p.evaluate(() => SettingsSheet.isOpen()))) await p.locator('#btn-settings').click();
    await p.locator('#settings-tab-' + section).click();
  };
  const closeSettings = async p => {
    if (!(await p.evaluate(() => SettingsSheet.isOpen()))) return;
    await p.locator('#btn-settings-close').click();
    await p.waitForFunction(() => !SettingsSheet.isOpen() && !/settings=/.test(location.search));
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
      const staticText = document.getElementById('threats-list').textContent;
      if (!staticText.trim()) problems.push('static threats were not rendered before the mate scan finished');
      threatRequestId++;
      resolveScan({ status: 'ok', mateIn: 1 });
      await tick();
      if (document.getElementById('threats-list').textContent !== staticText) problems.push('a stale mate scan changed the threat panel');
      window.detectMateThreat = () => Promise.resolve({ status: 'unavailable' });
      await showThreats();
      await tick();
      if (!/unavailable/i.test(document.getElementById('threats-list').textContent)) problems.push('mate-scan failure was not shown');
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
      const text = document.getElementById('threats-list').textContent;
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

  await check('a game result survives leaving Coach or starting the next game while sync waits', () => page.evaluate(async () => {
    const problems = [];
    const saved = { client: coachDbClient, user: coachAuthUser, remoteId: coachRemoteGameId, localId: coachLocalGameId, checkpoint: Object.assign({}, accountCheckpoint) };
    const writes = [];
    // The checkpoint upload is slow; every game write waits behind it.
    const fakeClient = {
      from(table) {
        const ops = [];
        const result = () => {
          if (table === 'coach_checkpoints') return new Promise(resolve => setTimeout(() => resolve(ops.includes('neq') ? { data: [], error: null } : ops.includes('insert') || ops.includes('update') ? { data: { revision: 1 }, error: null } : { data: null, error: null }), 400));
          if (table === 'coach_games') {
            writes.push(ops.slice());
            return Promise.resolve(ops.includes('insert') ? { data: { id: 'game-final-inserted' }, error: null } : { data: null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        };
        const query = new Proxy(function () {}, {
          get(_, prop) {
            if (prop === 'then') return (resolve, reject) => result().then(resolve, reject);
            return (...args) => {
              ops.push(prop, ...args.map(arg => (arg && typeof arg === 'object' ? JSON.parse(JSON.stringify(arg)) : arg)));
              return prop === 'single' || prop === 'maybeSingle' ? result() : query;
            };
          }
        });
        return query;
      }
    };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const finalWrite = (id, msg) => writes.find(ops => ops.includes('update') && ops.some(arg => arg && arg.end_reason === msg) && ops.includes(id));
    try {
      coachDbClient = fakeClient;
      coachAuthUser = { id: 'behaviour-test-user' };
      // Earlier stubbed checks can leave this test owner's tab marked as paused.
      sessionStorage.removeItem(coachMemoryKey('coach:checkpoint-conflict:v1'));
      Object.assign(accountCheckpoint, { owner: null, loaded: false, conflict: false, chain: Promise.resolve() });
      // Leaving Coach right after the result: the view change bumps the generation.
      coachRemoteGameId = 'game-final-1';
      coachSync.saveGame('Checkmate — White wins.').catch(error => problems.push('final save threw ' + error.message));
      invalidateCoachAsyncWork('Coach view changed.');
      await wait(1500);
      const left = finalWrite('game-final-1', 'Checkmate — White wins.');
      if (!left) problems.push('leaving Coach while the checkpoint uploaded dropped the game result');
      else if (!left.some(arg => arg && arg.result === '1-0' || arg && arg.result === '0-1' || arg && arg.result === '*')) problems.push('final write carried no result');
      // Starting the next game before the result reached the account.
      writes.length = 0;
      Object.assign(accountCheckpoint, { owner: null, loaded: false, conflict: false });
      coachRemoteGameId = 'game-final-2';
      coachSync.saveGame('Black resigned.').catch(error => problems.push('final save threw ' + error.message));
      invalidateCoachAsyncWork('A new game replaced the previous analysis.');
      coachLocalGameId = 'behaviour-next-game';
      coachRemoteGameId = null;
      await wait(1500);
      if (!finalWrite('game-final-2', 'Black resigned.')) problems.push('starting the next game dropped the previous game result');
      if (writes.some(ops => ops.includes('behaviour-next-game') || (ops.includes('update') && !ops.includes('game-final-2')))) problems.push('the previous result was written to the wrong game');
    } finally {
      clearQueuedRemoteCoachGameUpdate();
      if (accountCheckpoint.timer) clearTimeout(accountCheckpoint.timer);
      coachDbClient = saved.client;
      coachAuthUser = saved.user;
      coachRemoteGameId = saved.remoteId;
      coachLocalGameId = saved.localId;
      Object.assign(accountCheckpoint, saved.checkpoint, { timer: null });
      Object.keys(localStorage).filter(k => k.includes('behaviour-test-user')).forEach(k => localStorage.removeItem(k));
    }
    return problems;
  }));

  await check('practice sync skips an attempt the account rejects and keeps going', () => page.evaluate(async () => {
    const problems = [];
    const saved = { client: coachDbClient, user: coachAuthUser };
    const owner = 'behaviour-practice-user';
    const calls = [];
    let offline = false;
    const event = (id, extra) => Object.assign({ id, ownerId: owner, drillId: 'drill-' + id, tag: 'king_safety',
      fen: '8/8/8/8/8/8/4K3/7k w - - 0 1', bestUci: 'e2e3', at: Date.parse('2026-11-01T12:00:00Z'), correct: true, revealed: false, synced: false }, extra || {});
    const pendingIds = () => loadPracticeProgress(owner).events.filter(e => !e.synced).map(e => e.id).join(',');
    try {
      coachDbClient = {
        rpc(name, params) {
          calls.push(params.p_event_id + (params.p_source_move_id ? '@' + params.p_source_move_id : ''));
          if (offline) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
          // The source move was taken back: its id no longer exists.
          if (params.p_source_move_id === 'taken-back-move') return Promise.resolve({ data: null, error: { code: '23503', message: 'violates foreign key constraint' } });
          if (params.p_event_id === 'malformed') return Promise.resolve({ data: null, error: { code: 'P0001', message: 'Practice attempt payload is incomplete' } });
          return Promise.resolve({ data: null, error: null });
        }
      };
      coachAuthUser = { id: owner };
      savePracticeProgress({ records: {}, events: [event('orphaned', { sourceMoveId: 'taken-back-move' }), event('malformed'), event('later-1'), event('later-2')] }, owner);
      let threw = null;
      await syncPendingPracticeEvents().catch(error => { threw = error; });
      if (pendingIds().includes('later')) problems.push('one failing attempt kept later attempts from syncing (pending: ' + pendingIds() + ')');
      if (!calls.includes('orphaned')) problems.push('an attempt whose source move was taken back was not retried without it');
      if (pendingIds().includes('orphaned')) problems.push('the attempt with a taken-back source move never synced');
      calls.length = 0;
      await syncPendingPracticeEvents().catch(error => { threw = error; });
      if (calls.includes('malformed')) problems.push('a permanently rejected attempt is retried on every sync');
      // A network outage is not permanent: stop, keep the attempts pending.
      savePracticeProgress({ records: {}, events: loadPracticeProgress(owner).events.concat([event('offline-1'), event('offline-2')]) }, owner);
      offline = true; calls.length = 0; threw = null;
      await syncPendingPracticeEvents().catch(error => { threw = error; });
      if (!threw) problems.push('a network failure was not reported');
      if (calls.length !== 1 || !pendingIds().includes('offline-1') || !pendingIds().includes('offline-2')) problems.push('a network failure should stop the run and keep attempts pending: ' + calls.join(','));
    } finally {
      coachDbClient = saved.client;
      coachAuthUser = saved.user;
      Object.keys(localStorage).filter(k => k.includes(owner)).forEach(k => localStorage.removeItem(k));
    }
    return problems;
  }));

  await check('manual sync reports partial failures', () => page.evaluate(async () => {
    const problems = [];
    const saved = { client: coachDbClient, user: coachAuthUser, load: coachSync.loadInsights, save: coachSync.saveGame, flush: window.flushAccountCheckpoint };
    const run = async () => {
      document.getElementById('btn-coach-sync').click();
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
    const pieces = [...document.querySelectorAll('#coachBoard .pieces use')];
    const sprite = document.querySelector('#cm-chessboard-sprite svg');
    if (!pieces.length || !pieces.every(use => /^#[wb][kqrbnp]$/.test(use.getAttribute('href')))) problems.push('pieces are not drawn from the sprite');
    if (!sprite || !sprite.querySelector('#wk') || !/cburnett/.test(sprite.parentNode.innerHTML)) problems.push('the cburnett sprite is not loaded');
    if (performance.getEntriesByType('resource').some(r => /upload\.wikimedia|chessboardjs/.test(r.name))) problems.push('a retired piece or board source was requested');
    const before = document.querySelectorAll('#coachBoard .board-mark.last-move').length;
    coachBoard.position(coachGame.fen(), false);
    const host = document.getElementById('coachBoard');
    host.style.width = (host.clientWidth - 16) + 'px';
    coachBoard.resize();
    await new Promise(resolve => setTimeout(resolve, 50));
    const moved = document.querySelector('#coachBoard .board-mark-cell');
    const square = moved && document.querySelector(`#coachBoard .square[data-square="${moved.getAttribute('data-mark-square')}"]`);
    const aligned = moved && square && Math.abs(moved.getBoundingClientRect().width - square.getBoundingClientRect().width) < 0.5;
    host.style.width = '';
    coachBoard.resize();
    const after = document.querySelectorAll('#coachBoard .board-mark.last-move').length;
    if (before !== 2 || after !== 2) problems.push(`last-move squares before/after redraw: ${before}/${after}`);
    if (!aligned) problems.push('the last-move mark did not follow the squares through a resize');
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

  await check('landmarks are named, headings do not skip levels and board labels read as words', async () => {
    const problems = [];
    // Every rail is a named complementary landmark (an unnamed aside inside
    // a named section is not a landmark at all), and names are unique.
    const names = await page.evaluate(() => [...document.querySelectorAll('aside')].map(a => a.getAttribute('aria-label') || ''));
    if (names.some(n => !n)) problems.push('an aside has no aria-label: ' + JSON.stringify(names));
    if (new Set(names).size !== names.length) problems.push('aside names repeat: ' + JSON.stringify(names));
    const headingSkips = () => page.evaluate(() => {
      const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')]
        .filter(h => h.offsetParent || getComputedStyle(h).position === 'fixed')
        .map(h => ({ level: Number(h.getAttribute('aria-level') || h.tagName.slice(1)), text: h.textContent.trim().slice(0, 30) }));
      const skips = [];
      levels.forEach((h, i) => { if (i && h.level > levels[i - 1].level + 1) skips.push(`${levels[i - 1].text} (h${levels[i - 1].level}) -> ${h.text} (h${h.level})`); });
      return skips;
    });
    for (const [nav, setup] of [['#nav-coach', null], ['#nav-library', '#btn-explore'], ['#nav-puzzles', null]]) {
      await page.locator(nav).click();
      if (setup) { await page.locator('.opening-btn').first().click(); await page.locator(setup).click(); }
      await page.waitForTimeout(300);
      (await headingSkips()).forEach(skip => problems.push(nav + ': heading skips a level: ' + skip));
    }
    await page.locator('#nav-coach').click();
    const label = await page.evaluate(() => {
      const saved = coachGame;
      try {
        coachGame = new Chess('4k3/8/8/8/8/8/4q3/4K3 w - - 0 1');
        updateCoachBoardAccessibility();
        return document.getElementById('coachBoard').getAttribute('aria-label');
      } finally { coachGame = saved; updateCoachBoardAccessibility(); }
    });
    expect(problems, label === 'White to move. In check. White: King e1. Black: King e8, Queen e2.', 'Coach board label is not the position in words: ' + label);
    return problems;
  });

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
    const sq = name => page.locator(`#coachBoard .square[data-square="${name}"]`);
    await sq(before.move.from).dragTo(sq(before.move.to)).catch(() => {});
    await sq(before.move.from).click({ force: true });
    await sq(before.move.to).click({ force: true });
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
    await page.evaluate(() => { if (typeof closeCoachSummary === 'function') closeCoachSummary(); document.querySelectorAll('#coach-summary-overlay, #summary-overlay').forEach(el => { el.style.display = 'none'; }); });
    await page.evaluate(() => { const b = document.getElementById('btn-coach-takeback'); b.disabled = false; b.click(); });
    await page.waitForFunction(() => !coachLifetimeRolledForThisGame, null, { timeout: 30000 }).catch(() => problems.push('take-back left the game counted as finished'));
    if (await page.evaluate(gameId => !!loadLifetime().rollups[gameId], id)) problems.push('lifetime rollup survived the take-back');
    return problems;
  });

  await check('a take-back makes the game unrated but never erases a rated result', async () => {
    const problems = [];
    const rating = () => page.evaluate(() => { const p = loadGrowthState().profile; return { estimate: p.ratingEstimate, games: p.ratingGames, ids: p.ratingHistory.map(h => h.gameId) }; });
    const hideSummary = () => page.evaluate(() => { if (typeof closeCoachSummary === 'function') closeCoachSummary(); document.querySelectorAll('#coach-summary-overlay, #summary-overlay').forEach(el => { el.style.display = 'none'; }); });
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
    await page.evaluate(() => document.getElementById('btn-coach-resign').click());
    await page.waitForFunction(gameId => loadGrowthState().profile.ratingHistory.some(h => h.gameId === gameId), id, { timeout: 10000 })
      .catch(() => problems.push('a standard finished game was not rated'));
    await hideSummary();
    await page.evaluate(() => { const b = document.getElementById('btn-coach-takeback'); b.disabled = false; b.click(); });
    const kept = await rating();
    if (kept.games !== before.games + 1 || !kept.ids.includes(id)) problems.push('taking back a rated result should keep its rating: ' + JSON.stringify({ before, kept }));
    if (!/unrated/.test(await page.locator('#coach-status').textContent())) problems.push('the status should say a game with a take-back is unrated');
    // A take-back mid-game survives a reload and keeps the finished game unrated.
    await newGame();
    await playOne();
    await page.evaluate(() => { const b = document.getElementById('btn-coach-takeback'); b.disabled = false; b.click(); });
    await page.reload();
    await page.waitForFunction(() => typeof coachGameActive !== 'undefined' && coachGame && coachGameActive && !coachThinking, null, { timeout: 60000 });
    const id2 = await playOne();
    const midBefore = await rating();
    await page.evaluate(() => document.getElementById('btn-coach-resign').click());
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
      document.getElementById('game-inbox-side').value = 'white';
      document.getElementById('game-inbox-pgn').value = text;
      await analyseImportedPgn();
      return document.getElementById('game-inbox-status').textContent;
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
        document.getElementById('game-inbox-side').value = 'white';
        document.getElementById('game-inbox-pgn').value = pgn;
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
  await check('re-pasting a PGN or retrying a live game insert while signed in reuses its account game', async () => {
    const problems = [];
    await freshCoach();
    // A fake Data API that keeps coach_games rows and enforces what the
    // database does: one row per (user_id, client_game_key), nulls distinct.
    const result = await page.evaluate(async pgn => {
      const saved = { client: coachDbClient, user: coachAuthUser, insights: coachRemoteInsightEntries, loaded: coachRemoteInsightsLoaded, permission: window.ensureAccountWritePermission };
      const games = [], moves = [];
      let serial = 0;
      const one = (list, maybe) => list.length === 1 || (maybe && !list.length)
        ? { data: list[0] || null, error: null }
        : { data: null, error: { code: 'PGRST116', message: `${list.length} rows` } };
      const fakeClient = {
        from(table) {
          const state = { op: 'select', rows: null, opts: {}, filters: [] };
          const run = () => {
            if (table === 'coach_moves' && state.op === 'upsert') {
              moves.push(Object.assign({}, state.rows));
              return { data: [{ id: 'remote-move-' + (++serial) }], error: null };
            }
            if (table !== 'coach_games') return null;
            if (state.op === 'insert' || state.op === 'upsert') {
              const out = [];
              for (const row of [].concat(state.rows)) {
                const dup = row.client_game_key != null && games.find(g => g.user_id === row.user_id && g.client_game_key === row.client_game_key);
                if (dup && state.op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key value' } };
                if (dup && state.opts.ignoreDuplicates) continue;
                if (dup) { Object.assign(dup, row); out.push(dup); continue; }
                const created = Object.assign({ id: 'remote-game-' + (++serial) }, row);
                games.push(created);
                out.push(created);
              }
              return { data: out, error: null };
            }
            const matched = games.filter(g => state.filters.every(([key, value]) => g[key] === value));
            if (state.op === 'update') matched.forEach(g => Object.assign(g, state.rows));
            if (state.op === 'delete') matched.forEach(g => games.splice(games.indexOf(g), 1));
            return { data: matched, error: null };
          };
          const settle = mode => {
            const response = run();
            if (!response) return { data: null, error: null };
            if (!mode || response.error) return response;
            return one(Array.isArray(response.data) ? response.data : [response.data].filter(Boolean), mode === 'maybe');
          };
          const builder = new Proxy({}, {
            get(_, prop) {
              if (prop === 'then') return (resolve, reject) => Promise.resolve(settle(null)).then(resolve, reject);
              if (prop === 'single') return () => Promise.resolve(settle('single'));
              if (prop === 'maybeSingle') return () => Promise.resolve(settle('maybe'));
              if (prop === 'insert' || prop === 'update') return rows => { state.op = prop; state.rows = rows; return builder; };
              if (prop === 'upsert') return (rows, opts) => { state.op = 'upsert'; state.rows = rows; state.opts = opts || {}; return builder; };
              if (prop === 'delete') return () => { state.op = 'delete'; return builder; };
              if (prop === 'eq') return (key, value) => { state.filters.push([key, value]); return builder; };
              return () => builder;
            }
          });
          return builder;
        },
        rpc: async () => ({ data: null, error: null })
      };
      const paste = async () => {
        const before = moves.length;
        document.getElementById('game-inbox-side').value = 'white';
        document.getElementById('game-inbox-pgn').value = pgn;
        await analyseImportedPgn();
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && moves.length < before + 3) await new Promise(resolve => setTimeout(resolve, 100));
        await new Promise(resolve => setTimeout(resolve, 300));
        return { remoteGameId: coachRemoteGameId, status: document.getElementById('game-inbox-status').textContent };
      };
      try {
        coachDbClient = fakeClient;
        coachAuthUser = { id: 'behaviour-repaste-user' };
        coachRemoteInsightEntries = [];
        coachRemoteInsightsLoaded = true;
        // The session checkpoint is its own boundary (covered above); let game writes through.
        window.ensureAccountWritePermission = async () => {};
        const first = await paste();
        const second = await paste();
        const pasted = games.map(g => ({ id: g.id, key: g.client_game_key || null }));
        // A live game is keyed by its local id, so a retried insert (a lost
        // response, a late duplicate) reuses the row instead of adding one.
        const liveId = createCoachGameId();
        const livePayload = { user_id: 'behaviour-repaste-user', status: 'active', pgn: '' };
        const liveA = await insertRemoteCoachGame(livePayload, liveId);
        const liveB = await insertRemoteCoachGame(livePayload, liveId);
        // The final result for a game whose row exists but whose id was lost
        // lands on that row instead of being dropped by the ignored insert.
        await commitFinalRemoteCoachGame({ payload: { user_id: 'behaviour-repaste-user', status: 'completed', result: '1-0', pgn: '1. e4 *' }, remoteGameId: null, localGameId: liveId });
        const liveRow = games.find(g => g.client_game_key === liveId) || {};
        const live = { a: liveA, b: liveB, rows: games.filter(g => g.client_game_key === liveId).length, finalStatus: liveRow.status, finalResult: liveRow.result };
        return { first, second, games: pasted, moveGames: Array.from(new Set(moves.map(m => m.game_id))), moves: moves.length, live };
      } finally {
        coachDbClient = saved.client;
        coachAuthUser = saved.user;
        coachRemoteInsightEntries = saved.insights;
        coachRemoteInsightsLoaded = saved.loaded;
        window.ensureAccountWritePermission = saved.permission;
        clearQueuedRemoteCoachGameUpdate();
        Object.keys(localStorage).filter(k => k.includes('behaviour-repaste-user')).forEach(k => localStorage.removeItem(k));
      }
    }, '[Event "Club"]\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 *');
    if (!/reviewed/.test(result.second.status)) problems.push('the second paste did not finish: ' + result.second.status);
    if (result.moves < 6) problems.push(`both pastes should sync their moves: ${result.moves} move writes`);
    if (result.games.length !== 1) problems.push('re-pasting the same game added another account game: ' + JSON.stringify(result.games));
    if (!result.games[0] || !/^pgn-w/.test(result.games[0].key || '')) problems.push('the pasted game row should carry its content id: ' + JSON.stringify(result.games));
    if (result.first.remoteGameId !== result.second.remoteGameId) problems.push('the second paste should reuse the first paste\'s row: ' + JSON.stringify([result.first.remoteGameId, result.second.remoteGameId]));
    if (result.moveGames.length !== 1) problems.push('the re-pasted moves should land on the one game row: ' + JSON.stringify(result.moveGames));
    if (result.live.rows !== 1 || result.live.a.id !== result.live.b.id || result.live.b.created !== false) problems.push('a retried live-game insert should reuse its row: ' + JSON.stringify(result.live));
    if (result.live.rows !== 1 || result.live.finalStatus !== 'completed' || result.live.finalResult !== '1-0') problems.push('a final result for an existing keyed row should update it: ' + JSON.stringify(result.live));
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
    if (!/could not be saved/.test(document.getElementById('feedback-bar').textContent)) problems.push('quiz did not warn that progress was not saved');
    return problems;
  }));

  await check('share-link clipboard failure is handled visibly', async () => {
    const problems = [];
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    });
    await page.locator('#btn-share').click();
    await page.waitForFunction(() => /unavailable/i.test(document.getElementById('btn-share').textContent), null, { timeout: 5000 })
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
    await page.evaluate(() => { document.getElementById('lichess-token-input').value = ''; document.getElementById('lichess-token-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    if (!/Paste a Lichess token first/.test(await page.evaluate(() => { const el = document.getElementById('token-error'); return el.getClientRects().length ? el.textContent : ''; }))) problems.push('empty submit gave no feedback');
    await page.evaluate(value => {
      window.__realFetch = window.fetch;
      window.fetch = (url, init) => {
        const isExplorer = String(url).startsWith('https://explorer.lichess.ovh/') && new URL(url).searchParams.get('topGames') === '0';
        if (!isExplorer) return window.__realFetch(url, init);
        return Promise.resolve(new Response(JSON.stringify({ moves: [], white: 0, draws: 0, black: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      };
      document.getElementById('lichess-token-input').value = value;
      document.getElementById('lichess-token-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }, token);
    await page.waitForFunction(() => sessionStorage.getItem(LICHESS_TOKEN_KEY), null, { timeout: 5000 }).catch(() => problems.push('valid token was not kept for the session'));
    const leaked = await page.evaluate(value => Object.keys(localStorage).some(k => localStorage.getItem(k) && localStorage.getItem(k).includes(value)), token);
    if (leaked) problems.push('token was written to localStorage');
    await page.evaluate(() => { window.fetch = window.__realFetch; sessionStorage.removeItem(LICHESS_TOKEN_KEY); });
    return problems;
  });

  // ── Appearance: colour and board themes apply, persist and migrate ──
  await check('appearance and board themes change the page and survive reload', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof applyBoardTheme === 'function');
    await openSettings(page, 'appearance');
    await page.locator('#color-theme').selectOption('dark');
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (darkBg === 'rgb(245, 239, 227)') problems.push('choosing Dark left the light page colour');
    await page.locator('#board-theme').selectOption('contrast');
    const lightSquare = await page.evaluate(() => getComputedStyle(document.querySelector('#coachBoard .square.white')).fill);
    if (lightSquare !== 'rgb(255, 255, 255)') problems.push('High contrast did not recolour the light squares: ' + lightSquare);
    await closeSettings(page);
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

  // ── The board (src/ui/board.js on cm-chessboard): drag, click, touch ──
  const boardSquare = (p, id, name) => p.locator(`#${id} .square[data-square="${name}"]`);
  const squareCentre = async (p, id, name) => {
    const box = await boardSquare(p, id, name).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const mouseDrag = async (id, from, to) => {
    const a = await squareCentre(page, id, from), b = await squareCentre(page, id, to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  };

  await check('the board plays a dragged move, snaps back an illegal drop and plays a clicked move once', async () => {
    const problems = [];
    await freshCoach();
    await newGame();
    const sq = name => boardSquare(page, 'coachBoard', name);
    const boardMatchesGame = () => page.evaluate(() => Chessboard.objToFen(coachBoard.position()) === coachGame.fen().split(' ')[0]);
    await mouseDrag('coachBoard', 'a2', 'a5');
    await page.waitForTimeout(250);
    const illegal = await page.evaluate(() => ({ plies: coachGame.history().length, a2: coachBoard.position().a2, a5: coachBoard.position().a5 || null,
      shown: !!document.querySelector('#coachBoard .pieces g[data-square="a2"]:not([visibility="hidden"])'), floating: document.querySelectorAll('.cm-chessboard-draggable-piece').length }));
    if (illegal.plies !== 0 || illegal.a2 !== 'wP' || illegal.a5 || !illegal.shown || illegal.floating) problems.push('an illegal drop was not snapped back: ' + JSON.stringify(illegal));
    await mouseDrag('coachBoard', 'e2', 'e4');
    await page.waitForFunction(() => coachGame.history().length >= 1, null, { timeout: 5000 }).catch(() => {});
    const dragged = await page.evaluate(() => coachGame.history()[0] || null);
    if (dragged !== 'e4') problems.push('a dragged e2-e4 was not played: ' + dragged);
    await page.waitForFunction(() => coachGame.history().length >= 2 && !coachThinking, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    if (!(await boardMatchesGame())) problems.push('the board does not show the game after the reply');
    await sq('g1').click();
    const selected = await page.evaluate(() => ({ sel: coachBoard.marks('tap-selected').join(), dots: coachBoard.marks('tap-target').sort().join(),
      drawn: document.querySelectorAll('#coachBoard .board-mark.tap-target').length }));
    if (selected.sel !== 'g1' || selected.dots !== 'e2,f3,h3' || selected.drawn !== 3) problems.push('clicking a piece did not select it with its legal moves: ' + JSON.stringify(selected));
    // Another of your own pieces switches the selection; a second click on it drops it.
    await sq('b1').click();
    await sq('d2').click();
    const switched = await page.evaluate(() => ({ sel: coachBoard.marks('tap-selected').join(), plies: coachGame.history().length, premove: !!coachPremove }));
    if (switched.sel !== 'd2' || switched.plies !== 2 || switched.premove) problems.push('clicking your own piece did not switch the selection: ' + JSON.stringify(switched));
    await sq('d2').click();
    if (await page.evaluate(() => coachBoard.marks('tap-selected').length)) problems.push('a second click did not drop the selection');
    await sq('g1').click();
    await sq('f3').click();
    await page.waitForFunction(() => coachGame.history().length >= 3, null, { timeout: 5000 }).catch(() => {});
    const clicked = await page.evaluate(() => ({ third: coachGame.history()[2] || null, marks: coachBoard.marks('tap-selected').length + coachBoard.marks('tap-target').length }));
    if (clicked.third !== 'Nf3' || clicked.marks) problems.push('a clicked g1-f3 was not played cleanly: ' + JSON.stringify(clicked));
    await page.waitForFunction(() => coachGame.history().length >= 4 && !coachThinking, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    const plies = await page.evaluate(() => coachGame.history().length);
    if (plies !== 4) problems.push('one click played more than one move: ' + plies + ' plies');
    if (!(await boardMatchesGame())) problems.push('the board does not show the game after a clicked move');
    // The opponent's replies vary, and some make d4 illegal (2...Bb4 pins the
    // d-pawn, ...Nd4 blocks it), so type a quiet pawn move that is legal here.
    const keyMove = await page.evaluate(() => {
      const legal = coachGame.moves({ verbose: true });
      return ['d4', 'd3', 'h3', 'a3', 'b3'].map(san => legal.find(m => m.san === san)).find(Boolean) || legal.find(m => !m.captured) || legal[0];
    });
    await playMove(keyMove.san);
    await page.waitForFunction(() => coachGame.history().length >= 5, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(250);
    const typed = await page.evaluate(to => ({ fifth: coachGame.history()[4] || null, piece: coachBoard.position()[to] || null }), keyMove.to);
    if (typed.fifth !== keyMove.san || typed.piece !== 'w' + keyMove.piece.toUpperCase()) problems.push(`a keyboard move (${keyMove.san}) did not reach the board: ` + JSON.stringify(typed));
    await settle();
    return problems;
  });

  await check('flipping turns the board and its coordinates, also mid-animation', async () => {
    const problems = [];
    const read = () => page.evaluate(() => {
      const r = s => document.querySelector(`#coachBoard .square[data-square="${s}"]`).getBoundingClientRect();
      return { o: coachBoard.orientation(), a1Top: r('a1').top < r('a8').top, h1Left: r('h1').left < r('a1').left,
        files: [...document.querySelectorAll('#coachBoard .board-coord.file')].map(t => t.textContent).join(''),
        ranks: [...document.querySelectorAll('#coachBoard .board-coord.rank')].map(t => t.textContent).join('') };
    });
    await page.locator('#btn-coach-flip').click();
    const flipped = await read();
    if (flipped.o !== 'black' || !flipped.a1Top || !flipped.h1Left || flipped.files !== 'hgfedcba' || flipped.ranks !== '12345678') problems.push('flip did not turn the board: ' + JSON.stringify(flipped));
    await page.locator('#btn-coach-flip').click();
    const back = await read();
    if (back.o !== 'white' || back.a1Top || back.h1Left || back.files !== 'abcdefgh' || back.ranks !== '87654321') problems.push('flipping back did not restore White at the bottom: ' + JSON.stringify(back));
    // Flips requested while pieces are still moving wait for them and settle.
    await page.evaluate(() => { coachBoard.position('start', true); coachBoard.flip(); coachBoard.flip(); coachBoard.flip(); });
    await page.waitForTimeout(800);
    const queued = await read();
    if (queued.o !== 'black' || !queued.a1Top || queued.files !== 'hgfedcba') problems.push('flips during an animation did not settle: ' + JSON.stringify(queued));
    await page.evaluate(() => { coachBoard.flip(); coachBoard.position(coachGame.fen(), false); });
    await page.waitForTimeout(400);
    return problems;
  });

  await check('board themes recolour the squares from the tokens', async () => {
    const problems = [];
    await openSettings(page, 'appearance');
    const seen = new Set();
    for (const theme of ['green', 'walnut', 'blue', 'contrast']) {
      await page.locator('#board-theme').selectOption(theme);
      const colours = await page.evaluate(() => {
        const probe = document.createElement('div');
        document.body.appendChild(probe);
        probe.style.background = 'var(--board-light)';
        const light = getComputedStyle(probe).backgroundColor;
        probe.style.background = 'var(--board-dark)';
        const dark = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { light, dark, squareLight: getComputedStyle(document.querySelector('#coachBoard .square.white[data-square="b1"]')).fill,
          squareDark: getComputedStyle(document.querySelector('#coachBoard .square.black[data-square="a1"]')).fill };
      });
      if (colours.squareLight !== colours.light || colours.squareDark !== colours.dark) problems.push(`${theme}: squares ${colours.squareLight}/${colours.squareDark} do not match the tokens ${colours.light}/${colours.dark}`);
      seen.add(colours.squareLight + colours.squareDark);
    }
    if (seen.size !== 4) problems.push('the four board themes did not give four different boards');
    await page.locator('#board-theme').selectOption('green');
    await closeSettings(page);
    return problems;
  });

  await check('castling, en passant and promotion are redrawn after the move', async () => {
    const problems = [];
    await page.goto(base + '/?view=library&mode=explore');
    await page.waitForFunction(() => typeof exploreGame !== 'undefined' && exploreGame && !!board);
    await page.locator('#explore-engine-toggle').uncheck().catch(() => {});
    await page.locator('.explore-load summary').click();
    const load = async fen => {
      await page.locator('#explore-load-input').fill(fen);
      await page.locator('#explore-load-form button').click();
      await page.waitForFunction(f => exploreGame.fen() === f, fen, { timeout: 5000 });
      await page.waitForTimeout(150);
    };
    const shown = () => page.evaluate(() => board.position());
    await load('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    await mouseDrag('myBoard', 'e1', 'g1');
    await page.waitForTimeout(400);
    let pos = await shown();
    if (pos.g1 !== 'wK' || pos.f1 !== 'wR' || pos.h1 || pos.e1) problems.push('castling by drag left the rook behind: ' + JSON.stringify({ e1: pos.e1, f1: pos.f1, g1: pos.g1, h1: pos.h1 }));
    await load('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    await boardSquare(page, 'myBoard', 'e5').click();
    await boardSquare(page, 'myBoard', 'd6').click();
    await page.waitForTimeout(500);
    pos = await shown();
    if (pos.d6 !== 'wP' || pos.d5 || pos.e5) problems.push('en passant by click left the captured pawn: ' + JSON.stringify({ d5: pos.d5, d6: pos.d6, e5: pos.e5 }));
    await load('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    await mouseDrag('myBoard', 'a7', 'a8');
    await page.locator('#promotion-picker .promotion-choice[data-promotion="n"]').click();
    await page.waitForTimeout(500);
    pos = await shown();
    if (pos.a8 !== 'wN' || pos.a7) problems.push('a dragged under-promotion did not show the knight: ' + JSON.stringify({ a7: pos.a7, a8: pos.a8 }));
    await load('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    await boardSquare(page, 'myBoard', 'a7').click();
    await boardSquare(page, 'myBoard', 'a8').click();
    await page.locator('#promotion-picker .promotion-choice[data-promotion="q"]').click();
    await page.waitForTimeout(500);
    pos = await shown();
    if (pos.a8 !== 'wQ' || pos.a7) problems.push('a clicked promotion did not show the queen: ' + JSON.stringify({ a7: pos.a7, a8: pos.a8 }));
    const fenMatches = await page.evaluate(() => Chessboard.objToFen(board.position()) === exploreGame.fen().split(' ')[0]);
    if (!fenMatches) problems.push('the Explore board and game disagree after promotion');
    await page.locator('#explore-engine-toggle').check().catch(() => {});
    return problems;
  });

  // The board itself, on a scratch element: only onSnapEnd can put the rook
  // or the promoted piece where the game has it.
  await check('onSnapEnd follows each accepted drag or click, so castling and promotion are drawn from the game', async () => {
    const problems = [];
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'board-harness';
      host.style.cssText = 'position:fixed;left:24px;top:24px;width:328px;z-index:9999';
      document.body.appendChild(host);
      const h = window.__harness = { game: new Chess('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1'), snapEnds: 0, drops: [] };
      h.board = Chessboard('board-harness', {
        position: h.game.fen(), draggable: true,
        onDrop: (from, to, piece, newPos, oldPos, side, info) => {
          h.drops.push(`${from}${to}:${info.input}`);
          if (h.throwNext) { h.throwNext = false; throw new Error('harness onDrop failure'); }
          return h.game.move({ from, to, promotion: 'q' }) ? undefined : 'snapback'; },
        onSnapEnd: () => { h.snapEnds++; h.board.position(h.game.fen(), false); }
      });
    });
    const state = () => page.evaluate(() => ({ pos: __harness.board.position(), snapEnds: __harness.snapEnds, drops: __harness.drops.slice(), fenOk: Chessboard.objToFen(__harness.board.position()) === __harness.game.fen().split(' ')[0] }));
    try {
      await mouseDrag('board-harness', 'e1', 'g1');
      await page.waitForTimeout(400);
      let s = await state();
      if (s.pos.f1 !== 'wR' || s.pos.h1 || s.snapEnds !== 1 || !s.fenOk) problems.push('dragged castling was not redrawn by onSnapEnd: ' + JSON.stringify({ f1: s.pos.f1, h1: s.pos.h1, snapEnds: s.snapEnds }));
      await boardSquare(page, 'board-harness', 'e8').click();
      await boardSquare(page, 'board-harness', 'c8').click();
      await page.waitForTimeout(500);
      s = await state();
      if (s.pos.d8 !== 'bR' || s.pos.a8 || s.snapEnds !== 2 || !s.fenOk || s.drops[1] !== 'e8c8:click') problems.push('clicked castling was not redrawn by onSnapEnd: ' + JSON.stringify({ d8: s.pos.d8, a8: s.pos.a8, snapEnds: s.snapEnds, drops: s.drops }));
      await mouseDrag('board-harness', 'a2', 'a5');
      await page.waitForTimeout(300);
      s = await state();
      if (s.pos.a2 !== 'wP' || s.pos.a5 || s.snapEnds !== 2 || s.drops[2] !== 'a2a5:drag') problems.push('a refused drop moved the piece or called onSnapEnd: ' + JSON.stringify({ a2: s.pos.a2, a5: s.pos.a5, snapEnds: s.snapEnds }));
      // Clicking another of your own pieces changes the selection; onDrop
      // never hears of it.
      await boardSquare(page, 'board-harness', 'b2').click();
      await boardSquare(page, 'board-harness', 'c2').click();
      s = await state();
      const selected = await page.evaluate(() => __harness.board.marks('tap-selected').join());
      if (s.drops.length !== 3 || selected !== 'c2') problems.push('clicking another own piece reached onDrop instead of switching the selection: ' + JSON.stringify({ drops: s.drops, selected }));
      await boardSquare(page, 'board-harness', 'c2').click();
      // Dragging onto your own piece is deliberate (a recapture premove in
      // Coach): onDrop hears of it, and a refusal leaves both pieces home.
      await mouseDrag('board-harness', 'b2', 'c2');
      await page.waitForTimeout(300);
      s = await state();
      if (s.drops[3] !== 'b2c2:drag' || s.pos.b2 !== 'wP' || s.pos.c2 !== 'wP' || s.snapEnds !== 2 || !s.fenOk) problems.push('a drag onto an own piece did not reach onDrop or moved a piece: ' + JSON.stringify({ drops: s.drops, b2: s.pos.b2, c2: s.pos.c2, snapEnds: s.snapEnds }));
      // A handler that throws sends the piece home, reports the error and
      // leaves the board ready for the next move.
      await page.evaluate(() => { __harness.throwNext = true; });
      await mouseDrag('board-harness', 'b2', 'b3');
      await page.waitForTimeout(300);
      const afterThrow = (await state()).pos;
      await mouseDrag('board-harness', 'b2', 'b4');
      await page.waitForTimeout(300);
      s = await state();
      const thrown = pageErrors.findIndex(e => e.startsWith('Error: harness onDrop failure'));
      if (thrown === -1) problems.push('an onDrop error was swallowed');
      else pageErrors.splice(thrown, 1);
      if (afterThrow.b2 !== 'wP' || afterThrow.b3 || s.pos.b4 !== 'wP' || !s.fenOk) problems.push('a throwing onDrop left the board stuck or wrong: ' + JSON.stringify({ b2: afterThrow.b2, b3: afterThrow.b3, b4: s.pos.b4 }));
      await page.evaluate(() => { __harness.game = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1'); __harness.board.position(__harness.game.fen(), false); });
      await mouseDrag('board-harness', 'a7', 'a8');
      await page.waitForTimeout(300);
      s = await state();
      if (s.pos.a8 !== 'wQ' || s.pos.a7 || !s.fenOk) problems.push('a promotion was left as a pawn: ' + JSON.stringify({ a7: s.pos.a7, a8: s.pos.a8 }));
      const shown = await page.evaluate(() => document.querySelector('#board-harness .pieces g[data-square="a8"]').getAttribute('data-piece'));
      if (shown !== 'wq') problems.push('the promoted square draws ' + shown);
    } finally {
      await page.evaluate(() => { __harness.board.destroy(); document.getElementById('board-harness').remove(); delete window.__harness; });
    }
    return problems;
  });

  await check('touch: a tap selects, a second tap moves once, and a touch drag moves', async () => {
    const problems = [];
    const browser = page.context().browser();
    if (!browser) return ['no browser handle to open a touch context'];
    const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 900 } });
    try {
      const tp = await ctx.newPage();
      const errors = [];
      tp.on('pageerror', e => errors.push(e.message));
      await tp.goto(base + '/?view=coach');
      await tp.waitForFunction(() => typeof engineClient !== 'undefined' && !!coachBoard && navigator.maxTouchPoints > 0);
      await tp.locator('#btn-coach-newgame').tap();
      await tp.waitForFunction(() => coachGameActive && !coachThinking, null, { timeout: 60000 });
      const sq = name => boardSquare(tp, 'coachBoard', name);
      await sq('e2').tap();
      const sel = await tp.evaluate(() => coachBoard.marks('tap-selected').join());
      if (sel !== 'e2') problems.push('a tap did not select the pawn: ' + sel);
      await sq('e4').tap();
      await tp.waitForFunction(() => coachGame.history().length >= 1, null, { timeout: 5000 }).catch(() => {});
      await tp.waitForTimeout(400); // the emulated mouse events after a tap have arrived
      const tapped = await tp.evaluate(() => ({ first: coachGame.history()[0] || null, sel: coachBoard.marks('tap-selected').length, premove: !!coachPremove }));
      if (tapped.first !== 'e4' || tapped.sel || tapped.premove) problems.push('a tap move left a stray selection or premove: ' + JSON.stringify(tapped));
      await tp.waitForFunction(() => coachGame.history().length >= 2 && !coachThinking, null, { timeout: 60000 });
      await tp.waitForTimeout(300);
      const cdp = await ctx.newCDPSession(tp);
      const a = await squareCentre(tp, 'coachBoard', 'g1'), b = await squareCentre(tp, 'coachBoard', 'f3');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8 }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await tp.waitForFunction(() => coachGame.history().length >= 3, null, { timeout: 5000 }).catch(() => {});
      const third = await tp.evaluate(() => coachGame.history()[2] || null);
      if (third !== 'Nf3') problems.push('a touch drag g1-f3 was not played: ' + third);
      await tp.waitForFunction(() => coachGame.history().length >= 4 && !coachThinking, null, { timeout: 60000 }).catch(() => {});
      await tp.waitForTimeout(300);
      const end = await tp.evaluate(() => ({ plies: coachGame.history().length, same: Chessboard.objToFen(coachBoard.position()) === coachGame.fen().split(' ')[0] }));
      if (end.plies !== 4 || !end.same) problems.push('touch input moved twice or the board drifted from the game: ' + JSON.stringify(end));
      if (errors.length) problems.push('page errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
    return problems;
  });

  await check('touch: a tapped promotion keeps its picker open and a slow tap leaves nothing selected', async () => {
    const problems = [];
    const browser = page.context().browser();
    if (!browser) return ['no browser handle to open a touch context'];
    const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 900 } });
    try {
      const tp = await ctx.newPage();
      const errors = [];
      tp.on('pageerror', e => errors.push(e.message));
      const cdp = await ctx.newCDPSession(tp);
      // A tap held past the 200 ms move animation: the browser's emulated
      // mouse events then land on the piece that just moved.
      const slowTap = async (id, name) => {
        const c = await squareCentre(tp, id, name);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
        await tp.waitForTimeout(350);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      // Explore: tap the pawn, then the empty promotion square.
      await tp.goto(base + '/?opening=italian&mode=explore');
      await tp.waitForFunction(() => exploreMode && !!board);
      await tp.locator('.explore-load summary').tap();
      await tp.locator('#explore-load-input').fill('8/P6k/8/8/8/8/8/K7 w - - 0 1');
      await tp.locator('#explore-load-form button[type=submit]').tap();
      await tp.waitForFunction(() => exploreGame && exploreGame.fen().startsWith('8/P6k'));
      await boardSquare(tp, 'myBoard', 'a7').tap();
      await slowTap('myBoard', 'a8');
      await tp.waitForTimeout(400);
      const open = await tp.evaluate(() => document.getElementById('promotion-picker').getAttribute('aria-hidden') === 'false');
      if (!open) problems.push('the promotion picker closed straight after the tap that opened it');
      else {
        await tp.locator('.promotion-choice[data-promotion="n"]').tap();
        await tp.waitForTimeout(300);
        const promoted = await tp.evaluate(() => board.position().a8);
        if (promoted !== 'wN') problems.push('choosing a knight did not promote to a knight: ' + promoted);
      }
      // Coach: a slow tap on the target plays the move and selects nothing.
      await tp.goto(base + '/?view=coach');
      await tp.waitForFunction(() => typeof engineClient !== 'undefined' && !!coachBoard);
      await tp.locator('#btn-coach-newgame').tap();
      await tp.waitForFunction(() => coachGameActive && !coachThinking, null, { timeout: 60000 });
      await boardSquare(tp, 'coachBoard', 'd2').tap();
      await slowTap('coachBoard', 'd4');
      await tp.waitForTimeout(400);
      const after = await tp.evaluate(() => ({ first: coachGame.history()[0] || null, sel: coachBoard.marks('tap-selected').join(), premove: !!coachPremove }));
      if (after.first !== 'd4' || after.sel || after.premove) problems.push('a slow tap left the moved piece selected or a premove queued: ' + JSON.stringify(after));
      await tp.waitForFunction(() => !coachThinking, null, { timeout: 60000 }).catch(() => {});
      if (errors.length) problems.push('page errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
    return problems;
  });

  await check('startup stays within its main-thread budget', async () => {
    // Replaying every opening line at startup once blocked the page for
    // ~450 ms on a fast desktop. Budget: under 350 ms of blocking time (the
    // part of each long task over 50 ms), loose enough for a slow CI runner.
    const problems = [];
    const browser = page.context().browser();
    if (!browser) return ['no browser handle to open a fresh context'];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const fp = await ctx.newPage();
      await fp.addInitScript(() => {
        window.__longTasks = [];
        try { new PerformanceObserver(list => list.getEntries().forEach(e => window.__longTasks.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
      });
      for (const view of ['?view=coach', '?opening=italian', '?view=puzzles']) {
        await fp.goto(base + '/' + view, { waitUntil: 'load' });
        await fp.waitForTimeout(1500);
        const tasks = await fp.evaluate(() => window.__longTasks);
        const blocking = tasks.reduce((sum, d) => sum + Math.max(0, d - 50), 0);
        if (blocking >= 350) problems.push(`${view} blocked the main thread for ${blocking} ms at startup (long tasks: ${tasks.join(', ')} ms)`);
      }
    } finally {
      await ctx.close();
    }
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
    await page.evaluate(() => { coachPracticeSession = null; });
    await openSettings(page, 'appearance');
    await page.locator('#board-feedback-toggle').uncheck();
    s = await state();
    if (s.arrows || s.badges.length || s.bar) problems.push('turning board feedback off did not clear it');
    await closeSettings(page);
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

  // ── Settings sheet (src/ui/settings.js) and the router (src/ui/router.js) ──
  const sheetState = p => p.evaluate(() => {
    const d = document.getElementById('settings-sheet');
    const a = document.activeElement;
    return {
      open: !!d && d.open && d.checkVisibility(), modal: !!d && d.matches(':modal'), section: window.SettingsSheet ? SettingsSheet.section() : null,
      focus: a && a.id, inside: !!d && d.contains(a), url: location.search,
      expanded: document.getElementById('btn-settings') && document.getElementById('btn-settings').getAttribute('aria-expanded')
    };
  });

  await check('Settings opens from the gear and the , key as a modal, traps focus, and closes back to where it was opened', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof coachBoard !== 'undefined' && !!coachBoard);
    if (!(await page.locator('#btn-settings').count())) return ['there is no Settings gear in the app bar'];
    await page.locator('#btn-settings').click();
    let s = await sheetState(page);
    expect(problems, s.open && s.modal, 'the gear did not open a modal Settings dialog: ' + JSON.stringify(s));
    expect(problems, s.inside && s.focus === 'settings-tab-appearance', 'focus did not move into Settings: ' + s.focus);
    expect(problems, s.expanded === 'true', 'the gear does not say Settings is open');
    expect(problems, /(^|&|\?)settings=appearance/.test(s.url), 'the address does not name the open section: ' + s.url);
    const semantics = await page.evaluate(() => {
      const d = document.getElementById('settings-sheet');
      const label = document.getElementById(d.getAttribute('aria-labelledby'));
      return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), name: label && label.textContent.trim() };
    });
    expect(problems, semantics.role === 'dialog' && semantics.modal === 'true' && semantics.name === 'Settings', 'dialog semantics: ' + JSON.stringify(semantics));
    // Tab and Shift+Tab stay inside, past the last and first controls.
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press(key);
        if (!(await sheetState(page)).inside) { problems.push(`${key} left Settings after ${i + 1} presses`); break; }
      }
    }
    // Arrow keys move between sections; the view's own keys do not reach the board.
    await page.locator('#settings-tab-appearance').focus();
    await page.keyboard.press('ArrowRight');
    s = await sheetState(page);
    const panels = await page.evaluate(() => ['appearance', 'account', 'data'].map(n => !document.getElementById('settings-' + n).hidden));
    expect(problems, s.focus === 'settings-tab-account' && s.section === 'account' && panels.join() === 'false,true,false', 'ArrowRight did not move to Account: ' + JSON.stringify({ s, panels }));
    expect(problems, /settings=account/.test(s.url), 'changing section did not update the address: ' + s.url);
    const orientation = await page.evaluate(() => coachBoard.orientation());
    await page.keyboard.press('f');
    expect(problems, await page.evaluate(() => coachBoard.orientation()) === orientation, 'F flipped the board behind Settings');
    // Escape closes, hands focus back to the gear and clears the address.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !SettingsSheet.isOpen()).catch(() => {});
    await page.waitForTimeout(150);
    s = await sheetState(page);
    expect(problems, !s.open && s.focus === 'btn-settings' && !/settings=/.test(s.url) && s.expanded === 'false', 'Escape did not close Settings back to the gear: ' + JSON.stringify(s));
    // , opens and closes; not while typing.
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press(',');
    s = await sheetState(page);
    expect(problems, s.open && s.inside, ', did not open Settings: ' + JSON.stringify(s));
    await page.keyboard.press(',');
    await page.waitForTimeout(150);
    expect(problems, !(await sheetState(page)).open, ', did not close Settings again');
    await page.locator('#coach-keyboard-move').evaluate(el => { el.open = true; });
    await page.locator('#coach-keyboard-move-input').focus();
    await page.keyboard.press(',');
    expect(problems, !(await sheetState(page)).open, ', in a text field opened Settings');
    await page.locator('#coach-keyboard-move-input').fill('');
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('?');
    const listed = await page.locator('#shortcut-sheet').textContent();
    expect(problems, /,\s*Open Settings/.test(listed), 'the shortcut sheet does not list , for Settings');
    await page.keyboard.press('Escape');
    // A press on the backdrop closes it; the Coach rail's way in opens at Account.
    await page.locator('#btn-settings').click();
    await page.mouse.click(12, 450);
    await page.waitForTimeout(150);
    expect(problems, !(await sheetState(page)).open, 'a press on the backdrop did not close Settings');
    await page.locator('#btn-coach-settings').click();
    s = await sheetState(page);
    expect(problems, s.open && s.section === 'account', 'the Coach rail link did not open Settings → Account: ' + JSON.stringify(s));
    await page.locator('#btn-settings-close').click();
    await page.waitForTimeout(150);
    s = await sheetState(page);
    expect(problems, !s.open && s.focus === 'btn-coach-settings', 'closing did not return focus to the rail link: ' + s.focus);
    return problems;
  });

  await check('Settings holds working Appearance, Account and Training data controls', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof coachBoard !== 'undefined' && !!coachBoard);
    if (!(await page.evaluate(() => !!window.SettingsSheet && !!document.getElementById('settings-sheet')))) return ['there is no Settings sheet'];
    await page.evaluate(() => { localStorage.removeItem('ui:theme'); localStorage.removeItem('coach:sound:v1'); localStorage.removeItem('ui:board-feedback'); });
    await openSettings(page, 'appearance');
    const inSheet = ids => page.evaluate(list => list.filter(id => !document.getElementById('settings-sheet').contains(document.getElementById(id))), ids);
    const outside = await inSheet(['color-theme', 'board-theme', 'coach-sound-toggle', 'board-feedback-toggle', 'coach-auth-card', 'coach-auth-email', 'btn-coach-sync', 'btn-account-resume', 'training-data-card', 'btn-export-training-data', 'btn-import-training-data', 'training-data-last-backup']);
    expect(problems, !outside.length, 'controls not in Settings: ' + outside.join(', '));
    await page.locator('#color-theme').selectOption('dark');
    expect(problems, await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'Dark did not set data-theme');
    await page.locator('#color-theme').selectOption('light');
    expect(problems, await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'Light did not set data-theme');
    await page.locator('#color-theme').selectOption('auto');
    expect(problems, await page.evaluate(() => !document.documentElement.hasAttribute('data-theme') && localStorage.getItem('ui:theme') === null), 'Match device did not hand the theme back to the device');
    await page.locator('#board-theme').selectOption('walnut');
    expect(problems, await page.evaluate(() => document.documentElement.dataset.boardTheme) === 'walnut', 'board colours did not change');
    await page.locator('#board-theme').selectOption('green');
    await page.locator('#coach-sound-toggle').check();
    expect(problems, await page.evaluate(() => coachSoundEnabled && localStorage.getItem('coach:sound:v1') === '1'), 'Move sounds did not turn on');
    await page.locator('#coach-sound-toggle').uncheck();
    // Account: the sign-in form sends a link (the auth service is the boundary).
    await openSettings(page, 'account');
    let otp = 0;
    await page.route('**/auth/v1/otp**', route => { otp++; route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    try {
      if (await page.locator('#coach-auth-email').isVisible()) {
        await page.locator('#coach-auth-email').fill('settings@example.com');
        await page.locator('#btn-coach-login').click();
        await page.waitForFunction(() => /Link sent/.test(document.getElementById('coach-auth-status').textContent), null, { timeout: 5000 })
          .catch(() => problems.push('Send link did not report a sent link: ' + JSON.stringify(otp)));
        expect(problems, otp === 1, 'the sign-in form sent ' + otp + ' requests');
      } else if (await page.evaluate(() => isSupabaseConfigured())) problems.push('the sign-in form is not shown in Settings → Account');
    } finally {
      await page.unroute('**/auth/v1/otp**');
      await page.evaluate(() => { try { sessionStorage.removeItem('coach:auth-pending-email'); } catch (e) {} });
    }
    // Training data: export downloads a backup and says when.
    await page.evaluate(() => { window.__settingsDownloads = []; const real = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__settingsDownloads.push(this.download); return; } return real.call(this); }; });
    await openSettings(page, 'data');
    await page.locator('#btn-export-training-data').click();
    const data = await page.evaluate(() => ({ downloads: window.__settingsDownloads, line: document.getElementById('training-data-last-backup').textContent }));
    expect(problems, data.downloads.length === 1 && data.line === 'Last backed up: today', 'Export backup from Settings: ' + JSON.stringify(data));
    await closeSettings(page);
    await page.evaluate(() => localStorage.removeItem('coach:last-backup:v1'));
    return problems;
  });

  // One state per history entry, read from what is on screen.
  const routeState = p => p.evaluate(() => {
    if (typeof appView === 'undefined') return { url: location.href, view: 'left the app' };
    const shown = id => { const el = document.getElementById(id); return !!el && el.checkVisibility(); };
    return {
      url: location.search, view: appView, marker: window.__routerMarker || 0,
      shown: ['library-view', 'coach-view', 'puzzles-view'].filter(shown).join(),
      opening: currentOpening ? currentOpening.id : null,
      activeOpening: document.querySelector('.opening-btn.active') ? document.querySelector('.opening-btn.active').dataset.id : null,
      mode: quizMode ? 'quiz' : exploreMode ? 'explore' : 'study',
      quizPressed: document.getElementById('btn-quiz').getAttribute('aria-pressed'),
      move: currentMoveIdx,
      puzzleMode: PuzzlesView._debug().mode,
      rushPanel: !document.getElementById('puzzle-panel-rush').hidden,
      settings: window.SettingsSheet && SettingsSheet.isOpen() ? SettingsSheet.section() : null
    };
  });

  await check('router: Back and Forward restore Library, an opening, its Quiz, Coach and Puzzle Rush without a reload', async () => {
    const problems = [];
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof PuzzlesView !== 'undefined' && !!coachBoard);
    await page.evaluate(() => { window.__routerMarker = 7; });
    await page.locator('#nav-library').click();
    await page.locator('.opening-btn[data-id="italian"]').click();
    // Study moves rewrite the entry; they are not Back steps.
    await page.locator('#btn-next').click();
    await page.locator('#btn-next').click();
    await page.locator('#btn-quiz').click();
    await page.locator('#nav-coach').click();
    await page.locator('#nav-puzzles').click();
    await page.locator('.puzzle-mode[data-mode="rush"]').click();
    const want = [
      { url: '?view=puzzles&mode=rush', view: 'puzzles', shown: 'puzzles-view', puzzleMode: 'rush', rushPanel: true },
      { url: '?view=puzzles', view: 'puzzles', shown: 'puzzles-view', puzzleMode: 'rated', rushPanel: false },
      { url: '?view=coach', view: 'coach', shown: 'coach-view' },
      { url: '?opening=italian&mode=quiz', view: 'library', shown: 'library-view', opening: 'italian', activeOpening: 'italian', mode: 'quiz', quizPressed: 'true' },
      { url: '?opening=italian&move=1', view: 'library', shown: 'library-view', opening: 'italian', activeOpening: 'italian', mode: 'study', quizPressed: 'false', move: 1 },
      { url: '?view=library', view: 'library', shown: 'library-view', opening: null, activeOpening: null, mode: 'study' },
      { url: '?view=coach', view: 'coach', shown: 'coach-view' }
    ];
    const compare = (label, got, expected) => {
      const wrong = Object.keys(expected).filter(k => got[k] !== expected[k]);
      if (wrong.length) problems.push(`${label}: ${wrong.map(k => `${k} ${JSON.stringify(got[k])} (wanted ${JSON.stringify(expected[k])})`).join(', ')}`);
      if (got.marker !== 7) problems.push(label + ': the page reloaded');
    };
    compare('after the clicks', await routeState(page), want[0]);
    for (let i = 1; i < want.length; i++) {
      await page.goBack();
      await page.waitForTimeout(250);
      compare('Back ' + i, await routeState(page), want[i]);
      if (problems.length > 3) return problems;
    }
    for (let i = want.length - 2; i >= 0; i--) {
      await page.goForward();
      await page.waitForTimeout(250);
      compare('Forward to ' + want[i].url, await routeState(page), want[i]);
      if (problems.length > 3) return problems;
    }
    return problems;
  });

  await check('router: opening Settings is a history entry; Back closes it and Forward reopens it', async () => {
    const problems = [];
    await page.goto(base + '/?opening=italian');
    await page.waitForFunction(() => typeof currentOpening !== 'undefined' && !!currentOpening);
    if (!(await page.locator('#btn-settings').count())) return ['there is no Settings gear to open'];
    await page.evaluate(() => { window.__routerMarker = 9; });
    const length = await page.evaluate(() => history.length);
    await page.locator('#btn-settings').click();
    await page.locator('#settings-tab-data').click();
    let s = await routeState(page);
    expect(problems, s.settings === 'data' && s.url === '?opening=italian&settings=data', 'Settings → Training data: ' + JSON.stringify(s));
    expect(problems, await page.evaluate(() => history.length) === length + 1, 'opening Settings and changing section should add exactly one entry');
    await page.goBack();
    await page.waitForTimeout(250);
    s = await routeState(page);
    expect(problems, s.settings === null && s.url === '?opening=italian' && s.view === 'library' && s.opening === 'italian' && s.marker === 9, 'Back did not close Settings over the opening: ' + JSON.stringify(s));
    expect(problems, await page.evaluate(() => document.activeElement && document.activeElement.id) === 'btn-settings', 'Back did not return focus to the gear');
    await page.goForward();
    await page.waitForTimeout(250);
    s = await routeState(page);
    expect(problems, s.settings === 'data' && s.url === '?opening=italian&settings=data', 'Forward did not reopen Settings at Training data: ' + JSON.stringify(s));
    // Closing goes back to the entry underneath, so Back after closing leaves.
    await page.locator('#btn-settings-close').click();
    await page.waitForFunction(() => !/settings=/.test(location.search));
    expect(problems, await page.evaluate(() => history.length) === length + 1 && (await routeState(page)).url === '?opening=italian', 'closing Settings did not step back to the opening');
    return problems;
  });

  await check('deep links: old ?view=, ?opening= and mode= links, and ?settings=, load the place they name', async () => {
    const problems = [];
    const cases = [
      ['/', { url: '?view=coach', view: 'coach', shown: 'coach-view' }],
      ['/?view=coach', { url: '?view=coach', view: 'coach', shown: 'coach-view' }],
      ['/?view=puzzles&mode=rush', { url: '?view=puzzles&mode=rush', view: 'puzzles', shown: 'puzzles-view' }],
      ['/?opening=italian&mode=quiz', { url: '?opening=italian&mode=quiz', view: 'library', opening: 'italian', mode: 'quiz' }],
      ['/?opening=italian&move=3', { url: '?opening=italian&move=3', view: 'library', opening: 'italian', mode: 'study', move: 3 }],
      ['/?view=library&mode=explore', { url: '?view=library&mode=explore', view: 'library', opening: null, mode: 'explore' }],
      ['/?mode=explore', { url: '?view=library&mode=explore', view: 'library', mode: 'explore' }],
      ['/?opening=no-such-opening', { url: '?view=coach', view: 'coach', shown: 'coach-view' }],
      ['/?view=coach&settings=account', { url: '?view=coach&settings=account', view: 'coach', settings: 'account' }],
      ['/?view=puzzles&mode=vision&settings=appearance', { url: '?view=puzzles&mode=vision&settings=appearance', view: 'puzzles', settings: 'appearance' }]
    ];
    for (const [path, expected] of cases) {
      // A page that loads from a link adds no history entries of its own.
      await page.goto(base + '/health.html');
      await page.goto(base + path);
      const ready = await page.waitForFunction(() => typeof PuzzlesView !== 'undefined' && typeof appView === 'string' && (appView !== 'coach' || !!coachBoard), null, { timeout: 10000 }).then(() => true, () => false);
      if (!ready) problems.push(path + ': the page did not finish setting up its view');
      await page.waitForTimeout(250);
      const got = await routeState(page);
      const wrong = Object.keys(expected).filter(k => got[k] !== expected[k]);
      if (wrong.length) problems.push(`${path}: ${wrong.map(k => `${k} ${JSON.stringify(got[k])}`).join(', ')}`);
      if (expected.settings) {
        const open = await sheetState(page);
        if (!open.open || !open.inside) problems.push(path + ': Settings is not open with focus inside');
      }
      await page.goBack();
      if (!/health/.test(page.url())) problems.push(path + ': loading the link added a history entry (Back went to ' + page.url().replace(base, '') + ')');
    }
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
    await page.evaluate(() => { const b = document.getElementById('btn-coach-takeback'); b.disabled = false; b.click(); });
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
      await page.waitForFunction(() => !coachPracticeSession.grading && /could not verify/.test(document.getElementById('coach-practice-status').textContent), null, { timeout: 30000 })
        .catch(() => problems.push('setup: the first attempt should be ungraded while the engine is down'));
      if (await page.evaluate(() => window.__practiceSearches) > 2) problems.push('a failed retry analysed again in a loop');
      await playMove('d4');
      await page.waitForFunction(() => !coachPracticeSession.grading && !/could not verify|Checking/.test(document.getElementById('coach-practice-status').textContent), null, { timeout: 60000 })
        .catch(() => problems.push('the second attempt was not graded: analysis was never retried'));
      if (await page.evaluate(() => window.__practiceSearches) < 3) problems.push('the practice position was not analysed again on the next attempt');
    } finally {
      await page.evaluate(() => { engineClient.evaluate = window.__realEvaluate; if (coachPracticeSession) exitCoachPractice(); });
    }
    return problems;
  });

  await check('a practice move made on the board is drawn once it is graded', async () => {
    const problems = [];
    await freshCoach();
    await page.evaluate(() => {
      startCoachPractice({ id: 'drill-board-drag', tag: 'development', meta: INSIGHT_TAG_META.development,
        entry: { fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', bestUci: 'e2e4', bestSan: 'e4', userSan: 'a3', pairNum: 1, ply: 1 } });
    });
    try {
      await page.waitForFunction(() => coachPracticeSession && coachPracticeSession.analysisReady, null, { timeout: 30000 });
      await mouseDrag('coachBoard', 'e2', 'e4');
      // The drill may play the opponent's follow-up reply straight away.
      await page.waitForFunction(() => coachPracticeSession && !coachPracticeSession.grading && coachGame.history()[0] === 'e4', null, { timeout: 30000 })
        .catch(() => problems.push('setup: the dragged best move was not accepted'));
      await page.waitForTimeout(500);
      const shown = await page.evaluate(() => ({ board: Chessboard.objToFen(coachBoard.position()), game: coachGame.fen().split(' ')[0] }));
      if (shown.board !== shown.game) problems.push('the board still shows the old position after a graded drag: ' + JSON.stringify(shown));
    } finally {
      await page.evaluate(() => { if (coachPracticeSession) exitCoachPractice(); });
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

  await check('a Daily Sprint day saved stuck shows its real state straight after reload', async () => {
    const problems = [];
    await freshCoach();
    // Days saved before drills and moves shared one completion check:
    // yesterday reached its target without completedAt, and today opened
    // live play with drills still owed ("0 moves remain").
    await page.evaluate(() => {
      const now = Date.now();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const moves = Array.from({ length: 6 }, (_, i) => `g:${i + 1}`);
      const base = { mode: 'adaptive', focusTag: 'development', focus: 'Slow development', focusCue: 'Develop a piece.', focusReason: 'Recent reviews.',
        moveTarget: 6, movesCompleted: 6, moveIds: moves, target: 8, completedAt: null, takeaway: null };
      const history = { v: 1, days: {
        [dailySprintDayKey(yesterday.getTime())]: Object.assign({}, base, { phase: 'drills', drillTarget: 2, drillsCompleted: 2, drillIds: ['a', 'b'], completedUnits: 6,
          startedAt: yesterday.getTime() - 3600000, updatedAt: yesterday.getTime() }),
        [dailySprintDayKey(now)]: Object.assign({}, base, { phase: 'moves', drillTarget: 2, drillsCompleted: 0, drillIds: [], completedUnits: 6,
          startedAt: now - 120000, updatedAt: now - 120000 })
      } };
      saveDailySprintHistory(history);
    });
    await page.goto(base + '/?view=coach');
    await page.waitForFunction(() => typeof dailySprintToday === 'function' && document.getElementById('coach-daily-plan-title').textContent.trim().length > 0);
    const shown = await page.evaluate(() => ({
      title: document.getElementById('coach-daily-plan-title').textContent,
      detail: document.getElementById('coach-daily-plan-detail').textContent,
      streak: document.getElementById('daily-sprint-streak').textContent,
      today: dailySprintToday(),
      days: Object.values(loadDailySprintHistory().days).map(day => ({ phase: day.phase, done: !!day.completedAt }))
    }));
    // No drills are due in a fresh browser, so today's owed drills are
    // removed and its six moves complete it.
    if (!/training complete/.test(shown.title)) problems.push(`today should show as complete after reload: ${shown.title} — ${shown.detail}`);
    if (/0 reviewed moves remain/.test(shown.detail)) problems.push('the stuck "0 reviewed moves remain" state survived a reload');
    if (!shown.today || !shown.today.completedAt) problems.push('today\'s settled state was not saved: ' + JSON.stringify(shown.today));
    if (shown.days.some(day => !day.done)) problems.push('a stuck saved day was left incomplete: ' + JSON.stringify(shown.days));
    if (shown.streak !== '2-day streak') problems.push(`the settled days should count in the streak: ${shown.streak}`);
    await freshCoach();
    return problems;
  });

  await check('opening rehearsals count only unaided solves as correct', async () => {
    const problems = [];
    await freshCoach();
    const rows = await page.evaluate(() => {
      const item = openingBridgeItem(OPENINGS.find(opening => opening.id === 'italian'));
      const rowText = () => {
        renderOpeningBridgeTrack();
        const row = Array.from(document.querySelectorAll('#opening-bridge-list .opening-bridge-row'))
          .find(el => el.querySelector('strong') && el.querySelector('strong').textContent === item.meta.title);
        return row ? row.querySelector('.opening-bridge-copy span').textContent : null;
      };
      // Solved after a hint, then solved cleanly.
      recordPracticeAttempt(item, true, true);
      const hinted = rowText();
      const record = loadPracticeProgress();
      record.records[item.id].dueAt = 0;
      savePracticeProgress(record);
      recordPracticeAttempt(item, true, false);
      return { hinted, both: rowText() };
    });
    if (!rows.hinted) problems.push('the Italian rehearsal row was not shown');
    else {
      if (/1\/1 correct/.test(rows.hinted)) problems.push('a hinted solve was reported as correct: ' + rows.hinted);
      if (!/0\/1 correct unaided/.test(rows.hinted) || !/1 completed with a hint or answer/.test(rows.hinted)) problems.push('the hinted solve should be named apart: ' + rows.hinted);
      if (!/1\/2 correct unaided, 1 completed with a hint or answer/.test(rows.both || '')) problems.push('a clean solve after a hinted one should read 1/2 correct: ' + rows.both);
    }
    await freshCoach();
    return problems;
  });

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
    await page.evaluate(() => document.querySelector('.opening-btn[data-id="sicilian"]').click());
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
      window.__realFetch = window.fetch;
      window.fetch = (url, init) => String(url).startsWith('https://explorer.lichess.ovh/')
        ? Promise.resolve(new Response('{}', { status: 429 }))
        : window.__realFetch(url, init);
      exploreCache.clear();
      fetchExploreData();
    });
    await page.waitForFunction(() => !/Fetching/.test(document.getElementById('continuations-list').textContent), null, { timeout: 3000 }).catch(() => {});
    const text = await page.evaluate(() => document.getElementById('continuations-list').textContent);
    if (!/limiting requests/.test(text) || /Could not reach/.test(text)) problems.push('a 429 was shown as: ' + text);
    await page.evaluate(() => { window.fetch = window.__realFetch; sessionStorage.removeItem(LICHESS_TOKEN_KEY); });
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
      const text = document.getElementById('coach-opening-name').textContent;
      if (!/out of book after move 5$/.test(text)) problems.push('5.Nc3 is a book move, so the label should say move 5: ' + text);
    } finally {
      coachGame = saved.game; coachOpeningTransfer = saved.transfer; coachReviewCursor = saved.cursor;
      updateOpeningLabel();
    }
    return problems;
  }));

  // ── Responsive layout (Phase 6a): phone, upright tablet, landscape tablet ──
  // Fresh contexts at each size; the layout is CSS plus src/ui/layout.js, so
  // these drive the real pages and measure what is on screen.
  const layoutReport = (p, boardId) => p.evaluate(id => {
    const board = document.getElementById(id);
    const r = board ? board.getBoundingClientRect() : null;
    // Visible elements that stick out sideways (for the failure message).
    const wide = [...document.querySelectorAll('body *')].filter(el => {
      if (!el.checkVisibility || !el.checkVisibility()) return false;
      if (el.closest('.notation-strip .movelist, .notation-strip .move-list, .cat-tabs, .game-viewer-moves')) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1);
    }).slice(0, 4).map(el => (el.id ? '#' + el.id : String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className)) + ' ' + Math.round(el.getBoundingClientRect().left) + '..' + Math.round(el.getBoundingClientRect().right));
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth, board: r && { left: r.left, right: r.right, width: r.width }, wide };
  }, boardId);
  const fitProblems = (where, m, minBoard) => {
    const out = [];
    if (m.scrollWidth > m.innerWidth) out.push(`${where}: the page scrolls sideways (${m.scrollWidth} > ${m.innerWidth}; ${m.wide.join(', ')})`);
    if (!m.board || !m.board.width) out.push(`${where}: no board on screen`);
    else {
      if (m.board.left < -0.5 || m.board.right > m.innerWidth + 0.5) out.push(`${where}: the board runs off the screen (${Math.round(m.board.left)}..${Math.round(m.board.right)})`);
      if (m.board.width < minBoard) out.push(`${where}: the board is ${Math.round(m.board.width)}px wide, expected at least ${minBoard}`);
    }
    return out;
  };
  const sizedContext = async (width, height, touch) => {
    const browser = page.context().browser();
    return browser.newContext({ viewport: { width, height }, hasTouch: !!touch });
  };

  await check('responsive: Coach, Library and Puzzles fit 375, 820 and 1024 wide with the whole board on screen', async () => {
    const problems = [];
    if (!page.context().browser()) return ['no browser handle to open a sized context'];
    // [width, height, touch, smallest acceptable board]
    for (const [w, h, touch, minBoard] of [[375, 812, true, 370], [820, 1180, true, 500], [1024, 768, false, 440]]) {
      const ctx = await sizedContext(w, h, touch);
      try {
        const p = await ctx.newPage();
        const errors = [];
        p.on('pageerror', e => errors.push(e.message));
        const tag = `${w}x${h}`;
        await p.goto(base + '/?view=coach');
        await p.waitForFunction(() => typeof engineClient !== 'undefined' && !!coachBoard);
        const dialog = await p.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(el => el.checkVisibility()));
        if (dialog) problems.push(`${tag}: a dialog covered the layout on arrival`);
        await p.waitForTimeout(200);
        problems.push(...fitProblems(tag + ' Coach (ready)', await layoutReport(p, 'coachBoard'), minBoard));
        await p.locator('#btn-coach-newgame').click();
        await p.waitForFunction(() => coachGameActive && !coachThinking, null, { timeout: 60000 });
        await p.evaluate(() => {
          document.getElementById('coach-keyboard-move').open = true;
          document.getElementById('coach-keyboard-move-input').value = 'e4';
          document.querySelector('#coach-keyboard-move-form button[type=submit]').click();
        });
        await p.waitForFunction(() => coachGame.history().length >= 2 && !coachThinking, null, { timeout: 60000 }).catch(() => problems.push(`${tag}: setup: the opponent did not reply`));
        // Typing a move deliberately gives up some board; close it again.
        await p.evaluate(() => { document.getElementById('coach-keyboard-move').open = false; });
        await p.waitForTimeout(400);
        problems.push(...fitProblems(tag + ' Coach (live game)', await layoutReport(p, 'coachBoard'), minBoard));
        for (const panel of ['practice', 'progress']) {
          await p.evaluate(name => document.querySelector('.panel-tab[data-panel="' + name + '"]').click(), panel);
          await p.waitForTimeout(250);
          problems.push(...fitProblems(`${tag} Coach (${panel})`, await layoutReport(p, 'coachBoard'), minBoard));
        }
        await p.goto(base + '/?opening=italian');
        await p.waitForFunction(() => !!board && !!currentOpening);
        await p.waitForTimeout(300);
        problems.push(...fitProblems(tag + ' Library (study)', await layoutReport(p, 'myBoard'), minBoard));
        await p.goto(base + '/?opening=italian&mode=explore');
        await p.waitForFunction(() => exploreMode && !!board);
        await p.waitForTimeout(800);
        problems.push(...fitProblems(tag + ' Library (explore)', await layoutReport(p, 'myBoard'), minBoard));
        await p.goto(base + '/?view=puzzles');
        await p.waitForFunction(() => { const s = window.PuzzlesView && PuzzlesView._debug().session; return s && s.phase === 'solving' && !s.busy; }, null, { timeout: 15000 });
        problems.push(...fitProblems(tag + ' Puzzles', await layoutReport(p, 'puzzleBoard'), minBoard));
        if (errors.length) problems.push(`${tag}: page errors: ${errors.join(' | ')}`);
      } finally {
        await ctx.close();
      }
    }
    return problems;
  });

  await check('phone: taps play moves in Coach, a drill, Library and Puzzles, and the bottom tab bar switches views', async () => {
    const problems = [];
    if (!page.context().browser()) return ['no browser handle to open a phone context'];
    const ctx = await sizedContext(375, 812, true);
    try {
      const tp = await ctx.newPage();
      const errors = [];
      tp.on('pageerror', e => errors.push(e.message));
      const tapMove = async (id, from, to) => {
        await boardSquare(tp, id, from).tap();
        await boardSquare(tp, id, to).tap();
      };
      const smallTargets = () => tp.evaluate(() => [...document.querySelectorAll('.top-nav-btn, [data-primary-action="true"], .ctrl-btn.primary')]
        .filter(el => el.checkVisibility() && !el.closest('.keyboard-move-form'))
        .map(el => ({ id: el.id || el.textContent.trim(), r: el.getBoundingClientRect() }))
        .filter(t => t.r.height < 44 || t.r.width < 44)
        .map(t => `${t.id} ${Math.round(t.r.width)}x${Math.round(t.r.height)}`));
      await tp.goto(base + '/?view=coach');
      await tp.waitForFunction(() => typeof engineClient !== 'undefined' && !!coachBoard);

      // The tab bar is fixed to the bottom and every tab is a 44px target.
      const bar = await tp.evaluate(() => {
        const nav = document.querySelector('.top-nav').getBoundingClientRect();
        return { position: getComputedStyle(document.querySelector('.top-nav')).position, bottom: nav.bottom, top: nav.top, innerHeight };
      });
      if (bar.position !== 'fixed' || Math.abs(bar.bottom - bar.innerHeight) > 1) problems.push('the view tabs are not a bar fixed to the bottom: ' + JSON.stringify(bar));
      let small = await smallTargets();
      if (small.length) problems.push('targets under 44px in Coach: ' + small.join(', '));
      for (const [tab, view] of [['library', 'library-view'], ['puzzles', 'puzzles-view'], ['coach', 'coach-view']]) {
        await tp.locator('#nav-' + tab).tap();
        await tp.waitForTimeout(250);
        const state = await tp.evaluate(v => ({ app: appView, shown: document.getElementById(v).checkVisibility() }), view);
        if (state.app !== tab || !state.shown) problems.push(`the ${tab} tab did not switch the view: ` + JSON.stringify(state));
      }

      // Coach: a game by taps; the notation strip sits under the board.
      await tp.locator('#btn-coach-newgame').tap();
      await tp.waitForFunction(() => coachGameActive && !coachThinking, null, { timeout: 60000 });
      await tapMove('coachBoard', 'e2', 'e4');
      await tp.waitForFunction(() => coachGame.history().length >= 2 && !coachThinking, null, { timeout: 60000 }).catch(() => {});
      await tapMove('coachBoard', 'g1', 'f3');
      await tp.waitForFunction(() => coachGame.history().length >= 4 && !coachThinking, null, { timeout: 60000 }).catch(() => {});
      await tp.waitForTimeout(300);
      const coach = await tp.evaluate(() => {
        const board = document.getElementById('coachBoard').getBoundingClientRect();
        const strip = document.getElementById('movelist');
        const cur = strip.querySelector('.ply.current');
        const s = strip.getBoundingClientRect(), c = cur && cur.getBoundingClientRect();
        return { moves: coachGame.history().slice(0, 4), inBoardArea: !!strip.closest('.coach-board-area'), below: s.top >= board.bottom - 1,
          current: !!c && c.left >= s.left - 1 && c.right <= s.right + 1, oneRow: s.height < 80 };
      });
      if (coach.moves[0] !== 'e4' || coach.moves[2] !== 'Nf3') problems.push('tapped moves were not played in Coach: ' + coach.moves.join(' '));
      if (!coach.inBoardArea || !coach.below || !coach.current || !coach.oneRow) problems.push('the Coach notation is not a strip under the board showing the current move: ' + JSON.stringify(coach));
      small = await smallTargets();
      if (small.length) problems.push('targets under 44px during a game: ' + small.join(', '));

      // A drill: its question sits above the board and a tap answers it.
      await tp.evaluate(() => {
        startCoachPractice({ id: 'drill-phone-tap', tag: 'development', meta: INSIGHT_TAG_META.development,
          entry: { fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', bestUci: 'e2e4', bestSan: 'e4', userSan: 'a3', pairNum: 1, ply: 1 } });
      });
      try {
        await tp.waitForFunction(() => coachPracticeSession && coachPracticeSession.analysisReady, null, { timeout: 30000 });
        await tp.waitForTimeout(300);
        const drill = await tp.evaluate(() => ({ prompt: document.getElementById('coach-practice-prompt').getBoundingClientRect().bottom,
          board: document.getElementById('coachBoard').getBoundingClientRect().top, width: document.documentElement.scrollWidth }));
        if (!(drill.prompt <= drill.board)) problems.push('the drill question is not above the board: ' + JSON.stringify(drill));
        if (drill.width > 375) problems.push('the drill scrolls sideways: ' + drill.width);
        await tapMove('coachBoard', 'e2', 'e4');
        await tp.waitForFunction(() => coachPracticeSession && !coachPracticeSession.grading && coachGame.history()[0] === 'e4', null, { timeout: 30000 })
          .catch(() => problems.push('a tapped drill answer was not accepted'));
      } finally {
        await tp.evaluate(() => { if (coachPracticeSession) exitCoachPractice(); });
      }

      // Library quiz: a tap plays White's first move; the strip follows Study.
      await tp.goto(base + '/?opening=italian&mode=quiz');
      await tp.waitForFunction(() => !!board && quizMode);
      await tapMove('myBoard', 'e2', 'e4');
      await tp.waitForFunction(() => currentMoveIdx >= 0, null, { timeout: 5000 }).catch(() => problems.push('a tapped quiz move was not accepted in the Library'));
      await tp.locator('#btn-study').tap();
      for (let i = 0; i < 6; i++) await tp.locator('#btn-next').tap();
      const library = await tp.evaluate(() => {
        const board = document.getElementById('myBoard').getBoundingClientRect();
        const list = document.getElementById('move-list');
        const s = list.getBoundingClientRect(), c = list.querySelector('.move-chip.current').getBoundingClientRect();
        return { inBoardArea: !!list.closest('.board-area'), below: s.top >= board.bottom - 1, current: c.left >= s.left - 1 && c.right <= s.right + 1, oneRow: s.height < 80 };
      });
      if (!library.inBoardArea || !library.below || !library.current || !library.oneRow) problems.push('the Library notation is not a strip under the board showing the current move: ' + JSON.stringify(library));

      // Puzzles: tap the solution's next move.
      await tp.locator('#nav-puzzles').tap();
      await tp.waitForFunction(() => { const s = PuzzlesView._debug().session; return s && s.phase === 'solving' && !s.busy; }, null, { timeout: 15000 });
      const before = await tp.evaluate(() => { const s = PuzzlesView._debug().session; return { ply: s.ply, move: s.puzzle.moves[s.ply] }; });
      await tapMove('puzzleBoard', before.move.slice(0, 2), before.move.slice(2, 4));
      if (before.move.length === 5) await tp.locator(`.promotion-choice[data-promotion="${before.move[4]}"]`).tap();
      await tp.waitForFunction(ply => { const s = PuzzlesView._debug().session; return s.ply > ply || s.phase === 'solved'; }, before.ply, { timeout: 10000 })
        .catch(() => problems.push('a tapped puzzle move was not played'));
      small = await smallTargets();
      if (small.length) problems.push('targets under 44px in Puzzles: ' + small.join(', '));
      if (errors.length) problems.push('page errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
    return problems;
  });

  await check('phone: Settings, the review summary, the game viewer and the shortcut sheet fit 375 wide', async () => {
    const problems = [];
    if (!page.context().browser()) return ['no browser handle to open a phone context'];
    const ctx = await sizedContext(375, 812, true);
    try {
      const tp = await ctx.newPage();
      const errors = [];
      tp.on('pageerror', e => errors.push(e.message));
      await tp.goto(base + '/?view=coach');
      await tp.waitForFunction(() => typeof GameArchive !== 'undefined' && !!coachBoard);
      const inside = sel => tp.evaluate(s => {
        const el = document.querySelector(s);
        if (!el || !el.checkVisibility()) return s + ' is not shown';
        const r = el.getBoundingClientRect();
        if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) return `${s} runs off the screen (${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)})`;
        if (document.documentElement.scrollWidth > innerWidth) return `${s}: the page scrolls sideways`;
        return null;
      }, sel);
      // Coach setup: every group open at once.
      await tp.evaluate(() => document.querySelectorAll('.coach-settings details').forEach(d => { d.open = true; }));
      await tp.waitForTimeout(200);
      const settings = await layoutReport(tp, 'coachBoard');
      if (settings.scrollWidth > settings.innerWidth) problems.push('open Coach setup groups scroll sideways: ' + settings.wide.join(', '));
      // The Settings sheet, at each section.
      for (const section of ['appearance', 'account', 'data']) {
        await openSettings(tp, section);
        await tp.waitForTimeout(350);
        const sheetProblem = await inside('#settings-sheet');
        if (sheetProblem) problems.push(section + ': ' + sheetProblem);
      }
      await closeSettings(tp);
      // A finished game: the summary, then the archived game in the viewer.
      await tp.evaluate(() => {
        coachStartFen = new Chess().fen();
        coachLocalGameId = 'fixture-phone-game';
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
        showPostGameSummary('Checkmate — Black wins.');
      });
      await tp.waitForTimeout(600);
      let problem = await inside('.summary-card');
      if (problem) problems.push(problem);
      const actions = await tp.evaluate(() => [...document.querySelectorAll('.summary-actions .ctrl-btn')].filter(b => b.checkVisibility()).map(b => b.getBoundingClientRect()).filter(r => r.height < 44).length);
      if (actions) problems.push(actions + ' summary actions are under 44px tall');
      await tp.locator('#btn-summary-close').tap();
      await tp.locator('#tab-progress').tap();
      await tp.locator('.game-archive-open').first().tap();
      await tp.locator('#game-viewer').waitFor({ state: 'visible' });
      await tp.waitForTimeout(300);
      problem = await inside('.game-viewer-card');
      if (problem) problems.push(problem);
      problem = await inside('#archiveBoard');
      if (problem) problems.push(problem);
      await tp.keyboard.press('Escape');
      await tp.waitForTimeout(200);
      await tp.locator('#btn-shortcuts').tap();
      await tp.waitForTimeout(200);
      problem = await inside('.shortcut-card');
      if (problem) problems.push(problem);
      if (errors.length) problems.push('page errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
    return problems;
  });

  await check('phone: Settings is a bottom sheet at 375×812 with 44px targets, and Escape or close hands focus back', async () => {
    const problems = [];
    if (!page.context().browser()) return ['no browser handle to open a phone context'];
    const ctx = await sizedContext(375, 812, true);
    try {
      const tp = await ctx.newPage();
      const errors = [];
      tp.on('pageerror', e => errors.push(e.message));
      await tp.goto(base + '/?view=coach');
      await tp.waitForFunction(() => typeof coachBoard !== 'undefined' && !!coachBoard);
      if (!(await tp.locator('#btn-settings').count())) return ['there is no Settings gear in the app bar'];
      const gear = await tp.evaluate(() => { const r = document.getElementById('btn-settings').getBoundingClientRect(); const bar = document.querySelector('header').getBoundingClientRect(); return { w: r.width, h: r.height, inBar: r.top >= bar.top && r.bottom <= bar.bottom + 0.5 }; });
      expect(problems, gear.w >= 44 && gear.h >= 44 && gear.inBar, 'the gear is not a 44px target in the app bar: ' + JSON.stringify(gear));
      await tp.locator('#btn-settings').tap();
      await tp.waitForTimeout(400);
      for (const section of ['appearance', 'account', 'data']) {
        await tp.locator('#settings-tab-' + section).tap();
        await tp.waitForTimeout(150);
        const m = await tp.evaluate(() => {
          const d = document.getElementById('settings-sheet');
          const r = d.getBoundingClientRect();
          const small = [...d.querySelectorAll('button, select, input:not([type="file"]):not([type="checkbox"]), .toggle-label')]
            .filter(el => el.checkVisibility()).filter(el => el.getBoundingClientRect().height < 44)
            .map(el => el.id || el.className);
          return { open: d.open, left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollWidth: document.documentElement.scrollWidth, small, focusInside: d.contains(document.activeElement) };
        });
        expect(problems, m.open && Math.abs(m.left) < 1 && Math.abs(m.right - 375) < 1 && Math.abs(m.bottom - 812) < 1, `${section}: not a full-width sheet on the bottom edge: ` + JSON.stringify(m));
        expect(problems, m.top > 812 * 0.15, `${section}: the sheet covers the whole screen (top ${Math.round(m.top)})`);
        expect(problems, m.scrollWidth <= 375, `${section}: the page scrolls sideways`);
        expect(problems, !m.small.length, `${section}: targets under 44px: ` + m.small.join(', '));
        expect(problems, m.focusInside, `${section}: focus left the sheet`);
      }
      // Escape closes back to the gear.
      await tp.keyboard.press('Escape');
      await tp.waitForTimeout(250);
      let s = await sheetState(tp);
      expect(problems, !s.open && s.focus === 'btn-settings', 'Escape did not close the sheet back to the gear: ' + JSON.stringify(s));
      // Close button, from the Coach rail link.
      await tp.locator('#btn-coach-settings').tap();
      await tp.waitForTimeout(300);
      s = await sheetState(tp);
      expect(problems, s.open && s.section === 'account', 'the Coach rail link did not open Account: ' + JSON.stringify(s));
      await tp.locator('#btn-settings-close').tap();
      await tp.waitForTimeout(300);
      s = await sheetState(tp);
      expect(problems, !s.open && s.focus === 'btn-coach-settings', 'closing did not return focus to the rail link: ' + JSON.stringify(s));
      if (errors.length) problems.push('page errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
    return problems;
  });

  await check('phone: the notation strip scrolls without stepping, drills cannot be stepped back, and scrolling follows the user', async () => {
    const problems = [];
    if (!page.context().browser()) return ['no browser handle to open a phone context'];
    const ctx = await sizedContext(375, 812, true);
    try {
      const tp = await ctx.newPage();
      const errors = [];
      tp.on('pageerror', e => errors.push(e.message));
      const cdp = await ctx.newCDPSession(tp);
      const swipe = async (box, dx) => {
        const y = box.y + box.height / 2, x0 = box.x + box.width / 2 + (dx < 0 ? 80 : -80);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
        for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / 6, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await tp.waitForTimeout(300);
      };
      // Library Study: swiping the board steps; swiping the strip only scrolls it.
      await tp.goto(base + '/?opening=italian');
      await tp.waitForFunction(() => !!board && document.querySelectorAll('#move-list .move-chip').length > 4);
      await tp.evaluate(() => goToMove(2));
      await swipe(await tp.locator('#myBoard').boundingBox(), -160);
      const afterBoard = await tp.evaluate(() => currentMoveIdx);
      if (afterBoard !== 3) problems.push('setup: a swipe on the board should step to the next move, got ' + afterBoard);
      await swipe(await tp.locator('#library-moves').boundingBox(), -160);
      const afterStrip = await tp.evaluate(() => currentMoveIdx);
      if (afterStrip !== afterBoard) problems.push(`swiping the notation strip stepped the opening from ${afterBoard} to ${afterStrip}`);

      // Coach drill: the move list is hidden and cannot put the board into review.
      await tp.goto(base + '/?view=coach');
      await tp.waitForFunction(() => typeof engineClient !== 'undefined' && !!coachBoard);
      await tp.evaluate(() => {
        startCoachPractice({ id: 'drill-strip', tag: 'development', meta: INSIGHT_TAG_META.development,
          entry: { fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', bestUci: 'e2e4', bestSan: 'e4', userSan: 'a3', pairNum: 1, ply: 1 } });
      });
      await tp.waitForFunction(() => coachPracticeSession && coachPracticeSession.analysisReady, null, { timeout: 30000 });
      await tp.evaluate(() => { document.getElementById('coach-keyboard-move').open = true; });
      await tp.locator('#coach-keyboard-move-input').fill('e4');
      await tp.locator('#coach-keyboard-move-form button[type=submit]').tap();
      await tp.waitForFunction(() => coachPracticeSession && !coachPracticeSession.grading && coachGame.history()[0] === 'e4', null, { timeout: 30000 }).catch(() => problems.push('setup: the drill move was not graded'));
      if (await tp.locator('#movelist-section').isVisible()) problems.push('the move list showed during a drill on a phone');
      const reviewing = await tp.evaluate(() => { coachGotoPly(0); return coachReviewCursor; });
      if (reviewing !== null) problems.push('stepping back during a drill put the board into review at ply ' + reviewing);
      await tp.evaluate(() => { if (coachPracticeSession) exitCoachPractice(); });

      // Re-showing the current view (as sign-in does) keeps the scroll position.
      await tp.evaluate(() => window.scrollTo(0, 600));
      await tp.waitForTimeout(200);
      const before = await tp.evaluate(() => scrollY);
      await tp.evaluate(() => switchView('coach'));
      await tp.waitForTimeout(400);
      const after = await tp.evaluate(() => scrollY);
      if (before > 100 && after < before - 50) problems.push(`re-showing Coach jumped the page from ${before} to ${after}`);

      // Puzzles: a mode chosen at the bottom brings its board into view.
      await tp.locator('#nav-puzzles').tap();
      await tp.waitForFunction(() => document.getElementById('puzzles-view').getAttribute('aria-hidden') === 'false');
      await tp.waitForTimeout(1500);
      await tp.locator('#puzzle-mode-rush').scrollIntoViewIfNeeded();
      await tp.locator('#puzzle-mode-rush').tap();
      await tp.waitForTimeout(900);
      const boardTop = await tp.evaluate(() => document.querySelector('.puzzles-board-area').getBoundingClientRect().top);
      if (boardTop < -10 || boardTop > 812 * 0.5) problems.push('choosing a puzzle mode left its board off screen (top ' + Math.round(boardTop) + ')');
      if (errors.length) problems.push('page errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
    // Reduced motion: page scrolls are instant.
    const rm = await page.context().browser().newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
    try {
      const rp = await rm.newPage();
      await rp.goto(base + '/?view=coach');
      const behaviour = await rp.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
      if (behaviour !== 'auto') problems.push('with reduced motion the page still scrolls smoothly (' + behaviour + ')');
    } finally {
      await rm.close();
    }
    return problems;
  });

  await check('phone: keyboard and screen-reader order follow the drawn order, and desktop gets the markup order back', async () => {
    const problems = [];
    if (!page.context().browser()) return ['no browser handle to open a phone context'];
    const containers = ['#library-view', '#coach-view', '#puzzles-view', '#library-view .board-area', '.coach-board-area', '.puzzles-board-area'];
    // In DOM order, the drawn order (CSS `order`) must never go down.
    const outOfOrder = (p, where) => p.evaluate(([sels, where]) => {
      const bad = [];
      sels.forEach(sel => {
        const c = document.querySelector(sel);
        if (!c || !c.offsetParent) return;
        const orders = [...c.children].map(el => ({ el, o: parseInt(getComputedStyle(el).order, 10) || 0 }));
        for (let i = 1; i < orders.length; i++) {
          if (orders[i].o < orders[i - 1].o) bad.push(`${where} ${sel}: ${orders[i].el.className || orders[i].el.id} (order ${orders[i].o}) comes after ${orders[i - 1].el.className || orders[i - 1].el.id} (order ${orders[i - 1].o})`);
        }
      });
      return bad;
    }, [containers, where]);
    const childList = p => p.evaluate(sels => sels.map(sel => { const c = document.querySelector(sel); return c ? [...c.children].map(el => el.id || el.className).join('|') : ''; }), containers);
    const ctx = await sizedContext(375, 812, true);
    try {
      const tp = await ctx.newPage();
      const settle = () => tp.waitForTimeout(300);
      await tp.goto(base + '/?view=coach');
      await tp.waitForFunction(() => typeof engineClient !== 'undefined' && !!coachBoard);
      await settle();
      problems.push(...await outOfOrder(tp, 'Coach ready'));
      await tp.locator('#btn-coach-newgame').tap();
      await tp.waitForFunction(() => coachGameActive && !coachThinking, null, { timeout: 60000 });
      await settle();
      problems.push(...await outOfOrder(tp, 'Coach playing'));
      await tp.evaluate(() => {
        startCoachPractice({ id: 'drill-order', tag: 'development', meta: INSIGHT_TAG_META.development,
          entry: { fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', bestUci: 'e2e4', bestSan: 'e4', userSan: 'a3', pairNum: 1, ply: 1 } });
      });
      await settle();
      problems.push(...await outOfOrder(tp, 'Coach drill'));
      await tp.evaluate(() => { if (coachPracticeSession) exitCoachPractice(); });
      await tp.locator('#nav-library').tap();
      await settle();
      problems.push(...await outOfOrder(tp, 'Library list'));
      await tp.locator('.opening-btn').first().tap();
      await settle();
      problems.push(...await outOfOrder(tp, 'Library opening'));
      await tp.locator('#nav-puzzles').tap();
      await tp.waitForTimeout(1200);
      problems.push(...await outOfOrder(tp, 'Puzzles'));
      // Widening restores the markup order a desktop load has.
      await tp.setViewportSize({ width: 1440, height: 900 });
      await settle();
      const widened = await childList(tp);
      const dp = await (await sizedContext(1440, 900, false)).newPage();
      try {
        await dp.goto(base + '/?view=puzzles');
        await dp.waitForTimeout(600);
        const fresh = await childList(dp);
        containers.forEach((sel, i) => { if (widened[i] !== fresh[i]) problems.push(`${sel} kept the phone order after widening: ${widened[i]} vs ${fresh[i]}`); });
      } finally {
        await dp.context().close();
      }
    } finally {
      await ctx.close();
    }
    return problems;
  });

  // ── Backups on phones (redesign plan §3, risk 2: local-only data) ──
  // The download is the boundary: a link click with a download name is
  // recorded instead of saving a file.
  const stubDownloads = () => {
    window.__downloads = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__downloads.push(this.download); return; }
      return realClick.call(this);
    };
  };
  const loadSettled = async (p, view = 'coach') => {
    await p.goto(base + '/?view=' + view);
    await p.waitForFunction(v => typeof growthOwnerId === 'function' && typeof coachSync !== 'undefined' && (v === 'coach' ? !!coachBoard : appView === v), view);
    // The reminder is decided once the first account check has finished.
    await p.evaluate(async () => {
      await coachSync.init();
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
    });
  };
  const nudgeState = p => p.evaluate(() => {
    const el = document.getElementById('backup-nudge');
    if (!el) return { exists: false, shown: false, text: '' };
    return { exists: true, shown: !el.hidden && el.checkVisibility(), focusInside: el.contains(document.activeElement), text: el.textContent.replace(/\s+/g, ' ').trim() };
  });

  await check('Training data says when this browser last exported a backup', async () => {
    const problems = [];
    if (!page.context().browser()) return ['no browser handle to open a context'];
    const ctx = await sizedContext(1440, 900, false);
    try {
      const p = await ctx.newPage();
      await p.addInitScript(stubDownloads);
      const line = () => p.evaluate(() => { const el = document.getElementById('training-data-last-backup'); return el ? el.textContent.trim() : null; });
      await loadSettled(p);
      expect(problems, await line() === 'Not backed up yet', 'before any backup the card says ' + JSON.stringify(await line()));
      await openSettings(p, 'data');
      await p.locator('#btn-export-training-data').click();
      const downloads = await p.evaluate(() => window.__downloads);
      expect(problems, downloads.length === 1 && /^chess-coach-training-.*\.json$/.test(downloads[0]), 'export did not download a backup: ' + JSON.stringify(downloads));
      expect(problems, await line() === 'Last backed up: today', 'after exporting the card says ' + JSON.stringify(await line()));
      await loadSettled(p);
      expect(problems, await line() === 'Last backed up: today', 'after a reload the card says ' + JSON.stringify(await line()));
      // An older backup shows its date.
      await p.evaluate(() => localStorage.setItem('coach:last-backup:v1', String(Date.now() - 10 * 86400000)));
      await loadSettled(p);
      const older = await line();
      expect(problems, /^Last backed up: \S/.test(older || '') && !/today|yesterday/.test(older), 'a ten-day-old backup reads ' + JSON.stringify(older));
      // A failed export records nothing.
      await p.evaluate(() => localStorage.removeItem('coach:last-backup:v1'));
      await loadSettled(p);
      await p.evaluate(() => { downloadTrainingBackup = () => { throw new Error('Storage is blocked.'); }; });
      await openSettings(p, 'data');
      await p.locator('#btn-export-training-data').click();
      const failed = await p.evaluate(() => ({ stored: localStorage.getItem('coach:last-backup:v1'), status: document.getElementById('training-data-status').textContent, line: document.getElementById('training-data-last-backup').textContent }));
      expect(problems, failed.stored === null && failed.status === 'Storage is blocked.' && failed.line === 'Not backed up yet', 'a failed export still recorded a backup: ' + JSON.stringify(failed));
    } finally {
      await ctx.close();
    }
    return problems;
  });

  await check('phone: a signed-out user with progress is offered sign-in or a backup, and a dismissal lasts two weeks', async () => {
    const problems = [];
    if (!page.context().browser()) return ['no browser handle to open a phone context'];
    const ctx = await sizedContext(375, 812, true);
    try {
      const tp = await ctx.newPage();
      const errors = [];
      tp.on('pageerror', e => errors.push(e.message));
      await tp.addInitScript(stubDownloads);
      const daysAgo = n => Date.now() - n * 86400000;
      // An empty profile: no reminder.
      await loadSettled(tp);
      let s = await nudgeState(tp);
      if (!s.exists) return ['there is no backup reminder'];
      expect(problems, !s.shown, 'shown to a user with no progress');
      // Two finished games are not enough; three are. The reminder sits under
      // the app bar, does not take focus and leaves the whole board on screen.
      await tp.evaluate(() => { const lt = loadLifetime(); lt.games = 2; saveLifetime(lt); });
      await loadSettled(tp);
      expect(problems, !(await nudgeState(tp)).shown, 'shown with only two finished games');
      await tp.evaluate(() => { const lt = loadLifetime(); lt.games = 3; saveLifetime(lt); });
      await loadSettled(tp);
      s = await nudgeState(tp);
      expect(problems, s.shown, 'not shown to a signed-out phone user with three finished games');
      expect(problems, !s.focusInside, 'the reminder took focus');
      expect(problems, /only on this device/.test(s.text) && /Safari can clear it after a week without a visit/.test(s.text) && /Not backed up yet/.test(s.text), 'reminder text: ' + s.text);
      const fit = await tp.evaluate(() => {
        const b = document.getElementById('coachBoard').getBoundingClientRect();
        const bar = document.querySelector('.top-nav').getBoundingClientRect();
        const nudge = document.getElementById('backup-nudge').getBoundingClientRect();
        return { boardTop: Math.round(b.top), boardBottom: Math.round(b.bottom), barTop: Math.round(bar.top), nudgeBottom: Math.round(nudge.bottom), wide: document.documentElement.scrollWidth > innerWidth };
      });
      expect(problems, fit.nudgeBottom <= fit.boardTop && fit.boardBottom <= fit.barTop, 'with the reminder the board is not fully on screen: ' + JSON.stringify(fit));
      expect(problems, !fit.wide, 'the reminder makes the page scroll sideways');
      const buttons = await tp.evaluate(() => [...document.querySelectorAll('#backup-nudge button')].filter(b => b.checkVisibility()).map(b => ({ name: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) })));
      expect(problems, buttons.map(b => b.name).join('|') === 'Sign in to sync|Back up now|Hide for 2 weeks', 'reminder buttons: ' + JSON.stringify(buttons));
      expect(problems, buttons.every(b => b.h >= 44), 'reminder buttons under 44px: ' + JSON.stringify(buttons));
      // Sign in to sync: from Puzzles, it opens Settings → Account over the
      // current view, with the email field focused and on screen.
      await loadSettled(tp, 'puzzles');
      await tp.locator('#btn-backup-nudge-signin').tap();
      await tp.waitForTimeout(400);
      const signIn = await tp.evaluate(() => {
        const r = document.getElementById('coach-auth-email').getBoundingClientRect();
        return { view: appView, open: SettingsSheet.isOpen() && document.getElementById('settings-sheet').open, section: SettingsSheet.section(), focus: document.activeElement && document.activeElement.id, inView: r.top >= 0 && r.bottom <= innerHeight };
      });
      expect(problems, signIn.view === 'puzzles' && signIn.open && signIn.section === 'account' && signIn.focus === 'coach-auth-email' && signIn.inView, 'Sign in to sync did not open Settings → Account: ' + JSON.stringify(signIn));
      await closeSettings(tp);
      // Back up now: downloads, says so, and keeps the reminder away for a week.
      await loadSettled(tp);
      await tp.locator('#btn-backup-nudge-backup').tap();
      const backedUp = await tp.evaluate(() => ({
        downloads: window.__downloads.length,
        status: document.getElementById('backup-nudge-status').textContent,
        backupHidden: document.getElementById('btn-backup-nudge-backup').hidden,
        focus: document.activeElement && document.activeElement.id,
        card: document.getElementById('training-data-last-backup').textContent
      }));
      expect(problems, backedUp.downloads === 1 && /Backup downloaded/.test(backedUp.status) && /Settings → Training data/.test(backedUp.status) && backedUp.backupHidden, 'Back up now did not back up: ' + JSON.stringify(backedUp));
      expect(problems, backedUp.focus === 'btn-backup-nudge-dismiss', 'focus was lost when the backup button went away: ' + backedUp.focus);
      expect(problems, backedUp.card === 'Last backed up: today', 'the Training data card did not update: ' + backedUp.card);
      // Closing after a backup is not a two-week dismissal.
      await tp.locator('#btn-backup-nudge-dismiss').tap();
      const closed = await tp.evaluate(() => ({ hidden: document.getElementById('backup-nudge').hidden, dismissedAt: localStorage.getItem('ui:backup-nudge-dismissed-at') }));
      expect(problems, closed.hidden && closed.dismissedAt === null, 'closing after a backup: ' + JSON.stringify(closed));
      await loadSettled(tp);
      expect(problems, !(await nudgeState(tp)).shown, 'shown again right after a backup');
      // A week-old backup brings it back, with the date.
      await tp.evaluate(d => localStorage.setItem('coach:last-backup:v1', String(d)), daysAgo(8));
      await loadSettled(tp);
      s = await nudgeState(tp);
      expect(problems, s.shown && /Last backed up: \S/.test(s.text) && !/Not backed up yet/.test(s.text), 'not back after a week-old backup: ' + s.text);
      // Dismissal: hides it, hands focus to the view tab, and lasts two weeks.
      await tp.locator('#btn-backup-nudge-dismiss').tap();
      const dismissed = await tp.evaluate(() => ({ hidden: document.getElementById('backup-nudge').hidden, focus: document.activeElement && document.activeElement.id }));
      expect(problems, dismissed.hidden && dismissed.focus === 'nav-coach', 'dismissing did not hide it, or dropped focus: ' + JSON.stringify(dismissed));
      await loadSettled(tp);
      expect(problems, !(await nudgeState(tp)).shown, 'a dismissal did not survive a reload');
      await tp.evaluate(d => localStorage.setItem('ui:backup-nudge-dismissed-at', String(d)), daysAgo(13));
      await loadSettled(tp);
      expect(problems, !(await nudgeState(tp)).shown, 'shown again before two weeks were up');
      await tp.evaluate(d => localStorage.setItem('ui:backup-nudge-dismissed-at', String(d)), daysAgo(15));
      await loadSettled(tp);
      expect(problems, (await nudgeState(tp)).shown, 'not back after two weeks');
      // Signing in hides it at once.
      await tp.evaluate(() => { coachAuthUser = { id: 'nudge-user', email: 'nudge@example.com' }; renderCoachAuth(); });
      expect(problems, !(await nudgeState(tp)).shown, 'still shown after signing in');
      await tp.evaluate(() => { coachAuthUser = null; renderCoachAuth(); });
      // Wider than the stacked layout it goes; back in it, it returns.
      await tp.setViewportSize({ width: 1024, height: 768 });
      await tp.waitForTimeout(250);
      expect(problems, !(await nudgeState(tp)).shown, 'shown at 1024 wide');
      await tp.setViewportSize({ width: 375, height: 812 });
      await tp.waitForTimeout(250);
      expect(problems, (await nudgeState(tp)).shown, 'not back after returning to the phone layout');
      if (errors.length) problems.push('page errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
    return problems;
  });

  await check('backup reminder: never for a signed-in phone user or on a desktop, even with progress', async () => {
    const problems = [];
    if (!page.context().browser()) return ['no browser handle to open a context'];
    // A signed-in session from the account service (the Supabase client is
    // the boundary), switched on per tab; every query answers with no rows.
    const signedInClient = () => {
      if (sessionStorage.getItem('test:signed-in') !== '1') return;
      const result = { data: null, error: null, count: 0 };
      const chain = () => new Proxy(function () {}, {
        get: (t, prop) => prop === 'then' ? (ok, fail) => Promise.resolve(result).then(ok, fail) : chain(),
        apply: () => chain()
      });
      const user = { id: '00000000-0000-4000-8000-00000000ab12', email: 'synced@example.com' };
      window.supabase = { createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user, access_token: 'x' } }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({ error: null })
        },
        from: () => chain(),
        rpc: () => chain(),
        channel: () => chain(),
        removeChannel: () => {}
      }) };
    };
    for (const [tag, w, h, touch, signed, want] of [['signed-in phone', 375, 812, true, true, false], ['signed-out desktop', 1440, 900, false, false, false], ['signed-out phone (control)', 375, 812, true, false, true]]) {
      const ctx = await sizedContext(w, h, touch);
      try {
        const p = await ctx.newPage();
        await p.addInitScript(signedInClient);
        await loadSettled(p);
        // Guest progress first; a signed-in tab adopts it into the account.
        await p.evaluate(signed => {
          const lt = loadLifetime(); lt.games = 5; saveLifetime(lt);
          if (signed) sessionStorage.setItem('test:signed-in', '1');
        }, signed);
        await loadSettled(p);
        const s = await p.evaluate(() => ({ user: !!coachAuthUser, games: loadLifetime().games }));
        if (signed && !s.user) problems.push(tag + ': setup: the stubbed session did not sign in');
        if (s.games !== 5) problems.push(tag + ': setup: the guest games did not carry over: ' + s.games);
        const shown = (await nudgeState(p)).shown;
        if (shown !== want) problems.push(`${tag}: reminder ${shown ? 'shown' : 'not shown'}`);
      } finally {
        await ctx.close();
      }
    }
    return problems;
  });

  await check('an endgame lesson is marked done only after an unaided solve', async () => {
    await freshCoach();
    return page.evaluate(() => {
      const problems = [];
      const lesson = ENDGAME_LESSONS[0];
      const item = endgamePracticeItem(lesson);
      const row = () => {
        renderEndgameTrack();
        const el = document.querySelectorAll('#endgame-track-list .endgame-item')[0];
        return { done: el.classList.contains('is-complete'), title: el.querySelector('strong').textContent,
          button: el.querySelector('button').textContent, progress: document.getElementById('endgame-track-progress').textContent };
      };
      recordPracticeAttempt(item, true, true);   // solved with the answer shown
      let r = row();
      if (r.done || r.title.startsWith('✓') || r.progress.startsWith('1/')) problems.push('a helped solve marked the lesson done: ' + JSON.stringify(r));
      if (r.button !== 'Try unaided') problems.push('a helped-only lesson should offer an unaided try: ' + r.button);
      recordPracticeAttempt(item, true, false);  // solved unaided
      r = row();
      if (!r.done || !r.title.startsWith('✓') || !r.progress.startsWith('1/') || r.button !== 'Review') problems.push('an unaided solve did not mark the lesson done: ' + JSON.stringify(r));
      return problems;
    });
  });

  await check('emailed-code sign-in: the code field appears only when enabled, and a wrong or short code is refused', async () => {
    await freshCoach();
    return page.evaluate(async () => {
      const problems = [];
      // verify-browser.sh's smoke stage may have installed a setter that forces
      // the flag on for the session; replace the property outright and put
      // the original descriptor back afterwards.
      const saved = { client: coachDbClient, config: window.COACH_SUPABASE_CONFIG, descriptor: Object.getOwnPropertyDescriptor(window, 'COACH_SUPABASE_CONFIG') };
      const setConfig = value => Object.defineProperty(window, 'COACH_SUPABASE_CONFIG', { configurable: true, writable: true, value });
      const calls = [];
      const fake = {
        auth: {
          signInWithOtp: async args => { calls.push(['send', args.email]); return { error: null }; },
          verifyOtp: async args => { calls.push(['verify', args]); return args.token === '424242' ? { data: {}, error: null } : { data: null, error: { message: 'Token has expired or is invalid' } }; },
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({ error: null })
        },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) })
      };
      const submit = id => new Promise(resolve => { document.getElementById(id).requestSubmit(); setTimeout(resolve, 150); });
      const status = () => document.getElementById('coach-auth-status').textContent;
      const codeShown = () => getComputedStyle(document.getElementById('coach-auth-code-form')).display !== 'none';
      try {
        coachDbClient = fake;
        document.getElementById('coach-auth-form').style.display = '';
        // The account form lives in the Settings sheet; open it there.
        if (window.SettingsSheet) SettingsSheet.open('account');
        const group = document.getElementById('coach-auth-form').closest('details');
        if (group) group.open = true;
        // Off (the shipped default): the link is sent and no code field appears.
        setConfig(Object.assign({}, saved.config, { emailCodeEnabled: false }));
        document.getElementById('coach-auth-code-form').style.display = 'none';
        document.getElementById('coach-auth-email').value = 'player@example.com';
        await submit('coach-auth-email-form');
        if (codeShown()) problems.push('with codes off, the code field appeared');
        if (!/Open it in this browser to finish/.test(status())) problems.push('with codes off, the status should point to the link: ' + status());
        // On: the code field appears, takes focus, and only the right code signs in.
        setConfig(Object.assign({}, saved.config, { emailCodeEnabled: true }));
        await submit('coach-auth-email-form');
        if (!/^Code sent to player@example\.com\. Enter it here/.test(status())) problems.push('with codes on, the status should ask for the code: ' + status());
        if (!codeShown()) problems.push('with codes on, the code field did not appear after sending');
        if (document.activeElement !== document.getElementById('coach-auth-code')) problems.push('the code field did not take focus');
        document.getElementById('coach-auth-code').value = '123';
        await submit('coach-auth-code-form');
        if (status() !== 'Enter the code from the sign-in email.' || calls.some(c => c[0] === 'verify')) problems.push('a short code was sent or not refused: ' + status());
        document.getElementById('coach-auth-code').value = '123456789';
        await submit('coach-auth-code-form');
        if (status() !== 'Enter the code from the sign-in email.' || calls.some(c => c[0] === 'verify')) problems.push('a nine-digit code was sent or not refused: ' + status());
        // Projects can send 8-digit codes; those go through whole.
        document.getElementById('coach-auth-code').value = '1234 5678';
        await submit('coach-auth-code-form');
        const eight = calls.filter(c => c[0] === 'verify').pop();
        if (!eight || eight[1].token !== '12345678') problems.push('an 8-digit code was not sent whole: ' + JSON.stringify(eight));
        // Codes are often pasted with a space ("111 111"); the space is ignored.
        document.getElementById('coach-auth-code').value = '111 111';
        await submit('coach-auth-code-form');
        if (!/invalid or has expired/.test(status())) problems.push('a wrong code was not refused: ' + status());
        const wrong = calls.filter(c => c[0] === 'verify').pop();
        if (!wrong || wrong[1].token !== '111111') problems.push('a code pasted with a space was not sent as six digits: ' + JSON.stringify(wrong));
        document.getElementById('coach-auth-code').value = '424 242';
        await submit('coach-auth-code-form');
        const last = calls.filter(c => c[0] === 'verify').pop();
        if (!last || last[1].email !== 'player@example.com' || last[1].token !== '424242' || last[1].type !== 'email') problems.push('verifyOtp got the wrong arguments: ' + JSON.stringify(last));
        if (status() !== 'Signed in.') problems.push('the right code did not sign in: ' + status());
      } finally {
        coachDbClient = saved.client;
        if (saved.descriptor) Object.defineProperty(window, 'COACH_SUPABASE_CONFIG', saved.descriptor);
        else delete window.COACH_SUPABASE_CONFIG;
        document.getElementById('coach-auth-code-form').style.display = 'none';
        if (window.SettingsSheet && SettingsSheet.isOpen()) SettingsSheet.close();
      }
      return problems;
    });
  });

  await check('a rejected Lichess token keeps the token field and says why', async () => {
    const problems = [];
    await page.goto(base + '/?opening=italian&mode=explore');
    await page.waitForFunction(() => typeof exploreMode !== 'undefined' && exploreMode && !!document.getElementById('lichess-token-form'));
    await page.evaluate(() => {
      sessionStorage.removeItem(LICHESS_TOKEN_KEY);
      showExploreTokenState();
      window.__realFetch = window.fetch;
      window.fetch = async () => new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } });
    });
    try {
      await page.evaluate(() => {
        document.getElementById('lichess-token-input').value = 'lip_wrong';
        document.getElementById('lichess-token-form').requestSubmit();
      });
      await page.waitForFunction(() => /Invalid token/.test(document.getElementById('token-error').textContent), null, { timeout: 5000 })
        .catch(() => problems.push('a 401 did not say the token is invalid: ' + document.getElementById('token-error')));
      const form = await page.evaluate(() => ({
        input: !!document.getElementById('lichess-token-input'),
        button: (document.getElementById('btn-save-token') || {}).textContent || null,
        disabled: !!(document.getElementById('btn-save-token') || {}).disabled
      }));
      if (!form.input || form.button !== 'Connect' || form.disabled) problems.push('after a rejected token the form lost its field or button: ' + JSON.stringify(form));
    } finally {
      await page.evaluate(() => { window.fetch = window.__realFetch; });
    }
    return problems;
  });

  if (pageErrors.length) failures.push('page errors: ' + pageErrors.join(' | '));
  if (failures.length) throw new Error(failures.join('\n'));
  return { passed: passed.length, checks: passed };
}
