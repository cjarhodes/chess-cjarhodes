// Playwright CLI body: useful Progress through real practice and playing flows.
async page => {
 const errors=[],consoleErrors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const checks=[],scenarios=[];
 await page.route('**/*',route=>route.continue());
 const fresh=async()=>{
  await page.evaluate(()=>{localStorage.clear();sessionStorage.removeItem('ui:coach-panel-tab');});
  await page.reload();await page.locator('#tab-progress').click();
 };
 const capture=async name=>{
  for(const [width,height]of [[1280,800],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.waitForFunction(()=>{
    const area=document.querySelector('.coach-board-area'),b=document.getElementById('coachBoard').getBoundingClientRect();
    return area.scrollHeight<=area.clientHeight+2&&Math.abs(b.width-b.height)<8&&b.width>=320;
   },null,{timeout:15000});
   const measured=await page.evaluate(()=>{
    const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();
    const primary=[...document.querySelectorAll('#coach-view [data-primary-action="true"]')].filter(e=>e.checkVisibility());
    return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,board:rect('#coachBoard'),next:rect('#btn-progress-next'),primary:primary.map(e=>e.id)};
   });
   assert(measured.documentWidth<=width,'horizontal scrolling in '+name+' at '+width);
   assert(measured.board.bottom<=height&&measured.board.x>=0&&measured.board.right<=width,'clipped board in '+name+' at '+width);
   assert(measured.next.bottom<=height&&measured.next.y>=0,'next action below the fold in '+name+' at '+width);
   assert(measured.primary.length===1&&measured.primary[0]==='btn-progress-next','Progress lacks one dominant next action in '+name);
   await page.waitForFunction(()=>!jQuery(':animated').length);
   await page.screenshot({path:'output/playwright/progress-'+name+'-'+width+'.png',animations:'disabled'});
   checks.push({name,width,height,boardSize:measured.board.width,boardBottom:measured.board.bottom,nextBottom:measured.next.bottom,overflow:measured.documentWidth-width,primary:measured.primary[0]});
  }
 };
 const play=async move=>{
  await page.locator('#coach-keyboard-move').evaluate(el=>{el.open=true;});
  await page.locator('#coach-keyboard-move-input').fill(move);
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
 };
 const settle=()=>page.waitForFunction(()=>!coachThinking&&coachGameActive&&coachIsUserTurn(),null,{timeout:60000});
 const seed=async()=>page.evaluate(()=>{
  const now=Date.now(),entries=[],fen='7k/8/5KQ1/8/8/8/8/8 w - - 0 1';
  for(const [n,flags,age]of [[100,10,40],[200,15,2]])for(let i=0;i<n;i++)entries.push({
   ts:now-age*DAY_MS+i,tier:i<flags?'mistake':'good',loss:i<flags?200:0,tags:i<flags?['missed_mate']:[],
   phase:'middlegame',ply:i+1,pairNum:Math.ceil((i+1)/2),fenBefore:fen,userUci:'g6e4',bestUci:'g6g7',userSan:'Qe4',bestSan:'Qg7#'
  });
  saveInsights({v:1,entries});renderInsights();
 });
 await fresh();await capture('empty');
 await page.locator('#btn-progress-next').focus();await page.locator('#btn-progress-next').press('Tab');
 await page.keyboard.press('Shift+Tab');
 const focus=await page.locator('#btn-progress-next').evaluate(el=>document.activeElement===el&&getComputedStyle(el).outlineStyle==='solid');
 assert(focus,'Progress next action lacks visible keyboard focus');
 await page.locator('#btn-progress-next').press('Enter');
 assert(await page.evaluate(()=>coachGameActive&&coachStats.moves===0),'empty Progress did not start training');
 await play('h4');await settle();await page.locator('#tab-progress').click();
 assert(await page.evaluate(()=>currentInsightEntries().length===1),'real reviewed move missing from Progress');
 assert((await page.locator('#weekly-review-list').innerText()).includes('1 reviewed move'),'weekly activity did not use the real review');
 const saved=await page.evaluate(()=>({id:coachLocalGameId,pgn:coachGame.pgn(),moves:coachStats.moves,day:JSON.stringify(dailySprintToday())}));
 await page.locator('#tab-game').click();await page.locator('#btn-coach-showwhy').click();
 await page.waitForFunction(()=>!!coachReviewAnalysis,null,{timeout:60000});
 await page.locator('#tab-progress').click();await page.locator('#btn-progress-next').click();
 assert(await page.evaluate(before=>!coachReviewAnalysis&&coachReviewCursor===null&&coachLocalGameId===before.id&&coachGame.pgn()===before.pgn,saved),'Progress did not leave Show why with the same live game');
 await page.reload();await page.locator('#tab-progress').click();await page.locator('#btn-progress-next').click();
 assert(await page.evaluate(before=>coachLocalGameId===before.id&&coachGame.pgn()===before.pgn&&coachStats.moves===before.moves&&JSON.stringify(dailySprintToday())===before.day,saved),'Progress resume changed game or earned daily progress');
 assert(await page.locator('#panel-game').isVisible(),'Progress resume did not reveal Game');
 scenarios.push('empty Progress starts a real reviewed game; reload and one-action resume preserve game and daily progress');

 await fresh();await seed();await capture('focus');
 assert((await page.locator('#btn-progress-next').innerText())==='Practice 1 position','duplicate positions inflated the next action');
 assert((await page.locator('#practice-count').innerText())==='1 due','practice queue and Progress disagree');
 const rate=await page.evaluate(()=>recurringMistakeSummaries(currentInsightEntries())[0]);
 assert(rate.current===15&&rate.previous===10&&rate.currentSamples===200&&rate.previousSamples===100&&Math.abs(rate.change+.025)<1e-8,'unequal-volume rate comparison is wrong');
 await page.locator('#insights-section summary').click();
 await page.locator('#insights-recurring-list').scrollIntoViewIfNeeded();
 await page.screenshot({path:'output/playwright/progress-monthly-rates.png',animations:'disabled'});
 assert((await page.locator('#insights-recurring-list').innerText()).includes('2.5 percentage points lower'),'monthly trend still follows raw counts');
 await page.locator('#insights-section summary').click();
 await page.locator('#progress-next-section').scrollIntoViewIfNeeded();
 await page.locator('#btn-progress-next').click();
 await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:45000});
 assert(await page.evaluate(()=>coachPracticeRun.items.length===1&&dailySprintToday().drillTarget===1),'promised practice count was unreachable');
 await play('Qg7#');await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.completed,null,{timeout:45000});
 await page.locator('#btn-coach-practice-next').click();await settle();
 assert((await page.locator('#coach-keyboard-move-status').innerText())==='','practice status leaked into the live game');
 await page.locator('#tab-progress').click();await capture('after-practice');
 const checkpoint=await page.evaluate(()=>progressRecommendation(currentInsightEntries()).measurement);
 assert(checkpoint.baselineReady&&checkpoint.afterSamples===0&&!checkpoint.enoughEvidence,'fresh rehearsal falsely claimed learning');
 await page.locator('#btn-progress-next').click();await play('e4');await settle();
 await page.locator('#tab-progress').click();
 const followup=await page.evaluate(()=>progressRecommendation(currentInsightEntries()).measurement);
 assert(followup.anchor===checkpoint.anchor&&followup.afterSamples===1,'real follow-up review was not attached to the rehearsal');
 assert((await page.locator('#weekly-review-list').innerText()).includes('1/30 reviewed moves'),'follow-up status is not actionable');
 scenarios.push('normalized monthly rates, one unique due position, real unassisted solve, live handoff, and first follow-up review');

 await fresh();await seed();
 // Exercise a real assisted attempt; hints and answer reveals must not open a checkpoint.
 await page.locator('#btn-progress-next').click();
 await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:45000});
 await page.locator('#btn-coach-practice-hint').click();await play('Qg7#');
 await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.completed,null,{timeout:45000});
 await page.locator('#btn-coach-practice-next').click();await settle();await page.locator('#tab-progress').click();
 assert(await page.evaluate(()=>loadPracticeProgress().events.filter(e=>e.correct&&e.revealed).length===1&&transferMeasurement(currentInsightEntries(),'missed_mate')===null),'assisted solve was counted as an unassisted checkpoint');
 assert((await page.locator('#weekly-review-list').innerText()).includes('1 completed with a hint or answer'),'assisted completion is hidden in practice evidence');
 await capture('assisted');scenarios.push('real hinted completion stays assisted and does not claim transfer evidence');

 await fresh();
 await page.evaluate(()=>{
  const now=Date.now(),anchor=now-2*DAY_MS,entries=[];
  for(const [n,flags,offset]of [[30,10,-DAY_MS],[30,2,DAY_MS]])for(let i=0;i<n;i++)entries.push({ts:anchor+offset+i,tier:i<flags?'mistake':'good',tags:i<flags?['missed_mate']:[],loss:i<flags?200:0,phase:'middlegame'});
  saveInsights({v:1,entries});
  savePracticeProgress({v:2,records:{},events:[{id:'checkpoint',tag:'missed_mate',correct:true,revealed:false,at:anchor},{id:'later-rehearsal',tag:'missed_mate',correct:true,revealed:false,at:now-DAY_MS/2}]});
  renderInsights();
 });
 const comparison=await page.evaluate(()=>progressRecommendation(currentInsightEntries()).measurement);
 assert(comparison.enoughEvidence&&comparison.beforeErrors===10&&comparison.afterErrors===2&&comparison.change===-26.7,'completed evidence window reports the wrong result');
 assert((await page.locator('#weekly-review-list').innerText()).includes('26.7 percentage points lower'),'observed change is missing from Progress');
 assert((await page.locator('#btn-progress-next').innerText())==='Play with this cue','no due position should lead straight to playing');
 assert((await page.locator('#coach-daily-plan-title').innerText()).includes('Missed mate threats'),'daily plan lost a focus when no playable drill was retained');
 await capture('comparison');await page.reload();await page.locator('#tab-progress').click();
 assert(await page.evaluate(before=>progressRecommendation(currentInsightEntries()).measurement.anchor===before.anchor,comparison),'reloading reset a stable practice checkpoint');
 await page.locator('#btn-progress-next').click();
 assert(await page.evaluate(()=>coachGameActive&&!coachPracticeSession&&dailySprintToday().focusTag==='missed_mate'),'no-due evidence recommendation failed to start focused play');
 scenarios.push('30 before / 30 after observed rates survive later rehearsal and reload; absent drills lead to real focused play');

 await fresh();await seed();
 await page.evaluate(()=>{
  coachDbClient=null;coachAuthUser={id:'progress-isolation-fixture'};
  coachRemoteInsightEntries=[];coachRemoteInsightsLoaded=true;
  // Leave the old guest card visible: the click must refresh ownership itself.
 });
 await page.locator('#btn-progress-next').click();
 assert(await page.evaluate(()=>coachGameActive&&!coachPracticeSession&&dailySprintToday().focusTag===null),'stale guest recommendation loaded practice into another owner');
 await page.locator('#tab-progress').click();
 assert((await page.locator('#progress-next-title').innerText())==='Build your baseline','guest focus leaked into the empty account');
 await capture('owner-isolation');
 await page.evaluate(()=>{
  coachRemoteInsightEntries=[{id:'remote-review',ts:Date.now()-1000,tier:'mistake',tags:['development'],loss:200,phase:'opening'}];
  renderWeeklyReview();
 });
 assert((await page.locator('#weekly-review-list').innerText()).includes('1 reviewed move'),'standalone weekly render ignored loaded account reviews');
 assert((await page.locator('#weekly-review-list').innerText()).includes('0 practice attempts'),'guest practice attempts leaked into the account');
 scenarios.push('click-time owner refresh and standalone weekly rendering use the account source without guest review or practice leakage');
 await fresh();
 assert(errors.length===0,'page errors: '+errors.join('; '));
 assert(consoleErrors.length===0,'console errors: '+consoleErrors.join('; '));
 return {scenarios,checks,keyboardFocus:focus,pageErrors:errors.length,consoleErrors:consoleErrors.length};
}
