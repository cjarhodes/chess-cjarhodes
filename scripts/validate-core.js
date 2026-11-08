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

  // ── engine.js: the safety timeout covers the search, not its time in the queue ──
  {
    const fakeWorkers = [];
    const timers = [];
    const ctx = sandbox(['src/core/engine.js'], {
      Worker: function FakeWorker() { this.posted = []; this.postMessage = m => this.posted.push(m); this.terminate = () => {}; fakeWorkers.push(this); },
      setTimeout: (fn, ms) => { if (ms === 30000 || ms === 5000) { timers.push({ fn, ms }); return timers.length; } return setTimeout(fn, ms); },
      clearTimeout: id => { if (typeof id === 'number' && timers[id - 1]) timers[id - 1].cleared = true; else clearTimeout(id); },
    });
    const client = vm.runInContext('engineClient', ctx);
    const fen = '8/8/8/8/8/8/8/K6k w - - 0 1';
    const tick = () => new Promise(r => setTimeout(r, 0));
    const live = () => timers.filter(t => t.ms === 30000 && !t.cleared);
    const long = client.evaluate(fen, 20);
    const queued = client.evaluate(fen, 12);
    let queuedResult = null;
    queued.then(r => { queuedResult = r; });
    const worker = fakeWorkers[0];
    worker.onmessage({ data: 'uciok' });
    worker.onmessage({ data: 'readyok' });
    await tick();
    check(live().length === 1, `only the running search has a safety timer while another waits (found ${live().length})`);
    // Every pending safety timer fires (the long search took 30s): only the
    // running search may give up; the queued one has not started.
    live().forEach(t => { t.cleared = true; t.fn(); });
    await long;
    await tick();
    check(queuedResult === null, 'a queued search is not resolved empty before it has run');
    worker.onmessage({ data: 'bestmove a1a2' }); // the stopped search's late answer
    await tick();
    check(worker.posted.filter(m => m === 'go depth 12').length === 1 && live().length === 1, 'the queued search starts after the stopped one answers, with its own timer');
    worker.onmessage({ data: 'info depth 12 score cp 42 pv a1b1' });
    worker.onmessage({ data: 'bestmove a1b1' });
    const answered = await queued;
    check(answered.bestmove === 'a1b1' && answered.info.cp === 42, 'the queued search resolves with its own answer');
    check(live().length === 0, 'a finished search clears its safety timer');
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
    check(ctx.classifyRankLoss(1, 0).tier === 'best' && ctx.classifyRankLoss(3, 59).tier === 'excellent', 'top-three engine moves within 60cp are best or excellent');
    check(ctx.classifyRankLoss(2, 400).tier === 'blunder' && ctx.classifyRankLoss(3, 80).tier === 'inaccuracy', 'a top-three move that loses material is graded by its loss, not its rank');
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
    const after = sans => { const g = new ctx.Chess(); sans.forEach(san => g.move(san)); return g; };
    const checked = ctx.detectHangingPieces(after(['e4', 'd5', 'Bb5+']), 'black');
    check(!checked.some(h => h.piece === 'k'), 'the king in check is never reported as hanging');
    let threw = null;
    try { check(ctx.detectHangingPieces(after(['e4', 'e5', 'Bc4', 'Bc5', 'Bxf7+']), 'black').length === 0, 'in check, no hanging pieces are listed'); }
    catch (error) { threw = error; }
    check(!threw, 'scanning a position in check does not throw' + (threw ? ': ' + threw.message : ''));

    // The mate scan passes the move to the opponent; in check that position
    // would be illegal, so the engine must not be asked.
    const asked = [];
    const scan = sandbox(['src/core/tactics.js'], { engineClient: { evaluate: fen => { asked.push(fen); return Promise.resolve({ bestmove: null, info: { cp: 0, mate: null, pv: [] } }); } } });
    const inCheck = await scan.detectMateThreat(after(['e4', 'd5', 'Bb5+']).fen());
    check(asked.length === 0 && inCheck.status === 'ok' && inCheck.mateIn === null, 'the mate scan never sends a position with the side not to move in check');
    await scan.detectMateThreat(after(['e4', 'd5']).fen());
    check(asked.length === 1 && / b /.test(asked[0]), 'outside check the mate scan still asks the engine with the move passed');
  }

  // ── opening-book.js ──
  {
    const ctx = sandbox(['src/core/opening-book.js']);
    const italian = ctx.identifyOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
    check(italian.match && /Italian/.test(italian.match.name) && italian.exact, 'the Italian Game is identified from its moves');
    const offBook = ctx.identifyOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'a5', 'h4']);
    check(offBook.match && !offBook.exact && offBook.matchedPlies <= 5, 'leaving the book keeps the last named opening');
    check(ctx.identifyOpening([]).match === null, 'no moves means no opening');
    // Book moves past the last named node still count: 5.Nc3 is in the book
    // (on the way to the Najdorf), so the game left theory after move 5.
    const najdorfMiss = ctx.identifyOpening(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5', 'Nf5']);
    check(najdorfMiss.matchedPlies === 5 && najdorfMiss.bookPlies === 9 && !najdorfMiss.exact, 'bookPlies is where the game left the book, matchedPlies the last named opening');
  }

  // ── position-text.js ──
  {
    const ctx = sandbox(['src/core/position-text.js']);
    const start = ctx.describeChessPosition(new ctx.Chess());
    check(start.startsWith('White to move. White: King e1, Queen d1, Rooks a1 and h1, Bishops c1 and f1, Knights b1 and g1, Pawns a2, b2, c2, d2, e2, f2, g2 and h2. Black: King e8,'), 'the start position reads as words, pieces grouped by type: ' + start);
    check(!/[/]|FEN/.test(start), 'a board label never spells out a FEN');
    const mate = new ctx.Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    check(ctx.describeChessPosition(mate).startsWith('White to move. Checkmate. '), 'checkmate is announced');
    const check1 = new ctx.Chess('4k3/8/8/8/8/8/4q3/4K3 w - - 0 1');
    check(ctx.describeChessPosition(check1) === 'White to move. In check. White: King e1. Black: King e8, Queen e2.', 'check, single pieces: ' + ctx.describeChessPosition(check1));
    const stale = new ctx.Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    check(ctx.describeChessPosition(stale).startsWith('Black to move. Stalemate.'), 'stalemate is announced');
    const pawns = new ctx.Chess('4k3/8/8/8/8/8/P6P/4K3 w - - 0 1');
    check(ctx.describeChessPosition(pawns).includes('White: King e1, Pawns a2 and h2.'), 'two squares join with "and"');
    check(ctx.describeChessPosition(null) === 'Chess position unavailable.', 'a missing game has a fallback');
  }

  // ── library-sr.js ──
  {
    const ctx = sandbox(['src/core/library-sr.js']);
    check(ctx.srStatus('italian') === 'new', 'an unseen line is new');
    const day = (d, h) => new Date(2026, 10, d, h, 0, 0).getTime(); // local time, November 2026
    ctx.srRecordQuiz('italian', 5, day(10, 23));
    check(ctx.getSRRecord('italian').nextDue === day(11, 0), 'a one-day interval is due at the next local midnight, not 24 hours later');
    check(ctx.srNextReviewLabel(ctx.getSRRecord('italian').nextDue, day(10, 23)) === '1d', 'one hour before a review due tomorrow, the panel says 1d, not now');
    check(ctx.srNextReviewLabel(day(13, 0), day(10, 13)) === '3d' && ctx.srNextReviewLabel(day(11, 0), day(11, 0)) === 'now', 'the next-review label counts calendar days');
    check(ctx.srNextReviewLabel(day(10, 20), day(10, 9)) === 'today', 'a legacy due time later today is not shown as now');
    // Repeating the line before it is due counts as an attempt only.
    ctx.srRecordQuiz('italian', 5, day(10, 23) + 60000);
    ctx.srRecordQuiz('italian', 5, day(10, 23) + 120000);
    let rec = ctx.getSRRecord('italian');
    check(rec.reps === 1 && rec.interval === 1 && rec.attempts === 3 && ctx.srStatus('italian', day(10, 23) + 180000) === 'learning', 'extra runs before the line is due do not advance its schedule');
    ctx.srRecordQuiz('italian', 5, day(11, 9));
    rec = ctx.getSRRecord('italian');
    check(rec.reps === 2 && rec.interval === 3 && rec.attempts === 4 && rec.nextDue === day(14, 0), 'two perfect runs on due days schedule the line three days out');
    ctx.srRecordQuiz('italian', 0, day(11, 10));
    check(ctx.getSRRecord('italian').reps === 0 && ctx.getSRRecord('italian').interval === 1, 'a failed run resets the line, even before it is due');
    const failing = sandbox(['src/core/library-sr.js'], { localStorage: memoryStorage(true) });
    check(failing.saveSR({}).ok === false, 'saveSR reports a storage failure instead of throwing');
  }

  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`Core unit validation passed (${assertions} assertions across 7 files loaded whole).`);
}

main().catch(error => { console.error(error); process.exit(1); });
