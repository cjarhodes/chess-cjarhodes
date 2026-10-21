// Playwright CLI body: real coaching flows, three desktop sizes, and screenshot evidence.
async page => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const assert=(x,message)=>{if(!x)throw new Error(message);};
 await page.route('**/*',route=>route.continue());
 await page.evaluate(()=>localStorage.clear());await page.reload();
 const checks=[];
 const capture=async name=>{
  for(const [width,height]of [[1280,800],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.waitForFunction(()=>{
    const area=document.querySelector('.coach-board-area'),b=document.getElementById('coachBoard').getBoundingClientRect();
    return area.scrollHeight<=area.clientHeight+2&&Math.abs(b.width-b.height)<8&&b.width>=320;
   },null,{timeout:15000});
   const measured=await page.evaluate(()=>{
    const visible=e=>e.checkVisibility()&&getComputedStyle(e).visibility!=='hidden';
    const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();
    const view=document.getElementById('coach-view');
    return {state:view.dataset.uiState,width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,board:rect('#coachBoard'),keyboard:rect('#coach-keyboard-move'),tools:rect('.coach-board-area .board-controls'),primary:[...view.querySelectorAll('[data-primary-action="true"]')].filter(visible).map(e=>({id:e.id||'keyboard-submit',disabled:e.disabled})),boardPrimary:document.getElementById('coachBoard-wrap').dataset.primaryTarget==='true'};
   });
   assert(measured.documentWidth<=width,'horizontal page overflow in '+name+' at '+width);
   assert(measured.board.bottom<=height&&measured.board.x>=0&&measured.board.right<=width,'board clipped in '+name+' at '+width);
   assert(measured.keyboard.bottom<=height,'keyboard entry clipped in '+name+' at '+width);
   if(measured.tools.height)assert(measured.tools.bottom<=height,'board tools clipped in '+name+' at '+width);
   assert(measured.primary.length<=1,'competing primary actions in '+name);
   assert(measured.primary.every(a=>!a.disabled),'primary action is disabled in '+name);
   if(['ready','user-turn','review','practice','practice-complete','ended','complete'].includes(measured.state))assert(measured.primary.length===1||measured.boardPrimary,'no clear action in '+name);
   await page.waitForFunction(()=>!jQuery(':animated').length);
   await page.screenshot({path:'output/playwright/ui-'+name+'-'+width+'.png',animations:'disabled'});
   checks.push({name,...measured});
  }
 };
 const play=async move=>{
  await page.locator('#coach-keyboard-move').evaluate(el=>{el.open=true;});
  await page.locator('#coach-keyboard-move-input').fill(move);
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
 };
 const settle=()=>page.waitForFunction(()=>!coachThinking&&(!coachGameActive||coachIsUserTurn()),null,{timeout:60000});
 await capture('ready');
 await page.locator('#group-profile').evaluate(el=>{el.open=true;});
 await page.locator('#player-minutes').fill('5');
 await page.locator('#player-style').selectOption('play');
 await page.locator('#player-profile-form button[type=submit]').click();
 await page.locator('#group-profile').evaluate(el=>{el.open=false;});
 await page.locator('#tab-progress').click();
 await page.locator('#btn-coach-next-action').click();
 assert(await page.locator('#panel-game').isVisible(),'starting training left feedback hidden behind another panel');
 assert(await page.evaluate(()=>coachGameActive&&coachStats.moves===0),'single-action start failed');
 await capture('your-turn');
 await page.locator('#coach-keyboard-move summary').click();
 await page.locator('#coach-keyboard-move summary').press('Tab');
 const focus=await page.locator('#coach-keyboard-move-input').evaluate(el=>({focused:document.activeElement===el,outline:getComputedStyle(el).outlineStyle}));
 assert(focus.focused&&focus.outline==='solid','keyboard entry lacks visible keyboard focus');
 // Gate timing only, retaining real classification and real opponent searches.
 await page.evaluate(()=>{
  window.uiOriginalClassify=classifyMove;window.uiOriginalEvaluate=engineClient.evaluate;
  const classificationGate=new Promise(resolve=>{window.uiReleaseClassification=resolve;});
  const opponentGate=new Promise(resolve=>{window.uiReleaseOpponent=resolve;});
  window.classifyMove=async(...args)=>{await classificationGate;return uiOriginalClassify(...args);};
  engineClient.evaluate=async function(fen,depth,opts){const result=await uiOriginalEvaluate.call(this,fen,depth,opts);if(opts&&opts.multipv>=10)await opponentGate;return result;};
 });
 await play('h4');await capture('analyzing');
 await page.evaluate(()=>uiReleaseClassification());
 await page.waitForFunction(()=>document.getElementById('coach-view').dataset.uiState==='opponent-turn',null,{timeout:60000});
 await capture('opponent-turn');await page.evaluate(()=>uiReleaseOpponent());await settle();
 await page.evaluate(()=>{window.classifyMove=uiOriginalClassify;engineClient.evaluate=uiOriginalEvaluate;});
 await page.waitForFunction(()=>!document.getElementById('btn-coach-showwhy').disabled);
 await capture('feedback');
 const live=await page.evaluate(()=>({pgn:coachGame.pgn(),id:coachLocalGameId,stats:coachStats.moves}));
 await page.locator('#btn-coach-showwhy').click();
 await page.waitForFunction(()=>!!coachReviewAnalysis,null,{timeout:60000});
 await capture('review');await page.locator('#btn-coach-backtogame').click();
 await page.locator('#btn-coach-review-practice').click();
 await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:60000});
 await capture('practice');await page.reload();
 assert(await page.evaluate(()=>!!coachPracticeSession),'practice did not resume on reload');
 await capture('resumed-practice');
 await page.locator('#coach-keyboard-move').evaluate(el=>{el.open=true;});
 await page.evaluate(()=>{
  window.uiOriginalPractice=evaluatePracticeMove;
  const gate=new Promise(resolve=>{window.uiReleasePractice=resolve;});
  window.evaluatePracticeMove=async(...args)=>{await gate;return uiOriginalPractice(...args);};
 });
 await play(await page.evaluate(()=>coachPracticeSession.expectedUci));
 await capture('practice-checking');await page.evaluate(()=>uiReleasePractice());
 await page.waitForFunction(()=>!coachPracticeSession.grading&&!coachPracticeSession.pendingMove&&(coachPracticeSession.completed||coachPracticeSession.analysisReady),null,{timeout:60000});
 await page.evaluate(()=>{window.evaluatePracticeMove=uiOriginalPractice;});
 for(let step=0;step<4&&await page.evaluate(()=>!coachPracticeSession.completed);step++){
  const move=await page.evaluate(()=>coachPracticeSession.expectedUci);await play(move);
  await page.waitForFunction(()=>!coachPracticeSession.grading&&!coachPracticeSession.pendingMove&&(!coachPracticeSession||coachPracticeSession.completed||coachPracticeSession.analysisReady),null,{timeout:60000});
 }
 assert(await page.evaluate(()=>coachPracticeSession.completed),'practice did not complete');
 await capture('practice-complete');
 const next=await page.evaluate(()=>document.querySelector('#coach-view [data-primary-action="true"]').id);
 await page.locator('#'+next).click();
 assert(await page.evaluate(state=>!coachPracticeSession&&coachGame.pgn()===state.pgn&&coachLocalGameId===state.id&&coachStats.moves===state.stats,live),'practice transfer changed live game or stats');
 await page.reload();
 assert(await page.evaluate(state=>coachLocalGameId===state.id&&coachGame.pgn()===state.pgn,live),'live game did not resume');
 await page.locator('#tab-progress').click();
 await page.locator('#btn-coach-next-action').click();
 assert(await page.locator('#panel-game').isVisible(),'resuming training did not reveal the feedback panel');
 assert(await page.locator('#coachBoard').evaluate(el=>document.activeElement===el),'single-action resume did not focus board');
 for(let i=0;i<10&&await page.evaluate(()=>!dailySprintToday().completedAt);i++){
  const move=await page.evaluate(async()=>{const r=await engineClient.evaluate(coachGame.fen(),8,{skill:20});return r.bestmove;});
  await play(move);await settle();
 }
 assert(await page.evaluate(()=>!!dailySprintToday().completedAt),'short session did not complete through real reviewed moves');
 await page.locator('#btn-coach-resign').click();
 await page.waitForFunction(()=>document.getElementById('summary-overlay').getAttribute('aria-hidden')==='false');
 const summaryPrimaries=await page.locator('.summary-actions .primary').count();assert(summaryPrimaries===1,'game summary has competing primary actions');
 await page.locator('#btn-summary-close').click();
 await capture('complete');
 await page.locator('#btn-coach-next-action').click();assert(await page.locator('#panel-progress').isVisible(),'completion did not lead to progress');
 assert(errors.length===0,'page errors: '+errors.join(';'));
 return {checks:checks.map(r=>({name:r.name,state:r.state,width:r.width,height:r.height,boardSize:r.board.width,boardBottom:r.board.bottom,controlsBottom:r.tools.bottom,keyboardBottom:r.keyboard.bottom,overflow:r.documentWidth-r.width,primary:r.primary.map(a=>a.id),boardPrimary:r.boardPrimary})),focus,pageErrors:errors.length,journey:'start, keyboard move, analysis, opponent reply, review, practice reload, completion, live return, resume, daily completion and Progress'};
}
