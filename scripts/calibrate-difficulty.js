#!/usr/bin/env node
// Difficulty calibration: reproduces the Coach opponent's move selection with
// the vendored Stockfish.js 10 build and scores every chosen move against a
// deep reference search. Prints average centipawn loss (ACPL), loss quantiles,
// and blunder rates per slider level next to a human reference curve.
//
//   node scripts/calibrate-difficulty.js                # all levels
//   LEVELS=800,1600 node scripts/calibrate-difficulty.js
//   KEYFRAMES=alt.json node scripts/calibrate-difficulty.js   # try other keyframes
//   REF_DEPTH=12 SAMPLES=1 OUT=calibration.json          # defaults
//
// Not part of the validator loop: a full run takes several minutes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.resolve(__dirname, '..');
const { Chess } = require(path.join(REPO, 'vendor/chess.js/chess-0.10.3.min.js'));
const app = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
const openingsSrc = fs.readFileSync(path.join(REPO, 'openings.js'), 'utf8');

const REF_DEPTH = parseInt(process.env.REF_DEPTH || '12', 10);
const LEVELS = (process.env.LEVELS || '400,600,800,1000,1200,1400,1600,1800,2000,2200,2400').split(',').map(Number);
const SAMPLES = parseInt(process.env.SAMPLES || '1', 10);
const OUT = process.env.OUT || path.join(REPO, '.calibration.json');
const KEYFRAMES_OVERRIDE = process.env.KEYFRAMES ? JSON.parse(fs.readFileSync(process.env.KEYFRAMES, 'utf8')) : null;

function sliceFunction(src, name) {
  const re = new RegExp('(?:^|\\n)(async )?function ' + name + '\\(');
  const m = re.exec(src); if (!m) throw new Error('missing ' + name);
  let i = src.indexOf('{', m.index); let depth = 0; let j = i;
  let inStr = null, inTpl = false, inLine = false, inBlock = false;
  for (; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; j++; } continue; }
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { inLine = true; continue; }
    if (c === '/' && n === '*') { inBlock = true; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(m.index, j + 1);
}
function sliceConst(src, name) {
  const start = src.indexOf('const ' + name + ' = ');
  if (start < 0) throw new Error('missing const ' + name);
  const end = src.indexOf('];\n', start);
  return src.slice(start, end + 2);
}
const ctx = { Math, Number, Object, Set, Array, console };
vm.createContext(ctx);
const code = [
  KEYFRAMES_OVERRIDE ? 'const COACH_DIFFICULTY_KEYFRAMES = ' + JSON.stringify(KEYFRAMES_OVERRIDE) + ';' : sliceConst(app, 'COACH_DIFFICULTY_KEYFRAMES'),
  sliceFunction(app, 'interpolateDifficultyField'),
  sliceFunction(app, 'coachStrengthOpts'),
  sliceFunction(app, 'calibratedOpponentCandidates'),
  sliceFunction(app, 'chooseCalibratedOpponentMove'),
  sliceFunction(app, 'scoreToCp'),
  sliceFunction(app, 'parseInfo'),
  'globalThis.api = { coachStrengthOpts, chooseCalibratedOpponentMove, scoreToCp, parseInfo, COACH_DIFFICULTY_KEYFRAMES };'
].join('\n');
vm.runInContext(code, ctx, { filename: 'app-slice.js' });
const api = ctx.api;

