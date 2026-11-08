// The one board component (redesign Phase 5). Every board in the app
// (Library, Coach, Puzzles, the game archive) is built with
//   Chessboard(elementId, config)
// which returns a Board. The API is the part of chessboard.js 1.0 the app
// used, so callers did not change shape when the library underneath became
// cm-chessboard (vendor/cm-chessboard, loaded by src/ui/board-module.js):
//
//   config: position ('start' | FEN | {e4: 'wP'}), orientation, draggable,
//           showNotation, moveSpeed, onDragStart(square, piece),
//           onDrop(from, to, piece, newPos, oldPos, orientation, {input}),
//           onSnapEnd(from, to, piece), moveTargets(square) -> [squares]
//   board:  position(pos?, animate?), orientation(color?), flip(), resize(),
//           destroy(), setMarks(name, squares), marks(name), cancelInput()
//   static: Chessboard.objToFen, Chessboard.fenToObj, Chessboard.get(id)
//
// onDragStart returning false refuses the piece; onDrop returning 'snapback'
// sends it home. After an accepted move onSnapEnd runs, so the caller can
// redraw castling, en passant and promotion. Drag, click and tap all go
// through these two callbacks: there is one input path per board. (A tap on
// a piece is preventDefault-ed by cm-chessboard, so no emulated mouse events
// follow it; the ones after a tap on the target square arrive while the move
// is still being drawn, and cm-chessboard ignores input then.)
//
// Square marks (last move, hints, premoves, selection, legal-move dots) are
// drawn by this file in a layer between the squares and the pieces, styled
// by `.board-mark.<name>` rules in styles.css, and survive redraws.
(function(root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const EMPTY = '8/8/8/8/8/8/8/8';
  const TILE = 45; // vendor/pieces/cburnett/sprite.svg viewBox
  const SQUARE = /^[a-h][1-8]$/;
  // Drawing order, bottom first. Unknown names go on top.
  const MARK_ORDER = ['last-move', 'hint-square', 'practice-cue-source', 'practice-cue-target',
    'coach-premove-from', 'coach-premove-to', 'tap-selected', 'tap-target', 'vision-good', 'vision-bad'];
  const DOT_MARKS = new Set(['tap-target']);
  const instances = new Map();

  // ── Position helpers (chessboard.js object form: { e4: 'wP' }) ──
  function objToFen(obj) {
    if (!obj || typeof obj !== 'object') return EMPTY;
    const rows = [];
    for (let rank = 8; rank >= 1; rank--) {
      let row = '', empty = 0;
      for (let f = 0; f < 8; f++) {
        const piece = obj['abcdefgh'[f] + rank];
        if (!piece) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += piece[0] === 'w' ? piece[1].toUpperCase() : piece[1].toLowerCase();
      }
      rows.push(row + (empty ? empty : ''));
    }
    return rows.join('/');
  }

  function fenToObj(fen) {
    const placement = String(fen || '').trim().split(/\s+/)[0];
    const rows = placement.split('/');
    const obj = {};
    if (rows.length !== 8) return obj;
    rows.forEach((row, i) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += Number(ch); continue; }
        if (f > 7) break;
        const square = 'abcdefgh'[f] + (8 - i);
        obj[square] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
        f++;
      }
    });
    return obj;
  }

  function toFen(position) {
    if (position === 'start') return START;
    if (typeof position === 'string' && position.trim()) return position.trim();
    if (position && typeof position === 'object') return objToFen(position);
    return EMPTY;
  }

  const placementOf = fen => String(fen).split(/\s+/)[0];
  // cm-chessboard names pieces 'wp'; chessboard.js callers expect 'wP'.
  const legacyPiece = piece => (piece ? piece[0] + piece[1].toUpperCase() : piece);

  function svg(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    Object.keys(attrs).forEach(key => node.setAttribute(key, attrs[key]));
    if (parent) parent.appendChild(node);
    return node;
  }

  function library() {
    const CM = root.CMChessboard;
    if (!CM) throw new Error('The board module (src/ui/board-module.js) has not loaded yet.');
    return CM;
  }

  function Board(target, config) {
    const CM = library();
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) throw new Error('Board element not found: ' + target);
    if (el.__board) el.__board.destroy();
    this.el = el;
    this.id = el.id;
    this.config = config || {};
    this._orientation = this.config.orientation === 'black' ? 'black' : 'white';
    this._marks = new Map();
    this._showNotation = this.config.showNotation !== false;
    this._inDrop = false;
    this._deferred = null;
    this._turns = Promise.resolve();
    this._pendingTurns = 0;
    this._destroyed = false;
    el.classList.add('board-host');
    el.__board = this;
    instances.set(el.id, this);
    this.cm = new CM.Chessboard(el, {
      position: toFen(this.config.position),
      orientation: this._orientation === 'black' ? CM.COLOR.black : CM.COLOR.white,
      responsive: true,
      assetsUrl: '',
      assetsCache: true,
      style: {
        cssClass: 'app-board',
        showCoordinates: false, // drawn by _drawCoordinates to match the app's type
        borderType: 'none',     // the frame is the host's CSS border
        aspectRatio: 1,
        pieces: { file: CM.SPRITE, tileSize: TILE },
        animationDuration: typeof this.config.moveSpeed === 'number' ? this.config.moveSpeed : 200
      },
      extensions: [{ class: CM.BoardDecorations, props: { redraw: cm => this._decorate(cm) } }]
    });
    if (this.config.draggable) this.cm.enableMoveInput(event => this._onInput(event));
  }

  Board.prototype = {
    // ── chessboard.js-compatible API ──
    position(pos, animate) {
      if (this._destroyed) return arguments.length ? undefined : {};
      if (!arguments.length) return fenToObj(this.cm.getPosition());
      if (pos === 'fen') return this.cm.getPosition();
      const fen = toFen(pos);
      const animated = arguments.length < 2 ? true : !!animate;
      // While onDrop runs, the board still shows the move in progress. Apply
      // the caller's position once the drop has been settled.
      if (this._inDrop) { this._deferred = { fen, animated }; return; }
      this._apply(fen, animated);
    },

    orientation(color) {
      if (!arguments.length || color === undefined) return this._orientation;
      const next = color === 'flip' ? (this._orientation === 'white' ? 'black' : 'white') : (color === 'black' ? 'black' : 'white');
      if (next !== this._orientation && !this._destroyed) {
        this._orientation = next;
        this._turn();
      }
      return this._orientation;
    },

    flip() { return this.orientation('flip'); },

    resize() {
      if (!this._destroyed && this.cm.view) this.cm.view.handleResize();
    },

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      try { this.cm.destroy(); } catch (e) { /* already torn down */ }
      this.el.classList.remove('board-host');
      if (this.el.__board === this) this.el.__board = null;
      if (instances.get(this.id) === this) instances.delete(this.id);
    },

    // ── Square marks ──
    setMarks(name, squares) {
      const list = Array.from(new Set((squares || []).filter(sq => SQUARE.test(sq))));
      const current = this._marks.get(name) || [];
      if (list.length === current.length && list.every((sq, i) => sq === current[i])) return;
      if (list.length) this._marks.set(name, list); else this._marks.delete(name);
      if (!this._destroyed && this.cm && this.cm.view) this._drawMarks(this.cm);
    },

    marks(name) { return (this._marks.get(name) || []).slice(); },

    // Drop a piece picked up by click or drag. Ignored while onDrop runs:
    // that move is already being settled.
    cancelInput() {
      if (!this._destroyed && !this._inDrop && this.cm.view) this.cm.cancelMoveInput();
    },

    // ── Internals ──
    _queueIdle() {
      const q = this.cm.positionAnimationsQueue;
      return !q.workingOnPromise && !q.queue.length && !this._pendingTurns;
    },

    _apply(fen, animated) {
      const cm = this.cm;
      if (!animated && this._queueIdle()) {
        // Draw at once, as chessboard.js did, instead of two animation
        // frames later through cm-chessboard's queue.
        if (cm.getPosition() === placementOf(fen)) return;
        cm.state.position.setFen(fen);
        cm.view.visualMoveInput.positionChanged();
        cm.view.redrawPieces();
        cm.state.invokeExtensionPoints(library().EXTENSION_POINT.positionChanged);
        return;
      }
      cm.setPosition(fen, animated);
    },

    _turn() {
      const CM = library();
      const want = () => (this._orientation === 'black' ? CM.COLOR.black : CM.COLOR.white);
      if (this._queueIdle()) {
        const cm = this.cm;
        cm.cancelMoveInput();
        cm.state.orientation = want();
        cm.view.redrawBoard();
        cm.view.redrawPieces();
        cm.state.invokeExtensionPoints(CM.EXTENSION_POINT.boardChanged);
        return;
      }
      // Pieces are moving: turn the board once they have arrived.
      this._pendingTurns++;
      this._turns = this._turns.then(() => {
        if (this._destroyed || this.cm.getOrientation() === want()) return null;
        this.cm.cancelMoveInput();
        return this.cm.setOrientation(want(), false);
      }).catch(() => null).then(() => { this._pendingTurns--; });
    },

    _onInput(event) {
      const T = library().INPUT_EVENT_TYPE;
      switch (event.type) {
        case T.moveInputStarted: {
          const piece = legacyPiece(event.piece);
          const ok = !this.config.onDragStart ||
            this.config.onDragStart(event.squareFrom, piece, this.position(), this._orientation) !== false;
          if (ok) this._select(event.squareFrom);
          return ok;
        }
        case T.validateMoveInput:
          return this._validate(event);
        case T.moveInputCanceled:
          this._select(null);
          return undefined;
        default:
          return undefined;
      }
    },

    _validate(event) {
      const from = event.squareFrom, to = event.squareTo;
      this._select(null);
      if (!to || from === to) return false;
      const cm = this.cm;
      const moving = cm.getPiece(from), occupant = cm.getPiece(to);
      // A piece of the same colour on the target: the player is choosing a
      // different piece, not moving onto their own. cm-chessboard then
      // selects that piece.
      if (!moving || (occupant && occupant[0] === moving[0])) return false;
      const dragged = !!cm.view.visualMoveInput.draggablePiece;
      const oldPos = fenToObj(cm.getPosition());
      const newPos = Object.assign({}, oldPos);
      delete newPos[from];
      newPos[to] = legacyPiece(moving);
      let result;
      this._inDrop = true;
      this._deferred = null;
      try {
        result = this.config.onDrop
          ? this.config.onDrop(from, to, legacyPiece(moving), newPos, oldPos, this._orientation, { input: dragged ? 'drag' : 'click' })
          : undefined;
      } catch (error) {
        // Send the piece home so the board's input is not left mid-move,
        // and still report the error.
        result = 'snapback';
        setTimeout(() => { throw error; });
      } finally {
        this._inDrop = false;
      }
      const deferred = this._deferred;
      this._deferred = null;
      const accepted = result !== 'snapback' && result !== 'trash';
      // cm-chessboard moves (or returns) the piece as soon as this returns;
      // the caller's own redraw and onSnapEnd follow it through the queue.
      Promise.resolve().then(() => {
        if (this._destroyed) return;
        if (deferred) this._apply(deferred.fen, deferred.animated);
        if (accepted && this.config.onSnapEnd) this.config.onSnapEnd(from, to, legacyPiece(moving));
      });
      return accepted;
    },

    _select(square) {
      if (!square) {
        this.setMarks('tap-selected', []);
        this.setMarks('tap-target', []);
        return;
      }
      this.setMarks('tap-selected', [square]);
      let targets = [];
      try { targets = this.config.moveTargets ? (this.config.moveTargets(square) || []) : []; } catch (e) { targets = []; }
      this.setMarks('tap-target', targets);
    },

    // Runs after cm-chessboard (re)draws its squares: on creation, resize and
    // orientation changes.
    _decorate(cm) {
      this.cm = cm;
      const view = cm.view;
      if (!view || !view.svg) return;
      // The host element carries the position's accessible name.
      view.svg.setAttribute('aria-hidden', 'true');
      view.svg.setAttribute('focusable', 'false');
      if (!this._marksLayer || this._marksLayer.ownerSVGElement !== view.svg) {
        this._marksLayer = svg('g', { class: 'board-marks' });
        view.svg.insertBefore(this._marksLayer, view.coordinatesGroup);
      }
      this._drawMarks(cm);
      this._drawCoordinates(cm);
    },

    _drawMarks(cm) {
      const layer = this._marksLayer;
      const view = cm.view;
      if (!layer || !view) return;
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      const w = view.squareWidth, h = view.squareHeight;
      if (!w) return;
      const rank = name => { const i = MARK_ORDER.indexOf(name); return i === -1 ? MARK_ORDER.length : i; };
      Array.from(this._marks.keys()).sort((a, b) => rank(a) - rank(b)).forEach(name => {
        this._marks.get(name).forEach(square => {
          const p = view.squareToPoint(square);
          // A nested <svg> clips its content to the square, so a wide stroke
          // on the rect reads as an inset ring.
          const cell = svg('svg', { class: 'board-mark-cell', x: p.x, y: p.y, width: w, height: h, 'data-mark-square': square }, layer);
          if (DOT_MARKS.has(name)) {
            const capture = !!cm.getPiece(square);
            svg('circle', {
              class: `board-mark ${name}${capture ? ' capture' : ''}`, cx: w / 2, cy: h / 2,
              r: capture ? w * 0.46 : w * 0.13, 'stroke-width': capture ? w * 0.08 : 0
            }, cell);
          } else {
            svg('rect', { class: `board-mark ${name}`, width: w, height: h }, cell);
          }
        });
      });
    },

    // Coordinates in the app's mono type: files along the bottom edge, ranks
    // down the left, each coloured for the square it sits on.
    _drawCoordinates(cm) {
      const view = cm.view;
      const group = view.coordinatesGroup;
      while (group.firstChild) group.removeChild(group.firstChild);
      if (!this._showNotation || !view.squareWidth) return;
      const whiteBottom = cm.state.orientation !== library().COLOR.black;
      const w = view.squareWidth, h = view.squareHeight, b = view.borderSize;
      for (let i = 0; i < 8; i++) {
        const file = whiteBottom ? i : 7 - i;
        const bottomRank = whiteBottom ? 0 : 7;
        const fileText = svg('text', {
          class: `board-coord file ${(file + bottomRank) % 2 === 0 ? 'on-dark' : 'on-light'}`,
          x: b + (i + 1) * w - 4, y: b + 8 * h - 2, 'text-anchor': 'end', 'dominant-baseline': 'text-after-edge'
        }, group);
        fileText.textContent = 'abcdefgh'[file];
        const rankIndex = whiteBottom ? 7 - i : i;
        const leftFile = whiteBottom ? 0 : 7;
        const rankText = svg('text', {
          class: `board-coord rank ${(leftFile + rankIndex) % 2 === 0 ? 'on-dark' : 'on-light'}`,
          x: b + 4, y: b + i * h + 3, 'dominant-baseline': 'text-before-edge'
        }, group);
        rankText.textContent = String(rankIndex + 1);
      }
    }
  };

  function Chessboard(target, config) {
    return new Board(target, config);
  }
  Chessboard.objToFen = objToFen;
  Chessboard.fenToObj = fenToObj;
  Chessboard.get = id => instances.get(id) || null;
  Chessboard.Board = Board;

  root.Chessboard = Chessboard;
})(typeof window !== 'undefined' ? window : globalThis);
