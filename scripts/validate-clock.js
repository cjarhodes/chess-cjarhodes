#!/usr/bin/env node
// Coach clocks: time is charged to the side to move only while the game is
// live and not paused, increments follow each completed move, flags end the
// game as a loss (or a draw when the winner cannot mate), and saved clocks
// load back stopped.
const path = require('path');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');
const C = require(path.join(__dirname, '..', 'clock-core.js'));
let checks = 0;
const failures = [];
const expect = (actual, wanted, message) => { checks++; if (JSON.stringify(actual) !== JSON.stringify(wanted)) failures.push(`${message}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`); };

expect(C.timed('none'), false, 'untimed is the default and has no clock');
expect(C.control('bogus').id, 'none', 'an unknown control falls back to untimed');
expect(C.CONTROLS.filter(c => c.base).every(c => c.base >= 60), true, 'every timed control has at least a minute');

const live = (turn, plies) => ({ turn, plies, active: true, paused: false });
let s = C.create('3+2', 0);
expect([s.ms.w, s.ms.b, s.running], [180000, 180000, null], 'a new 3+2 clock starts stopped at three minutes each');
s = C.sync(s, live('w', 0), 1000);
expect(s.running, 'w', 'White\'s clock runs on White\'s turn');
s = C.sync(s, live('w', 0), 6000);
expect(s.ms.w, 175000, 'five seconds are charged to White');
// White moves: White gets the increment, Black's clock starts.
s = C.sync(s, live('b', 1), 7000);
expect([s.ms.w, s.ms.b, s.running], [180000 - 6000 + 2000, 180000, 'b'], 'White\'s move charges the last second and adds two');
s = C.sync(s, live('b', 1), 10000);
expect(s.ms.b, 177000, 'Black is charged while thinking');
// Paused (Show why, another view): nothing is charged.
s = C.sync(s, { turn: 'b', plies: 1, active: true, paused: true }, 11000);
expect([s.ms.b, s.running], [176000, null], 'pausing charges up to the pause and stops');
s = C.sync(s, { turn: 'b', plies: 1, active: true, paused: true }, 60000);
expect(s.ms.b, 176000, 'a paused clock does not run');
s = C.sync(s, live('b', 1), 61000);
s = C.sync(s, live('w', 2), 62000);
expect([s.ms.b, s.running], [176000 - 1000 + 2000, 'w'], 'Black\'s move after a pause adds the increment');
// Two moves between syncs (an instant reply): both movers get their increment.
s = C.sync(s, live('w', 4), 62000);
expect([s.ms.w, s.ms.b], [176000 + 2000, 177000 + 2000], 'both moves in one sync earn an increment each');
// A takeback lowers the move count without refunding or charging.
const before = s.ms;
s = C.sync(s, live('w', 2), 62000);
expect([s.ms, s.plies], [before, 2], 'a takeback leaves the clocks alone');
// An ended game stops both clocks.
s = C.sync(s, { turn: 'w', plies: 2, active: false, paused: false }, 70000);
expect(s.running, null, 'an ended game stops the clock');

// Flags.
let f = C.create('5+0', 0);
f = C.sync(f, live('w', 0), 0);
f = C.sync(f, live('w', 0), 300001);
expect([f.flagged, f.ms.w, f.running], ['w', 0, null], 'running out flags the side to move');
f = C.sync(f, live('b', 1), 300500);
expect([f.flagged, f.ms.w], ['w', 0], 'a flagged clock stays flagged, with no increment');
expect(C.flagResult(Chess, new Chess().fen(), 'w'), 'Time — Black wins.', 'losing on time with material left on the board is a loss');
expect(C.flagResult(Chess, '8/8/8/4k3/8/8/8/4K2Q w - - 0 1', 'b'), 'Time — White wins.', 'the opponent flags against a queen');
expect(C.flagResult(Chess, '8/8/8/4k3/8/8/2Q5/4K1N1 w - - 0 1', 'w'), 'Draw: time ran out with insufficient material.', 'a bare king cannot win on time');
expect(C.flagResult(Chess, '8/8/8/4kn2/8/8/2Q5/4K3 w - - 0 1', 'w'), 'Draw: time ran out with insufficient material.', 'king and knight cannot win on time');
expect(C.flagResult(Chess, '8/8/8/3pk3/8/8/2Q5/4K3 w - - 0 1', 'w'), 'Time — Black wins.', 'a pawn can still mate, so it wins on time');

// Formatting.
expect([C.format(180000), C.format(61000), C.format(10000), C.format(9400), C.format(-5)], ['3:00', '1:01', '0:10', '0:09.4', '0:00.0'], 'clock faces');

// Saved clocks load back stopped, with sane values.
const saved = C.normalize(JSON.parse(JSON.stringify(Object.assign(C.create('10+0', 6), { running: 'w', since: 123 }))));
expect([saved.running, saved.since, saved.plies, saved.ms.w], [null, null, 6, 600000], 'a saved clock loads stopped');
expect(C.normalize({ v: 1, control: 'none', ms: { w: 1, b: 1 } }), null, 'an untimed save is ignored');
expect(C.normalize({ v: 1, control: '3+2', ms: { w: 'x', b: 1e12 } }).ms, { w: 0, b: 720000 }, 'bad saved times are clamped');

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Clock validation passed (${checks} checks).`);