// ---- engine ----
const engine = require(path.join(REPO, 'stockfish/stockfish.js'))();
let handler = null;
engine.onmessage = msg => { if (handler) handler(String(msg)); };
function send(cmd) { engine.postMessage(cmd); }
function once(pred) { return new Promise(resolve => { const prev = handler; handler = line => { if (pred(line)) { handler = prev; resolve(line); } }; }); }
async function initEngine() {
  const p = once(l => l === 'uciok'); send('uci'); await p;
  const r = once(l => l === 'readyok'); send('isready'); await r;
}
function analyse(fen, opts) {
  return new Promise(resolve => {
    const pvLines = {}; let lastInfo = null; const t0 = Date.now();
    handler = line => {
      if (line.startsWith('info ')) {
        const parsed = api.parseInfo(line);
        if (!parsed || !parsed.pv || !parsed.pv.length) return;
        if (opts.multipv) pvLines[parsed.multipv || 1] = parsed; else lastInfo = parsed;
      } else if (line.startsWith('bestmove ')) {
        const bm = line.split(' ')[1];
        handler = null;
        const lines = Object.keys(pvLines).map(Number).sort((a, b) => a - b).map(k => pvLines[k]);
        resolve({ bestmove: bm === '(none)' ? null : bm, lines, info: lastInfo, ms: Date.now() - t0 });
      }
    };
    send('ucinewgame');
    send('setoption name Skill Level value ' + (typeof opts.skill === 'number' ? opts.skill : 20));
    send('setoption name MultiPV value ' + (opts.multipv || 1));
    send('position fen ' + fen);
    send('go depth ' + opts.depth);
  });
}
const refCache = new Map();
// Reference search: score (side to move) and best move. Losses are measured as
// the difference between the child position after the chosen move and the
// child position after the reference best move, both evaluated the same way,
// so the engine's tempo bonus and depth-parity effects cancel out.
async function refSearch(fen) {
  if (refCache.has(fen)) return refCache.get(fen);
  const g = new Chess(fen);
  let out;
  if (g.game_over()) out = { cp: g.in_checkmate() ? -10000 : 0, best: null };
  else { const r = await analyse(fen, { skill: 20, depth: REF_DEPTH, multipv: null }); out = { cp: api.scoreToCp(r.info || { cp: 0 }), best: (r.info && r.info.pv && r.info.pv[0]) || r.bestmove }; }
  refCache.set(fen, out); return out;
}
async function childScore(fen, move) {
  // Opponent-perspective score of the position after `move`; lower is better for the mover.
  const g = new Chess(fen);
  const mv = g.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] || 'q' });
  if (!mv) return null;
  return (await refSearch(g.fen())).cp;
}

