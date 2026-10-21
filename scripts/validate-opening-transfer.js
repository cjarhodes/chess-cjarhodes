#!/usr/bin/env node
const fs=require('fs'),path=require('path'),vm=require('vm');
const {Chess}=require('../vendor/chess.js/chess-0.10.3.min.js');
const root=path.resolve(__dirname,'..');
const openings=fs.readFileSync(path.join(root,'openings.js'),'utf8');
const growth=fs.readFileSync(path.join(root,'growth.js'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const context={Chess,window:{},$:()=>{},uciFromMove:m=>m.from+m.to+(m.promotion||'')};
vm.createContext(context);vm.runInContext(openings+'\n'+growth+'\nthis.openings=OPENINGS;',context);
let checks=0;const failures=[];
const assert=(ok,message)=>{checks++;if(!ok)failures.push(message);};
const move=(position,uci)=>position.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
for(const opening of context.openings){
 const item=context.openingBridgeItem(opening);if(!item)continue;
 const position=new Chess(item.entry.fenBefore);
 assert(position.turn()===(opening.category==='black'?'b':'w'),opening.id+': bridge starts on the wrong side');
 const solution=move(position,item.entry.bestUci);
 assert(solution&&solution.san===item.entry.bestSan,opening.id+': authored answer is illegal or mismatched');
 for(const step of item.entry.continuation){
  const reply=move(position,step.opponentUci),followup=reply&&move(position,step.followupUci);
  assert(reply&&followup,opening.id+': bridge continuation is illegal');
 }
}
const extract=name=>{
 const start=app.indexOf(`\nfunction ${name}(`)+1;
 if(!start)throw Error('Missing runtime function '+name);
 return app.slice(start,app.indexOf('\n}',start)+2);
};
let owner='anon:test';
context.coachMemoryOwnerId=()=>owner;
context.cloneCoachValue=(value,fallback)=>value==null?fallback:JSON.parse(JSON.stringify(value));
context.isInsightProblem=tier=>['inaccuracy','mistake','blunder'].includes(tier);
context.coachOpeningTransfer=null;context.coachReviewLog=[];
vm.runInContext(extract('getOpeningLines')+'\n'+extract('formatMoveRef')+'\n'+extract('quizMoveMatches')+'\n'+extract('resolveAccessibleMove')+'\n'+fs.readFileSync(path.join(root,'opening-transfer.js'),'utf8'),context);
let lines=0;
for(const opening of context.openings)for(const line of context.getOpeningLines(opening)){
 lines++;
 const target=context.openingTransferTarget(opening,line);
 assert(target&&new Chess(target.sourceFen).moves().length>0,opening.id+'/'+line.id+': no playable transfer target');
 assert(target.side===(opening.category==='black'?'black':'white'),opening.id+'/'+line.id+': lesson side was lost');
 const quiz=new Chess();
 for(const san of line.moves){
  const played=new Chess(quiz.fen()).move(san);
  assert(context.quizMoveMatches(quiz,played,san),opening.id+'/'+line.id+': legal authored quiz move rejected');
  assert(context.resolveAccessibleMove(quiz,san),opening.id+'/'+line.id+': authored notation is not accepted by keyboard entry');
  quiz.move(san);
 }
 const replay=new Chess();for(let i=0;i<target.sourcePly;i++)replay.move(line.moves[i]);
 assert(replay.fen()===target.sourceFen,opening.id+'/'+line.id+': target is not the studied position');
 const midPly=Math.min(4,line.moves.length-1),mid=context.openingTransferTarget(opening,line,midPly);
 const middle=new Chess();for(let i=0;i<midPly;i++)middle.move(line.moves[i]);
 assert(mid&&mid.sourceFen===middle.fen(),opening.id+'/'+line.id+': selected middle position moved unexpectedly');
 if(target.adjusted)assert(replay.turn()===target.side[0],opening.id+'/'+line.id+': terminal line did not back up to the student decision');
}
assert(lines===35,'all 35 authored lines must be validated');
assert(context.openingTransferTarget(null,null)===null,'missing lesson should not create an exercise');
assert(context.openingTransferTarget(context.openings[0],{moves:['not a move']})===null,'invalid line should not create an exercise');
const target=context.openingTransferDefinition('italian','main',26);
const state=Object.assign({},target,{v:1,id:'session-a',owner,cue:target.ideas[1],reflection:'adapted',returnState:{owner,pgn:'1. e4 e5',startFen:new Chess().fen()}});
assert(context.normalizeOpeningTransfer(state).cue===target.ideas[1],'selected cue did not survive normalization');
assert(context.normalizeOpeningTransfer(Object.assign({},state,{sourceFen:new Chess().fen()}))===null,'mismatched opening source should be rejected');
assert(context.normalizeOpeningTransfer(Object.assign({},state,{side:'black'}))===null,'mismatched lesson side should be rejected');
owner='user:other';assert(context.normalizeOpeningTransfer(state)===null,'opening context leaked between owners');owner='anon:test';
assert(context.normalizeOpeningTransfer(Object.assign({},state,{returnState:{owner:'user:other'}})).returnState===null,'borrowed game leaked between owners');
const blackFen=target.sourceFen.replace(' w ',' b ');
const observation=context.openingTransferSummary(state,[
 {tier:'best',pairNum:14,ply:1,userSan:'Re1',fenBefore:target.sourceFen,lesson:'Keep pieces active.'},
 {tier:'mistake',pairNum:14,ply:1,userSan:'b5',fenBefore:blackFen,lesson:'Check the reply.'},
 {tier:'unknown',pairNum:15,ply:3,userSan:'Qe2'}
]);
assert(observation.reviewed===2&&observation.problems===1,'observation counted unknown reviews or wrong flag tiers');
assert(observation.reflection==='adapted'&&observation.examples[0].move==='14... b5','self-reflection or Black move reference was lost');
const records=Array.from({length:10},(_,i)=>Object.assign({},observation,{id:'session-'+i,at:100+i}));
let normalized=context.normalizeOpeningTransferRecords(records.concat([Object.assign({},records[9],{at:999,reflection:'applied'})]));
assert(normalized.length===6&&normalized[0].id==='session-9'&&normalized[0].reflection==='applied','history must stay bounded and deduplicate a repeated save');
const local=context.emptyGrowthState(),remote=context.emptyGrowthState();local.openingTransfers=[records[0]];remote.openingTransfers=[records[1]];
const merged=context.mergeGrowthStates(local,remote);
assert(merged.openingTransfers.length===2,'cross-device growth merge dropped an opening session');
assert(context.normalizeGrowthState({v:1}).openingTransfers.length===0,'legacy training state should have an empty opening history');
const future=context.normalizeOpeningTransferRecords([Object.assign({},observation,{examples:[null]})]);
assert(future.length===1&&future[0].examples.length===0,'malformed saved examples should not break Progress');

// The real owner-scoped store is also the backup/sync payload. Verify that
// adding opening records preserves existing Library and profile records.
const store=new Map();context.localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
let activeOwner=null;context.activePracticeOwnerId=()=>activeOwner;context.queueGrowthRemoteSync=()=>{};
let growthState=context.emptyGrowthState();growthState.openingTransfers=[observation];growthState.library.records.italian={attempts:3};
assert(context.saveGrowthState(growthState).ok,'local opening history did not save');
activeOwner='account-a';assert(context.loadGrowthState().openingTransfers.length===0,'guest opening history appeared in a different owner store');
context.adoptAnonymousGrowthState(activeOwner);
assert(context.loadGrowthState().openingTransfers.length===1&&context.loadGrowthState().library.records.italian.attempts===3,'guest adoption did not preserve opening and Library records');
activeOwner='account-b';assert(context.loadGrowthState().openingTransfers.length===0,'account opening history leaked into another account');

// Finishing must flush the exercise before restoring a different game, and
// an in-flight finish must never overwrite an owner that changed meanwhile.
(async()=>{
 const asyncStart=app.indexOf('\nasync function classifyMove(')+1;
 vm.runInContext(app.slice(asyncStart,app.indexOf('\n}',asyncStart)+2),context);
 context.engineClient={evaluate:()=>{throw Error('terminal mate must not need an engine result');}};
 const mateBefore=new Chess('7k/8/5KQ1/8/8/8/8/8 w - - 0 1'),mateAfter=new Chess(mateBefore.fen());
 mateAfter.move('Qg7#');
 const mateReview=await context.classifyMove(mateBefore.fen(),'g6g7',mateAfter.fen());
 assert(mateReview.tier==='best'&&mateReview.label==='Best move'&&mateReview.loss===0&&mateReview.reviewSummary.includes('checkmate'),'proven mate became ungraded without engine data');
 context.setTimeout=setTimeout;context.clearTimeout=clearTimeout;
 vm.runInContext('saveOpeningTransferReview=()=>({ok:true});renderOpeningTransferHistory=()=>{};',context);
 Object.assign(context,{
  coachThinking:false,closeSummaryOverlay:()=>{},coachIsReviewing:()=>false,saveCoachState:()=>{},
  updateCoachControlsState:()=>{},handleCoachDbError:error=>{throw error;},
  CoachController:{setPhase:()=>{}},showCoachPanel:()=>{},setCoachStatus:()=>{},
  coachIsUserTurn:()=>true,document:{getElementById:()=>null},renderInsights:()=>{}
 });
 let restored=0,release;context.restoreCoachPracticeReturnState=()=>{restored++;return true;};
 context.coachSync={saveGame:()=>new Promise(resolve=>{release=resolve;})};
 context.coachOpeningTransfer=state;
 let finish=context.finishOpeningTransfer();
 assert(restored===0,'finish restored the old game before the outgoing save completed');
 release();await finish;
 assert(restored===1&&context.coachOpeningTransfer===null,'finished exercise did not restore after the outgoing save');
 context.coachOpeningTransfer=state;
 finish=context.finishOpeningTransfer();
 owner='user:other';const incoming={id:'incoming-owner-session'};context.coachOpeningTransfer=incoming;context.coachGameActive=true;
 release();await finish;
 assert(restored===1&&context.coachOpeningTransfer===incoming&&context.coachGameActive,'old asynchronous finish changed the incoming owner session');
 if(failures.length){console.error(failures.join('\n'));process.exit(1);}
 console.log(`Opening transfer validation passed (${checks} behavioural checks).`);
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
