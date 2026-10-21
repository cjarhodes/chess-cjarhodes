// Playwright CLI body. Every scenario uses a newly created, empty browser context.
async browserPage=>{
 const browser=browserPage.context().browser(),base=browserPage.url().split('?')[0];
 let context,page;const checks=[],scenarios=[],errors=[],consoleErrors=[];
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const fresh=async()=>{if(context)await context.close();context=await browser.newContext();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/favicon/.test(m.text()))consoleErrors.push(m.text());});await page.goto(base);};
 const play=async move=>{await page.locator('#coach-keyboard-move').evaluate(e=>{e.open=true;});await page.locator('#coach-keyboard-move-input').fill(move);await page.locator('#coach-keyboard-move-form button[type=submit]').click();};
 const settle=()=>page.waitForFunction(()=>!coachThinking&&coachGameActive&&coachIsUserTurn(),null,{timeout:60000});
 const source=async(index=0,hint=false)=>{
  await page.locator('#tab-practice').click();await page.locator('#endgame-track-list .endgame-item button').nth(index).click();
  await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:60000});
  if(hint)await page.locator('#btn-coach-practice-hint').click();
  for(let i=0;i<4&&await page.evaluate(()=>!coachPracticeSession.completed);i++){
   await play(await page.evaluate(()=>coachPracticeSession.expectedUci));
   await page.waitForFunction(()=>!coachPracticeSession.grading&&!coachPracticeSession.pendingMove&&(coachPracticeSession.completed||coachPracticeSession.analysisReady),null,{timeout:60000});
  }
  assert(await page.evaluate(()=>coachPracticeSession.completed),'source rehearsal did not complete');
 };
 const begin=async()=>{await page.locator('#btn-learning-transfer-test').click();await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.item.learningTransfer&&coachPracticeSession.analysisReady,null,{timeout:60000});};
 const capture=async(name,action)=>{
  await page.locator('#coach-keyboard-move').evaluate(e=>{e.open=true;});
  for(const [width,height]of [[1280,800],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});await page.waitForFunction(()=>!jQuery(':animated').length);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const m=await page.evaluate(action=>{const b=document.getElementById('coachBoard').getBoundingClientRect(),a=document.querySelector(action).getBoundingClientRect();return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,boardSize:b.width,boardBottom:b.bottom,boardX:b.x,boardRight:b.right,actionTop:a.y,actionBottom:a.bottom,primary:[...document.querySelectorAll('#coach-view [data-primary-action="true"]')].filter(e=>e.checkVisibility()).map(e=>e.id||'keyboard-submit')};},action);
   assert(m.documentWidth<=width&&m.boardX>=0&&m.boardRight<=width&&m.boardBottom<=height&&m.boardSize>=320,name+': board/overflow at '+width);
   assert(m.actionTop>=0&&m.actionBottom<=height,name+': action below fold at '+width);
   assert(m.primary.length<=1,name+': competing primary actions');
   await page.screenshot({path:'output/playwright/learning-'+name+'-'+width+'.png',animations:'disabled'});checks.push({name,...m});
  }
 };
 await fresh();await page.locator('#btn-coach-next-action').click();await play('e4');await settle();
 const original=await page.evaluate(()=>({id:coachLocalGameId,pgn:coachGame.pgn(),moves:coachStats.moves,elo:coachEngineElo}));
 await source();await capture('offer','#btn-learning-transfer-test');
 await page.locator('#btn-learning-transfer-test').focus();await page.locator('#btn-learning-transfer-test').press('Tab');await page.keyboard.press('Shift+Tab');
 const keyboardFocus=await page.locator('#btn-learning-transfer-test').evaluate(e=>document.activeElement===e&&getComputedStyle(e).outlineStyle==='solid');assert(keyboardFocus,'different-position action lacks keyboard focus');
 await begin();const before=await page.evaluate(()=>({record:currentLearningTransferRecord(),events:loadPracticeProgress().events.length,day:JSON.stringify(dailySprintToday())}));
 assert(before.record.sourceFen!==before.record.challengeFen&&before.record.firstResult==='pending','check reused source or graded opening the board');
 await capture('new-position','#btn-coach-practice-exit');
 await page.evaluate(()=>{window.learningOriginalEvaluate=evaluatePracticeMove;window.evaluatePracticeMove=async()=>({unknown:true});});
 await play('Re7');await page.waitForFunction(()=>!coachPracticeSession.grading);
 assert(await page.evaluate(()=>currentLearningTransferRecord().firstResult==='pending'&&coachPracticeSession.misses===0),'unavailable engine analysis became a miss');
 await page.evaluate(()=>{window.evaluatePracticeMove=learningOriginalEvaluate;});await page.reload();await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:60000});
 assert(await page.evaluate(()=>coachPracticeReturnState&&currentLearningTransferRecord().firstResult==='pending'),'reload lost borrowed game or pending result');
 await capture('resumed','#btn-coach-practice-exit');await play('Re8#');await page.waitForFunction(()=>coachPracticeSession.completed);
 const done=await page.evaluate(()=>({record:currentLearningTransferRecord(),events:loadPracticeProgress().events.length,day:JSON.stringify(dailySprintToday())}));
 assert(done.record.firstResult==='sound'&&done.record.completed,'independent sound decision absent');
 assert(done.events===before.events&&done.day===before.day,'check inflated rehearsal or daily progress');
 await capture('completed','#btn-coach-practice-next');await page.locator('#btn-coach-practice-next').click();await settle();
 assert(await page.evaluate(s=>coachLocalGameId===s.id&&coachGame.pgn()===s.pgn&&coachStats.moves===s.moves&&coachEngineElo===s.elo,original),'original game identity, PGN, stats or level changed');
 await play(await page.evaluate(async()=>(await engineClient.evaluate(coachGame.fen(),10)).bestmove));await settle();
 await page.locator('#tab-progress').click();await page.locator('.learning-transfer-result summary').first().click();await page.locator('.coach-panel').evaluate(e=>{e.scrollTop=0;});
 assert(await page.evaluate(()=>loadGrowthState().learningTransfers[0].observations.length===1),'real follow-up review not recorded');
 assert((await page.locator('#learning-transfer-progress-list').innerText()).includes('not proof'),'follow-up made unsupported learning claim');
 const backup=await page.evaluate(()=>{const payload=readTrainingBackup();mergeImportedTrainingData(payload);return loadGrowthState().learningTransfers;});assert(backup.length===1&&backup[0].firstResult==='sound','backup merge lost or duplicated evidence');
 assert(await page.locator('.learning-transfer-result').first().evaluate(e=>e.open),'evidence refresh collapsed a result while reading it');
 await capture('progress','#btn-progress-next');scenarios.push('Rehearsal -> different position -> ungraded engine result -> reload -> independent first decision -> exact game return -> real follow-up and backup');

 await fresh();await page.locator('#btn-coach-next-action').click();await play('e4');await settle();await source();await begin();
 await play('Re7');await page.waitForFunction(()=>coachPracticeSession.misses===1);
 const first=await page.evaluate(()=>currentLearningTransferRecord());assert(first.firstResult==='needs-work'&&first.firstUci==='e1e7','first miss was not recorded');
 await capture('first-miss','#btn-coach-practice-exit');await page.reload();await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:60000});
 await page.locator('#btn-coach-practice-hint').click();await play('Re8#');await page.waitForFunction(()=>coachPracticeSession.completed);
 assert(await page.evaluate(s=>{const r=currentLearningTransferRecord();return r.firstResult==='needs-work'&&r.firstAt===s.firstAt&&r.helpUsed;},first),'hinted retry overwrote first miss');
 await page.locator('#btn-coach-practice-next').click();await settle();await page.locator('#tab-progress').click();await page.locator('.learning-transfer-result summary').click();
 await page.getByRole('button',{name:'Rehearse this position',exact:true}).click();await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:60000});
 assert((await page.locator('#coach-practice-title').innerText())==='Rehearse this check','repeat was described as a new check');
 await play('Re8#');await page.waitForFunction(()=>coachPracticeSession.completed);
 assert(await page.evaluate(s=>loadGrowthState().learningTransfers.length===1&&currentLearningTransferRecord().firstAt===s.firstAt&&currentLearningTransferRecord().firstResult==='needs-work',first),'rehearsal inflated independent checks');
 await page.locator('#btn-coach-practice-next').click();await settle();await source();await begin();
 assert(await page.evaluate(()=>currentLearningTransferRecord().challengeId==='defended-square'),'a previously opened position was offered as fresh');
 await play('Qg7+');await page.waitForFunction(()=>coachPracticeSession.misses===1);await play('Qh5#');await page.waitForFunction(()=>coachPracticeSession.completed);
 assert(await page.evaluate(()=>currentLearningTransferRecord().firstResult==='needs-work'&&coachGame.in_checkmate()),'changed defense or equivalent mating alternative was misgraded');
 await page.locator('#btn-coach-practice-next').click();await settle();await source();
 assert(!await page.locator('#btn-learning-transfer-test').isVisible()&&(await page.locator('#learning-transfer-note').innerText()).includes('No fresh'),'exhausted pool silently repeated a known check');
 scenarios.push('First miss survives retry, hint, reload and explicit rehearsal; next check changes a defender, accepts equivalent mate, and exhausted pool routes to play');

 await fresh();await source(0,true);await begin();await page.locator('#btn-coach-practice-hint').click();
 assert(await page.evaluate(()=>currentLearningTransferRecord().firstResult==='pending'),'hint alone became a graded attempt');
 await page.reload();await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:60000});await play('Re8#');await page.waitForFunction(()=>coachPracticeSession.completed);
 assert(await page.evaluate(()=>currentLearningTransferRecord().firstResult==='assisted'),'help before first choice was called independent');
 await capture('assisted','#btn-coach-practice-next');await page.locator('#btn-coach-practice-next').click();await settle();
 await page.evaluate(()=>{window.learningOriginalOwner=growthOwnerId;growthOwnerId=()=> 'learning-owner-b';renderWeeklyReview();});
 assert(!await page.locator('#learning-transfer-progress').isVisible(),'another owner saw guest check evidence');
 await page.evaluate(()=>{growthOwnerId=learningOriginalOwner;renderWeeklyReview();});scenarios.push('Hinted source and hinted check remain distinct; hint survives reload; owner-scoped Progress hides another owner’s evidence');

 await fresh();await source(2);await begin();
 assert(await page.evaluate(()=>coachUserSide==='black'&&coachBoardFlipped&&currentLearningTransferRecord().challengeId==='black-passer'),'Black-side check orientation or source failed');
 await capture('black-side','#btn-coach-practice-exit');await play('Kf6');await page.waitForFunction(()=>coachPracticeSession.completed,null,{timeout:60000});
 assert(await page.evaluate(()=>currentLearningTransferRecord().firstResult==='sound'&&currentLearningTransferRecord().firstUci!=='b2b1q'),'strong alternative was rejected in favor of exact authored answer');
 await page.locator('#btn-coach-practice-next').click();await settle();
 await fresh();await page.locator('#btn-coach-next-action').click();await play('e4');await settle();
 const protectedGame=await page.evaluate(()=>({id:coachLocalGameId,pgn:coachGame.pgn(),moves:coachStats.moves}));
 await page.locator('#nav-library').click();await page.locator('.opening-btn[data-id="italian"]').first().click();await page.locator('#btn-end').click();await page.locator('#btn-library-transfer').click();await settle();
 const openingGame=await page.evaluate(()=>({id:coachLocalGameId,pgn:coachGame.pgn(),contextId:coachOpeningTransfer.id}));
 await source();await begin();await play('Re8#');await page.waitForFunction(()=>coachPracticeSession.completed);await page.locator('#btn-coach-practice-next').click();await settle();
 assert(await page.evaluate(s=>coachLocalGameId===s.id&&coachGame.pgn()===s.pgn&&coachOpeningTransfer.id===s.contextId&&!!coachOpeningTransfer.returnState,openingGame),'check lost the nested opening or original game');
 await capture('opening-return','#btn-opening-transfer-return');
 await play(await page.evaluate(async()=>(await engineClient.evaluate(coachGame.fen(),10)).bestmove));await settle();
 assert(await page.evaluate(()=>loadGrowthState().learningTransfers[0].observations.length===1),'opening-session move did not follow the chosen cue');
 await page.locator('#btn-opening-transfer-return').click();await page.waitForFunction(()=>!coachOpeningTransfer);
 assert(await page.evaluate(s=>coachLocalGameId===s.id&&coachGame.pgn()===s.pgn&&coachStats.moves===s.moves,protectedGame),'opening return after a check changed original game');
 scenarios.push('Saved game -> opening session -> rehearsal -> different-position check -> opening game and real review -> original saved game');
 const anchors=await page.evaluate(async()=>{const out=[];for(const p of LEARNING_TRANSFER_POSITIONS){const r=await engineClient.evaluate(p.fen,14,{multipv:6});const expected=r.lines.find(line=>line.pv[0]===p.uci);out.push({id:p.id,best:r.bestmove,limit:PRACTICE_SOUND_LOSS_CP,expected:!!expected,loss:expected?Math.max(0,scoreToCp(r.lines[0])-scoreToCp(expected)):null,mate:practiceMoveIsMate(p.fen,p.uci)});}return out;});
 assert(anchors.every(a=>a.mate||a.expected&&a.loss<=a.limit),'authored anchor is not a sound engine candidate: '+JSON.stringify(anchors));
 scenarios.push('Black-side transfer check accepts a strong non-authored move; all five authored anchors verified against the real engine');
 assert(errors.length===0,'page errors: '+errors.join('; '));assert(consoleErrors.length===0,'console errors: '+consoleErrors.join('; '));await context.close();
 return {scenarios,checks,keyboardFocus,anchors,pageErrors:errors.length,consoleErrors:consoleErrors.length};
}
