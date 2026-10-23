// End-to-end polish checks in new empty contexts. Searches and grading are real;
// one held candidate response makes the cancelled-work race deterministic.
async browserPage => {
 const browser=browserPage.context().browser(),base=browserPage.url().split('?')[0];
 const contexts=[],checks=[],captures=[],errors=[];let page;
 const assert=(ok,message)=>{if(!ok)throw Error(message);checks.push(message);};
 const fresh=async()=>{if(page)await page.context().close();const c=await browser.newContext();contexts.push(c);page=await c.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('#btn-coach-next-action').waitFor();};
 const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const play=async move=>{await page.locator('#coach-keyboard-move').evaluate(e=>e.open=true);await page.locator('#coach-keyboard-move-input').fill(move);await page.locator('#coach-keyboard-move-form button').click();};
 const settle=()=>page.waitForFunction(()=>coachGameActive&&!coachThinking&&coachIsUserTurn(),null,{timeout:60000});
 const practiceReady=()=>page.waitForFunction(()=>coachPracticeSession&&!coachPracticeSession.grading&&!coachPracticeSession.pendingMove&&(coachPracticeSession.completed||coachPracticeSession.analysisReady),null,{timeout:60000});
 const gameState=()=>page.evaluate(()=>({id:coachLocalGameId,pgn:coachGame.pgn(),stats:JSON.stringify(coachStats),flipped:coachBoardFlipped}));
 const exact=async state=>assert(JSON.stringify(await gameState())===JSON.stringify(state),'game identity, PGN, stats and orientation remain exact');
 const capture=async(name,workspace)=>{
  for(const[width,height]of[[1280,800],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});
   if(workspace!=='summary')await page.waitForFunction(workspace=>{const area=document.querySelector(workspace==='library'?'#library-view .board-area':'.coach-board-area'),b=document.getElementById(workspace==='library'?'myBoard':'coachBoard').getBoundingClientRect();return area.scrollHeight<=area.clientHeight+2&&Math.abs(b.width-b.height)<8;},workspace,{timeout:15000});
   await page.waitForFunction(()=>!jQuery(':animated').length);await frame();
   const m=await page.evaluate(workspace=>{
    const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();
    if(workspace==='summary')return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,card:rect('.summary-card'),action:rect('.summary-actions'),takeaway:document.getElementById('summary-takeaway').checkVisibility()?rect('#summary-takeaway'):null,primary:[...document.querySelectorAll('.summary-actions .primary')].filter(e=>e.checkVisibility()).map(e=>e.id)};
    return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,board:rect(workspace==='library'?'#myBoard':'#coachBoard'),action:rect(workspace==='library'?'#library-view .board-controls':'#coach-keyboard-move'),keyboard:rect(workspace==='library'?'#library-keyboard-move':'#coach-keyboard-move')};
   },workspace);
   assert(m.documentWidth<=width,name+': no horizontal scrolling '+width);
   if(m.board)assert(m.board.x>=0&&m.board.right<=width&&m.board.bottom<=height&&m.board.width>=320&&m.action.bottom<=height&&m.keyboard.bottom<=height,name+': board and essential controls fit '+width);
   else{assert(m.card.y>=0&&m.card.bottom<=height&&m.action.y>=m.card.y&&m.action.bottom<=m.card.bottom&&m.primary.length===1,name+': one reachable review action '+width);if(m.takeaway)assert(m.takeaway.y>=m.card.y&&m.takeaway.bottom<m.action.y,name+': takeaway visible before details '+width);}
   await page.screenshot({path:'output/playwright/cohesion-'+name+'-'+width+'.png',animations:'disabled'});captures.push({name,workspace,...m});
  }
 };
 try{
  await fresh();await page.locator('#btn-coach-next-action').click();await play('e4');await settle();await play('f3');await settle();
  const live=await gameState();
  await page.locator('#btn-coach-showwhy').click();await page.waitForFunction(()=>!!coachReviewAnalysis,null,{timeout:60000});
  await page.locator('#nav-library').click();await page.locator('.opening-btn[data-id=italian]').click();await page.locator('#btn-next').click();await page.locator('#btn-next').click();
  await page.locator('#library-keyboard-move').evaluate(e=>e.open=true);await capture('study','library');
  const libraryPly=await page.evaluate(()=>currentMoveIdx);
  await page.locator('#nav-coach').click();await exact(live);
  assert(await page.evaluate(()=>!coachReviewAnalysis&&Chessboard.objToFen(coachBoard.position())===coachGame.fen().split(' ')[0]&&document.getElementById('coach-view').dataset.uiState==='user-turn'),'return from a transient explanation shows the actual live board');
  await page.locator('#tab-progress').click();await page.locator('#btn-coach-next-action').click();await exact(live);
  assert(await page.locator('#panel-game').isVisible()&&await page.locator('#coachBoard').evaluate(e=>document.activeElement===e),'resume from Progress reveals feedback and focuses the board');
  await page.locator('#tab-practice').click();await page.locator('#endgame-track-list .endgame-item button').first().click();await practiceReady();
  await page.locator('#btn-coach-practice-hint').click();await page.locator('#btn-coach-practice-hint').click();
  const drill=await page.evaluate(()=>({fen:coachGame.fen(),hint:coachPracticeSession.hintStage,events:loadPracticeProgress().events.length,day:JSON.stringify(dailySprintToday())}));
  await page.locator('#nav-coach').focus();await page.keyboard.press('ArrowLeft');
  assert(await page.evaluate(ply=>!coachMode&&currentMoveIdx===ply,libraryPly),'top-tab arrow navigation does not also step the Library board');
  assert((await page.locator('#opening-transfer-detail').textContent()).includes('Queen mate lesson is still in progress'),'Library describes the lesson that its resume button will reopen');
  assert(await page.locator('#opening-transfer-cue').isDisabled(),'unavailable opening selection is disabled while resuming a drill');
  await capture('paused-lesson','library');await page.locator('#btn-library-transfer').click();await practiceReady();
  assert(await page.evaluate(d=>coachGame.fen()===d.fen&&coachPracticeSession.hintStage===d.hint&&loadPracticeProgress().events.length===d.events&&JSON.stringify(dailySprintToday())===d.day,drill),'navigation preserves drill position, hints, attempts and daily progress');
  await play('Qg7#');await practiceReady();assert(await page.evaluate(()=>coachPracticeSession.completed),'resumed drill accepts its legal solution');
  await capture('returned-lesson','coach');await page.locator('#btn-coach-practice-next').click();await exact(live);await page.reload();await settle();await exact(live);
  await page.locator('#btn-coach-resign').click();await page.locator('#summary-overlay').waitFor({state:'visible'});
  const promised=await page.evaluate(()=>summaryPracticeItems.length);
  await capture('game-review','summary');
  const beforeFlip=await page.evaluate(()=>coachBoardFlipped);await page.keyboard.press('f');await page.keyboard.press('Home');assert(await page.evaluate(()=>coachBoardFlipped)===beforeFlip&&await page.evaluate(()=>coachReviewCursor===null),'review dialog blocks background board shortcuts');
  await page.locator('.summary-body').evaluate(e=>e.scrollTop=e.scrollHeight);await capture('review-scrolled','summary');
  const row=page.locator('#summary-critical-list .moment-row').first();const ply=Number(await row.getAttribute('data-ply'));await row.click();
  assert(await page.evaluate(p=>coachReviewCursor===p&&Chessboard.objToFen(coachBoard.position())===coachFenAtPly(p).split(' ')[0],ply),'critical moment opens the selected review position');
  await page.locator('#nav-library').click();await page.locator('#nav-coach').click();await exact(live);
  assert(await page.evaluate(p=>coachReviewCursor===p&&Chessboard.objToFen(coachBoard.position())===coachFenAtPly(p).split(' ')[0],ply),'Library navigation preserves a selected historical position');
  await page.locator('#btn-coach-openreview').click();await page.locator('#btn-summary-practice').click();await practiceReady();
  assert(await page.evaluate(n=>coachPracticeRun.items.length===n,promised),'post-game practice starts the advertised distinct session');
  for(let position=0;position<promised;position++){
   for(let move=0;move<3&&await page.evaluate(()=>!coachPracticeSession.completed);move++){await play(await page.evaluate(()=>coachPracticeSession.expectedUci));await practiceReady();}
   assert(await page.evaluate(()=>coachPracticeSession.completed),'post-game position completes through its continuation');
   if(position+1<promised){await page.locator('#btn-coach-practice-next').click();await practiceReady();}
  }
  await page.locator('#btn-coach-practice-next').click();
  assert(await page.evaluate(()=>!coachPracticeSession),'completed post-game practice reaches its next state');

  // A real opponent reply must continue behind a retained review cursor.
  await fresh();await page.locator('#btn-coach-next-action').click();const replyGameId=await page.evaluate(()=>coachLocalGameId);
  await page.evaluate(()=>{window.cohesionReplyEvaluate=engineClient.evaluate;window.cohesionReplyHeld=false;const gate=new Promise(r=>window.cohesionReleaseReply=r);engineClient.evaluate=async function(fen,depth,opts){const result=await cohesionReplyEvaluate.call(this,fen,depth,opts);if(opts&&opts.multipv>=10){cohesionReplyHeld=true;await gate;}return result;};});
  await play('e4');await page.waitForFunction(()=>cohesionReplyHeld,null,{timeout:60000});await page.locator('#btn-coach-prev').click();
  await page.locator('#nav-library').click();await page.locator('#nav-coach').click();await page.evaluate(()=>cohesionReleaseReply());
  await page.waitForFunction(()=>coachGame.history().length===2,null,{timeout:60000});
  assert(await page.evaluate(id=>coachLocalGameId===id&&coachStats.moves===1&&coachReviewLog.length===1&&coachReviewCursor===0&&Chessboard.objToFen(coachBoard.position())===coachFenAtPly(0).split(' ')[0],replyGameId),'opponent replies once while the selected review position stays intact');
  await capture('review-reply','coach');await page.locator('#btn-coach-live').click();
  assert(await page.evaluate(()=>coachIsUserTurn()&&document.getElementById('coach-view').dataset.uiState==='user-turn'),'returning Live reaches a playable game after the resumed reply');
  await page.evaluate(()=>{engineClient.evaluate=cohesionReplyEvaluate;});

  // Deliberately hold a candidate so returning quickly cannot revive old work.
  await fresh();await page.locator('#btn-coach-next-action').click();await play('e4');await settle();const protectedGame=await gameState();
  await page.locator('#tab-practice').click();await page.locator('#endgame-track-list .endgame-item button').first().click();await practiceReady();
  await page.evaluate(()=>{window.cohesionOriginalEvaluate=evaluatePracticeMove;window.cohesionOldSession=coachPracticeSession;window.cohesionOldFinished=false;const gate=new Promise(r=>window.cohesionRelease=r);window.evaluatePracticeMove=async()=>{await gate;window.cohesionOldFinished=true;return{sound:true,exact:true,loss:0};};});
  await play('Qg7#');await page.waitForFunction(()=>coachPracticeSession.grading);await page.locator('#nav-library').click();await page.locator('#nav-coach').click();await practiceReady();
  await page.locator('#coach-keyboard-move-input').fill('Qe4');await page.evaluate(()=>cohesionRelease());await page.waitForFunction(()=>cohesionOldFinished);await frame();
  assert(await page.evaluate(()=>coachPracticeSession!==cohesionOldSession&&!coachPracticeSession.completed&&loadPracticeProgress().events.length===0),'cancelled candidate cannot score or complete the resumed drill');
  assert(await page.locator('#coach-keyboard-move-input').inputValue()==='Qe4'&&!(await page.locator('#coach-keyboard-move-status').textContent()).includes('changed'),'old keyboard completion cannot clear or overwrite the new input');
  assert((await page.locator('#coach-practice-status').textContent()).includes('interrupted'),'interrupted candidate has a clear retry state');
  await page.evaluate(()=>{window.evaluatePracticeMove=cohesionOriginalEvaluate;});await play('Qg7#');await practiceReady();assert(await page.evaluate(()=>coachPracticeSession.completed&&loadPracticeProgress().events.length===1),'fresh retry records exactly one completion');
  await page.locator('#btn-coach-practice-next').click();await exact(protectedGame);

  await fresh();await page.locator('#nav-library').click();await page.locator('.opening-btn[data-id=italian]').click();await page.locator('#btn-quiz').click();await page.locator('#library-keyboard-move').evaluate(e=>e.open=true);
  await page.locator('#library-keyboard-move-input').fill('a3');await page.locator('#library-keyboard-move-form button').click();await page.waitForFunction(()=>document.getElementById('feedback-bar').classList.contains('show'));
  await capture('quiz-feedback','library');await page.locator('#library-keyboard-move-input').fill('e4');await page.locator('#library-keyboard-move-form button').click();await page.waitForFunction(()=>game.history().length>=2);
  assert(await page.evaluate(()=>game.history()[0]==='e4'),'Library keyboard quiz still accepts the lesson move');
  await page.locator('#btn-study').click();assert(await page.locator('#opening-transfer-cue').isVisible(),'Quiz-to-Study restores the opening actions immediately');const selectBefore=await page.evaluate(()=>({ply:currentMoveIdx,index:document.getElementById('opening-transfer-cue').selectedIndex}));
  await page.locator('#opening-transfer-cue').evaluate(e=>{e.addEventListener('keydown',event=>queueMicrotask(()=>window.cohesionSelectPrevented=event.defaultPrevented));});
  await page.locator('#opening-transfer-cue').focus();await page.keyboard.press(selectBefore.index?'ArrowUp':'ArrowDown');
  assert(await page.evaluate(s=>currentMoveIdx===s.ply&&!window.cohesionSelectPrevented,selectBefore),'idea selector arrow is not consumed by board shortcuts');
  await page.locator('#opening-transfer-cue').selectOption(String(selectBefore.index?selectBefore.index-1:1));
  assert(await page.evaluate(s=>currentMoveIdx===s.ply&&document.getElementById('opening-transfer-cue').selectedIndex!==s.index,selectBefore),'idea selection remains functional without advancing the board');
  await page.locator('#btn-explore').click();await capture('explore','library');
  await page.locator('#nav-coach').click();await page.locator('#btn-coach-next-action').click();await page.locator('#btn-coach-resign').click();await page.locator('#summary-overlay').waitFor({state:'visible'});
  await capture('empty-review','summary');await page.keyboard.press('Tab');assert(await page.locator('#summary-overlay').evaluate(e=>e.contains(document.activeElement)),'review traps keyboard focus');
  await page.keyboard.press('Escape');assert(await page.locator('#btn-coach-openreview').evaluate(e=>document.activeElement===e),'closing review returns focus to an available control');
  assert(errors.length===0,'no browser runtime errors');
  return{kind:'real-workflows-with-controlled-in-flight-responses',checks:checks.length,captures,errors};
 }finally{for(const context of contexts)if(context.pages().length)await context.close();}
}
