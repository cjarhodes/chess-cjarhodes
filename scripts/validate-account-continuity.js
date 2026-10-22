#!/usr/bin/env node
const fs=require('fs'),path=require('path'),vm=require('vm');
const {Chess}=require('../vendor/chess.js/chess-0.10.3.min.js');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
let owner='account-a',checks=0,writes=0,failAt=0,blockFrom=0,gameSerial=0;
const storage=new Map(),session=new Map();
const assert=(ok,message)=>{checks++;if(!ok)throw Error(message);};
const clone=value=>JSON.parse(JSON.stringify(value));
const extract=name=>{const start=app.indexOf('\nfunction '+name+'(')+1;if(!start)throw Error(name);return app.slice(start,app.indexOf('\n}',start)+2);};
const chain=new Proxy({}, {get:()=>()=>chain});
const context={console,Chess,TextEncoder,Date,Promise,setTimeout,clearTimeout,
 localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>{writes++;if((failAt&&writes===failAt)||(blockFrom&&writes>=blockFrom))throw Error('quota');storage.set(key,String(value));},removeItem:key=>storage.delete(key)},
 sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,String(value)),removeItem:key=>session.delete(key)},
 $:()=>chain,window:{addEventListener:()=>{}},navigator:{onLine:true},coachMemoryOwnerId:()=>owner?'user:'+owner:'anon:test',coachMemoryKey:key=>key+':'+(owner?'user:'+owner:'anon:test'),
 activePracticeOwnerId:()=>owner,coachDeviceId:()=> 'device-a',createCoachGameId:()=> 'new-game-'+(++gameSerial),
 coachAuthUser:{id:'account-a'},coachPracticeSession:null,coachGame:null,coachLastEndMsg:null,coachThinking:false,
 hasCoachDbSession:()=>false,saveCoachState:()=>{},saveCoachPracticeState:()=>{},
 COACH_STATE_KEY:'coach:state:v1',COACH_PRACTICE_STATE_KEY:'coach:practice-state:v1',COACH_PRACTICE_RETURN_KEY:'coach:practice-return:v1',
 INSIGHTS_KEY:'coach:insights:v1',LIFETIME_KEY:'coach:lifetime:v1',INSIGHTS_MAX_ENTRIES:1000,
 PRACTICE_PROGRESS_KEY:'coach:practice-progress:v2',PRACTICE_EVENT_LIMIT:500,DAILY_SPRINT_KEY:'coach:daily-sprint:v1',DAILY_HISTORY_LIMIT:90,
 practiceProgressStorageKey:id=>'coach:practice-progress:v2:'+id,dailySprintStorageKey:id=>'coach:daily-sprint:v1:'+id,
 loadPracticeProgress:()=>JSON.parse(storage.get(context.practiceProgressStorageKey(owner))||'{"v":2,"records":{},"events":[]}'),loadDailySprintHistory:()=>({v:1,days:{}}),mergeDailySprintDay:(a,b)=>b||a,
 loadInsights:()=>JSON.parse(storage.get(context.coachMemoryKey(context.INSIGHTS_KEY))||'{"v":1,"entries":[]}'),
 loadLifetime:()=>JSON.parse(storage.get(context.coachMemoryKey(context.LIFETIME_KEY))||'{"games":0,"moves":0,"rollups":{}}'),
 emptyLifetime:()=>({games:0,moves:0,rollups:{}}),renderInsights:()=>{},updateSRSidebar:()=>{},updateSRPanel:()=>{},setCoachDbStatus:()=>{},handleCoachDbError:()=>{}
};
vm.createContext(context);
vm.runInContext(['cloneCoachValue','loadCoachSavedPosition','isValidFen','moveFromUci'].map(extract).join('\n')+'\n'+fs.readFileSync(path.join(root,'growth.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'account-continuity.js'),'utf8')+'\nhydrateGrowthUI=()=>{};renderAccountCheckpoint=()=>{};queueGrowthRemoteSync=()=>{};',context);
const game=new Chess();game.move('e4');game.move('e5');
const snapshot={v:1,pgn:game.pgn(),fen:game.fen(),startFen:new Chess().fen(),userSide:'white',engineElo:1200,localGameId:'source-game',remoteGameId:'source-remote',reviewLog:[],stats:{moves:1},ts:100,ended:false,
 openingTransfer:{owner:'user:account-a',sourceFen:new Chess().fen(),returnState:{owner:'user:account-a',localGameId:'nested-game',remoteGameId:'nested-remote'}}};
storage.set(context.coachMemoryKey(context.COACH_STATE_KEY),JSON.stringify(snapshot));
storage.set(context.coachMemoryKey(context.INSIGHTS_KEY),JSON.stringify({v:1,entries:[{id:'review-a',ts:100,tier:'good',userUci:'e2e4'}]}));
storage.set(context.coachMemoryKey(context.LIFETIME_KEY),JSON.stringify({games:2,moves:12,rollups:{old:{games:1,moves:6}}}));
storage.set('sb-unrelated-auth-token','untouched');
let growth=context.emptyGrowthState();growth.profile.rating=1500;growth.library.records.italian={attempts:3};context.saveGrowthState(growth,owner,{skipSync:true});
storage.set(context.practiceProgressStorageKey(owner),JSON.stringify({v:2,records:{},events:[{id:'source-event',ownerId:owner,synced:true,sourceMoveId:'source-move'}]}));
const backup=context.readTrainingBackup();
assert(Object.keys(backup.data).some(key=>key.startsWith(context.COACH_STATE_KEY)),'export omitted saved game');
assert(!JSON.stringify(backup).includes('sb-unrelated-auth-token'),'backup included authentication storage');
context.saveCoachState=()=>false;let staleExport=false;try{context.readTrainingBackup();}catch(e){staleExport=true;}assert(staleExport,'unsaved game exported a stale snapshot');context.saveCoachState=()=>{};
context.coachPracticeSession={};context.saveCoachPracticeState=()=>false;staleExport=false;try{context.readTrainingBackup();}catch(e){staleExport=true;}assert(staleExport,'unsaved practice exported a stale snapshot');context.coachPracticeSession=null;context.saveCoachPracticeState=()=>{};
owner='account-b';context.coachAuthUser={id:owner};
const existing={...snapshot,pgn:'',fen:new Chess().fen(),localGameId:'existing'};
storage.set(context.coachMemoryKey(context.COACH_STATE_KEY),JSON.stringify(existing));
context.mergeImportedTrainingData(clone(backup));
assert(context.loadInsights().entries.length===1,'scoped review history was not imported');
const importedEvent=context.loadPracticeProgress().events[0];
assert(importedEvent&&importedEvent.id!=='source-event'&&importedEvent.ownerId===owner&&!importedEvent.synced&&importedEvent.sourceMoveId===null,'cross-owner practice import reused private remote identity');
assert(context.loadLifetime().games===2,'scoped lifetime history was not imported');
assert(context.loadGrowthState().library.records.italian.attempts===3,'Library progress was lost');
assert(JSON.parse(storage.get(context.coachMemoryKey(context.COACH_STATE_KEY))).localGameId==='existing','import replaced current board');
let staged=context.storedAccountCheckpoint('coach:checkpoint-import:v1');
assert(staged&&staged.owner==='user:account-b'&&staged.game.remoteGameId===null,'import was not staged for the current owner without remote IDs');
assert(staged.game.openingTransfer.owner==='user:account-b','opening owner was not rebound');
assert(storage.get('sb-unrelated-auth-token')==='untouched','import changed unrelated auth storage');
context.mergeImportedTrainingData(clone(backup));assert(context.loadInsights().entries.length===1,'repeat import duplicated reviews');
assert(context.loadPracticeProgress().events.length===1,'repeat cross-owner import duplicated practice attempts');
const before=JSON.stringify([...storage]);
const malformed=clone(backup),gameKey=Object.keys(malformed.data).find(key=>key.startsWith(context.COACH_STATE_KEY));malformed.data[gameKey].fen='invalid';
let rejected=false;try{context.mergeImportedTrainingData(malformed);}catch(e){rejected=true;}
assert(rejected&&JSON.stringify([...storage])===before,'late invalid game caused a partial import');
failAt=2;writes=0;rejected=false;try{context.mergeImportedTrainingData(clone(backup));}catch(e){rejected=true;}finally{failAt=0;}
assert(rejected&&JSON.stringify([...storage].sort())===JSON.stringify(JSON.parse(before).sort()),'quota error did not restore previous values');
const interrupted=clone(backup),growthKey=Object.keys(interrupted.data).find(key=>key.startsWith('coach:growth:'));
assert(!!growthKey,'fixture has growth data');
interrupted.data[growthKey].profile.rating=1800;interrupted.data[growthKey].profile.updatedAt=Date.now()+10000;
blockFrom=3;writes=0;rejected=false;try{context.mergeImportedTrainingData(interrupted);}catch(e){rejected=true;}
assert(rejected&&storage.has(context.coachMemoryKey('coach:import-journal:v1')),'persistent storage failure lost the recovery journal');
assert(!context.recoverContinuityWrites(),'unavailable storage incorrectly completed rollback');
blockFrom=0;assert(context.recoverContinuityWrites(),'journal did not recover when storage returned');
assert(JSON.stringify([...storage].sort())===JSON.stringify(JSON.parse(before).sort()),'journal recovery lost the original data');
const copied=context.copiedAccountCheckpoint(staged).snapshot;
assert(copied.game.localGameId!=='source-game'&&copied.game.remoteGameId===null&&copied.game.continuityCopy,'recovered copy retained shared game identity or rating eligibility');
assert(copied.game.openingTransfer.returnState.remoteGameId===null&&copied.game.openingTransfer.returnState.localGameId!=='nested-game','nested opening return could overwrite source game');
assert(copied.game.pgn===snapshot.pgn&&copied.game.fen===snapshot.fen,'copy changed the saved position');
owner='account-c';context.coachAuthUser={id:owner};
assert(context.storedAccountCheckpoint('coach:checkpoint-import:v1')===null,'another owner could access staged recovery');
owner='account-b';context.coachAuthUser={id:owner};
const ambiguous=clone(backup);delete ambiguous.data[Object.keys(ambiguous.data).find(key=>key.startsWith(context.INSIGHTS_KEY))];ambiguous.data[context.INSIGHTS_KEY+':user:x']={v:1,entries:[]};ambiguous.data[context.INSIGHTS_KEY+':user:y']={v:1,entries:[]};
rejected=false;try{context.mergeImportedTrainingData(ambiguous);}catch(e){rejected=true;}assert(rejected,'ambiguous multi-owner history was accepted');
// A forced profile collision must reread, merge, and retry; no blind upsert.
let remote={state:context.emptyGrowthState(),updated_at:'revision-1'},collision=true,reads=0,updates=0;
remote.state.repertoire.observed=[{key:'remote',name:'Remote',side:'white',games:1,lastSeen:100}];
growth=context.loadGrowthState();growth.repertoire.observed=[{key:'local',name:'Local',side:'black',games:1,lastSeen:200}];context.saveGrowthState(growth,owner,{skipSync:true});
context.hasCoachDbSession=()=>true;
context.coachDbClient={from:()=>{
 let payload=null,expected=null,mode='read';const query={select:()=>query,eq:(key,value)=>{if(key==='updated_at')expected=value;return query;},update:value=>{mode='update';payload=value;return query;},insert:value=>{mode='insert';payload=value;return query;},maybeSingle:async()=>{
  if(mode==='read'){reads++;return{data:clone(remote),error:null};}updates++;
  if(collision){collision=false;remote.updated_at='revision-2';remote.state.repertoire.observed.push({key:'concurrent',name:'Concurrent',side:'white',games:1,lastSeen:300});return{data:null,error:null};}
  if(expected!==remote.updated_at)return{data:null,error:null};remote={state:clone(payload.state),updated_at:'revision-3'};return{data:{updated_at:remote.updated_at},error:null};
 }};return query;
}};
(async()=>{
 await context.syncGrowthState({silent:true});
 assert(reads===2&&updates===2,'profile conflict did not reread and retry');
 assert(['local','remote','concurrent'].every(key=>remote.state.repertoire.observed.some(row=>row.key===key)),'retry overwrote concurrent profile evidence');
 const order=[];let releaseFirst,startFirst;
 const started=new Promise(resolve=>{startFirst=resolve;});
 const held=new Promise(resolve=>{releaseFirst=resolve;});
 context.coachLocalGameId='slow-game';
 const firstWrite=context.runAccountGameWrite(async()=>{order.push('first');startFirst();await held;order.push('first-finished');});
 const secondWrite=context.runAccountGameWrite(async()=>{order.push('second');});
 await started;await Promise.resolve();
 assert(order.join(',')==='first','a newer game save overtook the held write');
 context.coachLocalGameId='other-game';await context.runAccountGameWrite(async()=>{order.push('other');});
 assert(order.includes('other')&&!order.includes('second'),'an unrelated game was blocked by the held write');
 releaseFirst();await Promise.all([firstWrite,secondWrite]);
 assert(order.indexOf('second')>order.indexOf('first-finished'),'successive game snapshots were committed out of order');
 console.log(`Account continuity validation passed (${checks} behavioural checks).`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