// ---- positions ----
const octx = {}; vm.createContext(octx);
vm.runInContext(openingsSrc + '\nglobalThis.OPENINGS = OPENINGS;', octx);
const positions = [];
for (const op of octx.OPENINGS) {
  for (const ply of [6, 12]) {
    if (op.moves.length < ply) continue;
    const g = new Chess(); for (let i = 0; i < ply; i++) g.move(op.moves[i]);
    positions.push({ id: op.id + '@' + ply, fen: g.fen() });
  }
}
positions.push({ id: 'endgame-KQvK', fen: '7k/8/5KQ1/8/8/8/8/8 w - - 0 1' });
positions.push({ id: 'endgame-rook', fen: '8/8/4k3/8/8/4K3/8/4R3 w - - 0 1' });
positions.push({ id: 'endgame-pawn', fen: '8/5k2/8/3P4/3K4/8/8/8 w - - 0 1' });
positions.push({ id: 'middlegame-1', fen: 'r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P4/2P1PN2/PP1NBPPP/R2QK2R w KQ - 0 8' });
positions.push({ id: 'middlegame-2', fen: 'r2q1rk1/1b1nbppp/p2ppn2/1p6/3NPP2/2N1B3/PPPQB1PP/2KR3R b - - 0 11' });
positions.push({ id: 'tactic-hang', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 0 4' });

(async () => {
  await initEngine();
  const results = {};
  const t0 = Date.now();
  for (const level of LEVELS) {
    const opts = api.coachStrengthOpts(level);
    const rows = [];
    for (const pos of positions) {
      const g = new Chess(pos.fen); if (g.game_over()) continue;
      const search = await analyse(pos.fen, opts);
      const ref = await refSearch(pos.fen);
      const bestChild = ref.best ? await childScore(pos.fen, ref.best) : null;
      for (let s = 0; s < SAMPLES; s++) {
        const move = api.chooseCalibratedOpponentMove(search, opts);
        if (!move) continue;
        const chosenChild = await childScore(pos.fen, move);
        if (chosenChild === null || bestChild === null) { rows.push({ pos: pos.id, move, loss: null, illegal: chosenChild === null }); continue; }
        const loss = Math.max(0, Math.min(1500, chosenChild - bestChild));
        const ownBest = search.lines.length ? api.scoreToCp(search.lines[0]) : null;
        const ownLine = search.lines.find(l => l.pv && l.pv[0] === move);
        const ownLoss = ownBest !== null && ownLine ? Math.max(0, ownBest - api.scoreToCp(ownLine)) : null;
        rows.push({ pos: pos.id, move, loss, ownLoss, ms: search.ms });
      }
    }
    const losses = rows.filter(r => r.loss !== null).map(r => r.loss).sort((a, b) => a - b);
    const mean = losses.reduce((a, b) => a + b, 0) / losses.length;
    const median = losses[Math.floor(losses.length / 2)];
    const rate = th => losses.filter(l => l >= th).length / losses.length;
    const ms = rows.map(r => r.ms).filter(Boolean);
    results[level] = { opts, n: losses.length, acpl: Math.round(mean), median, p100: rate(100), p200: rate(200), p300: rate(300),
      ownAcpl: Math.round(rows.filter(r => r.ownLoss !== null).reduce((a, r) => a + r.ownLoss, 0) / Math.max(1, rows.filter(r => r.ownLoss !== null).length)),
      msMean: Math.round(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length)), msMax: Math.max(0, ...ms), rows };
    const r = results[level];
    console.log(`level ${level}: depth ${opts.depth} mpv ${opts.multipv} err ${Math.round((opts.errorRate || 0) * 100)}% size ${opts.errorSize || 0} | n=${r.n} ACPL ${r.acpl} median ${r.median} p>=100 ${(r.p100*100).toFixed(0)}% p>=300 ${(r.p300*100).toFixed(0)}% | own ${r.ownAcpl} | ${r.msMean}ms avg ${r.msMax}ms max | elapsed ${Math.round((Date.now()-t0)/1000)}s`);
  }
  fs.writeFileSync(OUT, JSON.stringify({ REF_DEPTH, positions: positions.length, results }, null, 1));
  const HUMAN = { 400: 200, 600: 160, 800: 130, 1000: 105, 1200: 85, 1400: 70, 1600: 55, 1800: 45, 2000: 35, 2200: 27, 2400: 20 };
  const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  console.log('\nlevel  depth mpv rnd% err%  size | ACPL human | p25 med p75 p90 | >=100 >=300 | ms avg/max');
  for (const level of Object.keys(results).map(Number).sort((a, b) => a - b)) {
    const r = results[level]; const L = r.rows.filter(x => x.loss !== null).map(x => x.loss); const o = r.opts;
    console.log(`${String(level).padStart(5)}  ${String(o.depth).padStart(5)} ${String(o.multipv).padStart(3)} ${String(Math.round((o.randomRate || 0) * 100)).padStart(4)} ${String(Math.round((o.errorRate || 0) * 100)).padStart(4)} ${String(o.errorSize || 0).padStart(5)} | ${String(r.acpl).padStart(4)} ${String(HUMAN[level] || '?').padStart(5)} | ${String(q(L, .25)).padStart(3)} ${String(q(L, .5)).padStart(3)} ${String(q(L, .75)).padStart(3)} ${String(q(L, .9)).padStart(3)} | ${(r.p100 * 100).toFixed(0).padStart(4)}% ${(r.p300 * 100).toFixed(0).padStart(4)}% | ${r.msMean}/${r.msMax}`);
  }
  console.log('wrote ' + OUT);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
