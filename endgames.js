// Endgame practice: classic won positions played out against full-strength
// Stockfish until the goal is reached. Pure rules (drills and judging) so
// scripts/validate-endgames.js can run them in Node; puzzles.js plays them.
(function(root) {
  'use strict';
  const DRILLS = [
    { id: 'kq-k', title: 'Queen and king vs king', goal: 'mate', limit: 10,
      fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1',
      tip: 'Use the queen a knight’s move away to shrink the box, then bring your king. Watch for stalemate.' },
    { id: 'kr-k', title: 'Rook and king vs king', goal: 'mate', limit: 16,
      fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
      tip: 'Cut the king off with the rook, walk your king into opposition, then check along the edge.' },
    { id: 'rr-k', title: 'Two rooks: the ladder', goal: 'mate', limit: 8,
      fen: '8/8/3k4/8/8/8/8/R3K2R w - - 0 1',
      tip: 'The rooks take turns: one checks, the other guards the next rank. Keep them far from the king.' },
    { id: 'kp-k', title: 'King and pawn: key squares', goal: 'promote', limit: 15,
      fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
      tip: 'Your king in front of the pawn wins. Take the opposition and only push when the queening square is safe.' },
    { id: 'lucena', title: 'Lucena position: build a bridge', goal: 'promote', limit: 15,
      fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
      tip: 'Drive the black king away with a check, then lift your rook to the fourth rank to block the checks.' }
  ];

  function byId(id) { return DRILLS.find(d => d.id === id) || null; }
  function userColor(drill) { return drill.fen.split(' ')[1]; }

  function count(game, color, type) {
    let n = 0;
    game.board().forEach(row => row.forEach(sq => { if (sq && sq.color === color && (!type || sq.type === type)) n++; }));
    return n;
  }

  // After every half-move. Returns { result: 'win' | 'fail', reason } or null.
  // userMoves counts the moves the player has made so far.
  function judge(ChessCtor, drill, game, userMoves, startFen) {
    const me = userColor(drill);
    const start = new ChessCtor(startFen || drill.fen);
    if (game.in_checkmate()) {
      return game.turn() === me ? { result: 'fail', reason: 'You were checkmated.' } : { result: 'win', reason: `Checkmate in ${userMoves} move${userMoves === 1 ? '' : 's'}.` };
    }
    if (game.in_stalemate()) return { result: 'fail', reason: 'Stalemate: a draw. Leave the king a square or give check.' };
    // Losing any piece (or the pawn) throws the win away in these drills.
    // Say so before the draw rule, which a bare king position also triggers.
    const before = count(start, me) - count(start, me, 'p');
    const now = count(game, me) - count(game, me, 'p');
    // New pieces can only come from promotion (to a queen or any other).
    const promoted = now - before;
    if (drill.goal === 'promote') {
      // Judge promotion once the opponent has replied, so a new piece that
      // is simply captured does not count.
      if (game.turn() === me && promoted > 0) return { result: 'win', reason: `Promoted safely in ${userMoves} move${userMoves === 1 ? '' : 's'}.` };
      if (count(game, me, 'p') + Math.max(0, promoted) < count(start, me, 'p')) return { result: 'fail', reason: 'The pawn was lost.' };
    }
    if (now < before) return { result: 'fail', reason: 'You lost a piece.' };
    if (game.in_draw()) return { result: 'fail', reason: 'The position is a draw.' };
    if (game.turn() === me && userMoves >= drill.limit) return { result: 'fail', reason: `Out of moves: the goal is ${drill.limit}.` };
    return null;
  }

  const api = { DRILLS, byId, userColor, judge };
  root.EndgameDrills = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
