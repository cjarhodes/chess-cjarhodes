#!/usr/bin/env node
// Engine audit of Library lines: plays every line with the vendored
// Stockfish and reports moves by the line's own side that give away more
// than a threshold of winning chances, so content mistakes (a move that hangs a piece, a line that
// teaches a bad idea) are caught before they ship. The opponent's moves are
// reported but never fail the audit: trap lines show the victim's mistake
// on purpose. Slow (a few minutes for every line), so it is a tool rather
// than a CI validator.
//
//   node scripts/audit-openings.js                  every line, depth 12
//   node scripts/audit-openings.js vienna catalan   only these openings
//   DEPTH=14 LOSS=8 node scripts/audit-openings.js
//   EXTRA=draft.js SIDES='{"lasker-trap":"b"}' node scripts/audit-openings.js lasker-trap
//     (EXTRA: a file whose module.exports is an array of draft openings to
//      audit as if appended to openings.js; SIDES: owning side for ids that
//      opponents.js LINE_SIDE does not list yet)
//
// Loss is measured in win probability (percentage points), not centipawns:
// passing up +12 for +4 is not a teaching error, dropping from +0.3 to -1.5
// is. Exit code 1 when an own-side move loses more than LOSS points.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.resolve(__dirname, '..');
const { Chess } = require(path.join(REPO, 'vendor/chess.js/chess-0.10.3.min.js'));
const DEPTH = Number(process.env.DEPTH) || 12;
const LOSS = Number(process.env.LOSS) || 10;
const winPct = cp => 100 / (1 + Math.pow(10, -cp / 400));

const context = { Chess, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(REPO, 'openings.js'), 'utf8') + '\nthis.OPENINGS = OPENINGS;\n' +
  fs.readFileSync(path.join(REPO, 'opponents.js'), 'utf8').replace(/typeof window !== 'undefined' \? window : globalThis/, 'this'), context);
const OPENINGS = context.OPENINGS.concat(process.env.EXTRA ? require(path.resolve(process.env.EXTRA)) : []);
const SIDES = process.env.SIDES ? JSON.parse(process.env.SIDES) : {};
const lineSide = (id, opening) => SIDES[id] || context.OpponentPersonas.lineSide(id, opening);

const engine = require(path.join(REPO, 'stockfish/stockfish.js'))();
let handler = null;
engine.onmessage = msg => { if (handler) handler(String(msg)); };
const send = cmd => engine.postMessage(cmd);
function waitFor(pred) { return new Promise(resolve => { handler = line => { if (pred(line)) { handler = null; resolve(line); } }; }); }

// Searches a position: { score, best } with score in centipawns for the side
// to move (mates as ±10000), from the deepest completed iteration.
async function search(fen) {
  const g = new Chess(fen);
  if (g.in_checkmate()) return { score: -10000, best: null };
  if (g.game_over()) return { score: 0, best: null };
  const ready = waitFor(l => l === 'readyok'); send('isready'); await ready;
  return new Promise(resolve => {
    let score = 0, depth = -1;
    handler = line => {
      if (line.startsWith('info ') && / pv /.test(line) && !/ (lower|upper)bound/.test(line)) {
        const d = Number((line.match(/ depth (\d+)/) || [])[1]);
        const cp = line.match(/ score cp (-?\d+)/), mate = line.match(/ score mate (-?\d+)/);
        if (d >= depth) {
          depth = d;
          if (cp) score = Number(cp[1]);
          else if (mate) score = Number(mate[1]) > 0 ? 10000 - Number(mate[1]) : -10000 - Number(mate[1]);
        }
      } else if (line.startsWith('bestmove')) { handler = null; resolve({ score, best: line.split(' ')[1] }); }
    };
    send('ucinewgame');
    send('position fen ' + fen);
    send('go depth ' + DEPTH);
  });
}

function linesOf(opening) {
  return [{ id: opening.id, name: opening.name, moves: opening.moves }]
    .concat((opening.variations || []).map(v => ({ id: v.id, name: `${opening.name}: ${v.name}`, moves: v.moves })));
}

(async () => {
  const p = waitFor(l => l === 'uciok'); send('uci'); await p;
  const r = waitFor(l => l === 'readyok'); send('isready'); await r;
  const only = process.argv.slice(2);
  const cache = new Map();
  const look = async fen => { const key = fen.split(' ').slice(0, 4).join(' '); if (!cache.has(key)) cache.set(key, await search(fen)); return cache.get(key); };
  // The mover's score after a move, judged on the child position, so the
  // played move and the engine's best move are measured the same way and
  // tempo and depth-parity effects cancel.
  const after = async (fen, uci) => { const g = new Chess(fen); g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' }); return -(await look(g.fen())).score; };
  let problems = 0, checked = 0;
  for (const opening of OPENINGS) {
    if (only.length && !only.includes(opening.id)) continue;
    for (const line of linesOf(opening)) {
      const owner = lineSide(line.id, opening);
      const game = new Chess();
      const notes = [];
      for (let i = 0; i < line.moves.length; i++) {
        const fen = game.fen();
        const mover = game.turn();
        const best = (await look(fen)).best;
        const move = game.move(line.moves[i], { sloppy: true });
        if (!move) { notes.push(`  ✗ move ${i + 1} ${line.moves[i]} is illegal`); problems++; break; }
        const uci = move.from + move.to + (move.promotion || '');
        const loss = !best || best === uci ? 0 : Math.round(winPct(await after(fen, best)) - winPct(await after(fen, uci)));
        checked++;
        const label = `${Math.floor(i / 2) + 1}${mover === 'w' ? '.' : '...'}${move.san}`;
        if (mover === owner && loss > LOSS) { notes.push(`  ✗ ${label} (own side) gives away ${loss} points of winning chances`); problems++; }
        else if (mover !== owner && loss > 2 * LOSS) notes.push(`  · ${label} (opponent) gives away ${loss} points`);
      }
      const final = (await look(game.fen())).score;
      const whiteView = game.turn() === 'w' ? final : -final;
      console.log(`${line.id.padEnd(24)} ${owner === 'w' ? 'White' : 'Black'} line, ${line.moves.length} plies, ends ${whiteView >= 0 ? '+' : ''}${(whiteView / 100).toFixed(2)} (White's view)`);
      notes.forEach(n => console.log(n));
    }
  }
  console.log(`\n${checked} moves checked at depth ${DEPTH}; ${problems} own-side move${problems === 1 ? '' : 's'} giving away more than ${LOSS} points of winning chances.`);
  process.exit(problems ? 1 : 0);
})();
