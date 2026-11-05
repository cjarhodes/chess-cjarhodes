// Great (!) and Brilliant (!!) moves, in the spirit of Chess.com's review.
// A display-only flag on top of the existing tiers: accuracy, insights and
// stored reviews keep using `tier`. Pure function of the position and the
// engine's MultiPV lines, so scripts/validate-move-flair.js tests it in Node.
(function(root) {
  'use strict';
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const GREAT_GAP = 0.2;        // win-probability gap to the second-best move
  const DECIDED = 0.97;         // positions already this won are not "great"

  // Mover's win probability from a UCI score (side to move's view).
  function winProb(line) {
    if (!line) return null;
    if (line.mate !== null && line.mate !== undefined) return line.mate > 0 ? 1 : 0;
    const cp = Math.max(-2000, Math.min(2000, Number(line.cp) || 0));
    return 1 / (1 + Math.exp(-0.00368208 * cp));
  }

  // Would the moved piece be lost? True when the opponent can capture it
  // with a cheaper piece, or capture it at all with no recapture.
  function leavesPieceEnPrise(ChessCtor, fenAfter, square, value) {
    const after = new ChessCtor(fenAfter);
    const captures = after.moves({ verbose: true }).filter(m => m.to === square && m.captured);
    if (!captures.length) return false;
    const cheapest = Math.min(...captures.map(m => VALUE[m.piece] || 0));
    if (cheapest < value) return true;
    const take = captures.find(m => (VALUE[m.piece] || 0) === cheapest);
    after.move(take);
    const recapture = after.moves({ verbose: true }).some(m => m.to === square && m.captured);
    return !recapture;
  }

  // lines: engine MultiPV lines for fenBefore, best first, scores from the
  // mover's view. Returns 'brilliant', 'great' or null.
  function moveFlair(ChessCtor, fenBefore, userUci, lines) {
    if (!userUci || !Array.isArray(lines) || !lines.length) return null;
    const best = lines[0];
    if (!best || !best.pv || best.pv[0] !== userUci) return null;
    const board = new ChessCtor(fenBefore);
    if (board.in_check() || board.moves().length < 2) return null; // forced
    const move = board.move({ from: userUci.slice(0, 2), to: userUci.slice(2, 4), promotion: userUci[4] || undefined });
    if (!move) return null;
    if (board.in_checkmate()) return null; // mate in one is its own reward
    const pBest = winProb(best);
    if (pBest === null || pBest < 0.5) return null; // must keep a sound position

    const moved = VALUE[move.promotion || move.piece] || 0;
    const taken = move.captured ? VALUE[move.captured] : 0;
    // A sacrifice: a minor piece or more left where it can be won, not just
    // a trade, while the engine still rates the position at least level.
    if (moved >= 3 && move.piece !== 'k' && taken < moved && leavesPieceEnPrise(ChessCtor, board.fen(), move.to, moved)) {
      const second = lines[1];
      const p2 = second ? winProb(second) : null;
      if (pBest >= 0.5 && (p2 === null || pBest - p2 >= 0.05 || pBest < DECIDED)) return 'brilliant';
    }

    // Great: the only good move. Skip already-decided positions and plain
    // trades or recaptures, which are rarely hard to find.
    const second = lines[1];
    if (!second) return null;
    const p2 = winProb(second);
    if (p2 === null || pBest - p2 < GREAT_GAP) return null;
    if (p2 >= DECIDED) return null;
    if (move.captured && taken >= moved) return null;
    return 'great';
  }

  const api = { moveFlair, winProb, leavesPieceEnPrise };
  root.MoveFlair = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
