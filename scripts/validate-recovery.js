#!/usr/bin/env node

// Executable checks of saved-position loading and daily-plan recovery.
// Uses the runtime functions and the same vendored chess.js as the browser.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const errors = [];
let assertions = 0;

function assert(condition, message) {
  assertions += 1;
  if (!condition) errors.push(message);
}

function findFunctionStart(name) {
  for (const marker of [`\nfunction ${name}(`, `\nasync function ${name}(`]) {
    const index = app.indexOf(marker);
    if (index !== -1) return index + 1;
  }
  throw new Error(`Could not locate function ${name} in app.js`);
}

function findMatchingBrace(source, openBrace) {
  let depth = 0;
  let mode = 'code';
  for (let i = openBrace; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === 'line') { if (c === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (c === '*' && next === '/') { mode = 'code'; i += 1; } continue; }
    if (mode === 'single' || mode === 'double') {
      if (c === '\\') { i += 1; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"')) mode = 'code';
      continue;
    }
    if (c === '/' && next === '/') { mode = 'line'; i += 1; continue; }
    if (c === '/' && next === '*') { mode = 'block'; i += 1; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '{') depth += 1;
    if (c === '}' && --depth === 0) return i;
  }
  throw new Error('Unmatched function brace in app.js');
}

function extractFunction(name) {
  const start = findFunctionStart(name);
  const openBrace = app.indexOf('{', start);
  return app.slice(start, findMatchingBrace(app, openBrace) + 1);
}

const code = ['loadCoachSavedPosition', 'isValidFen', 'recoverDailySprintPlan'].map(extractFunction).join('\n');
const context = {Chess, DAILY_TRANSFER_TARGET:6};
vm.createContext(context);
vm.runInContext(code,context);
const customFen = '7k/8/5K2/8/8/8/8/R7 w - - 0 1';
const custom = new Chess(customFen);
const headerOnly = custom.pgn();
assert(context.loadCoachSavedPosition({startFen:customFen,pgn:headerOnly,fen:customFen}).fen() === customFen, 'zero-move custom PGN must restore its FEN');
custom.move('Kg6');custom.move('Kg8');
const played = context.loadCoachSavedPosition({startFen:customFen,pgn:custom.pgn(),fen:custom.fen()});
assert(played.pgn() === custom.pgn(), 'played custom game must retain its history');
assert(context.loadCoachSavedPosition({}).fen() === new Chess().fen(), 'empty legacy game must retain standard initial position');
for(const saved of [
  {startFen:'not a FEN'},
  {pgn:'not a legal PGN'},
  {startFen:customFen,pgn:custom.pgn(),fen:new Chess().fen()}
]) {
  let rejected=false;try{context.loadCoachSavedPosition(saved);}catch(e){rejected=true;}
  assert(rejected,'invalid or mismatched snapshot must be rejected');
}
const old={mode:'adaptive',phase:'drills',drillTarget:3,drillsCompleted:1,drillIds:['earned'],moveTarget:4,movesCompleted:0,target:7,completedUnits:1};
const original=JSON.stringify(old);
const repaired=context.recoverDailySprintPlan(old,0);
assert(repaired.phase==='moves' && repaired.target===5, 'unavailable drills must lead to live play');
assert(repaired.completedUnits===1 && repaired.drillIds[0]==='earned', 'repair must preserve earned work');
assert(!repaired.completedAt && repaired.moveTarget===4, 'repair must not fabricate completion or remove live play');
assert(JSON.stringify(old)===original,'repair must not mutate input state');
const partial=context.recoverDailySprintPlan(old,1);
assert(partial.phase==='drills' && partial.drillTarget===2,'one remaining drill must remain reachable');
assert(context.recoverDailySprintPlan(old,2)===old,'reachable plan must not change');
const complete=Object.assign({},old,{completedAt:123});
assert(context.recoverDailySprintPlan(complete,0)===complete,'completed day must not be rewritten');
const moves=Object.assign({},old,{phase:'moves'});
assert(context.recoverDailySprintPlan(moves,0)===moves,'active live play must not be rewritten');
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`Recovery validation passed (${assertions} assertions).`);
