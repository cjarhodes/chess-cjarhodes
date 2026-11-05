#!/usr/bin/env node
// Opponent personalities: every repertoire opening exists, book moves are
// legal continuations of the shipped Library lines, and the engine takes
// over off book or from a custom start position.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');
const root = path.resolve(__dirname, '..');
const context = { Chess, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'openings.js'), 'utf8') + '\nthis.OPENINGS = OPENINGS;\n' +
  fs.readFileSync(path.join(root, 'opponents.js'), 'utf8').replace(/typeof window !== 'undefined' \? window : globalThis/, 'this'), context);
const P = context.OpponentPersonas;
let checks = 0;
const failures = [];
const assert = (ok, message) => { checks++; if (!ok) failures.push(message); };
const rng = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();

assert(P.PERSONAS[0].id === 'coach' && P.PERSONAS[0].elo === null, 'Coach is the default adaptive opponent');
const elos = P.PERSONAS.filter(p => p.elo).map(p => p.elo);
assert(elos.every((e, i) => i === 0 || e > elos[i - 1]), 'personas are ordered by strength');
assert(elos.every(e => e >= 400 && e <= 2400 && e % 100 === 0), 'persona levels sit on the strength slider');
P.PERSONAS.forEach(p => p.openings.forEach(id => assert(context.OPENINGS.some(o => o.id === id), `${p.name} lists unknown opening ${id}`)));

// Play many games of book moves against random book-following replies.
P.PERSONAS.filter(p => p.openings.length).forEach(persona => {
  for (const side of ['w', 'b']) {
    for (let game = 0; game < 25; game++) {
      const board = new Chess();
      let bookPlies = 0;
      for (let ply = 0; ply < 40 && !board.game_over(); ply++) {
        if ((board.turn() === 'w') === (side === 'w')) {
          const uci = P.bookMove(persona, board.fen() === new Chess().fen() ? undefined : new Chess().fen(), board.history(), rng);
          if (!uci) break;
          const mv = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
          assert(!!mv, `${persona.name} produced an illegal book move ${uci}`);
          if (!mv) break;
          bookPlies++;
        } else {
          // The other side follows any of this persona's lines when it can.
          const candidates = [];
          persona.openings.forEach(id => {
            const o = context.OPENINGS.find(x => x.id === id);
            [o.moves].concat((o.variations || []).map(v => v.moves)).forEach(line => {
              const h = board.history();
              if (line.length > h.length && h.every((s, i) => s.replace(/[+#]$/, '') === line[i].replace(/[+#]$/, ''))) candidates.push(line[h.length]);
            });
          });
          const pick = candidates.length ? candidates[Math.floor(rng() * candidates.length)] : board.moves()[0];
          if (!board.move(pick, { sloppy: true })) break;
        }
      }
      if (side === 'w') assert(bookPlies >= 1, `${persona.name} as White should open from its book`);
    }
  }
});
const rosa = P.byId('rosa');
assert(P.bookMove(rosa, undefined, ['a4']) === null, 'an unknown first move leaves the book');
assert(P.bookMove(rosa, '8/8/8/8/8/5k2/6q1/7K w - - 0 1', []) === null, 'custom start positions never use the book');
const pip = P.byId('pip');
const first = P.bookMove(pip, undefined, [], () => 0);
assert(first === 'e2e4' || first === 'f2f3', 'Pip opens from its repertoire, got ' + first);
assert(P.bookMove(pip, undefined, ['f3', 'e5', 'g4']) === 'd8h4', 'Pip finds the Fool’s mate as Black');
assert(P.bookMove(P.byId('coach'), undefined, []) === null, 'Coach has no book');

// Personas only play the side of a line that owns it, never a trap's victim.
const pipWhiteFirsts = new Set();
for (let i = 0; i < 200; i++) pipWhiteFirsts.add(P.bookMove(pip, undefined, [], () => i / 200));
assert(!pipWhiteFirsts.has('f2f3'), 'Pip as White opened with the losing half of the Fool’s mate');
assert(P.bookMove(pip, undefined, ['f3', 'e5']) === null, 'Pip as White followed the Fool’s mate into g4??');
assert(P.bookMove(pip, undefined, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'd6', 'Nc3', 'Bg4', 'Nxe5']) === null, 'Pip as Black took the Legal trap bait');
assert(P.bookMove(rosa, undefined, ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Nbd7', 'cxd5', 'exd5']) === null, 'Rosa as White walked into the Elephant trap');
assert(P.bookMove(rosa, undefined, ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Nbd7', 'cxd5', 'exd5', 'Nxd5']) === 'f6d5', 'Rosa as Black springs the Elephant trap');
// Every persona line resolves to a side, and every listed opening is playable from one side.
P.PERSONAS.forEach(p => p.openings.forEach(id => {
  const o = context.OPENINGS.find(x => x.id === id);
  assert(['w', 'b'].includes(P.lineSide(id, o)), `${id} has no side`);
}));

if (failures.length) {
  console.error(`Opponent validation failed (${failures.length} of ${checks}):`);
  failures.slice(0, 20).forEach(f => console.error(' - ' + f));
  process.exit(1);
}
console.log(`Opponent validation passed (${checks} checks).`);
