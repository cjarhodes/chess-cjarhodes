// Playwright CLI run-code body: real engine, complete endings and opening sessions.
async page => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const assert=(x,msg)=>{if(!x)throw new Error(msg);};
 const results=[];
 await page.setViewportSize({width:1440,height:1000});
 const fresh=async level=>{
  await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.locator('#coach-auto-elo').uncheck();
  await page.locator('#coach-strength').fill(String(level));
  await page.locator('#coach-strength').dispatchEvent('input');
 };
 const settled=async()=>page.waitForFunction(()=>!coachThinking&&(!coachGameActive||coachIsUserTurn()),null,{timeout:60000});
 const bestUserMove=async()=>page.evaluate(async()=>{
  const result=await engineClient.evaluate(coachGame.fen(),8,{skill:20});
  const u=result.bestmove;return u;
 });
 const play=async move=>{
  await page.locator('#coach-keyboard-move').evaluate(el=>{el.open=true;});
  await page.locator('#coach-keyboard-move-input').fill(move);
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  await settled();
 };
 for(const level of [400,1200,2400]){
  await fresh(level);
  await page.locator('.side-toggle button[data-side=black]').click();
  await page.locator('#group-position').evaluate(el=>{el.open=true;});
  await page.locator('#coach-fen').fill('7k/8/5K2/8/8/8/8/Q7 w - - 0 1');
  await page.locator('#btn-coach-newgame').click();await settled();
  for(let i=0;i<12&&await page.evaluate(()=>coachGameActive);i++)await play(await bestUserMove());
  const ending=await page.evaluate(()=>({mate:coachGame.in_checkmate(),active:coachGameActive,pgn:coachGame.pgn(),plies:coachGame.history().length,id:coachLocalGameId,level:coachEngineElo,stats:coachStats.moves}));
  assert(ending.mate&&!ending.active,'opponent did not finish a known winning ending at '+level);
  assert(ending.level===level,'configured opponent level changed');
  await page.reload();
  assert(await page.evaluate(state=>coachGame.pgn()===state.pgn&&coachLocalGameId===state.id&&!coachGameActive,ending),'completed opponent win did not survive reload');
  results.push({kind:'completed mating ending',...ending});
  await fresh(level);
  await page.locator('#btn-coach-newgame').click();
  for(let i=0;i<6&&await page.evaluate(()=>coachGameActive);i++)await play(i===0?'e4':await bestUserMove());
  const live=await page.evaluate(()=>({plies:coachGame.history().length,reviewed:coachStats.moves,pgn:coachGame.pgn(),level:coachEngineElo,active:coachGameActive,mate:coachGame.in_checkmate()}));
  assert((live.reviewed===6&&live.plies===12)||(!live.active&&live.mate&&live.reviewed>0),'ordinary game lost a review or opponent reply at '+level);
  if(live.active){
   await page.locator('#btn-coach-resign').click();
   await page.waitForFunction(()=>!coachGameActive&&coachLastEndMsg&&coachLastEndMsg.includes('Resigned'));
  }
  results.push({kind:'opening session through six turns or checkmate',...live});
 }
 assert(errors.length===0,'page errors: '+errors.join(';'));
 return {results,errors};
}
