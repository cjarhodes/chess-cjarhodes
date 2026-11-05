#!/usr/bin/env node
// Endgame practice: drills are legal won positions and the judge calls wins,
// stalemates, lost material, captured queens and the move limit correctly.
const path = require('path');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');
const E = require(path.join(__dirname, '..', 'endgames.js'));
let checks = 0;
const failures = [];
const expect = (actual, wanted, message) => { checks++; if (actual !== wanted) failures.push(`${message}: got ${actual}, wanted ${wanted}`); };
const after = (fen, sans) => { const g = new Chess(fen); sans.forEach(m => { if (!g.move(m, { sloppy: true })) throw Error('illegal fixture move ' + m); }); return g; };
const result = (drill, g, n) => { const r = E.judge(Chess, drill, g, n); return r ? r.result : null; };

E.DRILLS.forEach(d => {
  const g = new Chess();
  expect(g.load(d.fen), true, `${d.id} has a legal FEN`);
  expect(g.game_over(), false, `${d.id} starts as a live position`);
  expect(E.userColor(d), 'w', `${d.id} is played as White`);
  expect(d.limit > 0 && d.tip.length > 20, true, `${d.id} has a limit and a tip`);
  expect(result(d, g, 0), null, `${d.id} is not judged at the start`);
});
expect(new Set(E.DRILLS.map(d => d.id)).size, E.DRILLS.length, 'drill ids are unique');

const kq = E.byId('kq-k');
expect(result(kq, new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 6), 'fail', 'a stalemate fails the queen drill');
expect(result(kq, new Chess('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1'), 6), 'win', 'a mate wins the queen drill');
expect(result(kq, new Chess('8/8/8/4k3/8/8/8/4K3 w - - 0 1'), 3), 'fail', 'losing the queen fails');
expect(/lost a piece/.test(E.judge(Chess, kq, new Chess('8/8/8/4k3/8/8/8/4K3 w - - 0 1'), 3).reason), true, 'a bare-king draw after losing the queen says the piece was lost');
expect(result(kq, new Chess('8/8/8/4k3/8/8/8/4K2Q w - - 0 1'), 10), 'fail', 'running out of moves fails');
expect(result(kq, new Chess('8/8/8/4k3/8/8/8/4K2Q w - - 0 1'), 9), null, 'a move left is still in play');

const kp = E.byId('kp-k');
expect(result(kp, new Chess('4Q3/3K4/5k2/8/8/8/8/8 b - - 0 1'), 5), null, 'a fresh queen is judged after the reply');
expect(result(kp, new Chess('4Q3/3K4/8/5k2/8/8/8/8 w - - 0 1'), 5), 'win', 'a queen that survives the reply wins');
expect(result(kp, new Chess('8/3K4/8/5k2/8/8/8/8 w - - 0 1'), 5), 'fail', 'losing the pawn fails');
expect(result(kp, new Chess('4R3/3K4/8/5k2/8/8/8/8 w - - 0 1'), 5), 'win', 'an underpromotion to a rook that survives also wins');
expect(result(kp, new Chess('4R3/3K4/5k2/8/8/8/8/8 b - - 0 1'), 5), null, 'a new rook is judged after the reply');
const kpLine = after(kp.fen, ['Kd6', 'Kd8', 'e6', 'Ke8', 'e7', 'Kf7', 'Kd7', 'Kf6', 'e8=Q', 'Kf5']);
expect(result(kp, kpLine, 5), 'win', 'the textbook key-square win is accepted');
const lucena = E.byId('lucena');
const bridge = after(lucena.fen, ['Rd1+', 'Ke7', 'Rd4', 'Ra1', 'Kc7', 'Rc1+', 'Kb6', 'Rb1+', 'Kc6', 'Rc1+', 'Kb5', 'Rb1+', 'Rb4', 'Rc1', 'b8=Q', 'Rc5+']);
expect(result(lucena, bridge, 8), 'win', 'building the bridge and promoting wins the Lucena drill');

if (failures.length) {
  console.error(`Endgame validation failed (${failures.length} of ${checks}):`);
  failures.forEach(f => console.error(' - ' + f));
  process.exit(1);
}
console.log(`Endgame validation passed (${checks} checks).`);
