// Playwright CLI run-code body; isolated local state, real engine, real reloads.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/*', route => route.continue());
  const fresh = async () => { await page.evaluate(() => { localStorage.clear(); sessionStorage.removeItem('ui:coach-panel-tab'); }); await page.reload(); };
  const play = async move => {
    await page.locator('#coach-keyboard-move').evaluate(el => { el.open = true; });
    await page.locator('#coach-keyboard-move-input').fill(move);
    await page.locator('#coach-keyboard-move-form button[type=submit]').click();
    await page.waitForFunction(() => !coachPracticeSession || (!coachPracticeSession.grading && !coachPracticeSession.pendingMove), null, { timeout: 45000 });
  };
  const gameState = () => page.evaluate(() => ({fen:coachGame.fen(),pgn:coachGame.pgn(),id:coachLocalGameId,stats:coachStats,flipped:coachBoardFlipped}));
  const practiceState = () => page.evaluate(() => ({fen:coachGame.fen(),phase:coachPracticeSession.phase,expected:coachPracticeSession.expectedUci,hint:coachPracticeSession.hintStage,misses:coachPracticeSession.misses,completed:coachPracticeSession.completed,progress:loadPracticeProgress(),day:dailySprintToday()}));
  const results = [];

  await fresh();
  await page.locator('#group-position').evaluate(el => { el.open = true; });
  await page.locator('#coach-fen').fill('7k/8/5K2/8/8/8/8/R7 w - - 0 1');
  await page.locator('#btn-coach-newgame').click();
  await page.locator('#btn-coach-flip').click();
  const zeroMove = await gameState();
  await page.reload();
  assert(JSON.stringify(await gameState()) === JSON.stringify(zeroMove), 'zero-move custom game or orientation was lost');
  const reopened = await page.context().newPage();
  await reopened.goto(page.url());
  assert(await reopened.evaluate(id => coachGameActive && coachLocalGameId === id, zeroMove.id), 'new browser tab did not reopen the saved game');
  await reopened.close();
  results.push('zero-move custom game, identity, orientation, and tab reopen');

  await fresh();
  await page.locator('#btn-coach-newgame').click();
  // Stall only this document's classifier to create a deterministic real
  // interruption. Reload loads the real engine implementation again.
  await page.evaluate(() => { window.classifyMove = () => new Promise(() => {}); });
  await play('e4');
  assert(await page.evaluate(() => !!loadCoachState().state.pendingReview), 'unreviewed move was not checkpointed');
  const pendingId = await page.evaluate(() => coachLocalGameId);
  await page.reload();
  await page.waitForFunction(() => coachLastReview && !coachPendingReview && !coachThinking && coachIsUserTurn(), null, {timeout:60000});
  assert(await page.evaluate(id => coachLocalGameId === id && coachGame.history().length === 2 && coachStats.moves === 1 && coachReviewLog.length === 1 && dailySprintToday().movesCompleted === 1, pendingId), 'interrupted analysis lost or duplicated the user move');
  const live = await gameState();
  await page.reload();
  assert(JSON.stringify(await gameState()) === JSON.stringify(live), 'settled game changed on a second reload');
  results.push('interrupted classification resumes once; opponent replies once');

  await page.evaluate(() => startCoachPractice({id:'recovery-mate',tag:'missed_mate',meta:INSIGHT_TAG_META.missed_mate,entry:{fenBefore:'7k/8/5KQ1/8/8/8/8/8 w - - 0 1',bestUci:'g6g7',bestSan:'Qg7#'}}));
  await page.waitForFunction(() => coachPracticeSession.analysisReady, null, {timeout:45000});
  await play('Qe4');
  assert(await page.evaluate(() => coachPracticeSession.misses === 1), 'incorrect practice move was not measured');
  const missed = await practiceState();
  await page.reload();
  assert(JSON.stringify(await practiceState()) === JSON.stringify(missed), 'missed attempt was lost or recorded again');
  await page.locator('#btn-coach-practice-exit').click();
  assert(JSON.stringify(await gameState()) === JSON.stringify(live), 'leaving restored missed-move practice lost the game');
  results.push('incorrect drill attempt survives reload without a duplicate event');

  // A two-step authored drill borrows the current live game.
  await page.evaluate(() => startCoachPractice({
    id:'recovery-rook',tag:'endgame_technique',meta:INSIGHT_TAG_META.endgame_technique,
    entry:{fenBefore:'7k/8/5K2/8/8/8/8/R7 w - - 0 1',bestUci:'f6g6',bestSan:'Kg6',continuation:[{opponentUci:'h8g8',followupUci:'a1a8'}]}
  }));
  await page.waitForFunction(() => coachPracticeSession.analysisReady, null, {timeout:45000});
  await page.locator('#btn-coach-practice-hint').click();
  await page.locator('#btn-coach-practice-hint').click();
  const hint = await practiceState();
  await page.reload();
  assert(JSON.stringify(await practiceState()) === JSON.stringify(hint), 'hinted practice state or progress changed on reload');
  assert((await page.locator('#coach-status').textContent()).includes('Practice restored'), 'resumed drill was not announced');
  await page.evaluate(() => { window.evaluatePracticeMove = () => new Promise(() => {}); });
  await page.locator('#coach-keyboard-move').evaluate(el => { el.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('Ra2');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  await page.waitForFunction(() => coachPracticeSession.grading, null, {timeout:10000});
  await page.reload();
  assert(JSON.stringify(await practiceState()) === JSON.stringify(hint), 'interrupted practice grading created a result or changed the saved position');
  await play('Kg6');
  assert(await page.evaluate(() => coachPracticeSession.phase === 'followup'), 'authored drill did not reach follow-up');
  const followup = await practiceState();
  await page.reload();
  assert(JSON.stringify(await practiceState()) === JSON.stringify(followup), 'follow-up position or expected move was lost');
  await page.locator('#btn-coach-practice-answer').click();
  const revealed = await practiceState();
  await page.reload();
  assert(JSON.stringify(await practiceState()) === JSON.stringify(revealed), 'revealed answer was recorded again during recovery');
  assert(await page.locator('#btn-coach-practice-answer').isDisabled(), 'revealed-answer control was reset');
  await play('Ra8#');
  const finished = await practiceState();
  assert(finished.completed, 'practice did not complete');
  await page.reload();
  assert(JSON.stringify(await practiceState()) === JSON.stringify(finished), 'finished drill duplicated its result or lost the completed board');
  assert(await page.locator('#btn-coach-practice-next').isVisible(), 'finished restored drill had no next action');
  await page.locator('#btn-coach-practice-next').click();
  assert(JSON.stringify(await gameState()) === JSON.stringify(live), 'practice reloads lost the original game');
  await page.reload();
  assert(await page.evaluate(() => !coachPracticeSession), 'exited practice returned after reload');
  results.push('hint, follow-up, answer reveal, saved completion, and exact borrowed-game restoration');

  // A valid account snapshot must be invisible to another memory owner.
  const isolated = await page.evaluate(() => {
    const previous = coachAuthUser;
    coachAuthUser = {id:'recovery-account-a'};
    const key = coachMemoryKey(COACH_PRACTICE_STATE_KEY);
    localStorage.setItem(key, JSON.stringify({v:1,owner:coachMemoryOwnerId(),session:{marker:'account-a'}}));
    coachAuthUser = {id:'recovery-account-b'};
    const hidden = loadCoachPracticeState() === null;
    coachAuthUser = previous;
    localStorage.removeItem(key);
    return hidden;
  });
  assert(isolated, 'practice snapshot leaked across account owners');
  results.push('practice resume points are isolated by account owner');
  // Simulate the same delayed owner handoff used by getSession/auth events,
  // with remote sync disabled: no emails, real accounts, or DB writes.
  await page.evaluate(async () => { if (coachDbInitPromise) await coachDbInitPromise; });
  await page.evaluate(() => { window.__recoveryDb = coachDbClient; coachDbClient = null; applyCoachRecoveryUser({id:'recovery-owner-a'}); });
  assert(await page.evaluate(() => coachGameActive), 'guest game was not adopted on first sign-in');
  await page.evaluate(() => startCoachPractice({id:'account-drill',tag:'missed_mate',meta:INSIGHT_TAG_META.missed_mate,entry:{fenBefore:'7k/8/5KQ1/8/8/8/8/8 w - - 0 1',bestUci:'g6g7',bestSan:'Qg7#'}}));
  await page.locator('#btn-coach-practice-hint').click();
  const accountPractice = await practiceState();
  await page.evaluate(() => applyCoachRecoveryUser({id:'recovery-owner-b'}));
  assert(await page.evaluate(() => !coachGameActive && !coachPracticeSession), 'account B inherited account A recovery');
  await page.evaluate(() => applyCoachRecoveryUser({id:'recovery-owner-a'}));
  assert(JSON.stringify(await practiceState()) === JSON.stringify(accountPractice), 'late account restoration lost its drill');
  await page.evaluate(() => applyCoachRecoveryUser({id:'recovery-owner-a'}));
  assert(JSON.stringify(await practiceState()) === JSON.stringify(accountPractice), 'same-owner token refresh reset practice');
  await page.evaluate(() => { applyCoachRecoveryUser(null); coachDbClient = window.__recoveryDb; delete window.__recoveryDb; });
  assert(await page.evaluate(() => !coachPracticeSession), 'signed-out view retained another owner’s drill');
  results.push('delayed account loading, account switching, token refresh, and sign-out select the right recovery');


  await fresh();
  await page.evaluate(() => {
    updateDailySprint(day => Object.assign(day,{mode:'adaptive',phase:'drills',focus:'Old drill plan',drillTarget:3,drillsCompleted:1,drillIds:['earned'],moveTarget:4,movesCompleted:0,target:7,completedUnits:1}));
  });
  await page.reload();
  const repaired = await page.evaluate(() => dailySprintToday());
  assert(repaired.phase === 'moves' && repaired.drillTarget === 1 && repaired.completedUnits === 1 && repaired.target === 5 && !repaired.completedAt, 'older impossible plan lost earned work or manufactured completion');
  assert((await page.locator('#daily-sprint-focus-detail').textContent()).includes('Saved session adjusted'), 'older-plan repair was not explained');
  await page.locator('#btn-coach-next-action').click();
  await page.evaluate(() => { for(let ply=1;ply<=4;ply++) recordDailySprintMove({ply,tier:'good',tags:[]}); renderCoachDailyPlan(); });
  const completed = await page.evaluate(() => dailySprintToday());
  await page.reload();
  assert(JSON.stringify(await page.evaluate(() => dailySprintToday())) === JSON.stringify(completed), 'daily completion changed on reload');
  await page.locator('#btn-coach-next-action').click();
  assert(await page.locator('#panel-progress').isVisible(), 'restored daily completion did not open progress');
  results.push('unavailable old drills repaired without fake credit; daily completion remains stable');

  await fresh();
  await page.locator('#btn-coach-newgame').click();
  const fallbackId = await page.evaluate(() => { localStorage.setItem(coachMemoryKey(COACH_PRACTICE_STATE_KEY), '{broken'); return coachLocalGameId; });
  await page.reload();
  assert(await page.evaluate(id => coachGameActive && coachLocalGameId === id && !coachPracticeSession, fallbackId), 'corrupt drill prevented recovery of a valid game');
  assert((await page.locator('#coach-status').textContent()).includes('interrupted drill could not be restored'), 'corrupt drill fallback was not explained');

  await fresh();
  await page.evaluate(() => {
    localStorage.setItem(coachMemoryKey(COACH_STATE_KEY), JSON.stringify({v:1,startFen:new Chess().fen(),pgn:'not a legal PGN',ended:false}));
    localStorage.setItem(coachMemoryKey(COACH_PRACTICE_STATE_KEY), '{broken');
  });
  await page.reload();
  assert(await page.evaluate(() => !coachGameActive && !coachPracticeSession && !!localStorage.getItem(coachMemoryKey(COACH_STATE_BACKUP_KEY))), 'corrupt recovery was not safely backed up');
  assert((await page.locator('#coach-status').textContent()).includes('could not be restored'), 'corrupt recovery did not explain the fresh start');
  results.push('corrupt snapshots are rejected and the game data backed up');
  assert(errors.length === 0, 'Page errors: '+errors.join(' | '));
  return {recovery:results,pageErrors:errors.length};
}
