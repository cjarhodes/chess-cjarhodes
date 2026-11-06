#!/usr/bin/env node
// Unit tests for src/core/: each file is loaded whole into a sandbox with
// only chess.js, the opening data and an in-memory localStorage, then its
// logic is exercised directly. No function is cut out of a file by name, so
// these keep working however the code inside a file is arranged.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const errors = [];
let assertions = 0;
const check = (condition, message) => { assertions++; if (!condition) errors.push(message); };

function memoryStorage(failWrites = false) {
  const store = {};
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { if (failWrites) throw new Error('QuotaExceededError'); store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    _store: store,
  };
}

function sandbox(files, extra = {}) {
  const context = vm.createContext(Object.assign({ console, setTimeout, clearTimeout, Promise, localStorage: memoryStorage() }, extra));
  vm.runInContext(fs.readFileSync(path.join(root, 'vendor/chess.js/chess-0.10.3.min.js'), 'utf8'), context, { filename: 'chess.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'openings.js'), 'utf8') + '\nglobalThis.OPENINGS = OPENINGS;', context, { filename: 'openings.js' });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

async function main() {
  // Every app script must parse (CI runs this validator, so src/ files are
  // syntax-checked there without editing the workflow).
  for (const file of require('./lib/app-source').appScriptFiles()) {
    try {
      new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
      assertions++;
    } catch (error) {
      errors.push(`${file} does not parse: ${error.message}`);
    }
  }

  // ── engine.js ──
  {
    const fakeWorkers = [];
    const ctx = sandbox(['src/core/engine.js'], {
      Worker: function FakeWorker() { this.posted = []; this.postMessage = m => this.posted.push(m); this.terminate = () => { this.terminated = true; }; fakeWorkers.push(this); },
    });
    const info = ctx.parseInfo('info depth 14 seldepth 20 multipv 2 score cp -35 nodes 1 pv e7e5 g1f3 b8c6');
    check(info && info.depth === 14 && info.cp === -35 && info.mate === null && info.multipv === 2, 'parseInfo reads depth, score and multipv');
    check(info && info.pv.join(' ') === 'e7e5 g1f3 b8c6', 'parseInfo reads the principal variation');
    check(ctx.parseInfo('info string NNUE evaluation enabled') === null, 'parseInfo ignores lines without a depth');
    check(ctx.parseInfo('info depth 9 score mate -3 pv a1a2').mate === -3, 'parseInfo reads mate scores');
    check(ctx.scoreToCp({ mate: 2 }) > ctx.scoreToCp({ mate: 5 }) && ctx.scoreToCp({ mate: 5 }) > ctx.scoreToCp({ cp: 900 }), 'faster mates outrank slower mates and any centipawn score');
    check(ctx.scoreToCp({ mate: -2 }) < ctx.scoreToCp({ mate: -6 }), 'being mated sooner scores lower');
    check(ctx.uciToSan('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'g1f3') === 'Nf3', 'uciToSan converts engine moves');

    // Top-level const bindings live in the sandbox's scope, not on its global object.
    const client = vm.runInContext('engineClient', ctx);
    const fen = '8/8/8/8/8/8/8/K6k w - - 0 1';
    const first = client.evaluate(fen, 6, { multipv: 2 });
    const queued = client.evaluate(fen, 4).catch(e => e);
    const worker = fakeWorkers[0];
    worker.onmessage({ data: 'option name Skill Level type spin default 20 min 0 max 20' });
    worker.onmessage({ data: 'uciok' });
    worker.onmessage({ data: 'readyok' });
    await new Promise(r => setTimeout(r, 0));
    check(worker.posted.includes('go depth 6') && worker.posted.includes('setoption name MultiPV value 2'), 'engine starts the first search with its options');
    check(!worker.posted.includes('go depth 4'), 'a second search waits in the queue');
    worker.onmessage({ data: 'info depth 6 multipv 1 score cp 10 pv a1a2' });
    worker.onmessage({ data: 'info depth 6 multipv 2 score cp -5 pv a1b1' });
    worker.onmessage({ data: 'bestmove a1a2' });
    const result = await first;
    check(result.bestmove === 'a1a2' && result.lines.length === 2 && result.lines[1].cp === -5, 'multi-line search resolves with every line in order');
    check(worker.posted.includes('go depth 4'), 'the queued search starts when the first finishes');
    client.cancel('test');
    const cancelled = await queued;
    check(ctx.isAbortError(cancelled), 'cancel rejects the running search as an abort');
    check(client.status === 'idle' && client.worker === null && worker.terminated, 'cancel resets and terminates the worker');
  }

  // ── opponent.js ──
  {
    const ctx = sandbox(['src/core/opponent.js', 'src/core/engine.js']);
    let previous = null;
    for (let elo = 400; elo <= 2400; elo += 50) {
      const opts = ctx.coachStrengthOpts(elo);
      if (previous) {
        check(opts.errorRate <= previous.errorRate && opts.errorSize <= previous.errorSize && opts.depth >= previous.depth, `difficulty never gets easier as the level rises (${elo})`);
      }
      previous = opts;
    }
    const lines = [
      { cp: 50, pv: ['e2e4'] }, { cp: 30, pv: ['d2d4'] }, { cp: -400, pv: ['f2f3'] },
    ];
    const always = () => 0;
    check(ctx.chooseCalibratedOpponentMove({ lines, bestmove: 'e2e4' }, { errorRate: 0, errorSize: 200 }, always) === 'e2e4', 'with no error budget the best move is played');
    const mating = [{ mate: 1, pv: ['h5f7'] }, { cp: 300, pv: ['a2a3'] }];
    check(ctx.chooseCalibratedOpponentMove({ lines: mating, bestmove: 'h5f7' }, { errorRate: 1, errorSize: 500 }, () => 0.99) === 'h5f7', 'a winning mate is always played');
  }

  // ── classify.js ──
  {
    const ctx = sandbox(['src/core/engine.js', 'src/core/classify.js']);
    check(ctx.classifyRankLoss(1, 0).tier === 'best' && ctx.classifyRankLoss(3, 80).tier === 'excellent', 'top-three engine moves are best or excellent');
    check(ctx.classifyRankLoss(5, 59).tier === 'good' && ctx.classifyRankLoss(5, 60).tier === 'inaccuracy', 'good/inaccuracy boundary is 60cp');
    check(ctx.classifyRankLoss(5, 120).tier === 'mistake' && ctx.classifyRankLoss(5, 250).tier === 'blunder', 'mistake and blunder boundaries are 120cp and 250cp');
    check(ctx.accuracyFromTallies({}, 0) === null, 'no moves means no accuracy');
    check(ctx.accuracyFromTallies({ best: 2 }, 2) === 100 && ctx.accuracyFromTallies({ best: 1, blunder: 1 }, 2) === 53, 'accuracy weights each tier');
  }

  // ── tactics.js ──
  {
    const ctx = sandbox(['src/core/engine.js', 'src/core/tactics.js']);
    const hanging = ctx.detectHangingPieces(new ctx.Chess('rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR b KQkq - 0 3'), 'black');
    check(hanging.some(h => h.square === 'g5' && h.piece === 'q'), 'a queen attacked by an undefended bishop line is reported as hanging');
    const safe = ctx.detectHangingPieces(new ctx.Chess(), 'white');
    check(safe.length === 0, 'nothing hangs in the starting position');
  }

  // ── opening-book.js ──
  {
    const ctx = sandbox(['src/core/opening-book.js']);
    const italian = ctx.identifyOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
    check(italian.match && /Italian/.test(italian.match.name) && italian.exact, 'the Italian Game is identified from its moves');
    const offBook = ctx.identifyOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'a5', 'h4']);
    check(offBook.match && !offBook.exact && offBook.matchedPlies <= 5, 'leaving the book keeps the last named opening');
    check(ctx.identifyOpening([]).match === null, 'no moves means no opening');
  }

  // ── library-sr.js ──
  {
    const ctx = sandbox(['src/core/library-sr.js']);
    check(ctx.srStatus('italian') === 'new', 'an unseen line is new');
    ctx.srRecordQuiz('italian', 5);
    ctx.srRecordQuiz('italian', 5);
    const rec = ctx.getSRRecord('italian');
    check(rec.reps === 2 && rec.interval === 3 && rec.attempts === 2, 'two perfect runs schedule the line three days out');
    ctx.srRecordQuiz('italian', 0);
    check(ctx.getSRRecord('italian').reps === 0 && ctx.getSRRecord('italian').interval === 1, 'a failed run resets the line');
    const failing = sandbox(['src/core/library-sr.js'], { localStorage: memoryStorage(true) });
    check(failing.saveSR({}).ok === false, 'saveSR reports a storage failure instead of throwing');
  }

  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`Core unit validation passed (${assertions} assertions across 6 files loaded whole).`);
}

main().catch(error => { console.error(error); process.exit(1); });
