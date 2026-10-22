// Playwright CLI body. Controlled auth/REST responses use the real vendored SDK
// in empty, isolated contexts. These fixtures never contact the live backend.
async browserPage => {
  const browser = browserPage.context().browser(), base = browserPage.url().split('?')[0];
  const checks = [], captures = [], errors = [], contexts = [], requests = [];
  const assert = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
  const users = {
    a: { id: '11111111-1111-4111-8111-111111111111', email: 'continuity-a@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' },
    b: { id: '22222222-2222-4222-8222-222222222222', email: 'continuity-b@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' }
  };
  const tokenOwners = new Map();
  const tables = Object.fromEntries(['coach_checkpoints','player_training_profiles','coach_games','coach_moves','drill_queue','practice_attempts','daily_training_sessions','theory_cards'].map(t=>[t,[]]));
  const raceWaiters = [];
  let serial = 1, stamp = 1, failLogout = false, offline = false, otpRequests = 0, logoutScope = '', profileRace = false, raceReads = 0;
  const stampTime = () => new Date(Date.UTC(2026,0,1,0,0,0,stamp++)).toISOString();
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(serial++).padStart(12,'0');
  const route = async route => {
    const request = route.request(), rawUrl = request.url(), method = request.method();
    const pathname = rawUrl.split('?')[0].split('/').slice(3).join('/');
    const params = new Map((rawUrl.split('?')[1] || '').split('&').filter(Boolean).map(part=>{const pair=part.split('=');return [decodeURIComponent(pair[0]),decodeURIComponent((pair[1]||'').replace(/\+/g,' '))];}));
    const json = async (body,status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if (offline) return json({message:'Controlled network outage'},503);
    const header = request.headers().authorization || '';
    const owner = tokenOwners.get(header.replace(/^Bearer /,'')) || null;
    if (pathname.endsWith('/otp')) { otpRequests++; return json({}); }
    if (pathname.endsWith('/user')) return json(Object.values(users).find(user=>user.id===owner) || users.a);
    if (pathname.endsWith('/logout')) { logoutScope = params.get('scope'); return failLogout ? json({message:'Controlled sign-out failure'},500) : json({}); }
    if (pathname.endsWith('/token')) {
      const user = Object.values(users).find(user=>user.id===owner) || users.a;
      return json({user,access_token:header.replace(/^Bearer /,''),refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer'});
    }
    const table = pathname.split('/').pop();
    requests.push({table,method,owner:!!owner});
    if (!tables[table]) return json({message:'Unexpected fixture path'},400);
    if (!owner) return json({message:'Not authenticated'},401);
    const matches = row => row.user_id === owner && [...params].every(([key,value]) => {
      if (['select','order','limit','on_conflict'].includes(key)) return true;
      if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
      if (value.startsWith('neq.')) return String(row[key]) !== value.slice(4);
      return true;
    });
    let rows = tables[table].filter(matches), result;
    if (method === 'GET') {
      result = clone(rows);
      const order = params.get('order');
      if (order) { const [key,direction] = order.split('.'); result.sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''))*(direction==='desc'?-1:1)); }
      if (params.has('limit')) result = result.slice(0,Number(params.get('limit')));
      // Hold the first two profile reads at the same revision to force a real
      // read/write collision through the SDK's normal query builder.
      if (profileRace && table==='player_training_profiles') {
        raceReads++;
        if (raceReads<=2) await new Promise(resolve=>{raceWaiters.push(resolve);if(raceWaiters.length===2)raceWaiters.splice(0).forEach(release=>release());});
      }
    } else if (method === 'POST') {
      const body = request.postDataJSON(), inputs = Array.isArray(body) ? body : [body]; result=[];
      const keys = (params.get('on_conflict') || (table==='player_training_profiles'?'user_id':table==='coach_checkpoints'?'user_id,device_id':'id')).split(',');
      for (const item of inputs) {
        if (item.user_id !== owner) return json({code:'42501',message:'Owner denied'},403);
        const existing = tables[table].find(row=>keys.every(key=>row[key]===item[key]));
        if (existing && !request.headers().prefer?.includes('resolution=')) return json({code:'23505',message:'Duplicate fixture row'},409);
        if (existing) {
          if (!request.headers().prefer.includes('ignore-duplicates')) Object.assign(existing,item,{updated_at:stampTime()});
          result.push(clone(existing));
        } else {
          const row = {...clone(item), id:item.id||id(), updated_at:stampTime()};
          if (table==='coach_checkpoints') row.revision=1;
          tables[table].push(row);result.push(clone(row));
        }
      }
    } else if (method === 'PATCH') {
      const body = request.postDataJSON(); result=[];
      for (const row of rows) {
        if (body.user_id && body.user_id !== owner) return json({code:'42501',message:'Owner denied'},403);
        Object.assign(row,clone(body),{updated_at:stampTime()});
        if (table==='coach_checkpoints') row.revision++;
        result.push(clone(row));
      }
    } else if (method === 'DELETE') { tables[table]=tables[table].filter(row=>!rows.includes(row));result=[]; }
    else return json({message:'Unexpected fixture method'},400);
    if (request.headers().accept?.includes('vnd.pgrst.object')) {
      if (result.length===1) return json(result[0]);
      return json({code:'PGRST116',details:'The result contains 0 rows',message:'No rows'},406);
    }
    return json(result);
  };
  const fresh = async () => {
    const context=await browser.newContext({viewport:{width:1440,height:900}}); contexts.push(context);
    await context.route('https://szbrgdmjsgrybptznogb.supabase.co/**',route);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.waitForFunction(()=>coachDbClient!==null);return page;
  };
  const signIn = async (page,key='a') => {
    const token=await page.evaluate(userId=>{
      const enc=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
      return enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:userId,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})+'.fixture-only';
    },users[key].id);
    tokenOwners.set(token, users[key].id);
    // Synthetic fixture credentials are accepted only by route(), never by a
    // live Supabase endpoint. Do not print session objects or callback URLs.
    await page.goto(base+'?view=coach&fixture_callback='+Date.now()+'#access_token='+token+'&refresh_token=fixture-refresh&token_type=bearer&expires_in=3600');
    try {
      await page.waitForFunction(userId=>coachAuthUser&&coachAuthUser.id===userId,users[key].id,{timeout:15000});
      await page.waitForFunction(()=>coachRemoteInsightsLoaded,null,{timeout:15000});
    } catch (error) {
      const state=await page.evaluate(()=>({signedIn:!!coachAuthUser,phase:coachAuthPhase,status:coachDbStatus,checkpoint:document.querySelector('#account-checkpoint-status').textContent}));
      throw Error('Fixture sign-in incomplete: '+JSON.stringify({state,errors,requests:requests.slice(-14)}));
    }
    await page.locator('#group-account').evaluate(e=>e.open=true);
    assert(!page.url().includes('#'),'callback fragment removed');
  };
  const settle=page=>page.waitForFunction(()=>coachGameActive&&!coachThinking&&coachIsUserTurn(),null,{timeout:60000});
  const play=async(page,move)=>{
    await page.locator('#coach-keyboard-move').evaluate(e=>e.open=true);
    await page.locator('#coach-keyboard-move-input').fill(move);
    await page.locator('#coach-keyboard-move-form button[type=submit]').click();
    await settle(page);
  };
  const sync=async page=>{
    await page.evaluate(async()=>{await refreshRemoteInsights({silent:true});await flushAccountCheckpoint();await refreshAccountCheckpoints();});
  };
  const capture=async(page,name)=>{
    await page.locator('#group-account').evaluate(e=>e.open=true);
    for(const [width,height] of [[1280,800],[1440,900],[1920,1080]]){
      await page.setViewportSize({width,height});await page.locator('#account-recovery').scrollIntoViewIfNeeded();await page.waitForFunction(()=>!jQuery(':animated').length);
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const metrics=await page.evaluate(()=>{const b=document.querySelector('#coachBoard').getBoundingClientRect();return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,boardBottom:b.bottom,boardWidth:b.width,boardRight:b.right};});
      assert(metrics.documentWidth<=width&&metrics.boardBottom<=height&&metrics.boardRight<=width&&metrics.boardWidth>=320,name+' fits '+width);
      await page.screenshot({path:'output/playwright/account-'+name+'-'+width+'.png',animations:'disabled'});captures.push({name,...metrics});
    }
  };
  try {
    const a=await fresh();
    await a.locator('#group-account').evaluate(e=>e.open=true);
    await a.locator('#coach-auth-email').fill(users.a.email);await a.locator('#btn-coach-login').click();
    await a.waitForFunction(()=>document.querySelector('#coach-auth-status').textContent.startsWith('Link sent'));
    assert(otpRequests===1,'email form sends one controlled request');
    await signIn(a);
    await a.locator('#btn-coach-next-action').click();await play(a,'e4');await sync(a);
    const original=await a.evaluate(()=>({pgn:coachGame.pgn(),id:coachLocalGameId,remote:coachRemoteGameId,stats:coachStats.moves}));
    assert(tables.coach_checkpoints.length===1&&tables.coach_moves.length===1,'real game saves checkpoint and reviewed move');
    const b=await fresh();await signIn(b);await sync(b);
    assert(await b.locator('#btn-account-resume').isVisible(),'second browser offers saved session');
    assert(await b.evaluate(()=>!coachGameActive),'cloud history does not replace board automatically');
    await b.locator('#btn-coach-next-action').click();await play(b,'d4');await sync(b);
    const displaced=await b.evaluate(()=>coachGame.pgn());
    await b.locator('#btn-account-resume').click();await settle(b);
    assert(await b.evaluate(saved=>coachGame.pgn()===saved.pgn&&coachLocalGameId!==saved.id&&coachRemoteGameId!==saved.remote&&coachContinuityCopy,original),'continue preserves PGN with separate unrated game identity');
    assert(await a.evaluate(saved=>coachLocalGameId===saved.id&&coachGame.pgn()===saved.pgn,original),'source browser game remains unchanged');
    assert(await b.locator('#btn-account-previous').isVisible(),'displaced local session is recoverable');
    await capture(b,'continued');
    await b.locator('#btn-account-previous').click();await settle(b);
    assert(await b.evaluate(pgn=>coachGame.pgn()===pgn,displaced),'return to previous session restores exact moves');
    // Durable offline review retry, even after another game replaces the board.
    offline=true;
    const move=await a.evaluate(async()=>(await engineClient.evaluate(coachGame.fen(),10)).bestmove);
    await play(a,move);
    assert(await a.evaluate(()=>pendingAccountReviews().length===1),'offline reviewed move is queued durably');
    const visible=await a.evaluate(()=>currentInsightEntries().length);
    assert(visible>=2,'offline account-local review remains visible');
    await a.locator('#btn-coach-newgame').click();
    offline=false;await sync(a);
    assert(await a.evaluate(()=>pendingAccountReviews().length===0),'offline queue drains after reconnect despite replaced board');
    assert(tables.coach_moves.length>=3,'recovered offline review reaches account history');
    const beforeUndo=tables.coach_moves.length;
    const visibleBeforeUndo=await a.evaluate(()=>currentInsightEntries().length);
    offline=true;await play(a,'e4');await a.locator('#btn-coach-takeback').click();
    assert(await a.evaluate(()=>!pendingAccountReviews().some(row=>!row.deleted)),'takeback cancels an unsent offline review');
    assert(await a.evaluate(n=>currentInsightEntries().length===n,visibleBeforeUndo),'taken-back review is removed from local evidence');
    offline=false;await sync(a);
    assert(tables.coach_moves.length===beforeUndo,'offline undone review does not reappear remotely');
    await play(a,'e4');await sync(a);
    offline=true;await a.locator('#btn-coach-takeback').click();
    assert(await a.evaluate(()=>pendingAccountReviews().some(row=>row.deleted)),'offline takeback keeps a durable remote deletion');
    offline=false;await sync(a);
    assert(tables.coach_moves.length===beforeUndo&&await a.evaluate(()=>pendingAccountReviews().length===0),'reconnect removes the previously synced undone review');
    // Backup export/import includes review history, saved board and practice.
    await a.locator('#tab-practice').click();await a.locator('#endgame-track-list .endgame-item button').first().click();
    await a.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:60000});
    await a.locator('#btn-coach-practice-hint').click();await a.evaluate(()=>saveCoachPracticeState());await sync(a);
    const backup=await a.evaluate(()=>readTrainingBackup());
    const c=await fresh();await c.locator('#btn-coach-next-action').click();await play(c,'c4');
    const current=await c.evaluate(()=>coachGame.pgn());
    await c.locator('#group-data').evaluate(e=>e.open=true);
    await c.evaluate(payload=>{const input=document.querySelector('#training-data-file'),transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(payload)],'fixture-training.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));},backup);
    await c.waitForFunction(()=>document.querySelector('#training-data-status').textContent.startsWith('Merged'));
    assert(await c.evaluate(pgn=>coachGame.pgn()===pgn,current),'backup merge keeps current board');
    assert(await c.evaluate(()=>loadInsights().entries.length>=2),'scoped review history imports across owners');
    await c.locator('#group-account').evaluate(e=>e.open=true);await c.locator('#btn-account-resume').click();
    await c.waitForFunction(()=>coachPracticeSession&&coachPracticeSession.analysisReady,null,{timeout:60000});
    assert(await c.evaluate(()=>coachPracticeSession.hintUsed&&coachPracticeSession.hintStage>0),'practice hint state survives backup transfer');
    const exactReturn=await a.evaluate(()=>coachPracticeReturnState&&coachPracticeReturnState.pgn);
    await c.locator('#btn-coach-practice-exit').click();
    assert(await c.evaluate(pgn=>coachGame.pgn()===pgn,exactReturn),'practice transfer retains borrowed live game');
    await capture(c,'backup-return');
    const before=await c.evaluate(()=>({pgn:coachGame.pgn(),growth:JSON.stringify(loadGrowthState()),insights:JSON.stringify(loadInsights())}));
    const malformed=clone(backup);malformed.data[Object.keys(malformed.data).find(key=>key.startsWith('coach:practice-state:v1'))].session.phase='broken';
    const rejected=await c.evaluate(payload=>{try{mergeImportedTrainingData(payload);return false;}catch(e){return true;}},malformed);
    assert(rejected,'malformed practice backup is rejected');
    assert(await c.evaluate(s=>coachGame.pgn()===s.pgn&&JSON.stringify(loadGrowthState())===s.growth&&JSON.stringify(loadInsights())===s.insights,before),'invalid backup leaves all progress and board unchanged');
    const quota=await c.evaluate(payload=>{
      const original=Storage.prototype.setItem;let writes=0;
      Storage.prototype.setItem=function(key,value){if(++writes===2)throw new DOMException('Fixture quota','QuotaExceededError');return original.call(this,key,value);};
      try{mergeImportedTrainingData(payload);return false;}catch(e){return true;}finally{Storage.prototype.setItem=original;}
    },backup);
    assert(quota,'storage failure reports failed import');
    assert(await c.evaluate(s=>JSON.stringify(loadGrowthState())===s.growth&&JSON.stringify(loadInsights())===s.insights,before),'quota failure rolls back existing progress');
    // Concurrent profile saves must retain independent learning observations.
    await a.evaluate(()=>{const s=loadGrowthState();s.repertoire.observed.push({key:'fixture-left',name:'Left',side:'white',games:1,lastSeen:Date.now()});saveGrowthState(s, growthOwnerId(), {skipSync:true});});
    await b.evaluate(()=>{const s=loadGrowthState();s.repertoire.observed.push({key:'fixture-right',name:'Right',side:'black',games:1,lastSeen:Date.now()});saveGrowthState(s, growthOwnerId(), {skipSync:true});});
    profileRace=true;raceReads=0;await Promise.all([a.evaluate(()=>syncGrowthState({silent:true})),b.evaluate(()=>syncGrowthState({silent:true}))]);profileRace=false;
    const observations=tables.player_training_profiles.find(row=>row.user_id===users.a.id).state.repertoire.observed;
    assert(observations.some(row=>row.key==='fixture-left')&&observations.some(row=>row.key==='fixture-right'),'simultaneous profile sync merges both browsers');
    // A competing tab advances this browser's checkpoint after our last read.
    await b.evaluate(()=>flushAccountCheckpoint());
    const device=await b.evaluate(()=>accountCheckpointDeviceId());
    const contested=tables.coach_checkpoints.find(row=>row.device_id===device&&row.user_id===users.a.id);
    contested.revision++;contested.snapshot.savedAt+=10000;
    const protectedSnapshot=JSON.stringify(contested.snapshot);
    await b.evaluate(()=>flushAccountCheckpoint());
    assert(await b.evaluate(()=>accountCheckpoint.conflict),'stale checkpoint write pauses instead of overwriting');
    assert(JSON.stringify(contested.snapshot)===protectedSnapshot,'competing tab checkpoint is preserved');
    await b.reload();await b.waitForFunction(()=>accountCheckpoint.loaded&&accountCheckpoint.conflict);
    assert(await b.evaluate(()=>accountCheckpoint.conflict),'stale-tab pause survives reload');
    await b.locator('#group-account').evaluate(e=>e.open=true);await b.locator('#btn-account-resume').click();await settle(b);
    await b.evaluate(()=>flushAccountCheckpoint());
    assert(await b.evaluate(old=>accountCheckpointDeviceId()!==old&&!accountCheckpoint.conflict,device),'explicit continuation forks the stale tab checkpoint');
    assert(JSON.stringify(contested.snapshot)===protectedSnapshot,'continued stale tab still leaves source checkpoint intact');
    // Failed sign-out must leave the real session and UI consistent.
    failLogout=true;await b.locator('#btn-coach-logout').click();
    await b.waitForFunction(()=>!coachAuthUser&&document.querySelector('#coach-auth-status').textContent.includes('Signed out on this browser.'));
    assert(await b.evaluate(async()=>!(await coachDbClient.auth.getSession()).data.session),'server logout failure reconciles cleared local credentials');
    failLogout=false;await signIn(b);
    await b.evaluate(()=>{window.fixtureSignOut=coachDbClient.auth.signOut.bind(coachDbClient.auth);coachDbClient.auth.signOut=async()=>({error:new Error('Controlled client error')});});
    await b.locator('#btn-coach-logout').click();await b.waitForFunction(()=>document.querySelector('#coach-auth-status').textContent.includes('did not finish'));
    assert(await b.evaluate(()=>!!coachAuthUser),'retained SDK session is reported as still signed in');
    await b.evaluate(()=>{coachDbClient.auth.signOut=window.fixtureSignOut;delete window.fixtureSignOut;});
    await b.locator('#btn-coach-logout').click();await b.waitForFunction(()=>!coachAuthUser);
    assert(logoutScope==='local','sign-out affects only this browser session');
    assert(await a.evaluate(()=>!!coachAuthUser),'other browser stays signed in');
    await signIn(b,'b');
    assert(await b.evaluate(()=>currentInsightEntries().length===0&&!coachGameActive),'different account sees no previous account history or board');
    await capture(b,'separate-owner');
    assert(errors.length===0,'no browser runtime errors');
    return {kind:'controlled-auth-and-rest-with-real-sdk',checks:checks.length,captures,scenarios:['email form and callback','two-browser game recovery','previous board recovery','offline move retry after replacement','offline takebacks before and after upload','practice backup and live-game return','malformed and quota rollback','concurrent profile merge','stale-tab conflict across reload and copy','failed and local sign-out','account isolation'],errors};
  } catch(error) { const states=await Promise.all(contexts.map(async c=>{const p=c.pages()[0];try{return await p.evaluate(()=>({signedIn:!!coachAuthUser,status:document.querySelector('#coach-auth-status').textContent}));}catch(e){return{};}}));throw Error(error.message+'; last checks: '+JSON.stringify(checks.slice(-4))+'; states: '+JSON.stringify(states)); }
  finally { for(const context of contexts)await context.close(); }
}
