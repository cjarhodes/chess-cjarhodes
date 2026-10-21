#!/usr/bin/env node
const fs=require('fs'),vm=require('vm'),path=require('path');
const {Chess}=require('../vendor/chess.js/chess-0.10.3.min.js');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const store=new Map(),chain=new Proxy({}, {get:()=>()=>chain});
let owner=null,entries=[],checks=0;
const context={Chess,window:{},$:()=>chain,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
 activePracticeOwnerId:()=>owner,coachMemoryOwnerId:()=>owner?'user:'+owner:'anon:test',currentInsightEntries:()=>entries,
 moveFromUci:(fen,uci)=>new Chess(fen).move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]}),
 setCoachStatus:()=>{},isInsightProblem:t=>['mistake','blunder','inaccuracy'].includes(t),insightTagsForReview:r=>r.tags||[],
 updateCoachControlsState:()=>{},saveCoachPracticeState:()=>{},renderInsights:()=>{},coachThinking:false,coachPracticeSession:null,coachPracticeRun:null,coachLocalGameId:'live-a'};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'openings.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'growth.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'learning-transfer.js'),'utf8')+'\nthis.positions=LEARNING_TRANSFER_POSITIONS;renderLearningTransferProgress=()=>{};queueGrowthRemoteSync=()=>{};',context);
