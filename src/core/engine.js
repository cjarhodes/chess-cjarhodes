// Stockfish worker client: UCI handshake, queued searches, timeouts, cancellation.
// Classic script loaded before app.js (see index.html); its top-level
// declarations are shared globals, as they were inside app.js.

// ─────────────────────────────────────────────
// STOCKFISH ENGINE WRAPPER
// ─────────────────────────────────────────────
function createAbortError(message) {
  const err = new Error(message || 'Engine work was cancelled.');
  err.name = 'AbortError';
  return err;
}

function isAbortError(err) {
  return !!(err && err.name === 'AbortError');
}

const engineClient = {
  worker: null,
  status: 'idle',   // idle | loading | ready
  queue: [],
  current: null,
  supportedOptions: new Set(),
  _readyResolvers: [],

  init() {
    if (this.status === 'ready') return Promise.resolve();
    if (this.status === 'loading') {
      return new Promise((resolve, reject) => this._readyResolvers.push({ resolve, reject }));
    }
    this.status = 'loading';
    this.supportedOptions = new Set();
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker('stockfish/stockfish.js');
      } catch (err) {
        this.status = 'idle';
        reject(err);
        return;
      }
      this._readyResolvers.push({ resolve, reject });
      this.worker.onmessage = (e) => this._onMessage(e.data);
      this.worker.onerror = (e) => {
        const err = new Error('Engine failed: ' + (e.message || e.filename || 'worker error'));
        this.failAll(err);
      };
      this.worker.postMessage('uci');
    });
  },

  failAll(err) {
    if (this.current && this.current.timeoutId) {
      clearTimeout(this.current.timeoutId);
      this.current.timeoutId = null;
    }
    const pending = [];
    if (this.current) pending.push(this.current);
    pending.push(...this.queue);
    this.current = null;
    this.queue = [];
    this.status = 'idle';
    if (this.worker) {
      try { this.worker.terminate(); } catch (e) {}
    }
    this.worker = null;
    this._readyResolvers.forEach(waiter => waiter.reject(err));
    this._readyResolvers = [];
    pending.forEach(task => {
      if (task.timeoutId) clearTimeout(task.timeoutId);
      if (task.reject) task.reject(err);
    });
  },

  _onMessage(msg) {
    if (typeof msg !== 'string') return;
    const optionMatch = msg.match(/^option name (.+?) type /);
    if (optionMatch) {
      this.supportedOptions.add(optionMatch[1]);
      return;
    }
    if (msg === 'uciok') { this.worker.postMessage('isready'); return; }
    if (msg === 'readyok' && this.status === 'loading') {
      this.status = 'ready';
      this._readyResolvers.forEach(waiter => waiter.resolve());
      this._readyResolvers = [];
      this._runNext();
      return;
    }
    if (!this.current) return;
    if (this.current.orphan) {
      if (msg.startsWith('bestmove ')) {
        clearTimeout(this.current.timeoutId);
        this.current = null;
        this._runNext();
      }
      return;
    }
    if (msg.startsWith('info ')) {
      const parsed = parseInfo(msg);
      if (!parsed) return;
      // Skip info lines without a pv (e.g. currmove progress reports) — they
      // would otherwise overwrite the real pv1 entry with an empty PV and
      // corrupt ranking / candidate display.
      if (!parsed.pv || parsed.pv.length === 0) return;
      if (this.current.multipv) {
        this.current.pvLines = this.current.pvLines || {};
        this.current.pvLines[parsed.multipv || 1] = parsed;
      } else {
        this.current.lastInfo = parsed;
      }
      return;
    }
    if (msg.startsWith('bestmove ')) {
      const bm = msg.split(' ')[1];
      const done = this.current;
      this.current = null;
      if (done.timeoutId) { clearTimeout(done.timeoutId); done.timeoutId = null; }
      if (done.multipv) {
        const lines = Object.keys(done.pvLines || {})
          .map(k => parseInt(k))
          .sort((a, b) => a - b)
          .map(k => done.pvLines[k]);
        done.resolve({ bestmove: bm === '(none)' ? null : bm, lines });
      } else {
        const info = done.lastInfo || { cp: 0, pv: [bm], depth: 0 };
        done.resolve({ bestmove: bm === '(none)' ? null : bm, info });
      }
      this._runNext();
    }
  },

  evaluate(fen, depth, opts) {
    return this.init().then(() => new Promise((resolve, reject) => {
      const task = {
        fen,
        depth,
        resolve,
        reject: reject,
        lastInfo: null,
        skill: (opts && typeof opts.skill === 'number') ? opts.skill : null,
        multipv: (opts && opts.multipv) || null,
        timeoutId: null
      };
      this.queue.push(task);
      this._runNext();
    }));
  },

  // Safety timeout — if the engine worker stalls or the WASM module wedges,
  // abandon the running search after 30s so the queue can drain and later
  // moves aren't permanently blocked. It is armed when the search starts, not
  // when it is queued: time spent waiting behind other searches must not
  // count, or a queued search could resolve empty without ever running.
  _armTimeout(task) {
    task.timeoutId = setTimeout(() => {
      task.timeoutId = null;
      if (this.current !== task) return;
      // UCI replies are untagged, so the stopped search's late info and
      // bestmove must not be read as the next task's answer. Hold the slot
      // until that bestmove arrives; restart the worker if it never does.
      this.current = { orphan: true, timeoutId: setTimeout(() => this._restart(), 5000) };
      try { this.worker.postMessage('stop'); } catch (_) {}
      if (task.multipv) {
        task.resolve({ bestmove: null, lines: [] });
      } else {
        task.resolve({ bestmove: null, info: { cp: 0, pv: [], depth: 0 } });
      }
      this._runNext();
    }, 30000);
  },

  _runNext() {
    if (this.status !== 'ready' || this.current || this.queue.length === 0) return;
    this.current = this.queue.shift();
    this._armTimeout(this.current);
    this.worker.postMessage('ucinewgame');
    // Stockfish.js 10 supports Skill Level but not UCI_Elo. Only send options
    // announced during the UCI handshake so unsupported commands can never
    // silently turn a displayed level into full-strength play.
    if (this.current.skill !== null && this.current.skill !== undefined &&
        this.supportedOptions.has('Skill Level')) {
      this.worker.postMessage('setoption name Skill Level value ' + this.current.skill);
    } else if (this.supportedOptions.has('Skill Level')) {
      this.worker.postMessage('setoption name Skill Level value 20');
    }
    // MultiPV
    this.worker.postMessage('setoption name MultiPV value ' + (this.current.multipv || 1));
    this.worker.postMessage('position fen ' + this.current.fen);
    this.worker.postMessage('go depth ' + this.current.depth);
  },

  // A stopped search that never answered: replace the worker but keep the
  // queued tasks, which run once the new worker is ready.
  _restart() {
    if (!this.current || !this.current.orphan) return;
    this.current = null;
    this.status = 'idle';
    if (this.worker) {
      try { this.worker.terminate(); } catch (e) {}
    }
    this.worker = null;
    if (this.queue.length) this.init().catch(err => this.failAll(err));
  },

  cancel(message) {
    const hasPendingWork = this.status === 'loading' || !!this.current || this.queue.length > 0;
    if (!hasPendingWork) return;
    // Terminating the worker is deliberate: UCI does not tag responses, so
    // starting a new search before the prior `bestmove` arrives can mix results.
    // failAll rejects every active/queued promise and the next evaluation
    // transparently starts a clean worker.
    this.failAll(createAbortError(message));
  }
};

