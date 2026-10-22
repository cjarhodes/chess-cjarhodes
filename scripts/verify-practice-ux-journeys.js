// Real UI journeys in empty browser contexts. Queue/history fixtures are explicit;
// no existing profile or real account is reset or used.
async browserPage => {
  const base = browserPage.url().split('?')[0], browser = browserPage.context().browser();
  const contexts = [], errors = [], checks = [], captures = [];
  const assert = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
  let page;
  const fresh = async () => {
    if (page) await page.context().close();
    const context = await browser.newContext(); contexts.push(context); page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.locator('#tab-practice').waitFor();
  };
  const play = async move => {
    await page.locator('#coach-keyboard-move').evaluate(e => e.open = true);
    await page.locator('#coach-keyboard-move-input').fill(move);
    await page.locator('#coach-keyboard-move-form button').click();
  };
  const settled = () => page.waitForFunction(() => coachGameActive && !coachThinking && coachIsUserTurn(), null, {timeout:60000});
  const practiceSettled = () => page.waitForFunction(() => coachPracticeSession && !coachPracticeSession.grading && !coachPracticeSession.pendingMove && (coachPracticeSession.completed || coachPracticeSession.analysisReady), null, {timeout:60000});
  const capture = async (name, action) => {
    for (const [width,height] of [[1280,800],[1440,900],[1920,1080]]) {
      await page.setViewportSize({width,height});
      await page.waitForFunction(() => !jQuery(':animated').length);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const m = await page.evaluate(action => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,board:rect('#coachBoard'),action:rect(action),
          boardPrimary:document.getElementById('coachBoard-wrap').dataset.primaryTarget==='true',
          primary:[...document.querySelectorAll('#coach-view [data-primary-action="true"]')].filter(e=>e.checkVisibility()).map(e=>e.id||'keyboard-submit'),
          hinted:[...document.querySelectorAll('#coachBoard .practice-cue-source, #coachBoard .practice-cue-target')].map(e=>getComputedStyle(e).boxShadow)};
      },action);
      assert(m.scrollWidth<=width && m.board.x>=0 && m.board.right<=width && m.board.bottom<=height && m.board.width>=320, name+': board fits '+width);
      assert(m.action.y>=0 && m.action.bottom<=height && m.primary.length+Number(m.boardPrimary)===1, name+': one visible next action '+width);
      if(name==='hints') assert(m.hinted.length===2 && m.hinted.every(s=>s!=='none'), 'hint outlines survive board resize '+width);
      await page.screenshot({path:'output/playwright/practice-ux-'+name+'-'+width+'.png',animations:'disabled'});
      captures.push({name,...m});
    }
  };
  try {
    await fresh(); await page.locator('#tab-practice').click();
    assert(await page.locator('#btn-practice-session-start').isVisible(), 'fresh Practice has one starting action');
    assert(!(await page.locator('#btn-coach-next-action').isVisible()), 'Practice selection removes the unrelated game start action');
    await capture('selection','#btn-practice-session-start');
    await page.locator('#btn-practice-session-start').focus(); await page.keyboard.press('Enter'); await practiceSettled();
    assert(await page.evaluate(()=>coachPracticeSession.item.id==='endgame-queen-mate' && document.activeElement.id==='coachBoard'), 'keyboard start opens the recommended lesson and moves focus to the board');
    assert((await page.locator('#coach-practice-prompt').textContent()).includes('immediate checkmate'), 'lesson states its concrete objective');
    assert(await page.locator('#daily-sprint-progress-label').textContent()==='0 of 1 position', 'active lesson reports its own progress');
    await capture('lesson','#btn-coach-practice-hint');
    await play('Qe4'); await practiceSettled();
    const feedback=await page.locator('#coach-practice-status').textContent();
    assert(feedback.includes('mate in one') && !feedback.includes('pawns') && !feedback.includes('Qg7'), 'mistake explains the missed objective without revealing the answer');
    await capture('mistake','#coach-keyboard-move-form button');
    await page.locator('#btn-coach-practice-hint').click();
    assert(await page.locator('#coachBoard .practice-cue-source').count()===0,'first hint gives an idea before locating a piece');
    await page.locator('#btn-coach-practice-hint').click(); await page.locator('#btn-coach-practice-hint').click();
    await capture('hints','#btn-coach-practice-hint');
    const saved=await page.evaluate(()=>({events:loadPracticeProgress().events.length,misses:coachPracticeSession.misses}));
    await page.reload(); await practiceSettled();
    assert(await page.evaluate(s=>coachPracticeSession.hintStage===3 && coachPracticeSession.misses===s.misses && loadPracticeProgress().events.length===s.events,saved),'reload preserves help and misses without adding attempts');
    await play('Qg7#'); await practiceSettled();
    assert(await page.locator('#daily-sprint-progress-label').textContent()==='1 of 1 position','completion reports the completed lesson');
    assert(!(await page.locator('#btn-coach-practice-hint').isVisible()) && !(await page.locator('#btn-coach-practice-answer').isVisible()) && !(await page.locator('#practice-empty').isVisible()),'completed lesson hides obsolete help and queue messages');
    await capture('completion','#btn-coach-practice-next');
    const attempts=await page.evaluate(()=>loadPracticeProgress().events.length);
    await page.locator('#btn-learning-transfer-test').click(); await practiceSettled();
    assert((await page.locator('#coach-practice-prompt').textContent()).includes('Scan checks'),'different-position check carries the lesson cue into the new task');
    assert(!(await page.locator('#learning-transfer-note').textContent()).includes('graded decision'),'check guidance uses player-facing language');
    await play('Re8#'); await practiceSettled();
    assert(await page.evaluate(n=>loadPracticeProgress().events.length===n,attempts),'different-position check does not inflate rehearsal attempts');
    await page.locator('#btn-coach-practice-next').click(); await settled();
    await play('e4'); await settled();
    const game=await page.evaluate(()=>({id:coachLocalGameId,pgn:coachGame.pgn(),stats:JSON.stringify(coachStats),day:JSON.stringify(dailySprintToday())}));
    await page.locator('#tab-practice').click(); await page.locator('#endgame-track-list .endgame-item button').nth(1).click(); await practiceSettled();
    await page.locator('#btn-coach-practice-hint').click(); await page.reload(); await practiceSettled();
    await page.locator('#btn-coach-practice-exit').click();
    assert(await page.evaluate(s=>coachLocalGameId===s.id && coachGame.pgn()===s.pgn && JSON.stringify(coachStats)===s.stats && JSON.stringify(dailySprintToday())===s.day,game),'unfinished lesson and reload return the exact game, stats and daily progress');

    // Controlled review fixture: three positions, one of them split across tags.
    await fresh();
    await page.evaluate(()=>{
      const start=new Chess(), e4=new Chess(), d4=new Chess(); e4.move('e4');e4.move('e5');d4.move('d4');d4.move('d5');
      const entries=[
        {fenBefore:start.fen(),bestUci:'e2e4',bestSan:'e4',userSan:'f3',userUci:'f2f3',tags:['development','king_safety','pawn_structure']},
        {fenBefore:e4.fen(),bestUci:'g1f3',bestSan:'Nf3',userSan:'a3',userUci:'a2a3',tags:['development']},
        {fenBefore:d4.fen(),bestUci:'c2c4',bestSan:'c4',userSan:'h3',userUci:'h2h3',tags:['development']}
      ].map((entry,i)=>({...entry,id:'practice-ux-fixture-'+i,gameId:'practice-ux-fixture',ply:i*2+1,pairNum:i+1,phase:'opening',tier:'mistake',loss:220,ts:Date.now()-i*1000}));
      saveInsights({v:1,entries}); renderInsights();
    });
    await page.locator('#tab-practice').click();
    const plan=await page.evaluate(()=>({raw:practiceItemsForEntries(currentInsightEntries(),insightTagCounts(currentInsightEntries())).length,distinct:renderedPracticeItems.size,planned:orderedPracticeRunItems([...renderedPracticeItems.values()]).length,label:$('#btn-practice-session-start').text()}));
    assert(plan.raw>plan.distinct && plan.distinct===3 && plan.planned<plan.distinct && plan.label.includes(String(plan.planned)),'recommendation advertises the actual capped, distinct session length');
    await capture('personalised','#btn-practice-session-start');
    assert(!(await page.locator('.practice-progress').isVisible()),'activity is disclosed after choosing a lesson');
    await page.locator('#btn-practice-session-start').click(); await practiceSettled();
    assert(await page.evaluate(n=>coachPracticeRun.items.length===n,plan.planned),'launch honours the advertised session length');
    for(let step=0;step<plan.planned;step++){
      for(let move=0;move<3 && await page.evaluate(()=>!coachPracticeSession.completed);move++){
        await play(await page.evaluate(()=>coachPracticeSession.expectedUci));await practiceSettled();
      }
      assert(await page.evaluate(()=>coachPracticeSession.completed),'session position completes through initial and follow-up decisions');
      if(step+1<plan.planned){await page.locator('#btn-coach-practice-next').click();await practiceSettled();}
    }
    assert(await page.evaluate(n=>coachPracticeRun.completed===n,plan.planned),'completed count matches the promised session');
    await capture('session-complete','#btn-coach-practice-next');
    assert(errors.length===0,'no browser runtime errors');
    return {kind:'real-workflows-and-isolated-review-fixture',checks:checks.length,captures,plan,errors};
  } finally { for(const context of contexts) if(context.pages().length) await context.close(); }
}
