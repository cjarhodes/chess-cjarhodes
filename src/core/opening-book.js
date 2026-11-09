// Opening identification from the built-in book.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

// ─────────────────────────────────────────────
// OPENING IDENTIFICATION
// ─────────────────────────────────────────────
// Compact opening book: SAN move sequence (space-joined) → { eco, name }.
// Curated to cover the most common lines encountered in club-level play.
// Longer prefixes win — so Italian Giuoco Piano beats Italian Game once c3 is on.
const OPENING_BOOK = [
  // 1.e4 families
  ['e4', 'B00', 'King\'s Pawn Opening'],
  ['e4 e5', 'C20', 'Open Game'],
  ['e4 e5 Nf3', 'C40', 'King\'s Knight Opening'],
  ['e4 e5 Nf3 Nc6', 'C44', 'King\'s Pawn Game'],
  ['e4 e5 Nf3 Nc6 Bb5', 'C60', 'Ruy Lopez'],
  ['e4 e5 Nf3 Nc6 Bb5 a6', 'C68', 'Ruy Lopez, Morphy Defense'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4', 'C77', 'Ruy Lopez, Morphy Defense'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6', 'C78', 'Ruy Lopez, Closed'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Bxc6', 'C68', 'Ruy Lopez, Exchange Variation'],
  ['e4 e5 Nf3 Nc6 Bb5 Nf6', 'C67', 'Ruy Lopez, Berlin Defense'],
  ['e4 e5 Nf3 Nc6 Bc4', 'C50', 'Italian Game'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'C50', 'Italian Game, Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 c3', 'C53', 'Italian Game, Giuoco Pianissimo'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'C55', 'Italian Game, Two Knights Defense'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5', 'C57', 'Two Knights, Fried Liver Attack'],
  ['e4 e5 Nf3 Nc6 d4', 'C44', 'Scotch Game'],
  ['e4 e5 Nf3 Nf6', 'C42', 'Petrov\'s Defense'],
  ['e4 e5 Nf3 d6', 'C41', 'Philidor Defense'],
  ['e4 e5 f4', 'C30', 'King\'s Gambit'],
  ['e4 e5 Nc3', 'C25', 'Vienna Game'],
  ['e4 e5 Bc4', 'C23', 'Bishop\'s Opening'],
  ['e4 c5', 'B20', 'Sicilian Defense'],
  ['e4 c5 Nf3', 'B27', 'Sicilian Defense'],
  ['e4 c5 Nf3 d6', 'B50', 'Sicilian Defense'],
  ['e4 c5 Nf3 d6 d4', 'B54', 'Sicilian, Open'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'B90', 'Sicilian, Najdorf'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'B70', 'Sicilian, Dragon'],
  ['e4 c5 Nf3 Nc6', 'B30', 'Sicilian, Old Sicilian'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5', 'B32', 'Sicilian, Sveshnikov'],
  ['e4 c5 Nf3 e6', 'B40', 'Sicilian, French Variation'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6', 'B42', 'Sicilian, Kan'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6', 'B44', 'Sicilian, Taimanov'],
  ['e4 c5 Nc3', 'B23', 'Sicilian, Closed'],
  ['e4 c5 c3', 'B22', 'Sicilian, Alapin'],
  ['e4 e6', 'C00', 'French Defense'],
  ['e4 e6 d4 d5', 'C01', 'French Defense'],
  ['e4 e6 d4 d5 Nc3', 'C10', 'French, Classical/Winawer territory'],
  ['e4 e6 d4 d5 Nc3 Bb4', 'C15', 'French, Winawer'],
  ['e4 e6 d4 d5 Nc3 Nf6', 'C11', 'French, Classical'],
  ['e4 e6 d4 d5 e5', 'C02', 'French, Advance'],
  ['e4 e6 d4 d5 exd5', 'C01', 'French, Exchange'],
  ['e4 c6', 'B10', 'Caro-Kann Defense'],
  ['e4 c6 d4 d5', 'B12', 'Caro-Kann'],
  ['e4 c6 d4 d5 Nc3', 'B15', 'Caro-Kann, Main Line'],
  ['e4 c6 d4 d5 exd5 cxd5', 'B13', 'Caro-Kann, Exchange'],
  ['e4 c6 d4 d5 e5', 'B12', 'Caro-Kann, Advance'],
  ['e4 d6', 'B07', 'Pirc Defense'],
  ['e4 d5', 'B01', 'Scandinavian Defense'],
  ['e4 Nf6', 'B02', 'Alekhine\'s Defense'],
  ['e4 g6', 'B06', 'Modern Defense'],
  ['e4 Nc6', 'B00', 'Nimzowitsch Defense'],

  // 1.d4 families
  ['d4', 'A40', 'Queen\'s Pawn Opening'],
  ['d4 d5', 'D00', 'Closed Game'],
  ['d4 d5 c4', 'D06', 'Queen\'s Gambit'],
  ['d4 d5 c4 e6', 'D30', 'Queen\'s Gambit Declined'],
  ['d4 d5 c4 e6 Nc3 Nf6', 'D35', 'QGD, Main Line'],
  ['d4 d5 c4 c6', 'D10', 'Slav Defense'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4', 'D15', 'Slav, Main Line'],
  ['d4 d5 c4 dxc4', 'D20', 'Queen\'s Gambit Accepted'],
  ['d4 d5 c4 Nf6', 'D06', 'QGD, Marshall Defense'],
  ['d4 d5 Nf3', 'D02', 'Queen\'s Pawn Game'],
  ['d4 d5 Bf4', 'D00', 'London System'],
  ['d4 d5 Nf3 Nf6 Bf4', 'D02', 'London System'],
  ['d4 Nf6', 'A45', 'Indian Defense'],
  ['d4 Nf6 c4', 'A50', 'Indian Defense'],
  ['d4 Nf6 c4 e6', 'E00', 'Indian, Queen\'s Pawn'],
  ['d4 Nf6 c4 e6 Nc3 Bb4', 'E20', 'Nimzo-Indian Defense'],
  ['d4 Nf6 c4 e6 Nf3', 'E10', 'Indian, East Indian'],
  ['d4 Nf6 c4 e6 Nf3 b6', 'E12', 'Queen\'s Indian Defense'],
  ['d4 Nf6 c4 e6 g3', 'E00', 'Catalan Opening'],
  ['d4 Nf6 c4 g6', 'A48', 'King\'s Indian / Grünfeld territory'],
  ['d4 Nf6 c4 g6 Nc3 Bg7', 'E60', 'King\'s Indian Defense'],
  ['d4 Nf6 c4 g6 Nc3 d5', 'D80', 'Grünfeld Defense'],
  ['d4 Nf6 c4 c5', 'A56', 'Benoni Defense'],
  ['d4 f5', 'A80', 'Dutch Defense'],
  ['d4 Nf6 Bg5', 'A45', 'Trompowsky Attack'],

  // Flank openings
  ['c4', 'A10', 'English Opening'],
  ['c4 e5', 'A20', 'English, King\'s English'],
  ['c4 c5', 'A30', 'English, Symmetrical'],
  ['c4 Nf6', 'A15', 'English, Anglo-Indian'],
  ['c4 e6', 'A13', 'English, Agincourt'],
  ['Nf3', 'A04', 'Réti Opening'],
  ['Nf3 d5', 'A07', 'King\'s Indian Attack'],
  ['g3', 'A00', 'Benko\'s Opening'],
  ['b3', 'A01', 'Larsen\'s Opening'],
  ['f4', 'A02', 'Bird\'s Opening'],
  ['b4', 'A00', 'Sokolsky Opening'],
];

// Build an in-memory trie keyed by SAN tokens. Each node stores any
// { eco, name } it terminates, and children keyed by next SAN.
const OPENING_TRIE = (() => {
  const root = { children: {} };
  for (const [line, eco, name] of OPENING_BOOK) {
    const tokens = line.split(' ');
    let node = root;
    for (const tok of tokens) {
      if (!node.children[tok]) node.children[tok] = { children: {} };
      node = node.children[tok];
    }
    node.data = { eco, name };
  }
  return root;
})();

// Find the deepest opening-book match for the given SAN history.
// Returns { match, exact, matchedPlies, bookPlies } — exact=true only if every
// move in `sans` walked into a trie node; matchedPlies is how far the named
// opening extends (i.e. the depth of the last {eco,name}-bearing node we
// passed); bookPlies is how far the game stayed in the book at all, which is
// where it actually left theory (an unnamed book move still counts).
function identifyOpening(sans) {
  if (!sans || sans.length === 0) return { match: null, exact: false, matchedPlies: 0, bookPlies: 0 };
  let node = OPENING_TRIE;
  let last = null;
  let lastDepth = 0;
  let walked = 0;
  for (let i = 0; i < sans.length; i++) {
    const next = node.children[sans[i]];
    if (!next) break;
    node = next;
    walked = i + 1;
    if (node.data) { last = node.data; lastDepth = walked; }
  }
  return { match: last, exact: walked === sans.length, matchedPlies: lastDepth, bookPlies: walked };
}

function openingDefinitionForSans(sans) {
  const history = Array.isArray(sans) ? sans : [];
  const info = identifyOpening(history);
  if (!info.match) return { info, opening: null };
  const matchedSans = history.slice(0, info.matchedPlies);
  const opening = OPENINGS.find(candidate => candidate.name === info.match.name &&
    candidate.moves.slice(0, matchedSans.length).join(' ') === matchedSans.join(' '));
  return { info, opening: opening || null };
}

function updateOpeningLabel() {
  coachOpeningId = null;
  if (!coachGame) {
    $('#opening-section').hide();
    return;
  }
  if (coachOpeningTransfer) {
    const source = OPENINGS.find(opening => opening.id === coachOpeningTransfer.openingId);
    coachOpeningId = source && source.id;
    $('#coach-opening-eco').text(source ? source.eco : '');
    $('#coach-opening-name').text(`${coachOpeningTransfer.title} · ${coachOpeningTransfer.lineName} · free play from move ${coachOpeningTransfer.sourceFen.split(' ')[5]}`);
    $('#opening-section').show();
    return;
  }
  // Respect the history cursor so navigating back shows the opening as it was
  // at that ply, not the latest one.
  const fullSans = coachGame.history();
  const end = coachReviewCursor === null ? fullSans.length : coachReviewCursor;
  const sans = fullSans.slice(0, end);
  if (sans.length === 0) {
    $('#opening-section').hide();
    return;
  }
  const definition = openingDefinitionForSans(sans);
  const info = definition.info;
  if (!info.match) {
    $('#opening-section').hide();
    return;
  }
  coachOpeningId = definition.opening ? definition.opening.id : null;
  $('#coach-opening-eco').text(info.match.eco);
  if (info.exact) {
    // Still in book — just show the current opening name.
    $('#coach-opening-name').text(info.match.name);
  } else {
    // Out of book — pin the deepest named match and say after which move.
    const moveNum = Math.ceil(info.bookPlies / 2);
    $('#coach-opening-name').text(
      `${info.match.name} — out of book after move ${moveNum}`
    );
  }
  $('#opening-section').show();
}