function parseInfo(msg) {
  const depthMatch = msg.match(/\bdepth (\d+)/);
  const cpMatch = msg.match(/\bscore cp (-?\d+)/);
  const mateMatch = msg.match(/\bscore mate (-?\d+)/);
  const mpvMatch = msg.match(/\bmultipv (\d+)/);
  // PV runs from "pv " to next space-delimited keyword or end
  const pvMatch = msg.match(/\bpv ((?:[a-h][1-8][a-h][1-8][qrbn]? ?)+)/);
  if (!depthMatch) return null;
  return {
    depth: parseInt(depthMatch[1]),
    cp: cpMatch ? parseInt(cpMatch[1]) : null,
    mate: mateMatch ? parseInt(mateMatch[1]) : null,
    multipv: mpvMatch ? parseInt(mpvMatch[1]) : 1,
    pv: pvMatch ? pvMatch[1].trim().split(/\s+/) : []
  };
}

function scoreToCp(info) {
  if (info.mate !== null && info.mate !== undefined) {
    return info.mate > 0 ? 10000 - info.mate : -10000 - info.mate;
  }
  return info.cp || 0;
}

function formatEval(info) {
  if (info.mate !== null && info.mate !== undefined) {
    return '#' + Math.abs(info.mate);
  }
  const cp = info.cp || 0;
  const sign = cp > 0 ? '+' : (cp < 0 ? '−' : '±');
  return sign + (Math.abs(cp) / 100).toFixed(2);
}

function uciToSan(fen, uci) {
  const g = new Chess(fen);
  const move = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  return move ? move.san : uci;
}

function pvToSan(fen, pvArr, max) {
  const g = new Chess(fen);
  const out = [];
  for (const uci of pvArr.slice(0, max || 5)) {
    const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    if (!mv) break;
    out.push(mv.san);
  }
  return out;
}

function uciFromMove(mv) {
  if (!mv) return null;
  return mv.from + mv.to + (mv.promotion || '');
}