const assert=(ok,message)=>{checks++;if(!ok)throw Error(message);};
const record=(id='test-a')=>({id,at:100,updatedAt:100,sourceId:'source',sourceFen:new Chess().fen(),tag:'missed_mate',title:'Scan checks',cue:'Check legal replies.',challengeId:'back-rank',challengeFen:context.positions[0].fen,firstResult:'pending',firstAt:0,firstUci:'',firstSan:'',completed:false,helpUsed:false,playGameId:'',observations:[]});
const save=rows=>{const state=context.loadGrowthState();state.learningTransfers=rows;state.library.records.italian={attempts:3};assert(context.saveGrowthState(state).ok,'growth save failed');};
const source={id:'source',tag:'missed_mate',entry:{fenBefore:'7k/8/5KQ1/8/8/8/8/8 w - - 0 1'}};
for(const p of context.positions){
 const board=new Chess(p.fen);assert(!board.game_over()&&!board.in_check(),'authored check must start playable without a forced check: '+p.id);
 const move=context.moveFromUci(p.fen,p.uci);assert(!!move,'authored answer is illegal: '+p.id);
 assert(context.learningPositionKey(p.fen)!==context.learningPositionKey(source.entry.fenBefore),'check repeats the source');
 if(['back-rank','defended-square'].includes(p.id)){board.move(move.san);assert(board.in_checkmate(),'authored mate is not mate: '+p.id);}
}
assert(context.positions.length===5,'all authored contexts should be checked');
assert(context.learningTransferOffer(source).id==='back-rank','matching source did not select a check');
entries=[{fenBefore:context.positions[0].fen.replace('0 1','9 40')}];
assert(context.learningTransferOffer(source).id==='defended-square','known position with changed counters was treated as different');
entries=[];save([record()]);assert(context.learningTransferOffer(source).id==='defended-square','opened checks were offered as fresh again');
save([record(),Object.assign(record('b'),{challengeId:'defended-square',challengeFen:context.positions[1].fen})]);
assert(context.learningTransferOffer(source)===null,'exhausted check pool should not repeat');
assert(context.learningTransferOffer({...source,tag:'time_to_castle'})===null,'unsupported cue got an unrelated check');
assert(context.learningTransferOffer({...source,id:'opening-bridge:italian'})===null,'opening bridge handoff was replaced');
save([record()]);
const item=context.learningTransferPracticeItem(context.loadGrowthState().learningTransfers[0]);
context.coachPracticeSession={owner:'anon:test',item,misses:0,hintUsed:false,revealed:false};context.coachGame=new Chess(item.entry.fenBefore);
assert(context.recordLearningTransferDecision(context.coachPracticeSession,'e1e7',{unknown:true})===false,'unknown engine result was graded');
assert(context.loadGrowthState().learningTransfers[0].firstResult==='pending','unknown result replaced the pending decision');
assert(context.recordLearningTransferDecision(context.coachPracticeSession,'e1e7',{sound:false}),'first mistake did not save');
let first=context.loadGrowthState().learningTransfers[0];assert(first.firstResult==='needs-work'&&first.firstSan==='Re7','first mistake recorded incorrectly');
context.coachPracticeSession.hintUsed=true;
context.recordLearningTransferDecision(context.coachPracticeSession,'e1e8',{sound:true});
assert(context.loadGrowthState().learningTransfers[0].firstUci==='e1e7','correct retry erased the first choice');
context.finishLearningTransferCheck(context.coachPracticeSession,{san:'Re8#'});
let completed=context.loadGrowthState().learningTransfers[0];assert(completed.completed&&completed.firstResult==='needs-work'&&completed.helpUsed,'completion or assistance overwrote first result');
assert(context.learningTransferPracticeItem(completed).meta.title==='Rehearse this check','a repeated check was described as new');
const late={...completed,updatedAt:completed.updatedAt+10,firstAt:completed.firstAt+5,firstResult:'sound',firstUci:'e1e8'};
const merged=context.normalizeLearningTransferRecords([completed,late])[0];assert(merged.firstResult==='needs-work'&&merged.firstUci==='e1e7','merge erased first result');
const pending={...completed,updatedAt:completed.updatedAt+20,firstResult:'pending',firstAt:0,completed:false};
assert(context.normalizeLearningTransferRecords([completed,pending])[0].completed,'newer stale pending save erased completion');
save([record('assist')]);context.coachPracticeSession={owner:'anon:test',item:context.learningTransferPracticeItem(context.loadGrowthState().learningTransfers[0]),hintUsed:true,revealed:false};
context.recordLearningTransferDecision(context.coachPracticeSession,'e1e8',{sound:true});
assert(context.loadGrowthState().learningTransfers[0].firstResult==='assisted','hinted first decision was called unassisted');
let row=context.loadGrowthState().learningTransfers[0];row.completed=true;row.playGameId='live-a';save([row]);context.coachPracticeSession=null;
context.recordLearningTransferLiveMove({tier:'unknown',ply:1,tags:['missed_mate']});
assert(context.loadGrowthState().learningTransfers[0].observations.length===0,'unknown live review counted');
for(let ply=1;ply<=10;ply++)context.recordLearningTransferLiveMove({tier:ply===2?'mistake':'good',ply,tags:['missed_mate']});
row=context.loadGrowthState().learningTransfers[0];assert(row.observations.length===6&&row.observations.filter(r=>r.flagged).length===1,'live window or pattern flags are wrong');
context.recordLearningTransferLiveMove({tier:'good',ply:1,tags:[]});assert(context.loadGrowthState().learningTransfers[0].observations.length===6,'duplicate live review counted');
context.coachLocalGameId='different-game';context.recordLearningTransferLiveMove({tier:'good',ply:11,tags:[]});assert(context.loadGrowthState().learningTransfers[0].observations.length===6,'unrelated game counted');
const rows=Array.from({length:30},(_,i)=>({...record('bound-'+i),at:200+i,observations:[null,{key:'x',at:200,tier:'unknown'}]}));
assert(context.normalizeLearningTransferRecords(rows).length===24,'history is unbounded');
assert(context.normalizeLearningTransferRecords([null,{},record()])[0].observations.length===0,'malformed observations retained');
assert(context.normalizeGrowthState({v:1}).learningTransfers.length===0,'legacy state has invalid learning history');
owner='account-a';assert(context.loadGrowthState().learningTransfers.length===0,'guest evidence leaked to another owner');
context.adoptAnonymousGrowthState(owner);assert(context.loadGrowthState().learningTransfers.length===1&&context.loadGrowthState().library.records.italian.attempts===3,'guest adoption lost checks or Library state');
owner='account-b';assert(context.loadGrowthState().learningTransfers.length===0,'check history leaked between accounts');
context.coachPracticeSession={owner:'anon:test',item};assert(context.currentLearningTransferRecord()===null,'stale practice owner can read a check');
console.log(`Learning transfer validation passed (${checks} behavioural checks).`);
