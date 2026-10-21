// Playwright CLI body: study/quiz -> opening idea -> real opponent -> review/return.
async page=>{
 const errors=[],consoleErrors=[],checks=[],scenarios=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 await page.route('**/*',r=>r.continue());
 const appUrl=page.url().split('?')[0];
 const fresh=async()=>{await page.evaluate(()=>{localStorage.clear();sessionStorage.removeItem('ui:coach-panel-tab');});await page.goto(appUrl);};
 const settle=()=>page.waitForFunction(()=>!coachThinking&&coachGameActive&&coachIsUserTurn(),null,{timeout:60000});
 const play=async move=>{await page.locator('#coach-keyboard-move').evaluate(e=>{e.open=true;});await page.locator('#coach-keyboard-move-input').fill(move);await page.locator('#coach-keyboard-move-form button[type=submit]').click();};
 const playBest=async()=>{await play(await page.evaluate(async()=>{const r=await engineClient.evaluate(coachGame.fen(),10,{skill:20});return r.bestmove;}));await settle();};
 const capture=async(name,library=false)=>{
  for(const [width,height]of [[1280,800],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const board=library?'#myBoard':'#coachBoard';
   await page.waitForFunction(selector=>{const b=document.querySelector(selector).getBoundingClientRect();return b.width>=320&&Math.abs(b.width-b.height)<8;},board,{timeout:15000});
   await page.waitForFunction(()=>!jQuery(':animated').length);
   const measured=await page.evaluate(({board,library})=>{
    const b=document.querySelector(board).getBoundingClientRect();
    const action=document.getElementById(library?'btn-library-transfer':'btn-opening-transfer-review').getBoundingClientRect();
    const primary=[...document.querySelectorAll('#coach-view [data-primary-action="true"]')].filter(e=>e.checkVisibility()).map(e=>e.id||'keyboard-submit');
    return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,boardSize:b.width,boardBottom:b.bottom,boardX:b.x,boardRight:b.right,actionBottom:action.bottom,primary};
   },{board,library});
   assert(measured.documentWidth<=width,name+': horizontal scrolling at '+width);
   assert(measured.boardBottom<=height&&measured.boardX>=0&&measured.boardRight<=width,name+': board clipped at '+width);
   assert(measured.actionBottom<=height,name+': transfer action below fold at '+width);
   if(!library)assert(measured.primary.length<=1,name+': competing primary actions');
   await page.screenshot({path:'output/playwright/opening-'+name+'-'+width+'.png',animations:'disabled'});
   checks.push({name,...measured});
  }
 };
 const captureSummary=async()=>{
  for(const [width,height]of [[1280,800],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});await page.locator('.summary-card').evaluate(e=>{e.scrollTop=0;});
   await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.summary-card')).opacity)>=.99);
   const measured=await page.evaluate(()=>{
    const card=document.querySelector('.summary-card').getBoundingClientRect(),action=document.getElementById('btn-summary-opening-return').getBoundingClientRect();
    return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,cardTop:card.y,cardBottom:card.bottom,actionTop:action.y,actionBottom:action.bottom,primaries:document.querySelectorAll('.summary-actions .primary').length};
   });
   assert(measured.cardTop>=0&&measured.cardBottom<=height,'opening review card clipped');
   assert(measured.actionTop>=measured.cardTop&&measured.actionBottom<=height,'save/return action not visible while reading opening review');
   assert(measured.primaries===1&&measured.documentWidth<=width,'opening summary has competing actions or horizontal scrolling');
   await page.screenshot({path:'output/playwright/opening-review-'+width+'.png',animations:'disabled'});checks.push({name:'summary',...measured});
  }
 };

 await fresh();await page.locator('#btn-coach-next-action').click();await play('e4');await settle();
 const original=await page.evaluate(()=>({id:coachLocalGameId,pgn:coachGame.pgn(),moves:coachStats.moves,elo:coachEngineElo}));
 await page.locator('#nav-library').click();await page.locator('.opening-btn[data-id="italian"]').first().click();await page.locator('#btn-end').click();await page.locator('#opening-transfer-cue').selectOption('3');
 const source=await page.evaluate(()=>({fen:game.fen(),cue:activeKeyIdeas()[3],ply:currentMoveIdx+1}));
 await capture('study',true);
 await page.locator('#btn-library-transfer').focus();await page.locator('#btn-library-transfer').press('Tab');await page.keyboard.press('Shift+Tab');
 const keyboardFocus=await page.locator('#btn-library-transfer').evaluate(e=>document.activeElement===e&&getComputedStyle(e).outlineStyle==='solid');
 assert(keyboardFocus,'Library transfer action lacks visible keyboard focus');await page.locator('#btn-library-transfer').press('Enter');await settle();
 assert(await page.evaluate(s=>coachOpeningTransfer.sourceFen===s.fen&&coachGame.fen()===s.fen&&coachOpeningTransfer.cue===s.cue&&coachUserSide==='white',source),'studied position, idea, or side changed during handoff');
 await capture('play');
 for(let n=0;n<4;n++)await playBest();
 assert(await page.evaluate(()=>coachStats.moves===4&&coachReviewLog[0].pairNum===14&&coachReviewLog.every(r=>r.tier!=='unknown')),'real opening moves were not reviewed at their actual move numbers');
 assert((await page.locator('#coach-opening-name').innerText()).includes('Italian Game'),'free play was incorrectly named as another opening');
 assert(await page.evaluate(()=>coachGetPgn().includes('[Opening "Italian Game"]')&&coachGetPgn().includes('[FEN "')&&!ratedCoachEligibility('Resigned').eligible),'opening PGN lost its source or exercise became rated');
 assert(await page.evaluate(()=>document.getElementById('coach-nav-label').textContent===`Move ${coachGame.fen().split(' ')[5]} • Live`),'opening navigation restarted move numbering at one');
 await page.locator('#btn-coach-prev').click();
 assert(await page.evaluate(()=>document.getElementById('coach-nav-label').textContent===`Move ${coachFenAtPly(coachReviewCursor).split(' ')[5]} • Review`),'opening review cursor lost actual move numbering');
 await page.locator('#btn-coach-live').click();
 await capture('ready-review');
 const openingGame=await page.evaluate(()=>({id:coachLocalGameId,pgn:coachGame.pgn(),contextId:coachOpeningTransfer.id}));
 // A drill inside an opening exercise must restore both levels of game context.
 await page.locator('#tab-practice').click();await page.locator('#endgame-track-list .endgame-item button').first().click();
 await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:60000});await page.reload();
 assert(await page.evaluate(()=>coachPracticeSession&&coachPracticeReturnState.openingTransfer.returnState),'nested practice recovery lost the original saved game');
 await play('Qg7#');await page.waitForFunction(()=>coachPracticeSession.completed,null,{timeout:60000});
 await page.locator('#btn-coach-practice-next').click();await settle();
 assert(await page.evaluate(s=>coachOpeningTransfer&&coachOpeningTransfer.id===s.contextId&&coachLocalGameId===s.id&&coachGame.pgn()===s.pgn&&coachStats.moves===4,openingGame),'practice did not return to the exact opening game');
 await page.locator('#btn-opening-transfer-review').click();await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.summary-card')).opacity)>=.99);
 await page.locator('#summary-transfer-reflection').selectOption('adapted');await captureSummary();
 assert((await page.locator('#summary-transfer-observation').innerText()).includes('not whether you applied'),'review claimed that engine grading proves use of the plan');
 await page.reload();
 assert(await page.evaluate(s=>coachOpeningTransfer.cue===s.cue&&coachOpeningTransfer.reflection==='adapted',source),'opening context or self-reflection did not survive reload');
 await page.locator('#btn-opening-transfer-review').click();await page.locator('#btn-summary-opening-return').click();
 await page.waitForFunction(()=>!coachOpeningTransfer);
 assert(await page.evaluate(s=>coachGameActive&&coachLocalGameId===s.id&&coachGame.pgn()===s.pgn&&coachStats.moves===s.moves&&coachEngineElo===s.elo,original),'return changed original PGN, identity, stats, or difficulty');
 assert(await page.evaluate(()=>dailySprintToday().movesCompleted>=5),'earned daily move progress was rolled back');
 await page.locator('#tab-progress').click();
 assert((await page.locator('#opening-transfer-history-list').innerText()).includes('4 reviewed moves'),'opening review absent from Progress');
 const backup=await page.evaluate(()=>{const backup=readTrainingBackup();mergeImportedTrainingData(backup);return{backup,records:loadGrowthState().openingTransfers};});
 assert(backup.records.length===1&&backup.records[0].reflection==='adapted','backup merge duplicated or lost the opening review');
 await page.locator('#tab-game').click();await page.locator('#btn-coach-resign').click();
 await page.waitForFunction(()=>document.getElementById('summary-overlay').getAttribute('aria-hidden')==='false');
 assert(await page.locator('.summary-actions .primary').count()===1,'normal review retained an opening-only primary action');
 await page.locator('#btn-summary-close').click();
 scenarios.push('Study -> chosen cue -> four real reviews -> nested practice/reload -> reflection -> original game and daily progress preserved -> Progress and backup');

 await fresh();await page.locator('#nav-library').click();await page.locator('.opening-btn[data-id="sicilian"]').first().click();await page.locator('.line-btn[data-line="sicilian-dragon"]').click();await page.locator('#btn-end').click();
 const dragon=await page.evaluate(()=>({fen:game.fen(),cue:activeKeyIdeas()[0]}));await page.locator('#btn-library-transfer').click();await settle();
 assert(await page.evaluate(s=>coachOpeningTransfer.lineId==='sicilian-dragon'&&coachOpeningTransfer.sourceFen===s.fen&&coachUserSide==='black'&&coachBoardFlipped&&coachGame.history({verbose:true})[0].color==='w',dragon),'Black variation, board orientation, or autonomous first opponent move failed');
 await playBest();await capture('black-variation');
 const guarded=await page.evaluate(async()=>{const before=coachGame.pgn();$('#game-inbox-pgn').val('1. e4 e5 *');await analyseImportedPgn();return{same:coachGame.pgn()===before,message:$('#game-inbox-status').text()};});
 assert(guarded.same&&guarded.message.includes('Return from'),'import replaced a borrowed opening game');
 await page.locator('#btn-opening-transfer-return').click();await page.waitForFunction(()=>!coachOpeningTransfer);assert(await page.locator('#library-view').isVisible(),'fresh opening session did not return to its Library line');
 assert(await page.evaluate(()=>currentLineId==='sicilian-dragon'),'return to lesson lost selected variation');
 scenarios.push('Black-side Dragon variation -> real opponent first -> reviewed response -> protected import -> same Library variation');

 await fresh();await page.locator('#nav-library').click();await page.locator('.opening-btn[data-id="scholars-mate"]').first().click();await page.locator('#btn-quiz').click();
 await page.locator('#library-keyboard-move').evaluate(e=>{e.open=true;});
 for(let n=0;n<8&&await page.evaluate(()=>currentMoveIdx<activeMoves().length-1);n++){
  await page.waitForFunction(()=>currentMoveIdx>=activeMoves().length-1||isUserTurn(currentMoveIdx+1));
  if(await page.evaluate(()=>currentMoveIdx>=activeMoves().length-1))break;
  await page.locator('#library-keyboard-move-input').fill(await page.evaluate(()=>activeMoves()[currentMoveIdx+1]));await page.locator('#library-keyboard-move-form button[type=submit]').click();
  await page.waitForFunction(()=>!jQuery(':animated').length);
 }
 await page.waitForFunction(()=>currentMoveIdx===activeMoves().length-1&&loadSR()['scholars-mate']);
 assert((await page.locator('#btn-library-transfer').innerText())==='Play before the finish','completed mating quiz offers an unplayable final position');
 await capture('quiz-finish',true);await page.locator('#btn-library-transfer').click();await settle();
 assert(await page.evaluate(()=>coachOpeningTransfer.adjusted&&coachOpeningTransfer.sourcePly===6&&!coachGame.game_over()),'mating line did not back up to a playable student decision');
 await play('Qxf7#');await page.waitForFunction(()=>document.getElementById('summary-overlay').getAttribute('aria-hidden')==='false',null,{timeout:60000});
 const mating=await page.evaluate(()=>({mate:coachGame.in_checkmate(),moves:coachStats.moves,tier:coachLastReview&&coachLastReview.tier,eligible:ratedCoachEligibility('Checkmate').eligible,opening:coachOpeningTransfer&&coachOpeningTransfer.openingId}));
 assert(mating.mate&&mating.moves===1&&!mating.eligible,'free play after quiz did not grade mate correctly: '+JSON.stringify(mating));
 await page.locator('#btn-summary-opening-return').click();await page.waitForFunction(()=>!coachOpeningTransfer);
 scenarios.push('Real keyboard quiz completion -> terminal-line recovery -> real mating move and review -> unrated lesson return');

 await fresh();await page.locator('#tab-practice').click();await page.locator('#opening-bridge-list .opening-bridge-row button').first().click();
 await page.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:60000});
 assert(await page.evaluate(()=>coachUserSide==='white'&&!!moveFromUci(coachGame.fen(),coachPracticeSession.expectedUci)),'bridge answer is illegal or on the wrong side');
 for(let n=0;n<3&&await page.evaluate(()=>!coachPracticeSession.completed);n++){
  await play(await page.evaluate(()=>coachPracticeSession.expectedUci));
  await page.waitForFunction(()=>!coachPracticeSession.grading&&!coachPracticeSession.pendingMove&&(coachPracticeSession.completed||coachPracticeSession.analysisReady),null,{timeout:60000});
 }
 assert(await page.evaluate(()=>coachPracticeSession.completed),'opening bridge did not complete through its continuation');
 await page.reload();assert((await page.locator('#btn-coach-practice-next').innerText()).includes('opening'),'resumed bridge lost its opening-specific next step');
 await page.locator('#btn-coach-practice-next').click();await settle();
 assert(await page.evaluate(()=>coachOpeningTransfer&&coachOpeningTransfer.openingId==='italian'&&coachOpeningTransfer.sourcePly===15),'bridge handed off to an unrelated initial game');
 scenarios.push('Corrected bridge -> legal opponent reply and follow-up -> reload -> matching opening position in free play');
 await fresh();
 assert(errors.length===0,'page errors: '+errors.join('; '));assert(consoleErrors.length===0,'console errors: '+consoleErrors.join('; '));
 return {scenarios,checks,keyboardFocus,pageErrors:errors.length,consoleErrors:consoleErrors.length};
}
