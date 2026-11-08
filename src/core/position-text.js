// Board positions as words, for screen readers. Every board is role="img"
// with one of these as its label, so it has to make sense read aloud: a FEN
// is spelled out character by character and tells a listener nothing.

const POSITION_PIECE_NAMES = { k: ['King', 'King'], q: ['Queen', 'Queens'], r: ['Rook', 'Rooks'], b: ['Bishop', 'Bishops'], n: ['Knight', 'Knights'], p: ['Pawn', 'Pawns'] };
const POSITION_PIECE_ORDER = ['k', 'q', 'r', 'b', 'n', 'p'];

function joinWords(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

// "King g1, Queen d1, Rooks a1 and f1, Pawns a2, b2 and c2". Squares go
// a to h, then rank 1 to 8, the order a player scans a side's own pieces.
function describeSidePieces(gameObj, color) {
  const bySquare = {};
  const board = gameObj.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece || piece.color !== color) continue;
      (bySquare[piece.type] = bySquare[piece.type] || []).push('abcdefgh'[f] + (8 - r));
    }
  }
  const parts = [];
  for (const type of POSITION_PIECE_ORDER) {
    const squares = (bySquare[type] || []).sort((a, b) => a[0] === b[0] ? a[1] - b[1] : (a < b ? -1 : 1));
    if (!squares.length) continue;
    const [one, many] = POSITION_PIECE_NAMES[type];
    parts.push(`${squares.length === 1 ? one : many} ${joinWords(squares)}`);
  }
  return parts.join(', ');
}

// Side to move, check, mate or stalemate, then every piece on the board.
function describeChessPosition(gameObj) {
  if (!gameObj) return 'Chess position unavailable.';
  const turn = gameObj.turn() === 'w' ? 'White' : 'Black';
  let state = '';
  if (gameObj.in_checkmate()) state = ' Checkmate.';
  else if (gameObj.in_stalemate()) state = ' Stalemate.';
  else if (gameObj.in_check()) state = ' In check.';
  const side = color => describeSidePieces(gameObj, color) || 'no pieces';
  return `${turn} to move.${state} White: ${side('w')}. Black: ${side('b')}.`;
}
