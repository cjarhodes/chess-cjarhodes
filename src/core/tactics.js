// Threat detection: hanging pieces, mate threats and the threat panel.
// Classic script loaded before app.js (see index.html); its top-level
// declarations are shared globals, as they were inside app.js.

// ─────────────────────────────────────────────
// THREAT DETECTION
// ─────────────────────────────────────────────
const PIECE_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const PIECE_NAME = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

function piecesDefenders(game, square, defenderColor) {
  // Count defenders of `square` owned by `defenderColor`.
  // Trick: swap the piece on `square` for an enemy queen (so pawns and sliders
  // alike generate capture moves to that square), then list captures from the
  // defender side. Using a queen — not an empty square — is key: pawns only
  // capture when a target exists, and only a non-pawn piece can legally occupy
  // the first/last ranks.
  const pos = game.board();
  const fileStr = 'abcdefgh';
  const f = fileStr.indexOf(square[0]);
  const r = 8 - parseInt(square[1]);
  const piece = pos[r][f];
  if (!piece) return 0;

  const enemyQueen = defenderColor === 'w' ? 'q' : 'Q';

  const parts = game.fen().split(' ');
  const rows = parts[0].split('/');
  let row = rows[r];
  let expanded = '';
  for (const ch of row) {
    if (/\d/.test(ch)) for (let i = 0; i < parseInt(ch); i++) expanded += '1';
    else expanded += ch;
  }
  expanded = expanded.substring(0, f) + enemyQueen + expanded.substring(f + 1);
  let collapsed = '';
  let runs = 0;
  for (const ch of expanded) {
    if (ch === '1') runs++;
    else { if (runs) { collapsed += runs; runs = 0; } collapsed += ch; }
  }
  if (runs) collapsed += runs;
  rows[r] = collapsed;
  parts[0] = rows.join('/');
  parts[1] = defenderColor;
  parts[3] = '-';

  const g = new Chess();
  if (!g.load(parts.join(' '))) return 0;
  return g.moves({ verbose: true }).filter(m => m.to === square).length;
}

// Piece values for static-exchange evaluation.
const SEE_VALUES = { p: 100, n: 300, b: 325, r: 500, q: 900, k: 10000 };

// Standard SEE — least-valuable attacker. Returns the material gain (cp) for
// `sideFirst` if they initiate captures on `square`, with optimal recaptures.
// Handles the case where a knight captures a pawn and the king recaptures the
// knight: SEE correctly reports that as a loss for the attacker, whereas the
// old attackers-vs-defenders heuristic reported the pawn as "hanging".
function seeAtSquare(game, square, sideFirst) {
  const fen = game.fen();
  const parts = fen.split(' ');
  parts[1] = sideFirst;
  parts[3] = '-';
  const g = new Chess();
  if (!g.load(parts.join(' '))) return 0;
  const caps = g.moves({ verbose: true }).filter(m => m.to === square && m.captured);
  if (caps.length === 0) return 0;
  caps.sort((a, b) => SEE_VALUES[a.piece] - SEE_VALUES[b.piece]);
  const first = caps[0];
  const firstValue = SEE_VALUES[first.captured];
  g.move(first);
  const recurse = () => {
    const ms = g.moves({ verbose: true }).filter(m => m.to === square && m.captured);
    if (ms.length === 0) return 0;
    ms.sort((a, b) => SEE_VALUES[a.piece] - SEE_VALUES[b.piece]);
    const m = ms[0];
    const capVal = SEE_VALUES[m.captured];
    g.move(m);
    const sub = recurse();
    g.undo();
    // Stand-pat: side only recaptures if net gain is positive.
    return Math.max(0, capVal - sub);
  };
  const oppRecap = recurse();
  return firstValue - oppRecap;
}

function detectHangingPieces(game, userColor) {
  // A user piece is "hanging" iff the opponent can initiate captures on its
  // square and come out with at least a pawn's worth of material (SEE ≥ 100).
  // The king is never "hanging": it cannot be captured. While the user is in
  // check the side-to-move swap below would describe an illegal position, and
  // answering the check is the only threat that matters, so nothing is listed.
  const userChar = userColor === 'white' ? 'w' : 'b';
  if (game.in_check() && game.turn() === userChar) return [];
  const oppChar = userColor === 'white' ? 'b' : 'w';
  const hangs = [];
  const boardArr = game.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = boardArr[r][f];
      if (!sq || sq.color !== userChar || sq.type === 'k') continue;
      const square = 'abcdefgh'[f] + (8 - r);
      const gain = seeAtSquare(game, square, oppChar);
      if (gain >= 100) {
        const attackers = countAttackers(game, square, oppChar);
        const defenders = piecesDefenders(game, square, userChar);
        hangs.push({ square, piece: sq.type, attackers, defenders, gain });
      }
    }
  }
  return hangs;
}

