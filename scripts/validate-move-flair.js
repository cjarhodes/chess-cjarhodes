#!/usr/bin/env node
// Great (!) and Brilliant (!!) labels: run move-flair.js on real positions
// with engine-shaped MultiPV fixtures (scores from the mover's view).
const path = require('path');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');
const { moveFlair, winProb } = require(path.join(__dirname, '..', 'move-flair.js'));

let checks = 0;
const failures = [];
const expect = (actual, wanted, message) => { checks++; if (actual !== wanted) failures.push(`${message}: got ${actual}, wanted ${wanted}`); };
const lines = (...rows) => rows.map(([uci, cp, mate]) => ({ pv: [uci], cp: cp === undefined ? null : cp, mate: mate === undefined ? null : mate }));

// Greek gift: Bxh7+ gives up the bishop (the king takes, nothing recaptures)
// and the engine still rates it best.
const greek = 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8';
expect(moveFlair(Chess, greek, 'd3h7', lines(['d3h7', 220], ['e1g1', 40])), 'brilliant', 'a sound bishop sacrifice');
expect(moveFlair(Chess, greek, 'd3h7', lines(['d3h7', -150], ['e1g1', -160])), null, 'a sacrifice into a worse position');
expect(moveFlair(Chess, greek, 'd3h7', lines(['e1g1', 60], ['d3h7', 50])), null, 'a sacrifice that was not the engine’s first choice');
expect(moveFlair(Chess, greek, 'e1g1', lines(['e1g1', 320], ['d3h7', 0])), 'great', 'the only good quiet move');

// A queen move to a square a pawn attacks is a sacrifice even if defended.
const queenSac = '6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1';
expect(moveFlair(Chess, queenSac, 'd1d8', lines(['d1d8', null, 1], ['g1f1', 0])), null, 'mate in one is not labelled');
const rookTakes = 'r5k1/5p1p/6p1/8/8/8/5PPP/3Q2K1 w - - 0 1';
expect(moveFlair(Chess, rookTakes, 'd1d8', lines(['d1d8', 300], ['g1f1', 0])), 'brilliant', 'a queen given to a rook while still best');
// Taking a queen with a queen is a trade, never a sacrifice.
const queens = '3qk3/8/8/8/8/8/8/3QK3 w - - 0 1';
expect(moveFlair(Chess, queens, 'd1d8', lines(['d1d8', 900], ['e1e2', -900])), null, 'a queen trade (also an obvious capture)');
// A defended piece that only a more valuable piece can take is not en prise.
const defended = '4k3/8/8/3q4/8/2N5/1P6/4K3 w - - 0 1';
expect(moveFlair(Chess, defended, 'c3a4', lines(['c3a4', 40], ['c3e4', 30])), null, 'an ordinary knight move');

// Great needs a clear gap to the second move.
const quiet = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
expect(moveFlair(Chess, quiet, 'f1b5', lines(['f1b5', 40], ['f1c4', 35])), null, 'several good moves');
expect(moveFlair(Chess, quiet, 'f1b5', lines(['f1b5', 300], ['f1c4', -50])), 'great', 'a large gap to the alternative');
expect(moveFlair(Chess, quiet, 'f1b5', lines(['f1b5', 300])), null, 'no second line to compare with');
expect(moveFlair(Chess, quiet, 'f1b5', lines(['f1b5', 1500], ['f1c4', 1200])), null, 'already decided position');
expect(moveFlair(Chess, quiet, 'f1b5', lines(['f1b5', -100], ['f1c4', -600])), null, 'the best of bad options');

// Plain recaptures and forced moves are not "great".
const recapture = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
expect(moveFlair(Chess, recapture, 'e4d5', lines(['e4d5', 60], ['b1c3', -200])), null, 'a pawn trade');
const inCheck = '4k3/8/8/8/8/8/3q4/4K3 w - - 0 1';
expect(moveFlair(Chess, inCheck, 'e1d2', lines(['e1d2', 900], ['e1f1', -900])), null, 'a forced capture while in check');

expect(Math.round(winProb({ cp: 0 }) * 100), 50, 'level is 50%');
expect(winProb({ mate: 3 }), 1, 'mate for the mover');
expect(winProb({ mate: -2 }), 0, 'mate against the mover');

if (failures.length) {
  console.error(`Move flair validation failed (${failures.length} of ${checks}):`);
  failures.forEach(f => console.error(' - ' + f));
  process.exit(1);
}
console.log(`Move flair validation passed (${checks} checks).`);