function countAttackers(game, square, attackerColor) {
  const parts = game.fen().split(' ');
  parts[1] = attackerColor;
  parts[3] = '-';
  const g = new Chess();
  if (!g.load(parts.join(' '))) return 0;
  return g.moves({ verbose: true }).filter(m => m.to === square).length;
}

async function detectMateThreat(fen) {
  // Is opponent threatening mate on their next move? Flip side-to-move.
  // Depth 12 catches ~6-move mate nets that depth 8 missed; still fast.
  // In check, passing the move would leave the side not to move in check, an
  // illegal position the engine must never see; the check is the threat.
  if (new Chess(fen).in_check()) return { status: 'ok', mateIn: null, inCheck: true };
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const flipped = parts.join(' ');
  try {
    const res = await engineClient.evaluate(flipped, 12);
    if (res.info && res.info.mate !== null && res.info.mate !== undefined && res.info.mate > 0) {
      return { status: 'ok', mateIn: res.info.mate };
    }
  } catch (e) {
    return { status: 'unavailable', error: e };
  }
  return { status: 'ok', mateIn: null };
}

function renderThreatItems(items) {
  const $section = $('#threats-section');
  const $list = $('#threats-list');
  $list.empty();
  if (items.length === 0) {
    $list.append($('<div class="threats-empty">No immediate threats. Look for active moves.</div>'));
  } else {
    items.forEach(it => {
      const $card = $('<div class="threat-card"></div>').addClass(it.kind === 'mate' ? 'mate' : '');
      if (it.glyph) $card.append($('<span class="piece"></span>').text(it.glyph));
      $card.append($('<span class="text"></span>').text(it.text));
      $list.append($card);
    });
  }
  $section.show();
}

async function showThreats() {
  if (!coachMode || !coachGameActive || !coachGame) return;
  const requestId = ++threatRequestId;
  const fen = coachGame.fen();
  const hangs = detectHangingPieces(coachGame, coachUserColor());
  const items = [];
  if (coachGame.in_check()) {
    renderThreatItems([{ kind: 'mate', text: 'Your king is in check — answer the check first.' }]);
    return;
  }
  hangs.forEach(h => {
    const name = PIECE_NAME[h.piece];
    const glyph = PIECE_GLYPH[h.piece];
    const pawns = (h.gain / 100).toFixed(h.gain >= 100 && h.gain % 100 === 0 ? 0 : 2);
    // Severity prefix based on how much opponent nets from the capture sequence.
    let severity;
    if (h.gain >= 500) severity = 'Major piece hangs';
    else if (h.gain >= 300) severity = 'Piece hangs';
    else severity = 'Pawn hangs';
    items.push({
      kind: 'hang',
      glyph,
      severity,
      text: `${severity}: ${name} on ${h.square} — defend or move (~${pawns} pawns).`
    });
  });
  renderThreatItems(items);
  detectMateThreat(fen).then(mateThreat => {
    if (requestId !== threatRequestId || !coachMode || !coachGameActive || !coachGame ||
        coachGame.fen() !== fen || !coachIsUserTurn()) {
      return;
    }
    const nextItems = items.slice();
    if (mateThreat.status === 'unavailable') {
      nextItems.unshift({ kind: 'scan', text: 'Mate scan unavailable — engine could not check forcing threats.' });
    } else if (mateThreat.mateIn !== null) {
      nextItems.unshift({ kind: 'mate', text: `Mate-in-${mateThreat.mateIn} threat — you must defend now.` });
    }
    renderThreatItems(nextItems);
  }).catch(() => {
    if (requestId !== threatRequestId || !coachMode || !coachGameActive || !coachGame ||
        coachGame.fen() !== fen || !coachIsUserTurn()) {
      return;
    }
    renderThreatItems([
      { kind: 'scan', text: 'Mate scan unavailable — engine could not check forcing threats.' },
      ...items
    ]);
  });
}
