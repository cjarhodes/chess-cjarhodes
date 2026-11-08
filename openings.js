// Opening content data — move lists, explanations, key ideas, and variations for the Library.
// Loaded before app.js via a plain <script> tag; OPENINGS is a global consumed by app.js.
// ─────────────────────────────────────────────
// OPENING DATA
// ─────────────────────────────────────────────
const OPENINGS = [
  {
    id: 'italian',
    name: 'Italian Game',
    eco: 'C50',
    category: 'white',
    tagline: 'Classical development and early f7 pressure',
    description: 'One of the oldest openings in chess, dating to the 16th century. The Italian Game focuses on rapid development, central control with e4+d3, and long-term structural advantages. The Bc4 bishop eyes the f7 pawn — Black\'s most vulnerable point early in the game. The Modern Italian (c3 + d3) is the current top-level choice for White.',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O', 'Re1', 'a6', 'a4', 'Ba7', 'h3', 'h6', 'Nbd2', 'Re8', 'Nf1', 'Be6', 'Bxe6', 'Rxe6', 'Ng3', 'Qd7'],
    explanations: [
      { label: '1. e4 — White', text: 'The King\'s Pawn — the most popular first move in all of chess. It immediately stakes a claim in the center, opens lines for the queen and bishop, and prepares rapid castling. Bobby Fischer called it "best by test."' },
      { label: '1... e5 — Black', text: 'The symmetrical response. Black mirrors White\'s central claim, contesting the center immediately. This is one of Black\'s most solid and time-tested replies — known as Open Game territory.' },
      { label: '2. Nf3 — White', text: 'The knight develops to its most natural square, simultaneously attacking Black\'s e5 pawn and preparing to castle kingside. Following the classical principle: "Knights before bishops."' },
      { label: '2... Nc6 — Black', text: 'The most natural defense — the knight defends e5 and comes to a strong central square. Black develops with purpose.' },
      { label: '3. Bc4 — White', text: 'The Italian bishop! White aims at f7 — the weakest square in Black\'s position (defended only by the king). This bishop is tremendously active.' },
      { label: '3... Bc5 — Black', text: 'Black mirrors White\'s development, placing the bishop on the powerful c5 diagonal. This symmetrical setup leads to the Giuoco Piano ("quiet game") — though it\'s far from quiet!' },
      { label: '4. c3 — White', text: 'The Modern Italian begins. White prepares d4 to grab the center. c3 also gives the queen a potential square on c2, and the pawn will support the d4 advance.' },
      { label: '4... Nf6 — Black', text: 'Black continues development rather than allowing d4 immediately. The Nf6 attacks e4, forcing White to defend it.' },
      { label: '5. d3 — White', text: 'White chooses the "slow" Italian setup — d3 instead of d4. This leads to a more positional battle. White will maneuver pieces to ideal squares before launching any pawn breaks.' },
      { label: '5... d6 — Black', text: 'Solid and sensible — Black supports the e5 pawn and prepares to complete development. The position is solid and roughly balanced.' },
      { label: '6. O-O — White', text: 'White castles, bringing the king to safety. Now all of White\'s development is focused on the kingside. The rook on f1 will be useful on the e-file after Re1.' },
      { label: '6... O-O — Black', text: 'Black also castles. Both kings are safe. The real battle begins now — slow maneuvering for ideal piece placement.' },
      { label: '7. Re1 — White', text: 'The rook eyes the e5 pawn. This classic move puts pressure on the e-file and supports the e4 pawn, preparing for future central action. Typical Italian plan.' },
      { label: '7... a6 — Black', text: 'A prophylactic move — Black prevents Bb5 (or Ba4-b3 ideas) and prepares to kick the bishop with ...b5 if needed. Typical Bc5 bishop defense.' },
      { label: '8. a4 — White', text: 'White stops ...b5 and prevents Black from pushing the bishop back. White also gains queenside space and creates pressure on the a5 square.' },
      { label: '8... Ba7 — Black', text: 'The bishop retreats to a7, a safe square outside the pawn chain. From a7, it doesn\'t do much, but it\'s also not easily attacked. Black must find other ways to activate.' },
      { label: '9. h3 — White', text: 'Prophylaxis! White prevents ...Bg4 (which would pin the Nf3 and add pressure). This quiet move is typical in slow Italian positions — secure everything before advancing.' },
      { label: '9... h6 — Black', text: 'Mirroring White\'s prophylaxis — Black prevents Bg5. Both sides are playing carefully, avoiding any weaknesses before the middlegame battle begins.' },
      { label: '10. Nbd2 — White', text: 'The knight comes to d2, heading for f1 and then e3 or g3. This "knight maneuver" is the hallmark of the Modern Italian — the knight will become a powerful piece.' },
      { label: '10... Re8 — Black', text: 'Black centralizes the rook, adding support to the e5 pawn and preparing for potential activity on the e-file. Both sides continue improving piece placement.' },
      { label: '11. Nf1 — White', text: 'The second step of White\'s knight maneuver. The Nd2 went to f1, and from here it can go to e3, g3, or even h2-g4. White\'s knights are heading to the kingside for an attack.' },
      { label: '11... Be6 — Black', text: 'Black\'s bishop becomes active, eying the c4 bishop and fighting for the d5 square. This also prepares ...d5 as a central break if conditions are right.' },
      { label: '12. Bxe6 — White', text: 'White exchanges the Italian bishop for Black\'s active Be6. This simplifies somewhat and removes the potentially dangerous bishop. White gets the bishop pair advantage.' },
      { label: '12... Rxe6 — Black', text: 'The rook recaptures on e6, becoming centralized and active. The rook on e6 is powerful — it can shift to d6, f6, or just maintain pressure.' },
      { label: '13. Ng3 — White', text: 'The knight arrives at g3, completing the maneuver. From g3, it controls f5 and h5, and can jump to f5 if Black allows it. This is the standard Italian knight setup — both knights (g3 and f3) aim at f5.' },
      { label: '13... Qd7 — Black', text: 'Black prepares queenside operations and potential ...Rae8 doubling rooks. The queen also eyes d5 and keeps an eye on g4. A tense middlegame battle awaits.' }
    ],
    keyIdeas: [
      'Modern Italian: c3 + d3 — slow but deep positional pressure',
      'White\'s knight maneuver: Nbd2-f1-g3 (or e3) aims at f5',
      'Re1 supports e4 and pressures e5 — a typical Italian rook move',
      'Key break: d4 when ready — challenges Black\'s central pawn structure'
    ]
  },
  {
    id: 'ruy-lopez',
    name: 'Ruy López',
    eco: 'C60',
    category: 'white',
    tagline: 'The gold standard of 1.e4 openings',
    description: 'Named after a 16th-century Spanish priest, the Ruy López is one of the most deeply studied openings in chess history — hundreds of years of theory! It puts immediate pressure on the Nc6 that defends e5, creating long-term strategic tension. The Breyer Variation shown here is Magnus Carlsen\'s favorite.',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8', 'd4', 'Nbd7', 'Nbd2', 'Bb7', 'Bc2', 'Re8', 'Nf1', 'Bf8'],
    explanations: [
      { label: '1. e4 — White', text: 'The King\'s Pawn — White stakes a central claim immediately, opening lines for rapid piece development and kingside castling.' },
      { label: '1... e5 — Black', text: 'Black responds symmetrically, taking equal central space. A principled, classical response that leads to rich middlegame play.' },
      { label: '2. Nf3 — White', text: 'The knight attacks e5, develops naturally, and prepares to castle.' },
      { label: '2... Nc6 — Black', text: 'The most natural defense to e5 — the knight develops to an active central square and covers the pawn.' },
      { label: '3. Bb5 — White', text: 'The Ruy López! The bishop threatens Bxc6 followed by Nxe5, winning the e5 pawn. It\'s not an immediate tactic — it\'s a long-term positional pressure move.' },
      { label: '3... a6 — Black', text: 'The Morphy Defense — Black asks the bishop to declare its intentions. It\'s the most popular response, leading to the richest theory in all of chess.' },
      { label: '4. Ba4 — White', text: 'The bishop retreats to a4, maintaining the pin (or semi-pin) on the Nc6. Now if Black pushes ...b5, the bishop retreats to b3, and the battle continues.' },
      { label: '4... Nf6 — Black', text: 'Black develops the knight, attacks e4, and prepares to castle. This is the start of the main Ruy López tabiya.' },
      { label: '5. O-O — White', text: 'White castles immediately — a key move. Rather than protecting e4 (which is not immediately threatened), White castles and creates more threats. This is the "main line" move.' },
      { label: '5... Be7 — Black', text: 'Solid development — the bishop prepares to castle and defends the kingside. Black is building a rock-solid structure.' },
      { label: '6. Re1 — White', text: 'The classic Ruy López rook move! Re1 supports the e4 pawn and prepares for central action. White is building up pressure slowly and solidly.' },
      { label: '6... b5 — Black', text: 'Black kicks the bishop back and gains queenside space. This is a key moment — Black gains space but slightly weakens the c5 square.' },
      { label: '7. Bb3 — White', text: 'The bishop retreats to b3, where it remains active on the a2-g8 diagonal. From b3, the bishop eyes f7 and stays involved in the game.' },
      { label: '7... d6 — Black', text: 'Black solidifies the center, supporting e5. This leads to the "Closed Ruy López" — a strategic battle involving piece maneuvering.' },
      { label: '8. c3 — White', text: 'White prepares d4. The c3 pawn will support a strong d4 advance, giving White central control. White is in no hurry — the position is slowly built up.' },
      { label: '8... O-O — Black', text: 'Black castles, bringing the king to safety. Now the real maneuvering begins. Both sides have completed basic development.' },
      { label: '9. h3 — White', text: 'Prophylaxis — preventing ...Bg4 which would pin the Nf3. White takes away this resource before pushing d4.' },
      { label: '9... Nb8 — Black', text: 'The Breyer Variation! The knight retreats all the way to b8, preparing to reroute to d7. This surprising move is the most sophisticated and dynamic reply. The knight will become powerfully placed on d7.' },
      { label: '10. d4 — White', text: 'White finally plays the central thrust. With the Nc6 gone (it\'s on b8), White doesn\'t need to worry about Nd4 counterplay.' },
      { label: '10... Nbd7 — Black', text: 'The Breyer knight completes its journey from c6 to b8 to d7. From d7, it supports e5 and prepares ...Nf8 or ...Nb6 maneuvering. This is beautiful chess.' },
      { label: '11. Nbd2 — White', text: 'White\'s queenside knight develops to d2, supporting the center. From d2, it can go to f1 and then e3 or g3 — the same knight maneuver as in the Italian.' },
      { label: '11... Bb7 — Black', text: 'The bishop develops to b7, pointing at the center along the long diagonal. This is typical Ruy López structure — Black\'s pieces are finding ideal squares.' },
      { label: '12. Bc2 — White', text: 'The bishop retreats to c2, keeping the a2-g8 diagonal while getting out of potential ...c5 attacks. White prepares a queenside expansion.' },
      { label: '12... Re8 — Black', text: 'The rook moves to e8, supporting the e5 pawn. This is a key defensive move — the e5 pawn is the cornerstone of Black\'s position.' },
      { label: '13. Nf1 — White', text: 'The first step of White\'s knight maneuver. The knight heads toward g3 or e3, preparing to attack.' },
      { label: '13... Bf8 — Black', text: 'The bishop retreats to f8, a key defensive move in the Breyer. From f8, the bishop can go to g7 (fianchetto-style) or come to e7. The position is an intricate maneuvering game with chances for both sides.' }
    ],
    keyIdeas: [
      'Breyer Variation: 9...Nb8-d7 — the most dynamic Black system',
      'White\'s knight maneuver: Nbd2-f1-g3/e3 — copying the Italian theme',
      'Key tension: d4 vs e5 — who controls the center?',
      'Long-term: White aims for queenside expansion, Black attacks on the kingside'
    ]
  },
  {
    id: 'queens-gambit',
    name: "Queen's Gambit",
    eco: 'D06',
    category: 'white',
    tagline: 'Classical central dominance from the d-file',
    description: 'One of the oldest and most respected openings in chess. White offers the c4 pawn — a "gambit" in name, but it\'s actually very safe since the pawn is usually regained. The line shown is the QGD with Bg5 — the classical main line that has been played for over a century at the highest levels.',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6', 'Bh4', 'b6', 'Bd3', 'dxc4', 'Bxc4', 'Bb7', 'O-O', 'Nbd7', 'Qe2', 'c5', 'Rfd1', 'Qc7'],
    explanations: [
      { label: '1. d4 — White', text: 'The Queen\'s Pawn opening. Controls the center from the d-file side and opens the diagonal for the dark-squared bishop. Unlike 1.e4, this leads to more positional, strategic battles.' },
      { label: '1... d5 — Black', text: 'Black responds symmetrically, taking equal central space. A principled response that leads to the Queen\'s Gambit complex.' },
      { label: '2. c4 — White', text: 'The Queen\'s Gambit! White offers a pawn to deflect Black\'s d5 pawn. This is "not really a gambit" — White almost always regains the pawn with superior central control.' },
      { label: '2... e6 — Black', text: 'The Queen\'s Gambit Declined! Black supports d5 with e6, giving up the light-squared bishop\'s diagonal but building a rock-solid center. This leads to rich, strategic play.' },
      { label: '3. Nc3 — White', text: 'White develops the knight, supporting d4 and preparing to add pressure on d5. Nc3 is the most aggressive setup, leading to the main lines.' },
      { label: '3... Nf6 — Black', text: 'Black continues development, contesting the center with the knight. The classical QGD main line.' },
      { label: '4. Bg5 — White', text: 'White pins the Nf6 to the queen! This is the Classical QGD. The pin creates pressure — if Black isn\'t careful, the d5 pawn can fall. This move also prepares e3 and Nf3.' },
      { label: '4... Be7 — Black', text: 'Black breaks the pin with the bishop. Be7 is the most solid response — Black unpins and prepares to castle.' },
      { label: '5. e3 — White', text: 'White solidifies the center with e3 and prepares to develop the f1 bishop. The structure is very solid — d4, c4, e3 form a powerful triangle.' },
      { label: '5... O-O — Black', text: 'Black castles, bringing the king to safety. Development is nearly complete for Black.' },
      { label: '6. Nf3 — White', text: 'White completes development. Now White has all pieces developed except the bishops.' },
      { label: '6... h6 — Black', text: 'Black asks the bishop to declare its intentions. This prophylactic move prevents Bxf6 and also prepares potential ...b6 and ...Bb7 development.' },
      { label: '7. Bh4 — White', text: 'White retreats the bishop rather than exchanging. Bh4 keeps the pin alive — from h4, the bishop still eyes f6 and g3 if needed.' },
      { label: '7... b6 — Black', text: 'Black prepares to fianchetto the light-squared bishop on b7. This is a common plan — ...Bb7 will create counterplay along the long diagonal.' },
      { label: '8. Bd3 — White', text: 'White develops the f1 bishop to an active square, pointing at h7. This bishop will be key in White\'s attacking plans on the kingside.' },
      { label: '8... dxc4 — Black', text: 'Black takes the gambit pawn! This is the Queen\'s Gambit Accepted move order — Black accepts the pawn to relieve central tension and gain time.' },
      { label: '9. Bxc4 — White', text: 'White recaptures, now with the bishop on c4 instead of d3. This bishop eyes f7 and is more active.' },
      { label: '9... Bb7 — Black', text: 'The bishop arrives at b7, completing the fianchetto. From b7, it pressures the long diagonal and eyes e4.' },
      { label: '10. O-O — White', text: 'White castles. Development is complete. Now the strategic battle begins — White has the bishop pair and central space, Black has solid structure.' },
      { label: '10... Nbd7 — Black', text: 'The queenside knight develops to d7, supporting the center and preparing ...c5 or ...e5 breaks.' },
      { label: '11. Qe2 — White', text: 'The queen moves to e2, eyeing the e-file and preparing Rfd1. White is building up central pressure.' },
      { label: '11... c5 — Black', text: 'Black launches the central break! ...c5 is Black\'s main counter in the QGD — it challenges White\'s d4 pawn and activates Black\'s pieces.' },
      { label: '12. Rfd1 — White', text: 'The rook goes to d1, supporting d4 and preparing for central action. White must respond carefully to the c5 break.' },
      { label: '12... Qc7 — Black', text: 'Black prepares to complete development and contests the center. The queen supports ...c4 ideas and eyes the c-file. A rich strategic middlegame awaits both sides.' }
    ],
    keyIdeas: [
      'Classical QGD: Bg5 pin creates long-term pressure on Black\'s position',
      'Black\'s plan: ...b6, ...Bb7 — fianchetto to contest the long diagonal',
      'White\'s plan: Bd3 + e4 push — activate pieces and attack the kingside',
      'Key break: ...c5 by Black challenges White\'s center at the right moment'
    ]
  },
  {
    id: 'london',
    name: 'London System',
    eco: 'D02',
    category: 'white',
    tagline: 'Solid, flexible, and low on theory',
    description: 'The London System is a reliable, low-theory approach beloved by everyone from club players to Magnus Carlsen. White builds a solid pawn structure with the bishop developed to f4 BEFORE playing e3 — the key move order. White\'s plans are clear and safe; the position requires good maneuvering.',
    moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'Bd6', 'Bg3', 'O-O', 'Nbd2', 'c5', 'c3', 'Nc6', 'Bd3', 'Bxg3', 'hxg3', 'Qe7', 'Ne5', 'g6', 'f4', 'Nd7', 'Ndf3', 'f6'],
    explanations: [
      { label: '1. d4 — White', text: 'White opens with the Queen\'s Pawn, controlling the center and preparing a solid setup. Less sharp than 1.e4, but deeply strategic.' },
      { label: '1... d5 — Black', text: 'Black takes central space. The symmetrical 1...d5 is a principled response.' },
      { label: '2. Nf3 — White', text: 'Natural development. Move order matters: White plays Nf3 before deciding on the bishop.' },
      { label: '2... Nf6 — Black', text: 'Black mirrors with Nf6 — natural development, contesting the e4 square.' },
      { label: '3. Bf4 — White', text: 'The defining London move! The bishop develops to f4 BEFORE playing e3. This is critical — once e3 is played, the c1 bishop gets locked in. White wants active piece play.' },
      { label: '3... e6 — Black', text: 'Black supports d5 with e6. A solid, classical response that leads to a positional battle.' },
      { label: '4. e3 — White', text: 'Now White plays e3, completing the London triangle (d4, e3, c3 will come). Notice that the bishop on f4 is already developed — that\'s the whole point of the London move order.' },
      { label: '4... Bd6 — Black', text: 'Black challenges the Bf4 directly. The bishop on d6 eyes the f4 bishop and prepares to exchange it, potentially weakening White\'s pawn structure.' },
      { label: '5. Bg3 — White', text: 'White retreats the bishop to g3. Now if Black exchanges (Bxg3), White recaptures with h2xg3, doubling the h/g pawns but opening the h-file for the rook.' },
      { label: '5... O-O — Black', text: 'Black castles, king to safety. The fight over the light squares will continue after castle.' },
      { label: '6. Nbd2 — White', text: 'White develops the queenside knight to d2, supporting the center. From d2 it can go to f1, b3, or stay to support e4.' },
      { label: '6... c5 — Black', text: 'Black attacks d4. This is the main counter in the London — Black wants to challenge White\'s central pawn before White consolidates.' },
      { label: '7. c3 — White', text: 'White solidifies d4, completing the London triangle: d4, e3, c3. This structure is very hard to break down — White\'s center is rock-solid.' },
      { label: '7... Nc6 — Black', text: 'Black develops the knight to c6, increasing pressure on d4. The knight on c6 supports potential ...e5 or ...c4 breaks.' },
      { label: '8. Bd3 — White', text: 'White\'s f1 bishop develops to d3, aiming at h7. From d3, the bishop is very powerful, and White now threatens to follow up with Qc2 and then e4.' },
      { label: '8... Bxg3 — Black', text: 'Black exchanges the bishops. By trading the Bd6 for the Bg3, Black removes White\'s important bishop but concedes the h-file opening.' },
      { label: '9. hxg3 — White', text: 'White recaptures with the h-pawn, creating a half-open h-file. This is an important dynamic — White can use the h-file for attacking chances with Rh1.' },
      { label: '9... Qe7 — Black', text: 'Black develops the queen to e7, preparing to challenge White\'s center with ...e5 or contest the bishop on d3.' },
      { label: '10. Ne5 — White', text: 'Don\'t castle yet! With the h-file half-open, the rook is already useful on h1. The knight jumps to its key outpost on e5, and now Bxh7+ is a real threat: the bishop on d3 and the rook on h1 both aim at h7, so after Bxh7+ the rook joins in with discovered checks. Castling kingside here would throw that pressure away.' },
      { label: '10... g6 — Black', text: 'Black blocks the bishop\'s diagonal and covers h7 for good. This is the most solid defense, but it loosens the dark squares around the black king, and with the dark-squared bishops gone nobody can easily cover them.' },
      { label: '11. f4 — White', text: 'White props up the knight with f4, a Stonewall-style grip on e5. If Black ever trades on e5, White recaptures with a pawn and keeps a wedge in the center that cramps Black\'s pieces.' },
      { label: '11... Nd7 — Black', text: 'Black brings a second knight to challenge e5. Trading off White\'s best piece is Black\'s main idea in these structures.' },
      { label: '12. Ndf3 — White', text: 'The d2 knight joins in, defending e5 again. Now if Black captures on e5, Nxe5 puts a fresh knight straight back on the outpost. White\'s king can stay in the center for now, or castle queenside later, while the rook keeps watch on the h-file.' },
      { label: '12... f6 — Black', text: 'Black attacks the knight with a pawn to break White\'s grip on e5. It costs something, though: the e6 pawn becomes weaker and the black king more exposed. White keeps the easier game, with kingside chances and a firm hold on the center.' }
    ],
    keyIdeas: [
      'Always play Bf4 BEFORE e3 — the critical London move order',
      'Build the triangle: d4, e3, c3 for a rock-solid structure',
      'Ne5 is a key attacking outpost — aim to get the knight there',
      'After hxg3 the h-file is half-open: keep the rook on h1 and don\'t rush to castle kingside'
    ]
  },
  {
    id: 'sicilian',
    name: 'Sicilian Defense',
    eco: 'B20',
    category: 'black',
    tagline: "Black's sharpest and most popular weapon against 1.e4",
    description: 'The most played opening in chess at all levels. The Sicilian creates an asymmetrical pawn structure from move one. The line shown is the Najdorf Variation — the most theoretically rich opening in chess, favored by Fischer, Kasparov, and Carlsen. Black gets queenside counterplay while White attacks on the kingside.',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2', 'e5', 'Nb3', 'Be7', 'O-O', 'O-O', 'Be3', 'Be6', 'Qd2', 'Nbd7', 'f3', 'b5', 'a4', 'b4'],
    explanations: [
      { label: '1. e4 — White', text: 'White opens with the King\'s Pawn, claiming central space and preparing rapid development. White will typically aim for a kingside attack.' },
      { label: '1... c5 — Black', text: 'The Sicilian! Instead of matching White\'s central pawn with 1...e5, Black plays c5 — controlling d4 without giving White a central pawn duo. This asymmetry is the engine of the most complex chess in history.' },
      { label: '2. Nf3 — White', text: 'White develops the knight and prepares d4 — the key pawn thrust that opens the Sicilian into its full complexity.' },
      { label: '2... d6 — Black', text: 'Black supports the e5 square (after ...e5 later) and prepares the Najdorf. Black builds a flexible structure.' },
      { label: '3. d4 — White', text: 'The key move! White opens the center. After 3...cxd4 4.Nxd4, the Sicilian proper begins — White has more central space, Black has the c-file for counterplay.' },
      { label: '3... cxd4 — Black', text: 'Black captures, eliminating White\'s c-pawn equivalence. Now the pawn structure is asymmetrical: White has an e-pawn, Black has a d-pawn. This imbalance drives the entire game.' },
      { label: '4. Nxd4 — White', text: 'White recaptures with the knight, centralizing it. The knight on d4 is a powerful piece, but Black will try to undermine it.' },
      { label: '4... Nf6 — Black', text: 'Black attacks e4, developing a key piece. The Nf6 is Black\'s best move — it contests the center and prepares for the upcoming battle.' },
      { label: '5. Nc3 — White', text: 'White defends e4 with the knight, completing basic development. Now the Najdorf tabiya is set with White\'s next move choice.' },
      { label: '5... a6 — Black', text: 'The Najdorf! The signature move — 5...a6. This prevents Bb5+, prepares ...b5 expansion, and keeps options flexible. Fischer called the Najdorf "best by test" for Black.' },
      { label: '6. Be2 — White', text: 'The English Attack alternative — White plays Be2, avoiding the razor-sharp 6.Bg5 lines. This solid system leads to strategic battles.' },
      { label: '6... e5 — Black', text: 'Black stakes a claim in the center. 6...e5 kicks the Nd4, gains space, and prepares to develop with ...Be7, ...Be6, and ...0-0. The central tension defines the middlegame.' },
      { label: '7. Nb3 — White', text: 'The knight retreats to b3, keeping an eye on d4 and c5. White accepts a slightly passive knight in exchange for long-term structural pressure.' },
      { label: '7... Be7 — Black', text: 'Solid development — the bishop prepares to castle. Be7 is the backbone of the Najdorf with 6...e5 — a safe, flexible piece.' },
      { label: '8. O-O — White', text: 'White castles, completing development. Now the strategic battle begins in earnest.' },
      { label: '8... O-O — Black', text: 'Black also castles. Both kings are safe, and the battle will be fought in the center and on both wings.' },
      { label: '9. Be3 — White', text: 'White develops the bishop to e3, eyeing the d4 and b6 squares. White prepares the Qd2 + f3 setup, known as the English Attack in Sicilian positions.' },
      { label: '9... Be6 — Black', text: 'Black\'s bishop to e6, contesting White\'s Be3 and preparing to fight for the d5 and c4 squares. The bishops will likely be exchanged.' },
      { label: '10. Qd2 — White', text: 'White prepares the classic Sicilian plan: Qd2 + f3 + g4. White is setting up for a queenside pawn storm (a4, f3, g4) while Black plans a queenside expansion.' },
      { label: '10... Nbd7 — Black', text: 'Black develops the knight, supporting e5 and preparing ...Nc5 (attacking Nb3) or ...Nb6. The knight on d7 is flexible.' },
      { label: '11. f3 — White', text: 'White plays f3, supporting e4 and preparing g4. This is the hallmark of the English Attack — White is going to launch a kingside pawn storm.' },
      { label: '11... b5 — Black', text: 'Black begins queenside counterplay. The b5 push is typical Sicilian — Black expands on the queenside while White attacks the kingside. This race is the heart of the Sicilian.' },
      { label: '12. a4 — White', text: 'White challenges Black\'s queenside expansion. a4 attacks the b5 pawn and slows Black\'s counter. This creates a critical race.' },
      { label: '12... b4 — Black', text: 'Black pushes the pawn, gaining space and forcing White to deal with the b4 pawn. White cannot capture (axb5 would allow ...axb5 with a strong queenside majority). The race is on — White storms the kingside, Black storms the queenside.' }
    ],
    keyIdeas: [
      'Najdorf: 5...a6 prevents Bb5+ and prepares queenside expansion',
      'English Attack: Be3 + Qd2 + f3 — White storms the kingside',
      'Black\'s plan: ...b5-b4, ...Nc5 — queenside counterplay and piece activity',
      'The race: White attacks the kingside BEFORE Black breaks through queenside'
    ]
  },
  {
    id: 'french',
    name: 'French Defense',
    eco: 'C00',
    category: 'black',
    tagline: 'Solid and counterattacking with ...c5',
    description: 'The French Defense is a strategic, counterattacking system. Black builds a solid structure and prepares the ...c5 break to challenge White\'s center. The Advance Variation shown (3.e5) gives White space but Black counterattacks with ...c5. Clear plans for both sides make this an excellent learning opening.',
    moves: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Qb6', 'a3', 'c4', 'g3', 'Na5', 'Nbd2', 'Bd7', 'Bg2', 'Ne7', 'O-O', 'h6', 'Re1', 'Nf5', 'Nf1', 'Be7'],
    explanations: [
      { label: '1. e4 — White', text: 'White opens with the King\'s Pawn, claiming central space.' },
      { label: '1... e6 — Black', text: 'The French Defense! Black prepares to challenge the center with ...d5 on the next move. The e6 pawn makes the position very solid.' },
      { label: '2. d4 — White', text: 'White builds a classical pawn center. Now Black must challenge it.' },
      { label: '2... d5 — Black', text: 'The defining French move — Black challenges the center head-on. Now a central tension exists that will define the game.' },
      { label: '3. e5 — White', text: 'The Advance Variation! White advances the pawn, gaining space and a space advantage but giving Black a clear target: the d4 pawn and the e5 pawn. This is a dynamic and rich variation.' },
      { label: '3... c5 — Black', text: 'Immediate counterattack! Black attacks the base of White\'s pawn chain (d4) right away. This is the most principled response — attack what White advances.' },
      { label: '4. c3 — White', text: 'White supports d4 with c3. This solid move keeps the center intact. White is going for a slow positional game.' },
      { label: '4... Nc6 — Black', text: 'Black develops the knight to c6, increasing pressure on d4 and preparing for further counterplay. The knight on c6 is very active.' },
      { label: '5. Nf3 — White', text: 'White develops the knight, further supporting d4 and preparing to castle. White\'s setup is solid but somewhat passive.' },
      { label: '5... Qb6 — Black', text: 'The queen comes to b6, attacking both d4 and b2. This is an aggressive and effective move — White must be careful with both weaknesses.' },
      { label: '6. a3 — White', text: 'White plays a3, preventing ...Bb4 (which would add pressure to c3) and preparing for queenside expansion. A slow but necessary prophylactic move.' },
      { label: '6... c4 — Black', text: 'Black locks the center with c4, fixing the queenside structure. Now the game becomes about the kingside and the activity of the pieces.' },
      { label: '7. g3 — White', text: 'White prepares to fianchetto the bishop. This is a modern approach — the Bg2 will be a powerful piece behind the pawn chain.' },
      { label: '7... Na5 — Black', text: 'The knight maneuvers to a5, targeting the b3 square and preparing to go to b3 itself (if White allows) or support ...a5 expansion. Typical French maneuvering.' },
      { label: '8. Nbd2 — White', text: 'White develops the knight to d2, preparing Nf1-e3 or h3. From d2, the knight can go to f1 heading to e3 to support the center.' },
      { label: '8... Bd7 — Black', text: 'Black develops the bishop to d7 — not the most glamorous square, but it prepares ...Be8-h5 or ...Bb5 potential. In the French, developing the pieces is the key challenge.' },
      { label: '9. Bg2 — White', text: 'White completes the fianchetto. The Bg2 is a powerful piece behind the pawn chain, supporting the e4-e5 advance and eyeing d5 if it ever opens.' },
      { label: '9... Ne7 — Black', text: 'Black\'s knight heads to f5, a key outpost in the Advance French. The Ne7 prepares Nf5, where it will be a powerful blockader.' },
      { label: '10. O-O — White', text: 'White castles, bringing the king to safety. Now White\'s pieces are all in their ideal positions.' },
      { label: '10... h6 — Black', text: 'Prophylaxis — Black prevents Bg5 (which would pin the Ne7). This quiet move secures the kingside.' },
      { label: '11. Re1 — White', text: 'The rook moves to e1, supporting the e5 pawn and preparing for central action. White is building up on the kingside.' },
      { label: '11... Nf5 — Black', text: 'The knight arrives at f5, Black\'s ideal outpost in the French Advance. From f5, the knight controls e3, g3, d4, and h4 — a fantastic piece! This square is the heart of Black\'s counterplay.' },
      { label: '12. Nf1 — White', text: 'White maneuvers the knight from d2 to f1, heading to e3 to challenge the Nf5 outpost.' },
      { label: '12... Be7 — Black', text: 'Black prepares to castle and solidifies the position. The Be7 defends f6 and prepares to activate. The position is roughly balanced with both sides having clear plans.' }
    ],
    keyIdeas: [
      'Advance Variation: attack d4 with ...c5 right away — that\'s the plan',
      '...Qb6 attacks d4 AND b2 simultaneously — a powerful dual threat',
      'The Nf5 outpost is Black\'s dream square — fight to reach it',
      'White\'s Bg2 fianchetto aims down the long diagonal at Black\'s queenside'
    ]
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defense',
    eco: 'B10',
    category: 'black',
    tagline: 'Solid, free bishop, and strong endgames',
    description: 'The Caro-Kann is Black\'s most solid defense against 1.e4. Like the French, Black prepares ...d5 — but with c6 instead of e6. The key difference: Black\'s light-squared bishop remains free, avoiding the French\'s main weakness. The Classical Variation shown here is Karpov\'s favorite.',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'e6', 'Ne5', 'Bh7', 'Bd3', 'Bxd3', 'Qxd3', 'Nd7', 'Bf4', 'Bb4+', 'c3', 'Be7', 'O-O', 'Ngf6'],
    explanations: [
      { label: '1. e4 — White', text: 'White opens with the King\'s Pawn, claiming the center and preparing rapid development.' },
      { label: '1... c6 — Black', text: 'The Caro-Kann! Black prepares ...d5 using the c-pawn to support it. Unlike the French (1...e6), the light-squared bishop on c8 remains completely free — one of the Caro-Kann\'s main virtues.' },
      { label: '2. d4 — White', text: 'White builds the classical center. Now Black challenges it directly.' },
      { label: '2... d5 — Black', text: 'The Caro-Kann tabiya. Black challenges the center immediately. The c6 pawn supports d5 without blocking the c8 bishop.' },
      { label: '3. Nc3 — White', text: 'White supports e4 with the knight. The Classical Variation — White contests the center aggressively.' },
      { label: '3... dxe4 — Black', text: 'Black captures the e4 pawn. This Classical line exchange gives Black a very solid position and an extra central pawn for a moment.' },
      { label: '4. Nxe4 — White', text: 'White recaptures with the knight, centralizing it powerfully. The knight on e4 is very strong — it controls d6, f6, c5, and g5.' },
      { label: '4... Bf5 — Black', text: 'Activate the bishop immediately! This is the whole point of the Caro-Kann — the light-squared bishop comes out BEFORE the pawn chain locks it in. 4...Bf5 is the most classical and principled response.' },
      { label: '5. Ng3 — White', text: 'White attacks the Bf5 with the knight. The bishop must move. White gains a tempo but the knight on g3 is not as powerful as it was on e4.' },
      { label: '5... Bg6 — Black', text: 'The bishop retreats to g6, a safe and active square. From g6, the bishop is hard to attack and still controls important squares.' },
      { label: '6. h4 — White', text: 'White attacks the Bg6 with a pawn. This aggressive move creates threats — if Black doesn\'t respond, h5 will kick the bishop again.' },
      { label: '6... h6 — Black', text: 'Black stops h5 with h6. Now the bishop on g6 is safe. This pawn move also supports a potential ...g5 advance if needed.' },
      { label: '7. Nf3 — White', text: 'White develops the knight to f3, completing the opening setup. Now the pieces are ready for castling.' },
      { label: '7... e6 — Black', text: 'Black plays e6, supporting d5 (or d4 if there is one) and preparing to develop the f8 bishop. The structure is solid.' },
      { label: '8. Ne5 — White', text: 'White jumps the knight to e5, the powerful central outpost. From e5, the knight attacks Bg6 and creates pressure on f7.' },
      { label: '8... Bh7 — Black', text: 'The bishop retreats to h7, a safe square. From h7, it\'s out of danger and supports Black\'s position quietly.' },
      { label: '9. Bd3 — White', text: 'White develops the bishop to d3, aiming at h7. White is building up an attacking setup with Ne5 and Bd3.' },
      { label: '9... Bxd3 — Black', text: 'Black exchanges the bishops. By taking on d3, Black removes White\'s powerful attacking bishop and slightly relieves the pressure.' },
      { label: '10. Qxd3 — White', text: 'White recaptures with the queen, which is now centrally placed and eyes h7. The queen on d3 is very active.' },
      { label: '10... Nd7 — Black', text: 'Black develops the knight to d7, challenging the Ne5 and preparing to complete development. The knight on d7 supports the center.' },
      { label: '11. Bf4 — White', text: 'White develops the remaining bishop to f4, maintaining piece activity. The bishop on f4 controls e5 (supporting the knight) and d6.' },
      { label: '11... Bb4+ — Black', text: 'Black gives check with the f8 bishop! This forces White to respond and gains a tempo. The Bb4+ is a common Caro-Kann resource.' },
      { label: '12. c3 — White', text: 'White blocks the check with c3. This also supports d4 and prepares to kick the bishop back.' },
      { label: '12... Be7 — Black', text: 'The bishop retreats to e7, where it prepares to castle. Black has completed the opening phase successfully.' },
      { label: '13. O-O — White', text: 'White castles, bringing the king to safety. White\'s position is active and slightly threatening.' },
      { label: '13... Ngf6 — Black', text: 'Black develops the kingside knight to f6, attacking the Ne5 and preparing to castle. The position is roughly equal — Black has a solid structure and active pieces.' }
    ],
    keyIdeas: [
      '4...Bf5 — activate the bishop IMMEDIATELY, before it gets locked in',
      'The Caro-Kann gives solid, healthy pawn structures — great for endgames',
      '...h6 stops h5 and prevents the bishop from being chased further',
      'Classical goal: complete development solidly, then equalize with ...Ngf6 and O-O'
    ]
  },
  {
    id: 'kings-indian',
    name: "King's Indian Defense",
    eco: 'E60',
    category: 'black',
    tagline: "Black's most dynamic weapon against 1.d4",
    description: 'The King\'s Indian is an aggressive, dynamic defense favored by Fischer, Kasparov, and Bronstein. Black allows White to build a large central pawn mass, then attacks it from the flanks. The Classical Variation shown — with ...e5, ...Nc6, d5, ...Ne7 — is the most important and deeply studied line.',
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6', 'd5', 'Ne7', 'Ne1', 'Nd7', 'Nd3', 'f5', 'Bd2', 'Nf6', 'f3', 'c6'],
    explanations: [
      { label: '1. d4 — White', text: 'White opens with the Queen\'s Pawn, aiming for central control and a solid queenside setup.' },
      { label: '1... Nf6 — Black', text: 'Black develops the knight to f6, immediately contesting the e4 square and preparing to fianchetto the kingside bishop.' },
      { label: '2. c4 — White', text: 'White expands, building a large central presence. White is going for a dominant center.' },
      { label: '2... g6 — Black', text: 'The signal! Black prepares to fianchetto the bishop. This is the King\'s Indian — Black allows White the center and attacks from the flanks.' },
      { label: '3. Nc3 — White', text: 'White develops the knight, supporting d4 and controlling e4.' },
      { label: '3... Bg7 — Black', text: 'The King\'s Indian bishop! On g7, this piece becomes enormously powerful when the center opens. Black will castle kingside then launch counterplay.' },
      { label: '4. e4 — White', text: 'White builds the maximum center — two pawns on d4 and e4. Black will now challenge this center from the flanks.' },
      { label: '4... d6 — Black', text: 'Black supports the e5 break and prepares to complete development. The d6 pawn is a key structural element.' },
      { label: '5. Nf3 — White', text: 'White develops the knight, supporting d4 and e4. Natural and strong development.' },
      { label: '5... O-O — Black', text: 'Black castles early, bringing the king to safety. The Bg7 is now protected and the h-file could become a weapon.' },
      { label: '6. Be2 — White', text: 'White develops the bishop to e2, preparing to castle. This is the Classical Variation — solid and principled.' },
      { label: '6... e5 — Black', text: 'The Classical King\'s Indian move! Black challenges the center immediately. This creates the main tabiya: White has d4 and c4, Black has e5. The battle is for d5.' },
      { label: '7. O-O — White', text: 'White castles. Now both sides are castled and the central battle begins in earnest.' },
      { label: '7... Nc6 — Black', text: 'Black develops the knight, supporting e5 and threatening ...Nd4. The knight on c6 is a key piece.' },
      { label: '8. d5 — White', text: 'White closes the center with d5. This is the most principled response — White grabs space and starts a race: White attacks on the queenside, Black attacks on the kingside.' },
      { label: '8... Ne7 — Black', text: 'The knight retreats to e7 — typical King\'s Indian! The knight will reroute to either d7 (supporting f5) or f5 (attacking). This is the start of Black\'s kingside attack plan.' },
      { label: '9. Ne1 — White', text: 'White\'s knight retreats to e1, the first step of White\'s knight maneuver (Ne1-d3-c5 or Ne1-d3-f2-g4-f6). White is preparing queenside action.' },
      { label: '9... Nd7 — Black', text: 'Black\'s knight reroutes to d7, preparing ...f5. The pawn push ...f5 is the heart of Black\'s kingside attack in the Classical King\'s Indian.' },
      { label: '10. Nd3 — White', text: 'White\'s knight comes to d3, an excellent central square. From d3, it supports e5 (if Black plays ...Nxd3) and prepares Nc5 or Nb4.' },
      { label: '10... f5 — Black', text: 'Black launches the kingside attack with f5! This is Black\'s plan — push f5, then f4, and storm the kingside. The Bg7 will become devastating when the center opens.' },
      { label: '11. Bd2 — White', text: 'White develops the bishop to d2, preparing to expand on the queenside with b4-b5. White\'s queenside attack mirrors Black\'s kingside attack.' },
      { label: '11... Nf6 — Black', text: 'The knight returns to f6, heading to f4 or g4 for the attack. Black\'s pieces are aligning for a direct kingside assault.' },
      { label: '12. f3 — White', text: 'White plays f3, solidifying the center and preparing g4 to stop Black\'s f5-f4 advance. White contests the kingside.' },
      { label: '12... c6 — Black', text: 'Black challenges White\'s d5 pawn! The ...c6 break is the other King\'s Indian plan — when f5 isn\'t immediately decisive, Black can open the center with ...c6. A tense double-edged position awaits.' }
    ],
    keyIdeas: [
      'Black allows White\'s big center, then attacks it from the flanks',
      'The Bg7 "Dragon bishop" is Black\'s main weapon — open lines for it',
      'Black\'s plan: ...f5-f4 kingside storm; White\'s plan: b4-b5 queenside push',
      'The race: who breaks through first — Black on the kingside or White on the queenside?'
    ]
  },
  {
    id: 'kings-gambit',
    name: "King's Gambit",
    eco: 'C30',
    category: 'gambit',
    tagline: 'The most romantic gambit in chess history',
    description: 'The King\'s Gambit was the most popular opening for hundreds of years. White sacrifices the f4 pawn to gain a powerful center and open lines for attack. The line shown — Accepted with 3...d5 — is a principled counter to the gambit: Black gives back the pawn to equalize quickly.',
    moves: ['e4', 'e5', 'f4', 'exf4', 'Nf3', 'd5', 'exd5', 'Nf6', 'Bb5+', 'c6', 'dxc6', 'bxc6', 'Bc4', 'Nd5', 'O-O', 'Bd6', 'd4', 'O-O', 'Bxd5', 'cxd5', 'c4', 'dxc4', 'Qa4', 'Be6', 'Qxc4', 'Nc6'],
    explanations: [
      { label: '1. e4 — White', text: 'White opens with the King\'s Pawn, claiming central space and preparing rapid development.' },
      { label: '1... e5 — Black', text: 'Black takes equal central space — the natural and principled response.' },
      { label: '2. f4 — White', text: 'The King\'s Gambit! White sacrifices the f4 pawn to gain center and open the f-file for attack. This was the most popular opening for 200+ years — Morphy, Anderssen, and countless Romantic-era masters loved it.' },
      { label: '2... exf4 — Black', text: 'Black accepts the gambit. 2...exf4 is the King\'s Gambit Accepted — Black takes the pawn and dares White to prove compensation.' },
      { label: '3. Nf3 — White', text: 'White develops the knight, attacks e5 (well, that\'s gone now), and prepares d4. White will try to build a strong center with d4.' },
      { label: '3... d5 — Black', text: 'The counter-gambit! Black offers to return the pawn for quick development and equal footing. 3...d5 is one of the most principled responses to the King\'s Gambit — Black just strikes back in the center.' },
      { label: '4. exd5 — White', text: 'White captures, accepting the pawn trade. Now both sides have open lines and piece activity.' },
      { label: '4... Nf6 — Black', text: 'Black develops the knight, attacks d5 (indirectly), and continues classical development. The Nf6 is always the right piece to develop first.' },
      { label: '5. Bb5+ — White', text: 'White gives check with the bishop! This tempo-gaining move disrupts Black\'s development and creates complications. White hopes to win back the f4 pawn while keeping attacking chances.' },
      { label: '5... c6 — Black', text: 'Black blocks the check with c6. This also attacks the bishop and will open lines after dxc6 bxc6.' },
      { label: '6. dxc6 — White', text: 'White captures on c6, opening the position further. The c-file will open after ...bxc6.' },
      { label: '6... bxc6 — Black', text: 'Black recaptures with the b-pawn, opening the b-file for the rook. Black now has active piece play despite being a pawn down.' },
      { label: '7. Bc4 — White', text: 'White\'s bishop retreats to c4, aiming at f7. Now White threatens Nxd4 ideas and has an active setup.' },
      { label: '7... Nd5 — Black', text: 'The knight jumps to d5, a powerful central square. From d5, it controls many key squares and defends the c-pawn. This is a strong equalizing move.' },
      { label: '8. O-O — White', text: 'White castles, bringing the king to safety. White is hoping to gain compensation for the piece with active play.' },
      { label: '8... Bd6 — Black', text: 'Black develops the bishop to d6, completing the pieces and preparing to castle. Black is catching up in development.' },
      { label: '9. d4 — White', text: 'White builds the center with d4, restoring some central presence and creating pressure on the d5 knight.' },
      { label: '9... O-O — Black', text: 'Black castles! The king is now safe. Black has completed development with an extra pawn — excellent play.' },
      { label: '10. Bxd5 — White', text: 'White exchanges the powerful Nd5. By taking the knight, White activates the c6 pawn as a target and opens lines.' },
      { label: '10... cxd5 — Black', text: 'Black recaptures with the c-pawn, creating a central pawn pair. Black has active central pawns.' },
      { label: '11. c4 — White', text: 'White attacks the d5 pawn, trying to open lines and regain material. The position is sharp and double-edged.' },
      { label: '11... dxc4 — Black', text: 'Black captures, accepting the pawn. Now Black has two extra pawns (f4 and c4) but White has active piece play.' },
      { label: '12. Qa4 — White', text: 'White plays the queen to a4, eyeing the c4 pawn and creating dual threats. White has active compensation for the pawns.' },
      { label: '12... Be6 — Black', text: 'Black defends with Be6, protecting c4 and activating the bishop. Black must be careful — White has real attacking potential.' },
      { label: '13. Qxc4 — White', text: 'White wins back the c4 pawn, regaining material balance. The position is now roughly equal with both sides having active pieces.' },
      { label: '13... Nc6 — Black', text: 'Black completes development with Nc6. The game has become a balanced middlegame — White has regained the pawn, Black has a solid position. A rich struggle awaits.' }
    ],
    keyIdeas: [
      '2...exf4: accept the gambit and challenge White to prove compensation',
      '3...d5: the counter-gambit — give back the pawn to equalize quickly',
      'White gets: open f-file, central pawns; Black gets: extra pawn, solid center',
      'The Immortal Game (Anderssen vs Kieseritsky 1851) was a King\'s Gambit'
    ]
  },
  {
    id: 'evans-gambit',
    name: 'Evans Gambit',
    eco: 'C51',
    category: 'gambit',
    tagline: 'A b-pawn sacrifice for explosive development',
    description: 'The Evans Gambit arises from the Italian Game when White sacrifices the b4 pawn to gain a powerful center and rapid development. It was a favorite of Paul Morphy and was revived by Garry Kasparov in 1995. When it works, White gets fantastic piece activity and attacking chances.',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5', 'd4', 'exd4', 'O-O', 'Nge7', 'cxd4', 'd5', 'exd5', 'Nxd5', 'Nbd2', 'Be6', 'Bxd5', 'Bxd5', 'Re1+', 'Be4', 'Ng5', 'O-O'],
    explanations: [
      { label: '1. e4 — White', text: 'White opens with the King\'s Pawn, claiming the center immediately.' },
      { label: '1... e5 — Black', text: 'The classical symmetrical response — Black takes equal central space.' },
      { label: '2. Nf3 — White', text: 'The knight develops naturally to f3, attacking e5 and preparing to castle.' },
      { label: '2... Nc6 — Black', text: 'Natural development — the knight defends e5 and develops to a strong central square.' },
      { label: '3. Bc4 — White', text: 'The Italian bishop — aiming at f7 and setting up the Evans Gambit. White is entering Italian/Evans territory.' },
      { label: '3... Bc5 — Black', text: 'Black develops symmetrically — the bishop goes to c5, aiming at f2 and mirroring White\'s setup. This is exactly what White wants for the Evans!' },
      { label: '4. b4 — White', text: 'The Evans Gambit! White offers the b4 pawn to deflect the Bc5. The idea: after 4...Bxb4 5.c3 Ba5 6.d4, White has a huge center with d4+e4. Compensation is clear.' },
      { label: '4... Bxb4 — Black', text: 'Black accepts the gambit. Taking the pawn is critical — declining the Evans (4...Bb6) gives White a pleasant Italian Game for free.' },
      { label: '5. c3 — White', text: 'White attacks the bishop and prepares d4. This is the key Evans plan: c3 forces the bishop to move, then d4 builds a huge center.' },
      { label: '5... Ba5 — Black', text: 'The bishop retreats to a5. From a5, it\'s safe but somewhat passive. White will now play d4 and build a powerful center.' },
      { label: '6. d4 — White', text: 'White plays d4! Now White has two central pawns (d4 and e4) and a lead in development. This is the Evans compensation — excellent piece activity for the sacrificed pawn.' },
      { label: '6... exd4 — Black', text: 'Black captures the d4 pawn, accepting the position. Now White recaptures and maintains central pressure.' },
      { label: '7. O-O — White', text: 'White castles rather than recapturing immediately! This is the Compromised Defense — White sacrifices ANOTHER pawn for lead in development and attacking chances. Pure Romantic chess.' },
      { label: '7... Nge7 — Black', text: 'Black develops the knight to e7, defending the center and preparing to consolidate. Black must be careful — White has tremendous compensation.' },
      { label: '8. cxd4 — White', text: 'White recaptures on d4, restoring the pawn count. Now White has d4 and e4 — a powerful center.' },
      { label: '8... d5 — Black', text: 'Black counterattacks with d5! This is the principled response — Black challenges White\'s center and tries to free the position.' },
      { label: '9. exd5 — White', text: 'White captures, opening lines. The position is now sharp and tactical.' },
      { label: '9... Nxd5 — Black', text: 'Black\'s knight takes d5, a powerful central square. The knight on d5 is a strong piece.' },
      { label: '10. Nbd2 — White', text: 'White develops the queenside knight to d2, preparing to reroute pieces. White has excellent piece activity as compensation.' },
      { label: '10... Be6 — Black', text: 'Black develops the bishop to e6, fighting for the central squares and activating pieces. Black must develop quickly to deal with White\'s pressure.' },
      { label: '11. Bxd5 — White', text: 'White exchanges the powerful Nd5. This removes Black\'s best piece and opens lines for White\'s rooks.' },
      { label: '11... Bxd5 — Black', text: 'Black recaptures with the bishop. The position is sharp but approximately balanced.' },
      { label: '12. Re1+ — White', text: 'Check! The rook goes to e1, checking Black\'s king on e8. The entire e-file is open — a dramatic moment showing White\'s piece activity.' },
      { label: '12... Be4 — Black', text: 'Black blocks the check with Be4, defending with the bishop. The bishop on e4 is active and defends the king.' },
      { label: '13. Ng5 — White', text: 'White attacks f7 with the knight! From g5, the knight threatens Nxf7 (the classic Italian fork). White has fantastic piece activity.' },
      { label: '13... O-O — Black', text: 'Black castles, getting the king to safety. After all the complications, Black has managed to castle. The position is dynamically balanced — White has piece activity and pressure, Black has extra material. A complex middlegame battle awaits.' }
    ],
    keyIdeas: [
      'After 4...Bxb4 5.c3 Ba5 6.d4 — White gets a huge center for the pawn',
      'Evans compensation: two central pawns + rapid development + open lines',
      'Kasparov used the Evans vs Anand (1995) for a brilliant win',
      'Key idea: if Black tries to consolidate, White generates attacks on f7'
    ]
  },
  {
    id: 'scotch',
    name: 'Scotch Game',
    eco: 'C45',
    category: 'white',
    tagline: 'Open and active — White fights for the center immediately',
    description: 'The Scotch Game (1.e4 e5 2.Nf3 Nc6 3.d4) was popularized by Garry Kasparov who used it to sidestep the mountains of Ruy López theory. By striking at the center immediately on move 3, White creates open, dynamic positions. After 5.Nxc6 bxc6 6.e5, Black\'s queen goes on a wild journey through the center while White tries to build a powerful pawn structure.',
    moves: ['e4','e5','Nf3','Nc6','d4','exd4','Nxd4','Nf6','Nxc6','bxc6','e5','Qe7','Qe2','Nd5','c4','Nb6','Nc3','Qe6','Qe4','f5','exf6','Qxe4+','Nxe4','gxf6','f4','d6'],
    explanations: [
      { label: '1. e4 — White', text: 'The King\'s Pawn — White stakes a central claim and opens lines for quick piece development.' },
      { label: '1... e5 — Black', text: 'The classical symmetrical response — Black takes equal space in the center.' },
      { label: '2. Nf3 — White', text: 'The knight develops, attacks e5, and prepares to castle.' },
      { label: '2... Nc6 — Black', text: 'The most natural defense to e5, developing the knight to a strong central square.' },
      { label: '3. d4 — White', text: 'The Scotch Game! White immediately challenges Black\'s center rather than building up slowly. This creates an open, dynamic game.' },
      { label: '3... exd4 — Black', text: 'Black accepts the pawn trade, opening the e-file. The resulting open position suits both sides\' active play.' },
      { label: '4. Nxd4 — White', text: 'White recaptures with the knight, establishing it on d4. The knight is well-centralized but can be challenged.' },
      { label: '4... Nf6 — Black', text: 'Black develops the knight and attacks the e4 pawn. This is the most principled response to the Scotch.' },
      { label: '5. Nxc6 — White', text: 'White takes the Nc6, preparing to advance e5 and dislodge Black\'s Nf6. This pawn structure battle is the heart of the Scotch.' },
      { label: '5... bxc6 — Black', text: 'Black recaptures with the b-pawn, creating a half-open b-file. This is the most popular recapture, accepting doubled pawns for active piece play.' },
      { label: '6. e5 — White', text: 'Attacking the Nf6! White gains space and forces Black to deal with the e5 pawn threat.' },
      { label: '6... Qe7 — Black', text: 'Black defends the Nf6 with the queen and prepares to castle queenside. A flexible move that keeps options open.' },
      { label: '7. Qe2 — White', text: 'White\'s queen goes to e2, supporting the e5 pawn and eyeing the e-file. White also connects well with the queenside development.' },
      { label: '7... Nd5 — Black', text: 'The knight retreats to d5, attacking c4 and eyeing the center. From d5, the knight is powerfully placed.' },
      { label: '8. c4 — White', text: 'White challenges the Nd5, pushing it away and grabbing more central space. This gains territory but creates some queenside weaknesses.' },
      { label: '8... Nb6 — Black', text: 'The knight retreats to b6, where it keeps pressure on c4 and prepares ...Ba6, ...Bb7, or ...c5 ideas.' },
      { label: '9. Nc3 — White', text: 'White develops the queenside knight, completing development and supporting the center. Nc3 also eyes d5 for potential knight jumps.' },
      { label: '9... Qe6 — Black', text: 'The queen moves to e6, contesting the center and preparing ...d6 or ...Ba6 ideas. Black\'s queen is active in the center.' },
      { label: '10. Qe4 — White', text: 'White\'s queen goes to e4, pressuring the c6 pawn and controlling the center. White is building up for a kingside push.' },
      { label: '10... f5 — Black', text: 'Black strikes back with f5! This attacks White\'s queen and gains space. It\'s a bold, committal move creating dynamic play.' },
      { label: '11. exf6 — White', text: 'White takes en passant on f6 (or captures f5 square)! The f6-square becomes a target and Black\'s king loses some shelter.' },
      { label: '11... Qxe4+ — Black', text: 'Black takes the e4 queen with check — the queens are exchanged! Both sides simplify into an endgame where Black has the extra pawn from exf6 but White has activity.' },
      { label: '12. Nxe4 — White', text: 'White recaptures. Now the game is queenless — White has the Ne4 centrally placed and will try to target the weak c6 and f6 pawns.' },
      { label: '12... gxf6 — Black', text: 'Black recaptures on f6, creating a passed f-pawn. The position is unbalanced with both sides having structural strengths and weaknesses.' },
      { label: '13. f4 — White', text: 'White advances f4, controlling the center and preparing Be3, Nf6+, or a queenside push. White\'s pieces are very active despite the queen trade.' },
      { label: '13... d6 — Black', text: 'Black challenges White\'s center and tries to free the position. The game is rich and double-edged — both sides have targets to play against.' }
    ],
    keyIdeas: [
      'Scotch key idea: open the center early to fight for activity, not slow maneuvering',
      'After Nxc6 bxc6 e5: the pawn advance creates immediate tension and gains space',
      'Watch the c6 pawn chain — White will target it throughout the game',
      'Kasparov revived the Scotch in the 1990s as a surprise against Karpov'
    ]
  },
  {
    id: 'english',
    name: 'English Opening',
    eco: 'A10',
    category: 'white',
    tagline: 'Flexible hypermodern control from the flank',
    description: 'The English Opening (1.c4) is a hypermodern classic — rather than occupying the center with pawns, White controls it from the flank. It leads to rich positional battles and can transpose into many other openings. The English is favored by positional players who want to sidestep Black\'s prepared systems while building long-term pressure.',
    moves: ['c4','e5','Nc3','Nf6','Nf3','Nc6','g3','d5','cxd5','Nxd5','Bg2','Nb6','O-O','Be7','d3','O-O','Be3','Be6','Rc1','f5','a3','a6','b4','h6','Qd2','Qd7'],
    explanations: [
      { label: '1. c4 — White', text: 'The English Opening! White controls d5 from the flank without immediately occupying the center. This flexible move allows many different setups.' },
      { label: '1... e5 — Black', text: 'The most direct response — Black occupies the center immediately. This leads to the "Reversed Sicilian" structure where Black gets the dynamic Sicilian positions with an extra tempo.' },
      { label: '2. Nc3 — White', text: 'White develops the knight to c3, supporting the c4 pawn and preparing to challenge Black\'s center. Natural development.' },
      { label: '2... Nf6 — Black', text: 'Black develops the knight, fighting for central control. Nf6 is an active, flexible response.' },
      { label: '3. Nf3 — White', text: 'The kingside knight develops, completing White\'s minor piece setup and preparing to fianchetto with g3.' },
      { label: '3... Nc6 — Black', text: 'Black completes the minor piece development, supporting e5. Both sides are building naturally.' },
      { label: '4. g3 — White', text: 'White prepares the fianchetto. The Bg2 will control the long diagonal and provide solid kingside defense. This is the most common setup in the English.' },
      { label: '4... d5 — Black', text: 'Black strikes back in the center! This is a critical move — Black challenges White\'s space advantage. The tension must be resolved.' },
      { label: '5. cxd5 — White', text: 'White takes on d5, opening the c-file and the position. The resulting isolated pawn positions favor active piece play.' },
      { label: '5... Nxd5 — Black', text: 'Black recaptures with the knight, centralizing it on d5. This is the most active recapture.' },
      { label: '6. Bg2 — White', text: 'The bishop arrives at g2, completing the fianchetto. From g2, the bishop controls the long a1-h8 diagonal and supports the center.' },
      { label: '6... Nb6 — Black', text: 'The knight retreats to b6, avoiding exchanges and going to a safe square where it eyeing c4 and d5.' },
      { label: '7. O-O — White', text: 'White castles, bringing the king to safety. The fianchettoed bishop makes the kingside very solid.' },
      { label: '7... Be7 — Black', text: 'Black develops the bishop, preparing to castle. Be7 is a solid, classical development.' },
      { label: '8. d3 — White', text: 'White plays d3, supporting the center and preparing to develop the queen\'s bishop. The d3 pawn solidifies White\'s structure.' },
      { label: '8... O-O — Black', text: 'Black castles, completing basic development. Now the strategic battle begins — Black will try to use the e5 pawn as a strength.' },
      { label: '9. Be3 — White', text: 'The queen\'s bishop develops to e3, where it supports the center and prepares queenside activity. White is building up slowly but effectively.' },
      { label: '9... Be6 — Black', text: 'Black\'s bishop develops to e6, contesting the long diagonal and fighting for the d5 square. Solid and natural.' },
      { label: '10. Rc1 — White', text: 'The rook goes straight to the half-open c-file, where it eyes c7 and supports play on the queenside. This is a Sicilian plan with colors reversed: White attacks on the queenside, where the extra tempo counts.' },
      { label: '10... f5 — Black', text: 'Black grabs kingside space with f5, the reversed-Dragon plan. The e5 and f5 pawns control the center, take e4 away from White\'s knight, and prepare ...f4 to hit the bishop on e3.' },
      { label: '11. a3 — White', text: 'Prophylaxis and preparation in one move. a3 takes b4 away from the c6 knight and prepares b4, gaining queenside space with the plan b4-b5 to drive the Nc6 away from the center.' },
      { label: '11... a6 — Black', text: 'Black stops b5 in advance, so the knight on c6 cannot be chased away from the center. Small moves like these are typical of positional English games.' },
      { label: '12. b4 — White', text: 'White gains space on the queenside. The b4 pawn covers c5, where the e3-bishop can go to trade off Black\'s e7-bishop, an important defender of the dark squares.' },
      { label: '12... h6 — Black', text: 'A quiet but useful move. h6 takes g5 away from White\'s knight, so Ng5 can no longer harass the bishop on e6, and gives the black king a little air.' },
      { label: '13. Qd2 — White', text: 'The queen steps up to d2, connecting the rooks. It also lines up with the Be3 on the c1-h6 diagonal against the h6 pawn, and Rfd1 or Bc5 can follow.' },
      { label: '13... Qd7 — Black', text: 'Black connects the rooks too, ready to bring one to d8. Both sides have finished developing: White will press on the queenside with Bc5, Na4 or b5, while Black plays in the center and on the kingside. A rich, balanced middlegame lies ahead.' }
    ],
    keyIdeas: [
      'English fianchetto: g3 + Bg2 creates long-term diagonal pressure and solid kingside',
      'Typical plan: Bg2, O-O, d3, Be3, then Rc1, a3 and b4 — a Sicilian queenside attack with colors reversed',
      'Watch for Black\'s ...Nd4 outpost — it can be very powerful in these structures',
      'The English often transposes into Queen\'s Gambit or King\'s Indian structures'
    ]
  },
  {
    id: 'reti',
    name: 'Réti Opening',
    eco: 'A05',
    category: 'white',
    tagline: 'Hypermodern king\'s knight — control without occupation',
    description: 'Named after Czech grandmaster Richard Réti, this hypermodern opening starts with 1.Nf3 rather than a pawn. White delays central pawn occupation, instead controlling the center from the flanks with knights and bishops. The Réti is extremely flexible and can transpose into many different structures. It was revolutionary in the 1920s and remains popular today.',
    moves: ['Nf3','d5','g3','Nf6','Bg2','c6','O-O','Bf5','d3','e6','Nbd2','h6','Qe1','Be7','e4','dxe4','dxe4','Bg4','h3','Bxf3','Bxf3','Nbd7','e5','Nd5','Qe2','Qc7','Re1','O-O','a4','Rfd8'],
    explanations: [
      { label: '1. Nf3 — White', text: 'The Réti! White develops the knight without committing to a pawn center. This delays revealing White\'s strategy and keeps maximum flexibility.' },
      { label: '1... d5 — Black', text: 'Black takes central space immediately. A principled response — Black occupies the center while White has not yet done so.' },
      { label: '2. g3 — White', text: 'White prepares the fianchetto with Bg2. This is the "pure Réti" — White will control d5 from afar with the bishop rather than with pawns.' },
      { label: '2... Nf6 — Black', text: 'Black develops the knight, contesting the center. A natural, flexible response.' },
      { label: '3. Bg2 — White', text: 'The Réti bishop arrives at g2, pointing at Black\'s queenside and center. This bishop is a powerful long-range weapon.' },
      { label: '3... c6 — Black', text: 'Black solidifies d5 with c6 — the Slav-like setup. This ensures the d5 pawn is well-supported and creates a solid structure.' },
      { label: '4. O-O — White', text: 'White castles quickly, getting the king safe before deciding on the pawn structure. The Réti often involves very flexible development before committing.' },
      { label: '4... Bf5 — Black', text: 'Black develops the bishop to f5 — an active square outside the pawn chain. This is the London System setup from the Black side.' },
      { label: '5. d3 — White', text: 'White plays d3 rather than d4, supporting the center modestly. This is the hypermodern approach — avoid locking in the structure too early.' },
      { label: '5... e6 — Black', text: 'Black solidifies further with e6. The pawn structure is solid but the light-squared bishop is now hemmed in.' },
      { label: '6. Nbd2 — White', text: 'White\'s queenside knight develops to d2. From d2, it can go to f1 or b3, and supports the center.' },
      { label: '6... h6 — Black', text: 'A prophylactic move — Black prevents Ng5 ideas and secures the bishop on f5. Typical in these solid setups.' },
      { label: '7. Qe1 — White', text: 'White\'s queen moves to e1, preparing e4. This mysterious queen move is a key Réti idea — the queen will support the e4 advance.' },
      { label: '7... Be7 — Black', text: 'Black develops the dark-squared bishop to e7, preparing to castle. Black\'s position is solid and complete.' },
      { label: '8. e4 — White', text: 'The central break! White strikes in the center, using the Qe1-Nbd2 setup to support this advance. The position opens up.' },
      { label: '8... dxe4 — Black', text: 'Black trades pawns in the center, opening the position. This is principled — Black relieves central tension.' },
      { label: '9. dxe4 — White', text: 'White recaptures, now with a pawn on e4 giving space advantage. The position is open and dynamic.' },
      { label: '9... Bg4 — Black', text: 'Black\'s bishop develops to g4, pinning the Nf3 knight. This creates immediate tactical pressure and fights for the initiative.' },
      { label: '10. h3 — White', text: 'White asks the bishop to declare its intentions. This typical prophylactic move tests Black — exchange the bishop or retreat?' },
      { label: '10... Bxf3 — Black', text: 'Black exchanges the bishop for the knight. This gives White the bishop pair but eliminates the Nf3 and potentially weakens White\'s kingside.' },
      { label: '11. Bxf3 — White', text: 'White recaptures with the Bg2, now on f3. The bishop pair is a long-term advantage, and White controls the center.' },
      { label: '11... Nbd7 — Black', text: 'Black develops the queenside knight, completing development. From d7, it can go to b6, c5, or e5.' },
      { label: '12. e5 — White', text: 'White advances e5, gaining central space and attacking the Nf6. This pawn advance is the Réti\'s typical aggressive central action.' },
      { label: '12... Nd5 — Black', text: 'The Nf6 retreats to d5 — a powerful central outpost! From d5, the knight controls many important squares.' },
      { label: '13. Qe2 — White', text: 'The queen steps to e2. It still guards the e5 pawn, and it frees e1 for the rook. The e5 wedge is White\'s main asset: it takes f6 away from Black\'s knights and gives White more space.' },
      { label: '13... Qc7 — Black', text: 'Black adds a second attacker to e5, joining the knight on d7. The pawn is the target of Black\'s whole setup: if it falls, White\'s space advantage goes with it.' },
      { label: '14. Re1 — White', text: 'The rook takes over e1 and lines up behind the queen, so e5 is now defended twice. Black\'s pressure is held, and the bishop pair can wait for the position to open.' },
      { label: '14... O-O — Black', text: 'Black castles and completes development. The king is safe on g8, and the knight on d5 is a strong central piece.' },
      { label: '15. a4 — White', text: 'A useful queenside move: a4 stops ...b5, which would gain space and take c4 away from White\'s knight. Nc4 can follow, eyeing the d6 square that the e5 pawn supports.' },
      { label: '15... Rfd8 — Black', text: 'Black puts a rook on the d-file, ready to contest d6 and the open file. The game has reached a balanced maneuvering middlegame: White has space and the bishop pair, Black has a solid position and a fine knight on d5.' }
    ],
    keyIdeas: [
      'Réti hypermodernism: control the center from afar with Nf3 + Bg2 rather than occupying it',
      'The Qe1 + e4 maneuver is the key attacking plan — often surprising opponents',
      'Bishop pair in open positions: after Bxf3, White\'s two bishops are long-term assets',
      'Can transpose into King\'s Indian Attack (KIA) or Queen\'s Gambit structures'
    ]
  },
  {
    id: 'sicilian-dragon',
    name: 'Sicilian Dragon',
    eco: 'B70',
    category: 'black',
    tagline: 'Fire on the board — Black\'s most aggressive Sicilian',
    description: 'The Dragon is the most feared and exciting Sicilian variation. Black fianchettoes the kingside bishop on g7, creating a "dragon" formation of pawns, and unleashes it down the long diagonal. Both sides attack on opposite wings — White goes after the Black king with the Yugoslav Attack (f3 + g4 + h4), while Black counterattacks down the c-file. Games are razor-sharp and beautiful.',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','g6','Be3','Bg7','f3','O-O','Qd2','Nc6','Bc4','Bd7','O-O-O','Rc8','Bb3','Ne5','h4','Nc4','Bxc4','Rxc4'],
    explanations: [
      { label: '1. e4 — White', text: 'The King\'s Pawn — the starting move for the Open Sicilian, the most analyzed opening in chess history.' },
      { label: '1... c5 — Black', text: 'The Sicilian Defense! Black attacks d4 from the flank. This asymmetrical response creates rich, imbalanced positions where both sides can fight for the win.' },
      { label: '2. Nf3 — White', text: 'The most common continuation — White will typically follow with d4 to open the center.' },
      { label: '2... d6 — Black', text: 'Black prepares to develop the dark-squared bishop (it will go to g7 in the Dragon) and supports the e5 square.' },
      { label: '3. d4 — White', text: 'The Open Sicilian! White strikes in the center, and after cxd4 Nxd4, the game becomes incredibly complex.' },
      { label: '3... cxd4 — Black', text: 'Black trades the c-pawn for White\'s d-pawn — a Sicilian hallmark. Black gets a half-open c-file for later counterplay.' },
      { label: '4. Nxd4 — White', text: 'White recaptures with the knight. The Nd4 is centralized but can be challenged by Black pieces.' },
      { label: '4... Nf6 — Black', text: 'Black develops the knight and attacks e4 — immediately pressuring White\'s center.' },
      { label: '5. Nc3 — White', text: 'White defends e4 and develops the queenside knight. White\'s setup is now pointing toward f5, a key attacking square.' },
      { label: '5... g6 — Black', text: 'The Dragon move! Black prepares the fianchetto with ...Bg7. The bishop on g7 will be a monster on the long diagonal.' },
      { label: '6. Be3 — White', text: 'White prepares the Yugoslav Attack with Be3, f3, Qd2, O-O-O. This is White\'s most aggressive system against the Dragon.' },
      { label: '6... Bg7 — Black', text: 'The Dragon bishop arrives at g7. This bishop is Black\'s most powerful piece — from g7 it x-rays all the way to a1 and supports the counterattack.' },
      { label: '7. f3 — White', text: 'A key Yugoslav Attack move! f3 supports e4, prepares g4-g5 kingside assault, and stops ...Ng4. White is preparing a pawn storm.' },
      { label: '7... O-O — Black', text: 'Black castles kingside — into the teeth of White\'s coming g4-g5-h5 pawn storm. Black relies on the counterattack down the c-file.' },
      { label: '8. Qd2 — White', text: 'The queen comes to d2, completing the Yugoslav Attack setup. White prepares O-O-O and then h4-h5-g4 to attack Black\'s king.' },
      { label: '8... Nc6 — Black', text: 'Black develops the knight, attacking the Nd4 and preparing ...d5 or ...Ne5. The knight on c6 is a key piece in the Dragon counterplay.' },
      { label: '9. Bc4 — White', text: 'The bishop to c4 — White eyes d5 and f7. This aggressive bishop placement adds to White\'s attacking forces.' },
      { label: '9... Bd7 — Black', text: 'Black develops the bishop to d7, preparing to double rooks on the c-file (...Rc8) and planning ...Ne5 to challenge the Bc4.' },
      { label: '10. O-O-O — White', text: 'White castles queenside! The kings are now on opposite wings — both sides will attack. This creates the ultimate double-edged Dragon fight.' },
      { label: '10... Rc8 — Black', text: 'Black\'s rook goes to c8 — the c-file is Black\'s main attacking route. The rook will support ...Rxc4 or ...c5-c4 advances.' },
      { label: '11. Bb3 — White', text: 'The bishop retreats to b3, where it\'s safe from ...Ne5 attacks and still eyes d5. This is a key regrouping move in the Yugoslav.' },
      { label: '11... Ne5 — Black', text: 'The knight jumps to e5 — an excellent central outpost. From e5, it attacks the Bb3 and supports ...Nc4 ideas.' },
      { label: '12. h4 — White', text: 'White launches the kingside pawn storm! h4 is the beginning of h4-h5-g4-g5 — a classic Dragon attack on Black\'s king.' },
      { label: '12... Nc4 — Black', text: 'Black\'s Ne5 jumps to c4, attacking the Bb3 and preparing to trade it off. This removes a key attacking piece from White\'s setup.' },
      { label: '13. Bxc4 — White', text: 'White exchanges the bishop for the knight rather than retreating. The position simplifies somewhat, but White still has the kingside attack.' },
      { label: '13... Rxc4 — Black', text: 'Black recaptures with the rook, activating it powerfully on the c-file. Black is ready to double rooks and create devastating pressure. The Dragon counterattack is in full swing.' }
    ],
    keyIdeas: [
      'Dragon key idea: Black\'s Bg7 and open c-file create massive counterplay against White\'s queenside',
      'Yugoslav Attack: White plays f3, Be3, Qd2, O-O-O then storms with h4-h5-g4-g5',
      'Both sides attack on opposite wings — who gets there first? Pure chess warfare',
      'Critical: Black must counterattack; passive play invites White\'s overwhelming kingside assault'
    ]
  },
  {
    id: 'sicilian-schev',
    name: 'Sicilian Scheveningen',
    eco: 'B80',
    category: 'black',
    tagline: 'The flexible Sicilian — Black builds a solid formation',
    description: 'The Scheveningen Variation is one of the most respected Sicilian systems. Named after the Dutch beach resort where it was first played systematically, Black builds a solid structure with pawns on d6 and e6, keeping maximum flexibility. Kasparov and Fischer both used it. White typically attacks on the kingside while Black counters on the queenside and center.',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','e6','Be2','a6','O-O','Be7','f4','Qc7','Kh1','O-O','Be3','Nc6','Qe1','Nxd4','Bxd4','b5','a3','Bb7'],
    explanations: [
      { label: '1. e4 — White', text: 'The Open Game — White stakes out the center and begins what will become a complex battle.' },
      { label: '1... c5 — Black', text: 'The Sicilian Defense. Black fights for the center from the flank, creating rich asymmetrical positions.' },
      { label: '2. Nf3 — White', text: 'Natural development heading toward d4.' },
      { label: '2... d6 — Black', text: 'Black prepares the Scheveningen setup — the d6 pawn will support e5 and give the knight on f6 room to maneuver.' },
      { label: '3. d4 — White', text: 'The Open Sicilian thrust — White opens the center and takes control of d4.' },
      { label: '3... cxd4 — Black', text: 'Black trades pawns, gaining the half-open c-file for future counterplay.' },
      { label: '4. Nxd4 — White', text: 'The knight takes d4, centralizing and setting up the tension.' },
      { label: '4... Nf6 — Black', text: 'The knight develops and attacks e4, forcing White to defend or advance.' },
      { label: '5. Nc3 — White', text: 'Development and defense of e4 — White is ready for an attacking setup.' },
      { label: '5... e6 — Black', text: 'The defining Scheveningen move! Black plays e6 rather than g6, creating a solid "small center" with d6+e6 pawns. The light-squared bishop is temporarily locked in, but the structure is very solid.' },
      { label: '6. Be2 — White', text: 'White chooses the Classical Scheveningen setup with Be2, avoiding the sharper Keres Attack. Be2 leads to rich strategic play.' },
      { label: '6... a6 — Black', text: 'The Najdorf move order! a6 prevents Bb5+ and prepares queenside expansion with ...b5. This flexible move is essential in many Sicilian systems.' },
      { label: '7. O-O — White', text: 'White castles, bringing the king to safety before launching the f4-f5 pawn storm.' },
      { label: '7... Be7 — Black', text: 'Black develops the bishop, preparing to castle. Be7 is the solid, classical approach in the Scheveningen.' },
      { label: '8. f4 — White', text: 'The English Attack begins! f4 prepares f5, aiming to attack the kingside. White will follow up with f5 to break open Black\'s kingside pawn structure.' },
      { label: '8... Qc7 — Black', text: 'The queen centralizes to c7, preparing ...O-O and supporting the c-file counterplay. Qc7 is a typical Sicilian queen move connecting rooks.' },
      { label: '9. Kh1 — White', text: 'A prophylactic king move — White gets the king off the g1-a7 diagonal before castling queenside or continuing the f-file attack.' },
      { label: '9... O-O — Black', text: 'Black castles — the king goes to safety before White can launch g4-g5-f5.' },
      { label: '10. Be3 — White', text: 'The bishop develops to e3, supporting d4 and preparing Qe1-Qg3 attacking ideas. The position is full of tension.' },
      { label: '10... Nc6 — Black', text: 'Black develops the queenside knight, attacking the Nd4. This forces White to decide what to do with the centralized knight.' },
      { label: '11. Qe1 — White', text: 'A key prophylactic move — White\'s queen goes to e1 to support g4-f5 ideas and avoids potential knight forks on d4.' },
      { label: '11... Nxd4 — Black', text: 'Black captures on d4, simplifying the position. Trading off White\'s centralized knight is a common Sicilian plan.' },
      { label: '12. Bxd4 — White', text: 'White recaptures with the bishop, maintaining a strong presence on d4 and controlling the long diagonal.' },
      { label: '12... b5 — Black', text: 'Black advances b5 — the queenside counterattack begins! This is the typical Sicilian counterplay: Black attacks on the queenside while White storms on the kingside.' },
      { label: '13. a3 — White', text: 'White prevents ...b4 which would attack the Nc3. Small preventive moves like this are crucial in tight Sicilian battles.' },
      { label: '13... Bb7 — Black', text: 'The bishop arrives at b7, pointing at the center and the White king area along the long diagonal. Black\'s position is solid with good counterplay. A rich strategic battle lies ahead.' }
    ],
    keyIdeas: [
      'Scheveningen structure: d6+e6 pawns = solid but flexible; bishop on c8 can develop both ways',
      'White\'s plan: f4-f5 kingside attack, or Keres Attack (e5 early), or positional English Attack',
      'Black\'s plan: ...b5-b4 queenside counterattack + ...d5 central break at the right moment',
      'The "hedgehog" quality: Black looks passive but springs to life — never underestimate it'
    ]
  },
  {
    id: 'nimzo-indian',
    name: 'Nimzo-Indian Defense',
    eco: 'E20',
    category: 'black',
    tagline: 'Pin and break — Nimzowitsch\'s revolutionary hypermodern weapon',
    description: 'The Nimzo-Indian (1.d4 Nf6 2.c4 e6 3.Nc3 Bb4) is one of the most respected defenses in chess. Black immediately pins White\'s Nc3 with the bishop, preventing e4 and creating long-term structural pressure. The key question: will Black\'s bishop pair disadvantage or White\'s doubled pawns prove more important? Kasparov, Fischer, and countless world champions played this opening.',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','e3','O-O','Bd3','d5','Nf3','c5','O-O','Nc6','a3','Bxc3','bxc3','dxc4','Bxc4','Qc7','Bd3','e5','dxe5','Nxe5','Nxe5','Qxe5'],
    explanations: [
      { label: '1. d4 — White', text: 'The Queen\'s Pawn — White opens with d4, leading to strategic battles quite different from the open 1.e4 games.' },
      { label: '1... Nf6 — Black', text: 'Black\'s most flexible response — the knight develops to f6, fighting for the center and keeping all options open.' },
      { label: '2. c4 — White', text: 'White grabs space with c4, extending the center. This leads to the Queen\'s Gambit complex or Indian Defenses.' },
      { label: '2... e6 — Black', text: 'Black prepares either the Queen\'s Gambit (with ...d5) or Nimzo-Indian (with ...Bb4). Flexible and solid.' },
      { label: '3. Nc3 — White', text: 'White\'s knight develops to c3, preparing e4 and supporting d4. This invites the Nimzo-Indian.' },
      { label: '3... Bb4 — Black', text: 'The Nimzo-Indian! The bishop pins the Nc3, preventing e4 and creating immediate imbalance. This is one of the most principled moves in chess.' },
      { label: '4. e3 — White', text: 'The Classical Variation — solid and reliable. White unpins the knight (the bishop no longer threatens to take c3 effectively after e3).' },
      { label: '4... O-O — Black', text: 'Black castles early, getting the king to safety before the strategic complications begin.' },
      { label: '5. Bd3 — White', text: 'White develops the bishop to d3, eyeing h7 and preparing for a kingside attack. Bd3 is active and aggressive.' },
      { label: '5... d5 — Black', text: 'Black claims central space with d5, challenging White\'s c4 pawn. This is the most principled response in the Classical Nimzo.' },
      { label: '6. Nf3 — White', text: 'Natural development — the knight develops and prepares to castle.' },
      { label: '6... c5 — Black', text: 'Black attacks d4! This central break is the key counterplay in the Nimzo-Indian — Black challenges White\'s pawn center.' },
      { label: '7. O-O — White', text: 'White castles, getting the king safe before the center tension resolves.' },
      { label: '7... Nc6 — Black', text: 'The queenside knight develops, increasing pressure on d4 and supporting the c5 break.' },
      { label: '8. a3 — White', text: 'White tests the bishop — a3 forces Black to decide between retreating or exchanging on c3.' },
      { label: '8... Bxc3 — Black', text: 'Black exchanges the bishop for the knight! This gives White doubled c-pawns but eliminates the powerful Nc3 and gives Black the bishop pair temporarily.' },
      { label: '9. bxc3 — White', text: 'White recaptures with the b-pawn, creating doubled c-pawns (c3 and c4). This weakens White\'s queenside but opens the b-file.' },
      { label: '9... dxc4 — Black', text: 'Black takes the c4 pawn! After Bxc4, Black exchanges the bishop, and the structure clarifies.' },
      { label: '10. Bxc4 — White', text: 'White recaptures with the bishop. Now White has a bishop pair and semi-open b-file, while Black has a solid structure with no weaknesses.' },
      { label: '10... Qc7 — Black', text: 'The queen comes to c7, eyeing the e5 break and preparing to contest the center. Black is ready to equalize.' },
      { label: '11. Bd3 — White', text: 'The bishop retreats to d3, maintaining pressure on h7 and supporting potential e4 advances.' },
      { label: '11... e5 — Black', text: 'Black\'s central break! ...e5 challenges White\'s d4 pawn, opening the position and activating Black\'s pieces.' },
      { label: '12. dxe5 — White', text: 'White captures on e5, opening the d-file. Now both sides must play precisely.' },
      { label: '12... Nxe5 — Black', text: 'The Nc6 takes on e5, centralizing powerfully. The knight on e5 is a magnificent outpost — well-protected and very active.' },
      { label: '13. Nxe5 — White', text: 'White exchanges the centralized knight. After Qxe5, Black has a very active queen and piece play.' },
      { label: '13... Qxe5 — Black', text: 'Black recaptures with the queen! From e5, the queen is extremely active — threatening multiple ideas. Black has fully equalized and has excellent counterplay in this Nimzo-Indian structure.' }
    ],
    keyIdeas: [
      'The Nimzo pin: Bb4 prevents White\'s e4 immediately — Black buys time for development',
      'Structural battle: Black creates doubled c-pawns for White; White gets the bishop pair',
      '...e5 break: the key central strike that Black always eyes in the Nimzo-Indian',
      'Kasparov considered the Nimzo-Indian the "most correct" defense to 1.d4'
    ]
  },
  {
    id: 'grunfeld',
    name: 'Grünfeld Defense',
    eco: 'D70',
    category: 'black',
    tagline: 'Give White the center — then destroy it',
    description: 'The Grünfeld Defense is one of the most theoretically sharp and intellectually exciting openings in chess. Black invites White to build a massive pawn center (d4+e4) then systematically undermines it with ...c5, ...cxd4, and the powerful Bg7 bishop. Bobby Fischer called it "the hypermodern paradox." Modern computers have proven it completely sound — Black was right all along!',
    moves: ['d4','Nf6','c4','g6','Nc3','d5','cxd5','Nxd5','e4','Nxc3','bxc3','Bg7','Bc4','c5','Ne2','Nc6','Be3','O-O','O-O','cxd4','cxd4','Bg4','f3','Na5','Bd3','Be6'],
    explanations: [
      { label: '1. d4 — White', text: 'The Queen\'s Pawn opening — White occupies the center with d4, starting a strategic battle.' },
      { label: '1... Nf6 — Black', text: 'Black\'s flexible response, keeping all Indian Defense options open.' },
      { label: '2. c4 — White', text: 'White extends the center grab with c4. Together with d4, this builds a powerful central pawn duo.' },
      { label: '2... g6 — Black', text: 'Black prepares the fianchetto — the Bg7 will be the weapon that targets White\'s entire center.' },
      { label: '3. Nc3 — White', text: 'White develops the knight to c3, supporting d4 and preparing e4.' },
      { label: '3... d5 — Black', text: 'The Grünfeld move! Black challenges the center directly rather than building a flank attack. This leads to the sharpest positions.' },
      { label: '4. cxd5 — White', text: 'White captures on d5, building toward the massive center that the Grünfeld invites.' },
      { label: '4... Nxd5 — Black', text: 'Black recaptures with the knight, attacking the Nc3. The exchange on c3 is coming, giving White the center but opening lines for the Bg7.' },
      { label: '5. e4 — White', text: 'White builds the "ideal" pawn center with e4+d4! This is exactly what White wants — a huge space advantage. But Black has a plan to destroy it.' },
      { label: '5... Nxc3 — Black', text: 'Black trades the knight for the Nc3, which forces White to recapture and gives the Bg7 a clear diagonal toward d4.' },
      { label: '6. bxc3 — White', text: 'White recaptures with the b-pawn. Now White has pawns on c3, d4, and e4 — a imposing center. But those are targets, not strengths!' },
      { label: '6... Bg7 — Black', text: 'The Dragon bishop arrives at g7, immediately pressuring the entire long diagonal. This bishop is the star of the Grünfeld — it x-rays d4 from g7.' },
      { label: '7. Bc4 — White', text: 'White develops the bishop aggressively to c4, eyeing f7 and supporting the center. White\'s position looks imposing.' },
      { label: '7... c5 — Black', text: 'Black strikes at the center with c5! This is the key Grünfeld counter — attacking d4 and opening lines for Black\'s pieces.' },
      { label: '8. Ne2 — White', text: 'The knight retreats to e2, getting out of the way of potential ...Bg4 pins and preparing to support the center.' },
      { label: '8... Nc6 — Black', text: 'The knight develops to c6, increasing pressure on d4 and threatening ...cxd4 followed by ...Qa5.' },
      { label: '9. Be3 — White', text: 'White develops the bishop to e3, supporting d4 and preparing for the strategic battle over the center.' },
      { label: '9... O-O — Black', text: 'Black castles, getting the king safe. The Bg7 becomes fully active now that the king has moved.' },
      { label: '10. O-O — White', text: 'White castles as well. Now both sides are fully developed — the strategic fight over d4 begins in earnest.' },
      { label: '10... cxd4 — Black', text: 'Black captures on d4, forcing White to deal with the recapture. This is a key tension-releasing move.' },
      { label: '11. cxd4 — White', text: 'White recaptures with the c-pawn, maintaining the center. The d4 pawn is now potentially isolated but very strong.' },
      { label: '11... Bg4 — Black', text: 'Black\'s other bishop develops to g4, pinning the Ne2 and adding pressure. Black is fighting hard against the center.' },
      { label: '12. f3 — White', text: 'White breaks the pin with f3. This solidifies the center and kicks the bishop, but slightly weakens the kingside.' },
      { label: '12... Na5 — Black', text: 'The knight leaps to a5, attacking the Bc4. Black will win the bishop pair or force another concession from White.' },
      { label: '13. Bd3 — White', text: 'The bishop retreats to d3, maintaining pressure on h7. White is keeping the center while Black has active piece play.' },
      { label: '13... Be6 — Black', text: 'Black\'s bishop develops to e6, contesting the center and fighting for the d5 outpost. The Grünfeld creates a rich strategic middlegame where both sides have genuine winning chances.' }
    ],
    keyIdeas: [
      'Grünfeld paradox: give White the huge center (d4+e4), then destroy it with ...c5 + Bg7',
      'The Bg7 dragon: once Black castles, this bishop becomes a monster — it targets d4 constantly',
      'Black\'s goal: eliminate d4 pawn or make it isolated (blockade it), then exploit the weakness',
      'Used by Kasparov, Spassky, Fischer — proof that the counterattack can beat the center'
    ]
  },
  {
    "id": "slav",
    "name": "Slav Defense",
    "eco": "D10",
    "category": "black",
    "tagline": "Solid and active — the most popular QGD variation",
    "description": "The Slav Defense is one of Black's most popular responses to the Queen's Gambit. By playing 2...c6 (instead of 2...e6), Black supports d5 while keeping the light-squared bishop free to develop to f5 or g4 — unlike in the QGD proper. The line shown is the Dutch Variation (5.a4 Bf5 6.e3): White regains the c4 pawn and pushes e4-e5, and Black answers with a strong knight on d5, a bishop trade and counterplay on the open c-file. The Slav is solid yet active, with excellent structural properties.",
    "moves": [
      "d4",
      "d5",
      "c4",
      "c6",
      "Nf3",
      "Nf6",
      "Nc3",
      "dxc4",
      "a4",
      "Bf5",
      "e3",
      "e6",
      "Bxc4",
      "Bb4",
      "O-O",
      "O-O",
      "Qe2",
      "Nbd7",
      "e4",
      "Bg6",
      "Bd3",
      "Bh5",
      "e5",
      "Nd5",
      "Nxd5",
      "cxd5",
      "Qe3",
      "Re8",
      "Ne1",
      "Bg6",
      "Bxg6",
      "hxg6",
      "Nd3",
      "Be7"
    ],
    "explanations": [
      {
        "label": "1. d4 — White",
        "text": "The Queen's Pawn — White builds a central presence and starts a strategic battle."
      },
      {
        "label": "1... d5 — Black",
        "text": "The classical response — Black takes equal central space."
      },
      {
        "label": "2. c4 — White",
        "text": "The Queen's Gambit! White offers to trade the c-pawn for central dominance."
      },
      {
        "label": "2... c6 — Black",
        "text": "The Slav Defense! Rather than declining with 2...e6 (QGD), Black supports d5 with c6. The crucial advantage: the Bc8 can now develop to f5 or g4 without being locked in."
      },
      {
        "label": "3. Nf3 — White",
        "text": "Natural development — White prepares Nc3 and avoids giving Black easy queenside counterplay immediately."
      },
      {
        "label": "3... Nf6 — Black",
        "text": "The knight develops, fighting for the center and preparing to castle."
      },
      {
        "label": "4. Nc3 — White",
        "text": "White develops the queenside knight, now threatening 5.cxd5 followed by 6.e4."
      },
      {
        "label": "4... dxc4 — Black",
        "text": "Black takes the gambit pawn! This is the accepted Slav. Black will try to hold c4 temporarily while White tries to regain it."
      },
      {
        "label": "5. a4 — White",
        "text": "White plays a4 to prevent ...b5 which would defend the extra c-pawn. This gives White queenside space but weakens b4."
      },
      {
        "label": "5... Bf5 — Black",
        "text": "The bishop develops to f5! This is the key Slav advantage over the QGD — the bishop is active outside the pawn chain. Black is ready to develop freely."
      },
      {
        "label": "6. e3 — White",
        "text": "White solidifies the center with e3. This will allow Bxc4 to regain the pawn while keeping the position solid."
      },
      {
        "label": "6... e6 — Black",
        "text": "Black finishes development with e6, supporting the center and preparing to castle."
      },
      {
        "label": "7. Bxc4 — White",
        "text": "White recaptures the gambited pawn. Now White has two bishops and central control, while Black has a solid structure."
      },
      {
        "label": "7... Bb4 — Black",
        "text": "Black pins the Nc3, echoing the Nimzo-Indian! This creates immediate tactical pressure on White's knight and d4."
      },
      {
        "label": "8. O-O — White",
        "text": "White castles, getting the king safe and avoiding the pin complications for now."
      },
      {
        "label": "8... O-O — Black",
        "text": "Black castles as well — both kings are safe. The real strategic battle begins."
      },
      {
        "label": "9. Qe2 — White",
        "text": "The queen comes to e2, supporting e4 and preparing to fight for central space. White wants to play e4 soon."
      },
      {
        "label": "9... Nbd7 — Black",
        "text": "The queenside knight develops to d7, where it supports the center and prepares ...e5 breaks."
      },
      {
        "label": "10. e4 — White",
        "text": "White advances e4, seizing central space and challenging Black's bishops. This is White's main plan in the Slav."
      },
      {
        "label": "10... Bg6 — Black",
        "text": "The e4 pawn attacks the Bf5, so the bishop retreats to g6. It stays on the same diagonal, still watching e4 and d3."
      },
      {
        "label": "11. Bd3 — White",
        "text": "White develops the bishop to d3, aiming at h7 and supporting the center. White's pieces are coordinating well."
      },
      {
        "label": "11... Bh5 — Black",
        "text": "The bishop steps to h5, where it pins the Nf3 against the queen on e2. The pin makes it harder for White to support the center with the knight."
      },
      {
        "label": "12. e5 — White",
        "text": "White gains space and kicks the Nf6. The price is the d5 square, which no white pawn can attack any more."
      },
      {
        "label": "12... Nd5 — Black",
        "text": "The knight jumps to the d5 outpost, a strong central square in the heart of Black's position."
      },
      {
        "label": "13. Nxd5 — White",
        "text": "White exchanges off the strong knight before Black can reinforce it."
      },
      {
        "label": "13... cxd5 — Black",
        "text": "Black recaptures with the c-pawn, opening the c-file for the rooks. Black's d5 and e6 pawns form a solid wall in front of White's e5 pawn."
      },
      {
        "label": "14. Qe3 — White",
        "text": "The queen leaves e2 to break the pin on the Nf3. From e3 it can also swing to the kingside."
      },
      {
        "label": "14... Re8 — Black",
        "text": "A useful waiting move. The rook vacates f8 so the d7 knight can later go to f8 to defend the kingside."
      },
      {
        "label": "15. Ne1 — White",
        "text": "With the pin gone, the knight reroutes toward d3 or c2, where it can challenge the Bb4, and frees the f-pawn to advance."
      },
      {
        "label": "15... Bg6 — Black",
        "text": "Black offers to trade light-squared bishops. The Bh5 has little to do now that the Nf3 has left, and the Bd3 is White's best attacking piece."
      },
      {
        "label": "16. Bxg6 — White",
        "text": "White accepts the trade."
      },
      {
        "label": "16... hxg6 — Black",
        "text": "Black recaptures toward the center. The f7 and g6 pawns give the king a compact shelter, with no weak h7 square for White's queen to aim at."
      },
      {
        "label": "17. Nd3 — White",
        "text": "The knight attacks the Bb4 and eyes the c5 and f4 squares."
      },
      {
        "label": "17... Be7 — Black",
        "text": "Black keeps the dark-squared bishop and retreats it to e7, where it guards the kingside dark squares. Black will use the open c-file with ...Rc8, and the position is about level."
      }
    ],
    "keyIdeas": [
      "Slav key: 2...c6 keeps the light-squared bishop free — unlike the Queen's Gambit Declined",
      "The Bf5 is Black's pride — keep it active; White will constantly try to chase it",
      "When White plays e5, the d5 square is Black's — put a knight there",
      "Trade the light-squared bishops with ...Bg6, then use the open c-file for counterplay"
    ]
  },
  {
    id: 'queens-indian',
    name: "Queen's Indian Defense",
    eco: 'E12',
    category: 'black',
    tagline: 'Nimzowitsch\'s other weapon — the fianchetto variation',
    description: 'The Queen\'s Indian Defense (1.d4 Nf6 2.c4 e6 3.Nf3 b6) is the companion to the Nimzo-Indian. When White plays 3.Nf3 instead of 3.Nc3, Black plays b6 and fianchettoes the bishop on b7, controlling d5 and e4 from the flank. This leads to rich, positional battles. Kramnik won multiple world championship games with it, and Carlsen regularly employs it.',
    moves: ['d4','Nf6','c4','e6','Nf3','b6','g3','Bb7','Bg2','Be7','O-O','O-O','Nc3','Ne4','Qc2','Nxc3','Qxc3','d6','b4','Nd7','Bb2','a5','bxa5','Rxa5','Rfd1','Qa8'],
    explanations: [
      { label: '1. d4 — White', text: 'The Queen\'s Pawn — White aims for a strategic battle.' },
      { label: '1... Nf6 — Black', text: 'The flexible knight development — keeping Indian Defense options alive.' },
      { label: '2. c4 — White', text: 'White extends the pawn center, challenging Black to decide on a defense.' },
      { label: '2... e6 — Black', text: 'Black prepares for the Queen\'s Indian (if White plays Nf3) or Nimzo-Indian (if Nc3). Very flexible.' },
      { label: '3. Nf3 — White', text: 'White plays Nf3 rather than Nc3, avoiding the Nimzo-Indian pin. This invites the Queen\'s Indian.' },
      { label: '3... b6 — Black', text: 'The Queen\'s Indian! Black prepares ...Bb7, fianchettoing the bishop to control the long diagonal and contest d5 and e4.' },
      { label: '4. g3 — White', text: 'White also fianchettoes! The g3 + Bg2 setup leads to a "battle of the bishops" down the long diagonals.' },
      { label: '4... Bb7 — Black', text: 'The queen\'s bishop arrives at b7 — this powerful piece controls the a8-h1 diagonal and will fight against White\'s Bg2.' },
      { label: '5. Bg2 — White', text: 'White\'s bishop reaches g2, completing the fianchetto. The two bishops face each other down the long diagonal — a fascinating strategic duel.' },
      { label: '5... Be7 — Black', text: 'Black develops the king\'s bishop to e7, preparing to castle. A solid, classical development.' },
      { label: '6. O-O — White', text: 'White castles, completing the kingside setup. White\'s fianchettoed position is very solid.' },
      { label: '6... O-O — Black', text: 'Black castles as well — both kings are safe. Now the real positional battle begins.' },
      { label: '7. Nc3 — White', text: 'White develops the queenside knight to c3. Now the position resembles a Catalan/QID hybrid with many strategic subtleties.' },
      { label: '7... Ne4 — Black', text: 'Black\'s knight jumps to e4! This active move challenges White\'s control of the center and invites simplification.' },
      { label: '8. Qc2 — White', text: 'White plays Qc2, attacking the Ne4 and offering a trade. This is the most principled response.' },
      { label: '8... Nxc3 — Black', text: 'Black exchanges the knight. After Qxc3, the queens come off and Black has a solid position without weaknesses.' },
      { label: '9. Qxc3 — White', text: 'White recaptures with the queen. Now White has the queen on c3 and a slight space advantage, while Black has good piece coordination.' },
      { label: '9... d6 — Black', text: 'Black solidifies the center with d6. This prevents e4 and keeps a solid, unbreachable position.' },
      { label: '10. b4 — White', text: 'White launches queenside expansion with b4! This gains space and prepares Bb2 to reinforce the long diagonal battle.' },
      { label: '10... Nd7 — Black', text: 'The knight retreats to d7, where it supports c5 and can go to f6 or e5. Black is regrouping.' },
      { label: '11. Bb2 — White', text: 'The bishop develops to b2, engaging in the long diagonal battle with Black\'s Bb7. This is a key strategic moment.' },
      { label: '11... a5 — Black', text: 'Black challenges the queenside expansion with a5! This fights for space and creates tension on the b-file.' },
      { label: '12. bxa5 — White', text: 'White captures on a5, opening the b-file. This forces Black to recapture and creates some structural tension.' },
      { label: '12... Rxa5 — Black', text: 'Black recaptures with the rook and keeps the pawn structure intact. The rook is already active on a5, eyeing the a2 pawn along the half-open a-file, and Black has no pawn weaknesses.' },
      { label: '13. Rfd1 — White', text: 'White centralizes the rook to d1, supporting d4 and preparing for central action. Both sides are maneuvering for optimal positions.' },
      { label: '13... Qa8 — Black', text: 'A typical Queen\'s Indian queen move! On a8 the queen lines up behind the Bb7 on the long diagonal toward g2, and it backs up the rook against a2. Black has active pieces and no weaknesses, and ...Bf6 or ...c5 can follow to challenge d4 — a typical Queen\'s Indian achievement.' }
    ],
    keyIdeas: [
      'QID key: Bb7 controls the long a8-h1 diagonal — fighting against White\'s Bg2 for central influence',
      'The "battle of fianchettoes": both bishops on g2 and b7 eye the same long diagonal',
      'Black\'s queenside counterplay: ...a5 to open the a-file, then ...c5 to challenge White\'s space advantage',
      'Very solid — Black has no structural weaknesses and always has counterplay ideas'
    ]
  },
  {
    "id": "four-knights",
    "name": "Four Knights Game",
    "eco": "C48",
    "category": "black",
    "tagline": "Rubinstein's ...Nd4 — counterattack instead of defending",
    "description": "The Four Knights Game begins 1.e4 e5 2.Nf3 Nc6 3.Nc3 Nf6, with all four knights developed. In the Spanish Four Knights (4.Bb5), White threatens to win e5 by Bxc6 and Nxe5. Black's most active answer is the Rubinstein Variation, 4...Nd4: rather than defending passively, Black counterattacks the b5 bishop and offers a knight trade. The line shown is White's direct 5.Nxd4 exd4 6.e5, which leads to a forcing sequence of exchanges and a level endgame — a reliable way for Black to neutralize the opening.",
    "moves": [
      "e4",
      "e5",
      "Nf3",
      "Nc6",
      "Nc3",
      "Nf6",
      "Bb5",
      "Nd4",
      "Nxd4",
      "exd4",
      "e5",
      "dxc3",
      "exf6",
      "Qxf6",
      "dxc3",
      "Qe5+",
      "Qe2",
      "Qxe2+",
      "Bxe2",
      "d5",
      "Bf4",
      "c6",
      "O-O-O",
      "Be6",
      "Rhe1",
      "Bc5"
    ],
    "explanations": [
      {
        "label": "1. e4 — White",
        "text": "The King's Pawn opening — White begins the classical fight for the center."
      },
      {
        "label": "1... e5 — Black",
        "text": "The symmetrical response — Black takes an equal share of the center."
      },
      {
        "label": "2. Nf3 — White",
        "text": "White develops and attacks the e5 pawn."
      },
      {
        "label": "2... Nc6 — Black",
        "text": "The knight defends e5 and develops toward the center."
      },
      {
        "label": "3. Nc3 — White",
        "text": "White develops the queenside knight and guards e4. This sets up the Four Knights."
      },
      {
        "label": "3... Nf6 — Black",
        "text": "Black mirrors with ...Nf6 and attacks e4. All four knights are now developed."
      },
      {
        "label": "4. Bb5 — White",
        "text": "The Spanish Four Knights. White attacks the c6 knight, which defends e5, so Bxc6 followed by Nxe5 is a threat."
      },
      {
        "label": "4... Nd4 — Black",
        "text": "The Rubinstein Variation. Black counterattacks the b5 bishop and the f3 knight instead of defending e5. If 5.Nxe5, Black regains the pawn with ...Qe7 and active play."
      },
      {
        "label": "5. Nxd4 — White",
        "text": "White trades knights at once and prepares e5 to chase Black's other knight."
      },
      {
        "label": "5... exd4 — Black",
        "text": "Black recaptures. The new pawn on d4 attacks the c3 knight."
      },
      {
        "label": "6. e5 — White",
        "text": "The point of White's play: the f6 knight is attacked and has no comfortable retreat."
      },
      {
        "label": "6... dxc3 — Black",
        "text": "Black ignores the threat and takes the c3 knight. Material will stay even: a knight for a knight."
      },
      {
        "label": "7. exf6 — White",
        "text": "White takes back on f6. Note that Black's c3 pawn now attacks b2 and d2."
      },
      {
        "label": "7... Qxf6 — Black",
        "text": "Black recaptures with the queen, which is active on f6 and supports the dangerous c3 pawn."
      },
      {
        "label": "8. dxc3 — White",
        "text": "White removes the c3 pawn and opens the diagonal for the c1 bishop. White has doubled c-pawns but a slight lead in development and open lines for the bishops."
      },
      {
        "label": "8... Qe5+ — Black",
        "text": "A check that forces White to decide. Black also offers a queen trade, which takes most of the sting out of White's lead in development."
      },
      {
        "label": "9. Qe2 — White",
        "text": "White blocks with the queen. This is the main line and leads to a queenless middlegame."
      },
      {
        "label": "9... Qxe2+ — Black",
        "text": "Black trades queens. Without queens, Black's king is safe in the center and White has few attacking chances."
      },
      {
        "label": "10. Bxe2 — White",
        "text": "White recaptures with the bishop, which retreats from b5 at the same time."
      },
      {
        "label": "10... d5 — Black",
        "text": "Black claims the center and opens the diagonal for the c8 bishop."
      },
      {
        "label": "11. Bf4 — White",
        "text": "White develops actively. The bishop eyes the c7 pawn now that d6 is empty."
      },
      {
        "label": "11... c6 — Black",
        "text": "Black takes the pawn off the f4 bishop's diagonal and supports d5. Black's structure is solid and the c8 bishop is free."
      },
      {
        "label": "12. O-O-O — White",
        "text": "With queens off, White can castle long safely and bring the rook to the d-file against d5."
      },
      {
        "label": "12... Be6 — Black",
        "text": "Black develops the bishop to guard d5 and prepares ...Bc5 and castling."
      },
      {
        "label": "13. Rhe1 — White",
        "text": "White's rooks take the central files. White has slightly more active pieces, but no real targets."
      },
      {
        "label": "13... Bc5 — Black",
        "text": "The bishop takes its most active diagonal and eyes f2. Black has completed development with a healthy, level position — the Rubinstein has done its job."
      }
    ],
    "keyIdeas": [
      "4...Nd4: counterattack the b5 bishop instead of defending e5 passively",
      "After 5.Nxd4 exd4 6.e5, answer the knight attack with ...dxc3 — a piece for a piece",
      "...Qe5+ and ...Qxe2+: trade queens to neutralize White's lead in development",
      "In the endgame, ...d5, ...c6, ...Be6 and ...Bc5 give Black a level, healthy position"
    ]
  },
  {
    id: 'scholars-mate',
    name: "Scholar's Mate",
    eco: null,
    category: 'trap',
    tagline: 'The fastest trap — beginner beware!',
    description: "Scholar's Mate is the most famous beginner trap in chess. White attacks f7 with the queen and bishop, and if Black doesn't see it coming, it's checkmate in just 4 moves! The key lesson: don't move the queen too early, and always watch for Qxf7# threats. Almost every strong player fell for this at least once as a beginner.",
    moves: ['e4','e5','Bc4','Nc6','Qh5','Nf6','Qxf7'],
    explanations: [
      { label: '1. e4 — White', text: 'White opens with e4 — but the Scholar\'s Mate is already being planned. White will try to attack f7 as fast as possible.' },
      { label: '1... e5 — Black', text: 'Black plays e5, a natural response. But Black needs to be very careful about the f7 square — it\'s only defended by the king.' },
      { label: '2. Bc4 — White', text: 'The Italian bishop develops to c4, immediately targeting f7! This bishop is now on the most dangerous diagonal aimed at Black\'s weakest point.' },
      { label: '2... Nc6 — Black', text: 'Black develops the knight — a natural move, but Black has missed White\'s plan. The correct response would be 2...Nf6 to stop Qh5, or 2...d6 for solid defense.' },
      { label: '3. Qh5 — White', text: 'The queen leaps to h5, threatening Qxf7# immediately! This is the Scholar\'s Mate threat. Black must respond correctly or get checkmated.' },
      { label: '3... Nf6?? — Black', text: 'Black plays Nf6, attacking the queen — but this is a BLUNDER! The correct move was g6 to drive the queen away. Now White delivers checkmate.' },
      { label: '4. Qxf7# — White', text: 'CHECKMATE! The queen takes f7 — the king on e8 is in check with no escape. The Bc4 covers d5, and the queen covers e8 and f7. A painful lesson for the beginner who falls for this!' }
    ],
    keyIdeas: [
      'f7 is Black\'s most vulnerable square — defended only by the king in the opening',
      'To defend: play g6 when the queen reaches h5, or develop Nf6 BEFORE Qh5 can threaten',
      'White lesson: this works only against beginners — don\'t rely on it against prepared players',
      'Key principle: don\'t bring the queen out too early — but watch for opponents who do!'
    ]
  },
  {
    id: 'fools-mate',
    name: "Fool's Mate",
    eco: null,
    category: 'trap',
    tagline: 'Checkmate in 2 — the fastest game possible',
    description: "Fool's Mate is the fastest possible checkmate in chess — just 2 moves! White plays the weakest possible opening (f3 + g4), opening lines toward the king, and Black delivers Qh4#. While no strong player will ever fall for it, it illustrates a crucial lesson: never weaken your king unnecessarily in the opening.",
    moves: ['f3','e5','g4','Qh4'],
    explanations: [
      { label: '1. f3 — White', text: 'A terrible opening move! f3 weakens the e1 king and does nothing for development. This move is almost never played, but demonstrates the danger of opening pawn moves near your king.' },
      { label: '1... e5 — Black', text: 'Black takes central space and opens lines. E5 is a natural, strong move that also helps set up the checkmate threat.' },
      { label: '2. g4?? — White', text: 'Another disastrous move — g4 further weakens the kingside and opens the h4-e1 diagonal. White has created the perfect conditions for an immediate checkmate.' },
      { label: '2... Qh4# — Black', text: 'CHECKMATE on move 2! The queen delivers the quickest possible checkmate in all of chess. The White king on e1 is in check from Qh4 via the diagonal, and cannot escape: f2 is not covered (f3 pawn has moved away), and there are no pieces to block. Game over!' }
    ],
    keyIdeas: [
      'Never move f and g pawns simultaneously in the opening — this fatally weakens your king',
      'The h4-e1 diagonal is extremely dangerous when f3 and g4 are played — any queen or bishop can use it',
      'Principle: don\'t create weaknesses around your king in the opening',
      'This checkmate illustrates why "developing pawns near your king" is so dangerous'
    ]
  },
  {
    id: 'legal-trap',
    name: "Legal's Trap",
    eco: null,
    category: 'trap',
    tagline: 'The brilliant queen sacrifice leading to smothered mate',
    description: "Legal's Trap is a beautiful queen sacrifice that leads to a brilliant checkmate. White appears to hang the queen (allowing Bxd1), but after Bxf7+ Ke7, the knight on d5 delivers checkmate! The lesson: always check if a piece sacrifice leads to a forced checkmate before capturing. Named after 18th century French master Sire de Legal.",
    moves: ['e4','e5','Nf3','Nc6','Bc4','d6','Nc3','Bg4','Nxe5','Bxd1','Bxf7+','Ke7','Nd5'],
    explanations: [
      { label: '1. e4 — White', text: 'The standard King\'s Pawn opening.' },
      { label: '1... e5 — Black', text: 'Black mirrors in the center — the game begins with classical symmetry.' },
      { label: '2. Nf3 — White', text: 'The knight develops and attacks e5.' },
      { label: '2... Nc6 — Black', text: 'The knight defends e5. Both sides are developing normally.' },
      { label: '3. Bc4 — White', text: 'The Italian Bishop to c4 — this targets f7 and sets up the trap that\'s coming.' },
      { label: '3... d6 — Black', text: 'A solid move supporting e5. Nothing suspicious yet.' },
      { label: '4. Nc3 — White', text: 'White develops the queenside knight, building toward the trap. The key ingredient: White needs Nc3 to jump to d5 later.' },
      { label: '4... Bg4 — Black', text: 'Black pins the Nf3! The bishop on g4 attacks the knight defending e4. Black threatens to double White\'s pawns if the knight moves. This looks clever — but it walks right into the trap!' },
      { label: '5. Nxe5! — White', text: 'WHITE SACRIFICES THE QUEEN! The knight takes e5, apparently hanging the queen (since Bxd1 would win it). But White has calculated the forced mate. This move is the heart of the Legal Trap!' },
      { label: '5... Bxd1 — Black', text: 'Black greedily takes the queen on d1. This looks like a huge material gain — but it\'s a catastrophic mistake! Black\'s queen has never moved, so the bishop takes White\'s queen. The king is now on e8 about to walk into a mating net.' },
      { label: '6. Bxf7+ — White', text: 'CHECK! The bishop takes f7, giving check to the Black king on e8. The king must move — there are no other legal moves to escape this check.' },
      { label: '6... Ke7 — Black', text: 'The king is forced to move to e7. This seems like escaping, but it walks right into the final checkmate. Every escape square will be covered.' },
      { label: '7. Nd5# — White', text: 'CHECKMATE! The knight from c3 jumps to d5, and it\'s over. The king on e7 has no escape: d6 has Black\'s own pawn, d8 has Black\'s own queen, e8 is attacked by Bxf7, f8 has Black\'s own bishop (Bf8), e6 is attacked by Bf7, f6 is attacked by Nd5 itself, and f7 has the White bishop. A beautiful smothered mate!' }
    ],
    keyIdeas: [
      'The Legal Trap: Nxe5 looks like a blunder (queen is en prise) but leads to forced checkmate',
      'Key lesson: always check whether taking a piece leads to checkmate before capturing!',
      'The Bg4 pin is a mistake — it walks into this trap. Better: don\'t pin Nf3 here',
      'After Nxe5 Bxd1, the forced sequence Bxf7+ Ke7 Nd5# is unstoppable — memorize the mating pattern'
    ]
  },
  {
    id: 'fried-liver',
    name: 'Fried Liver Attack',
    eco: null,
    category: 'trap',
    tagline: 'The knife into f7 — a legendary knight sacrifice',
    description: "The Fried Liver Attack is one of chess's most spectacular sacrificial attacks. Arising from the Two Knights Defense, White sacrifices the knight on f7 (6.Nxf7!) to drag the Black king into the center. With the king exposed, White launches a devastating attack. It\'s named because Black's position gets 'fried.' Very popular at club level where Black is not well-prepared.",
    moves: ['e4','e5','Nf3','Nc6','Bc4','Nf6','Ng5','d5','exd5','Nxd5','Nxf7','Kxf7','Qf3+','Ke6','Nc3','Nb4','Qe4','c6','a3','Na6','d4','Bd7','Nxd5','Qa5+'],
    explanations: [
      { label: '1. e4 — White', text: 'Standard King\'s Pawn opening.' },
      { label: '1... e5 — Black', text: 'Black takes central space.' },
      { label: '2. Nf3 — White', text: 'The knight develops, attacking e5.' },
      { label: '2... Nc6 — Black', text: 'The knight defends e5.' },
      { label: '3. Bc4 — White', text: 'The Italian bishop develops, setting up the Two Knights Defense. The bishop eyes f7.' },
      { label: '3... Nf6 — Black', text: 'Black plays Nf6, entering the Two Knights Defense. This creates the conditions for the Fried Liver!' },
      { label: '4. Ng5 — White', text: 'The knight attacks f7 with Ng5! Along with the Bc4, White is threatening Nxf7, winning the exchange. Black must respond carefully.' },
      { label: '4... d5 — Black', text: 'Black strikes back with d5! The best response — Black counterattacks in the center rather than defending passively. If 4...Bc5 instead, White plays Nxf7 anyway.' },
      { label: '5. exd5 — White', text: 'White captures on d5 — the center opens up.' },
      { label: '5... Nxd5 — Black', text: 'Black takes back with the knight, centralizing it powerfully on d5. This looks natural but walks into the sacrifice.' },
      { label: '6. Nxf7! — White', text: 'THE FRIED LIVER SACRIFICE! The knight takes f7, giving check! Black\'s king must take the knight — and then it gets dragged into the center. This sacrifice has been played since the 16th century.' },
      { label: '6... Kxf7 — Black', text: 'The king takes the knight on f7. Black has no choice — it must capture. Now the king is exposed in the center, and White has a powerful attack for the sacrificed knight.' },
      { label: '7. Qf3+ — White', text: 'Check! The queen comes to f3 with a devastating check. The king is forced to move further into the center.' },
      { label: '7... Ke6 — Black', text: 'The king retreats to e6 — in the center of the board! This is dangerous, but Ke8 loses immediately too. Black must try to survive.' },
      { label: '8. Nc3 — White', text: 'White develops the knight with tempo, preparing Nd5+ or Ne4 ideas to continue the attack.' },
      { label: '8... Nb4 — Black', text: 'Black\'s Nd5 retreats to b4, attacking the Bc4 and trying to trade off White\'s attacking pieces. Black needs to simplify to survive.' },
      { label: '9. Qe4 — White', text: 'The queen centralizes to e4, threatening d4 and keeping the pressure on Black\'s exposed king. White\'s attack continues.' },
      { label: '9... c6 — Black', text: 'Black plays c6, trying to establish some central stability. The king needs pawn cover desperately.' },
      { label: '10. a3 — White', text: 'White forces the Nb4 to declare its intentions. After Na6, the knight is sidelined.' },
      { label: '10... Na6 — Black', text: 'The knight retreats to a6 — a passive but forced move. Black\'s pieces are not coordinating well under the pressure.' },
      { label: '11. d4 — White', text: 'White advances d4, opening more lines and creating threats against the exposed king. The initiative remains firmly with White.' },
      { label: '11... Bd7 — Black', text: 'A natural-looking developing move, and a serious mistake. The bishop on d7 cuts the queen off from d5, so the knight there is defended only by the c6 pawn, and it is pinned: the Bc4 looks through it at the king on e6. Black had to play 11...Nc7, bringing the knight back to defend d5.' },
      { label: '12. Nxd5! — White', text: 'White takes the pinned knight! If 12...cxd5, the queen or bishop takes on d5 with check and the exposed king is mated within a few moves. White has won back the sacrificed piece and the attack goes on.' },
      { label: '12... Qa5+ — Black', text: 'Black\'s best try is this check, so the queen can take on d5 next. It does not help: after 13.Bd2 Qxd5 14.Bxd5+ cxd5 15.Qxe5+ White has won Black\'s queen for a bishop and is completely winning. One careless move and the king in the center collapses — this is the power of the Fried Liver!' }
    ],
    keyIdeas: [
      'The Fried Liver works: Nxf7 sacrifices a piece to drag the Black king into the center',
      'After Kxf7, White plays Qf3+ forcing Ke6 — the king is trapped in the middle of the board',
      'White gets enormous compensation: open lines, centralized pieces, exposed king — and pins against the king on e6',
      'Defense: Black should play 5...Na5 (attacking Bc4) instead of 5...Nxd5 to avoid the sacrifice'
    ]
  },
  {
    id: 'elephant-trap',
    name: 'Elephant Trap',
    eco: null,
    category: 'trap',
    tagline: 'Win the queen in the Queen\'s Gambit Declined',
    description: "The Elephant Trap is one of the most important opening traps to know in the Queen's Gambit Declined. After 5.cxd5 exd5 6.Nxd5??, Black wins the queen with the brilliant Bb4+! White cannot avoid losing material — the queen is trapped. The lesson: be very careful about premature captures in the QGD.",
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Nbd7','cxd5','exd5','Nxd5','Nxd5','Bxd8','Bb4+','Qd2','Bxd2+','Kxd2','Kxd8'],
    explanations: [
      { label: '1. d4 — White', text: 'The Queen\'s Pawn opening begins.' },
      { label: '1... d5 — Black', text: 'Black claims central space with d5.' },
      { label: '2. c4 — White', text: 'The Queen\'s Gambit! White offers the c-pawn.' },
      { label: '2... e6 — Black', text: 'The Queen\'s Gambit Declined. Black solidifies d5 with e6.' },
      { label: '3. Nc3 — White', text: 'White develops the knight.' },
      { label: '3... Nf6 — Black', text: 'Black develops the kingside knight.' },
      { label: '4. Bg5 — White', text: 'White pins the Nf6 with Bg5. This is the Classical QGD — White creates pressure on Black\'s position.' },
      { label: '4... Nbd7 — Black', text: 'Black develops the queenside knight to d7 rather than c6, maintaining the pressure on the Bg5 pin without blocking the c-pawn.' },
      { label: '5. cxd5 — White', text: 'White trades pawns. This relieves the central tension, but now comes the trap...' },
      { label: '5... exd5 — Black', text: 'Black recaptures with the e-pawn. Now d5 is defended by the Nf6, and the Nbd7 is protecting the Nf6. This seemingly simple position contains a deadly trap.' },
      { label: '6. Nxd5?? — White', text: 'WHITE FALLS INTO THE TRAP! The knight takes d5, apparently winning a pawn and forking the Nf6 and Nbd7. But this loses the queen! White should play e3, Nf3, or Qc2 instead.' },
      { label: '6... Nxd5 — Black', text: 'Black takes back with the knight on d5 — the queen on d1 is now unprotected! And the next move will expose this beautifully.' },
      { label: '7. Bxd8 — White', text: 'White takes the Black queen... but waits for the brilliant reply that wins the game.' },
      { label: '7... Bb4+ — Black', text: 'CHECK! The bishop comes to b4, giving check to the White king AND defending the Nd5. White cannot take the bishop because the queen would hang. The White queen is trapped on d8!' },
      { label: '8. Qd2 — White', text: 'White must interpose with Qd2 to block the check. But now the queen is on d2, not defending anything useful, and Black wins it back.' },
      { label: '8... Bxd2+ — Black', text: 'Check again! Black takes the Qd2 with check. White must take back.' },
      { label: '9. Kxd2 — White', text: 'White\'s king takes the bishop. White has the queens off the board, but Black recovers the queen on d8.' },
      { label: '9... Kxd8 — Black', text: 'Black takes White\'s queen on d8! Black has won a queen for a bishop and knight — a huge material advantage. The Elephant Trap catches so many unsuspecting players at club level!' }
    ],
    keyIdeas: [
      'Elephant Trap: after cxd5 exd5, the move Nxd5 loses to Nxd5 Bxd8 Bb4+! winning the queen',
      'Key sequence: 6...Nxd5 7.Bxd8 Bb4+ 8.Qd2 Bxd2+ 9.Kxd2 Kxd8 — Black wins a queen for two pieces',
      'White lesson: after cxd5 exd5, the d5 square is solidly defended — don\'t try to grab it',
      'Prevention: White should play e3, Nf3, or Qc2 instead of the greedy Nxd5'
    ]
  },
  {
    id: 'stafford-gambit',
    name: 'Stafford Gambit',
    eco: null,
    category: 'trap',
    tagline: 'The reckless gambit that has trapped thousands',
    description: "The Stafford Gambit (1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nc6) is a swashbuckling gambit where Black sacrifices a pawn to get wild attacking chances. After 4.Nxc6 dxc6 5.e5 Ne4, Black creates chaos with piece activity and tactical tricks. White needs to be well-prepared — many attacking lines win for Black if White plays carelessly.",
    moves: ['e4','e5','Nf3','Nf6','Nxe5','Nc6','Nxc6','dxc6','e5','Ne4','Nc3','Bc5','Qf3','Nxc3','bxc3','Qd4','Qg3','Be6','Ba3','O-O-O','Bxc5','Qxc5','d4','Qa5'],
    explanations: [
      { label: '1. e4 — White', text: 'Standard King\'s Pawn opening.' },
      { label: '1... e5 — Black', text: 'Black takes central space.' },
      { label: '2. Nf3 — White', text: 'The knight develops and attacks e5.' },
      { label: '2... Nf6 — Black', text: 'The Petrov/Russian variation — or is it? Black is about to play the Stafford Gambit!' },
      { label: '3. Nxe5 — White', text: 'White takes the e5 pawn.' },
      { label: '3... Nc6 — Black', text: 'The Stafford Gambit! Black develops the knight rather than recapturing the pawn. If White is greedy and takes on c6, the complications will favor Black.' },
      { label: '4. Nxc6 — White', text: 'White takes the Nc6. This is exactly what Black wants — the position becomes wildly complex and full of traps.' },
      { label: '4... dxc6 — Black', text: 'Black recaptures with the d-pawn, opening the d-file and giving the queen access to d4. The gambit pawn is gone, but Black has huge piece activity.' },
      { label: '5. e5 — White', text: 'White advances e5, attacking the Nf6. This looks natural but the game gets very sharp.' },
      { label: '5... Ne4 — Black', text: 'Black\'s knight jumps to e4 — a powerful central outpost. The knight threatens to come to d2 or f2, creating immediate problems for White.' },
      { label: '6. Nc3 — White', text: 'White develops the knight, trying to challenge the Ne4. If Black takes Nxc3, the b-pawn recaptures and White gets a solid center.' },
      { label: '6... Bc5 — Black', text: 'Black develops the bishop to c5 — a powerful diagonal aiming at f2. Along with the Ne4, Black has serious attacking threats.' },
      { label: '7. Qf3 — White', text: 'White plays Qf3, defending f2 (protecting against Bxf2+) and attacking the Ne4. White is trying to consolidate.' },
      { label: '7... Nxc3 — Black', text: 'Black takes the Nc3. After bxc3, White\'s pawn structure is damaged and the b-file is open.' },
      { label: '8. bxc3 — White', text: 'White recaptures with the b-pawn — forced. Now Black has an important tactical resource.' },
      { label: '8... Qd4 — Black', text: 'The queen jumps to d4! A powerful centralizing move that attacks c4, pressures f2, and threatens to take on c3 or e5. White must respond carefully.' },
      { label: '9. Qg3 — White', text: 'White retreats the queen to g3 to avoid exchanges and maintain some attacking potential.' },
      { label: '9... Be6 — Black', text: 'Black develops the bishop to e6, preparing to castle queenside and connect the rooks. Black is building a dangerous attacking setup.' },
      { label: '10. Ba3 — White', text: 'White plays Ba3, trying to develop and create some counterplay. The position is extremely complex.' },
      { label: '10... O-O-O — Black', text: 'Black castles queenside! The king goes to safety and the rook comes to d8. Black\'s pieces are all active and coordinated — the Stafford Gambit has provided rich compensation.' },
      { label: '11. Bxc5 — White', text: 'White exchanges the bishop, simplifying somewhat. After Qxc5, both sides continue fighting.' },
      { label: '11... Qxc5 — Black', text: 'Black recaptures with the queen. Black has a very active queen and rooks pointing at White\'s center.' },
      { label: '12. d4 — White', text: 'White pushes d4, fighting for central space. White needs to challenge Black\'s control.' },
      { label: '12... Qa5 — Black', text: 'The queen goes to a5, eyeing the queenside and potentially c3. Black continues to create multiple threats simultaneously — the Stafford\'s hallmark is keeping White off balance.' }
    ],
    keyIdeas: [
      'Stafford Gambit: sacrifice the e5 pawn for wild piece activity and tactical tricks',
      'Key threat: Ne4 + Bc5 combo targets f2 constantly — White must always watch for Bxf2+ tactics',
      'White lesson: play 6.d3 or 6.Qe2 carefully — grabbing material with Nxc6 leads to trouble',
      'Black\'s compensation: open d-file, active pieces, the c5 bishop + Ne4 combo creates constant threats'
    ]
  },
  {
    id: 'blackburne-shilling',
    name: 'Blackburne Shilling Gambit',
    eco: null,
    category: 'trap',
    tagline: 'Swindling knight trick — wins a shilling from careless players',
    description: "The Blackburne Shilling Gambit (named because Joseph Blackburne would supposedly win a shilling from amateurs with this trick) is a sharp trap in the Italian Game. After 3...Nd4, Black offers the e5 pawn. If White grabs it greedily with 4.Nxe5 Qg5! 5.Nxf7 Qxg2 6.Rf1 Qxe4+, the game ends dramatically. If White plays 7.Be2, the crushing Nf3# delivers checkmate!",
    moves: ['e4','e5','Nf3','Nc6','Bc4','Nd4','Nxe5','Qg5','Nxf7','Qxg2','Rf1','Qxe4+','Be2','Nf3#'],
    explanations: [
      { label: '1. e4 — White', text: 'Standard King\'s Pawn opening.' },
      { label: '1... e5 — Black', text: 'Black mirrors in the center.' },
      { label: '2. Nf3 — White', text: 'Natural development attacking e5.' },
      { label: '2... Nc6 — Black', text: 'Black defends e5.' },
      { label: '3. Bc4 — White', text: 'The Italian Bishop — aimed at f7, the weakest point in Black\'s position.' },
      { label: '3... Nd4!? — Black', text: 'The Blackburne Shilling Gambit! Black places the knight on d4, attacking the Nf3. This looks active but actually sets a beautiful trap for White.' },
      { label: '4. Nxe5? — White', text: 'White grabs the e5 pawn — falling into the trap! After Nxe5, White thinks they\'re winning material. But the attack that follows is devastating.' },
      { label: '4... Qg5! — Black', text: 'The queen jumps to g5, attacking both the Ne5 and the g2 pawn simultaneously! White cannot defend both.' },
      { label: '5. Nxf7 — White', text: 'White takes f7 with a fork (threatening Nxh8 + rook), but falls deeper into the trap. White is still trying to grab material while Black\'s attack builds.' },
      { label: '5... Qxg2 — Black', text: 'Black\'s queen takes g2, threatening the Rh1! After Rf1, the trap is almost sprung.' },
      { label: '6. Rf1 — White', text: 'White plays Rf1 to save the rook. This looks like a reasonable defensive move, but the position is now lost for White.' },
      { label: '6... Qxe4+ — Black', text: 'CHECK! Black\'s queen comes back with a devastating check on e4. White must interpose.' },
      { label: '7. Be2 — White', text: 'White blocks with Be2 — forced. But now the final blow falls.' },
      { label: '7... Nf3# — Black', text: 'CHECKMATE! The knight from d4 delivers checkmate on f3. The king cannot escape: e3 is protected by the queen on e4, e1 is blocked by Be2, f1 has the rook. A stunning smothered checkmate — the Blackburne Shilling Gambit strikes!' }
    ],
    keyIdeas: [
      'The Blackburne trap: after 3...Nd4 4.Nxe5 Qg5! 5.Nxf7 Qxg2 6.Rf1 Qxe4+ 7.Be2 Nf3#',
      'White must avoid Nxe5 — better moves are Nxd4 or c3 to challenge the Nd4',
      'Key pattern: queen on g2 threatens the rook, and the Nd4-f3 checkmate is the finale',
      'The trap works because White greedily takes too many pawns while Black builds the mating net'
    ]
  },
  {
    id: 'budapest-gambit',
    name: 'Budapest Gambit',
    eco: null,
    category: 'trap',
    tagline: 'e5 pawn gambit — active piece play vs. White\'s center',
    description: "The Budapest Gambit (1.d4 Nf6 2.c4 e5) is a lively gambit where Black sacrifices a pawn for active piece play. After 3.dxe5 Ng4, Black pressures the e5 pawn immediately. White must play precisely to hold the material advantage — one slip and Black's active pieces overwhelm the position. It's a great surprise weapon at club level.",
    moves: ['d4','Nf6','c4','e5','dxe5','Ng4','Nf3','Bc5','e3','Nc6','Be2','Ngxe5','Nxe5','Nxe5','O-O','O-O'],
    explanations: [
      { label: '1. d4 — White', text: 'White opens with d4, aiming for a positional battle.' },
      { label: '1... Nf6 — Black', text: 'The knight develops, keeping multiple options open.' },
      { label: '2. c4 — White', text: 'White grabs central space with c4.' },
      { label: '2... e5!? — Black', text: 'The Budapest Gambit! Black sacrifices the e5 pawn immediately for active piece play. This is a surprise weapon — White is often unprepared for it.' },
      { label: '3. dxe5 — White', text: 'White takes the gambit pawn. This is the most principled response — White accepts the challenge.' },
      { label: '3... Ng4 — Black', text: 'The knight immediately attacks the e5 pawn, demanding that White defend it. Black will regain the pawn or win compensation in activity.' },
      { label: '4. Nf3 — White', text: 'White defends the e5 pawn. This is the safest continuation — White holds the extra pawn and tries to develop.' },
      { label: '4... Bc5 — Black', text: 'Black develops the bishop to c5, a powerful active square. The bishop eyes f2 and creates pressure from the outset.' },
      { label: '5. e3 — White', text: 'White solidifies the center and prepares to develop the dark-squared bishop. White is playing cautiously to hold the extra pawn.' },
      { label: '5... Nc6 — Black', text: 'The knight develops to c6, increasing pressure on e5 and eyeing the d4 square. Black now threatens ...Ngxe5 to win back the pawn.' },
      { label: '6. Be2 — White', text: 'White develops the bishop, preparing to castle. After castling, White hopes to consolidate the extra pawn.' },
      { label: '6... Ngxe5 — Black', text: 'Black takes the e5 pawn back! The gambit pawn is regained. But Black could also try the speculative ...Nxe5 immediately, which leads to more complex play.' },
      { label: '7. Nxe5 — White', text: 'White takes the Ne5 — trading the extra pawn. The position has simplified somewhat but is still rich.' },
      { label: '7... Nxe5 — Black', text: 'Black recaptures on e5 with the Nc6. Now we have a balanced position where Black has fully equalized.' },
      { label: '8. O-O — White', text: 'White castles, bringing the king to safety. The game enters a middlegame where both sides have solid positions.' },
      { label: '8... O-O — Black', text: 'Black castles as well. The Budapest Gambit has achieved its main goal: Black has active piece play, no structural weaknesses, and good counterplay from the very start. The gambit is a complete success in terms of dynamism.' }
    ],
    keyIdeas: [
      'Budapest Gambit: sacrifice e5 for immediate piece activity and disruption of White\'s plans',
      'Key idea: Ng4 immediately pressures the e5 pawn — Black threatens to regain it right away',
      'White must play precisely — any slip allows Black to get a lead in development with the open e-file',
      'Best for White: 3.dxe5 Ng4 4.Bf4! — the strongest response, maintaining the pawn advantage safely'
    ]
  },
  {
    "id": "vienna",
    "name": "Vienna Game",
    "eco": "C29",
    "category": "white",
    "tagline": "King's Gambit ideas with a knight already developed",
    "description": "The Vienna Game (1.e4 e5 2.Nc3) develops the queenside knight first. The knight guards e4 and controls d5, and because the f-pawn is still free, White keeps the option of f4 — a King's Gambit with a piece already out. After 2...Nf6, White can play quietly with Bc4 and d3, or sharply with the Vienna Gambit 3.f4. The line shown is the gambit with 3...d5, Black's most principled reply: White gains space with fxe5 and d4, challenges Black's centralized knight, and both sides fight over the soon-to-open f-file.",
    "moves": [
      "e4",
      "e5",
      "Nc3",
      "Nf6",
      "f4",
      "d5",
      "fxe5",
      "Nxe4",
      "Nf3",
      "Be7",
      "d4",
      "O-O",
      "Bd3",
      "f5",
      "exf6",
      "Bxf6",
      "O-O",
      "Nc6",
      "Nxe4",
      "dxe4",
      "Bxe4",
      "Nxd4",
      "c3",
      "Nxf3+",
      "Bxf3"
    ],
    "explanations": [
      {
        "label": "1. e4 — White",
        "text": "The King's Pawn opening. White takes central space and opens lines for the queen and the f1 bishop."
      },
      {
        "label": "1... e5 — Black",
        "text": "The classical reply. Black claims an equal share of the center, and we are in Open Game territory."
      },
      {
        "label": "2. Nc3 — White",
        "text": "The Vienna Game. Instead of Nf3, White develops the queenside knight, guarding e4 and covering d5. Crucially, the f-pawn stays free to advance to f4."
      },
      {
        "label": "2... Nf6 — Black",
        "text": "The most principled answer: Black develops with an attack on e4 and prepares ...d5. Black wants to strike in the center before White's f4 idea gets going."
      },
      {
        "label": "3. f4 — White",
        "text": "The Vienna Gambit. White attacks e5 and hopes to open the f-file — the King's Gambit idea, but with the c3 knight already in play."
      },
      {
        "label": "3... d5 — Black",
        "text": "The best antidote is a counter-strike in the center. Black opens lines while White's king is still on e1, rather than grabbing f4 (3...exf4 4.e5 would drive the knight back)."
      },
      {
        "label": "4. fxe5 — White",
        "text": "White takes the pawn, gaining space and attacking the f6 knight. The e5 pawn will cramp Black's kingside for a long time if it survives."
      },
      {
        "label": "4... Nxe4 — Black",
        "text": "The knight jumps into the center, where it attacks c3 and cannot easily be kicked — there is no white d-pawn on d3 yet, and f3 is no longer possible."
      },
      {
        "label": "5. Nf3 — White",
        "text": "Natural development. The knight protects e5, eyes g5, and supports d4 to build a big pawn center."
      },
      {
        "label": "5... Be7 — Black",
        "text": "Calm and solid. Black develops and prepares to castle, keeping the strong knight on e4 for now."
      },
      {
        "label": "6. d4 — White",
        "text": "White builds the e5-d4 pawn center and opens the diagonal for the c1 bishop. This space is White's reward for the gambit."
      },
      {
        "label": "6... O-O — Black",
        "text": "Black puts the king safe. The rook on f8 will be important once the f-file opens."
      },
      {
        "label": "7. Bd3 — White",
        "text": "The bishop develops with a purpose: it challenges the e4 knight and, once that knight is gone, aims at h7."
      },
      {
        "label": "7... f5 — Black",
        "text": "Black props up the e4 knight with the f-pawn. The drawback is that White can now capture en passant and remove that support."
      },
      {
        "label": "8. exf6 — White",
        "text": "White captures en passant. The e4 knight loses its f5 support, and the f-file opens for White's rook after castling."
      },
      {
        "label": "8... Bxf6 — Black",
        "text": "The bishop recaptures and lands on a good diagonal, pressing against d4 and keeping the Ne4 in place."
      },
      {
        "label": "9. O-O — White",
        "text": "White castles, putting the rook on the open f-file. Now Nxe4 followed by Bxe4 is a real threat to win a pawn."
      },
      {
        "label": "9... Nc6 — Black",
        "text": "Black develops with a counterattack on d4. If White wins the e4 pawn, Black plans to win the d4 pawn in return."
      },
      {
        "label": "10. Nxe4 — White",
        "text": "White removes Black's best piece. Without the e4 knight, Black's pawn on e4 becomes a target."
      },
      {
        "label": "10... dxe4 — Black",
        "text": "Black recaptures. The pawn on e4 hits both the d3 bishop and the f3 knight, so White must react."
      },
      {
        "label": "11. Bxe4 — White",
        "text": "White takes the pawn and centralizes the bishop, which now attacks the c6 knight and eyes h7."
      },
      {
        "label": "11... Nxd4 — Black",
        "text": "Black wins the pawn back. The knight on d4 is active, attacking the f3 knight, and the f6 bishop supports it from behind."
      },
      {
        "label": "12. c3 — White",
        "text": "White drives the knight away. Taking with 12.Nxd4? would be a mistake: 12...Qxd4+ followed by ...Bxd4+ uses the open f-file and wins material."
      },
      {
        "label": "12... Nxf3+ — Black",
        "text": "Black trades knights with check, the simplest way to relieve the pressure."
      },
      {
        "label": "13. Bxf3 — White",
        "text": "White recaptures with the bishop. Material is level, but White's pieces are active and the queenside pawns are healthy; queens often come off with ...Qxd1 Rxd1, leaving an open position where White's bishops give a slight pull."
      }
    ],
    "keyIdeas": [
      "2.Nc3 keeps f4 available — King's Gambit ideas with a knight already out",
      "Against 3...d5, take on e5 and build a center with Nf3 and d4",
      "Challenge Black's e4 knight with Bd3 and Nxe4 rather than letting it dominate",
      "Once both f-pawns are gone, watch the open f-file — check tactics like 12.Nxd4? Qxd4+"
    ]
  },
  {
    "id": "catalan",
    "name": "Catalan Opening",
    "eco": "E05",
    "category": "white",
    "tagline": "Queen's Gambit meets the long-diagonal fianchetto",
    "description": "The Catalan combines the Queen's Gambit (d4 and c4) with a kingside fianchetto: the g2 bishop aims down the long diagonal at d5, b7 and the whole queenside. It is a favorite of positional players because White's pressure is long-lasting and low-risk. In the Open Catalan, Black takes the c4 pawn; White usually does not hurry to win it back, relying on Qc2 or Qa4+ to regain it later. The line shown is the classical main line, where Black gains time with ...a6 and ...b5 and contests the long diagonal with ...Bb7.",
    "moves": [
      "d4",
      "Nf6",
      "c4",
      "e6",
      "g3",
      "d5",
      "Bg2",
      "Be7",
      "Nf3",
      "O-O",
      "O-O",
      "dxc4",
      "Qc2",
      "a6",
      "Qxc4",
      "b5",
      "Qc2",
      "Bb7",
      "Bd2",
      "Be4",
      "Qc1",
      "Bb7",
      "Bf4",
      "Bd6",
      "Nbd2",
      "Nbd7"
    ],
    "explanations": [
      {
        "label": "1. d4 — White",
        "text": "The Queen's Pawn. White takes central space and prepares c4."
      },
      {
        "label": "1... Nf6 — Black",
        "text": "Black develops flexibly, controlling e4 and keeping options open between the Indian defenses and ...d5 structures."
      },
      {
        "label": "2. c4 — White",
        "text": "White grabs more queenside space and puts pressure on d5 before Black has occupied it."
      },
      {
        "label": "2... e6 — Black",
        "text": "Black prepares ...d5 (or ...Bb4) and opens the f8 bishop."
      },
      {
        "label": "3. g3 — White",
        "text": "The Catalan move. White prepares Bg2, where the bishop will press against d5 and the queenside along the long diagonal."
      },
      {
        "label": "3... d5 — Black",
        "text": "Black takes the center in Queen's Gambit Declined style. The question for later is whether to keep the pawn on d5 or take on c4."
      },
      {
        "label": "4. Bg2 — White",
        "text": "The bishop arrives on its key diagonal. Every Catalan plan relies on this piece."
      },
      {
        "label": "4... Be7 — Black",
        "text": "Black develops and prepares to castle. Delaying ...dxc4 keeps Black's options flexible."
      },
      {
        "label": "5. Nf3 — White",
        "text": "Natural development, covering d4 and e5 and preparing to castle."
      },
      {
        "label": "5... O-O — Black",
        "text": "Black castles. Now Black has to decide how to deal with White's pressure on d5."
      },
      {
        "label": "6. O-O — White",
        "text": "White castles and leaves the c4 pawn hanging on purpose. White is happy to give it up temporarily in return for development and pressure on the long diagonal."
      },
      {
        "label": "6... dxc4 — Black",
        "text": "The Open Catalan. Black takes the pawn, giving up the d5 point but opening the position and forcing White to spend time winning the pawn back."
      },
      {
        "label": "7. Qc2 — White",
        "text": "The main line. The queen prepares to recapture on c4 while staying on the c-file and supporting a later e4."
      },
      {
        "label": "7... a6 — Black",
        "text": "Black prepares ...b5, gaining time against the queen once it lands on c4."
      },
      {
        "label": "8. Qxc4 — White",
        "text": "White regains the pawn. Material is level, and White's queen and g2 bishop both look at the queenside."
      },
      {
        "label": "8... b5 — Black",
        "text": "Black gains time on the queen and clears b7 for the bishop. The drawback is that c6 and c5 become slightly weaker."
      },
      {
        "label": "9. Qc2 — White",
        "text": "The queen retreats, keeping an eye on c7 and the half-open c-file."
      },
      {
        "label": "9... Bb7 — Black",
        "text": "Black's most important idea: the bishop contests the long diagonal and neutralizes the g2 bishop."
      },
      {
        "label": "10. Bd2 — White",
        "text": "White develops the bishop and prepares Ba5 to tie Black down on c7, or Bf4 later."
      },
      {
        "label": "10... Be4 — Black",
        "text": "Black gains a tempo on the queen, which must leave the b1-h7 diagonal."
      },
      {
        "label": "11. Qc1 — White",
        "text": "The queen steps aside but stays on the c-file, supporting pressure on c7 and ready to back up a bishop on f4."
      },
      {
        "label": "11... Bb7 — Black",
        "text": "The bishop returns to its best diagonal. Black is content: White's queen is on c1, and the b7 bishop still blunts the Catalan bishop."
      },
      {
        "label": "12. Bf4 — White",
        "text": "The bishop goes to f4 after all, attacking c7 together with the queen on c1. This makes Black's freeing ...c5 harder to arrange."
      },
      {
        "label": "12... Bd6 — Black",
        "text": "Black challenges the f4 bishop and covers c7. A trade on d6 or f4 would ease Black's position."
      },
      {
        "label": "13. Nbd2 — White",
        "text": "White develops the last minor piece. The knight is heading for b3, from where it can jump to c5 or a5 and attack the queenside light squares."
      },
      {
        "label": "13... Nbd7 — Black",
        "text": "Black finishes development and prepares ...c5. This is a typical Open Catalan middlegame: White has lasting queenside pressure, Black a solid position and the ...c5 break."
      }
    ],
    "keyIdeas": [
      "The g2 bishop is the heart of the Catalan — keep the long diagonal open",
      "In the Open Catalan, White regains c4 with Qc2 and Qxc4 instead of defending it",
      "Black's counterplay: ...a6, ...b5, ...Bb7 to fight the diagonal, then ...c5",
      "White targets c7 and the c5/a5 squares, often with Bf4, Nbd2-b3 and the a4 lever"
    ]
  },
  {
    "id": "kings-indian-attack",
    "name": "King's Indian Attack",
    "eco": "A08",
    "category": "white",
    "tagline": "A reversed King's Indian setup against almost anything",
    "description": "The King's Indian Attack is a system rather than a fixed line. White plays Nf3, g3, Bg2, O-O, d3, Nbd2 and e4 against almost any defense — a King's Indian Defense with colors reversed and an extra tempo. It suits players who want familiar plans instead of heavy theory. Against Black's popular ...d5, ...c5, ...Nc6 and ...e6 setup, White can push e5 and attack on the kingside, or meet Black's fast queenside expansion by opening the center. The line shown takes the second route: White blunts ...b5 with a4, then exd5 and d4 leave Black with an isolated d-pawn.",
    "moves": [
      "Nf3",
      "d5",
      "g3",
      "c5",
      "Bg2",
      "Nc6",
      "O-O",
      "e6",
      "d3",
      "Nf6",
      "Nbd2",
      "Be7",
      "e4",
      "O-O",
      "Re1",
      "b5",
      "a4",
      "b4",
      "exd5",
      "exd5",
      "d4",
      "Bg4",
      "dxc5",
      "Bxc5",
      "Nb3"
    ],
    "explanations": [
      {
        "label": "1. Nf3 — White",
        "text": "A flexible first move. The knight controls e5 and d4 and White does not yet commit any central pawns."
      },
      {
        "label": "1... d5 — Black",
        "text": "Black takes the center with a pawn — the most common reply."
      },
      {
        "label": "2. g3 — White",
        "text": "White prepares the fianchetto. This, together with Nf3, is the backbone of the King's Indian Attack."
      },
      {
        "label": "2... c5 — Black",
        "text": "Black grabs more space and aims for an ambitious setup with ...Nc6 and ...e6."
      },
      {
        "label": "3. Bg2 — White",
        "text": "The bishop goes to the long diagonal, pressing on d5 and guarding the king after castling."
      },
      {
        "label": "3... Nc6 — Black",
        "text": "Black develops and adds control over d4 and e5."
      },
      {
        "label": "4. O-O — White",
        "text": "White castles early. In the KIA the king is safe first and the central plan comes later."
      },
      {
        "label": "4... e6 — Black",
        "text": "Black builds a solid French-style center with ...e6, supporting d5 and opening the f8 bishop."
      },
      {
        "label": "5. d3 — White",
        "text": "The KIA structure: d3 prepares e4 and keeps the c1 bishop's diagonal open."
      },
      {
        "label": "5... Nf6 — Black",
        "text": "Natural development, eyeing e4."
      },
      {
        "label": "6. Nbd2 — White",
        "text": "The knight goes to d2 instead of c3 so it supports e4 without blocking the c-pawn. Later it can travel to f1, e3 or b3."
      },
      {
        "label": "6... Be7 — Black",
        "text": "Black develops and prepares to castle."
      },
      {
        "label": "7. e4 — White",
        "text": "The key KIA break. White challenges d5 and asks Black to decide what to do about the central tension."
      },
      {
        "label": "7... O-O — Black",
        "text": "Black castles and keeps the tension."
      },
      {
        "label": "8. Re1 — White",
        "text": "The rook supports e4 and, in many lines, a later e5 advance. Black's ...dxe4 is less attractive with the rook already on the e-file."
      },
      {
        "label": "8... b5 — Black",
        "text": "Black's typical plan: expand on the queenside with ...b5-b4 and ...a5-a4 while White's pieces are aimed at the kingside."
      },
      {
        "label": "9. a4 — White",
        "text": "White hits the b5 pawn at once. After ...bxa4 Black's queenside pawns would be split, so Black usually pushes past."
      },
      {
        "label": "9... b4 — Black",
        "text": "Black gains space, but the b-pawn can no longer defend c5 or control c4, which leaves Black's central pawns less supported."
      },
      {
        "label": "10. exd5 — White",
        "text": "With Black committed on the queenside, White releases the tension and opens the center."
      },
      {
        "label": "10... exd5 — Black",
        "text": "Black recaptures with the pawn, keeping a pawn on d5 for central presence."
      },
      {
        "label": "11. d4 — White",
        "text": "White strikes at c5 immediately. Black's c5 and d5 pawns are now a target, and Black cannot support c5 with ...b6."
      },
      {
        "label": "11... Bg4 — Black",
        "text": "Black develops actively, pinning the f3 knight and adding pressure against d4."
      },
      {
        "label": "12. dxc5 — White",
        "text": "White takes on c5, leaving Black with an isolated d-pawn."
      },
      {
        "label": "12... Bxc5 — Black",
        "text": "Black regains the pawn and the bishop becomes active, eyeing f2."
      },
      {
        "label": "13. Nb3 — White",
        "text": "The knight hits the c5 bishop and heads for d4, the ideal blockading square in front of the isolated pawn. The g2 bishop adds long-term pressure on d5."
      }
    ],
    "keyIdeas": [
      "The KIA setup: Nf3, g3, Bg2, O-O, d3, Nbd2 and e4 — a reversed King's Indian",
      "Re1 supports e4 and prepares e5 in many lines",
      "Meet ...b5 with a4 so Black's queenside expansion costs something",
      "If Black overextends, open the center with exd5 and d4 and blockade the isolated pawn on d4"
    ]
  },
  {
    "id": "scandinavian",
    "name": "Scandinavian Defense",
    "eco": "B01",
    "category": "black",
    "tagline": "Hit e4 at once — free bishop and a healthy structure",
    "description": "The Scandinavian Defense (1...d5) strikes at e4 on the very first move. After 2.exd5 Qxd5 Black's queen comes out early and White gains a tempo with 3.Nc3, but in return Black gets a healthy Caro-Kann-style pawn structure and free development for the light-squared bishop. The 3...Qa5 line shown is the classical main line: the queen is safe on a5, the bishop goes to f5 before ...e6, and Black builds a compact position with clear plans.",
    "moves": [
      "e4",
      "d5",
      "exd5",
      "Qxd5",
      "Nc3",
      "Qa5",
      "d4",
      "Nf6",
      "Nf3",
      "c6",
      "Bc4",
      "Bf5",
      "Bd2",
      "e6",
      "Qe2",
      "Bb4",
      "O-O-O",
      "Nbd7",
      "a3",
      "Bxc3",
      "Bxc3",
      "Qc7",
      "Rhe1",
      "b5",
      "Bd3",
      "O-O"
    ],
    "explanations": [
      {
        "label": "1. e4 — White",
        "text": "White opens with the King's Pawn, claiming the center and opening lines for the queen and bishop."
      },
      {
        "label": "1... d5 — Black",
        "text": "The Scandinavian Defense! Black challenges e4 immediately instead of preparing the challenge first. The center is decided right away."
      },
      {
        "label": "2. exd5 — White",
        "text": "White takes the pawn — by far the most common reply. Pushing past with 2.e5 would give Black an easy ...Bf5 or ...c5."
      },
      {
        "label": "2... Qxd5 — Black",
        "text": "The queen recaptures. Bringing the queen out early costs a tempo, but Black regains the pawn at once and keeps a healthy pawn structure."
      },
      {
        "label": "3. Nc3 — White",
        "text": "White develops with gain of time, attacking the queen. This is the main reason White likes to take on d5."
      },
      {
        "label": "3... Qa5 — Black",
        "text": "The classical retreat. On a5 the queen is out of reach of White's minor pieces and stays active — after d4 it pins the Nc3 along the diagonal to the king on e1."
      },
      {
        "label": "4. d4 — White",
        "text": "White grabs the center and frees the dark-squared bishop. White has a lead in development and more central space."
      },
      {
        "label": "4... Nf6 — Black",
        "text": "Black develops the knight to its best square, controlling e4 and d5 and preparing to castle kingside."
      },
      {
        "label": "5. Nf3 — White",
        "text": "Natural development. The knight eyes the e5 square and prepares to castle."
      },
      {
        "label": "5... c6 — Black",
        "text": "An important little move. The c6 pawn takes b5 and d5 away from White's knights, so they cannot jump forward to harass the queen, and it gives Black a solid Caro-Kann-like structure."
      },
      {
        "label": "6. Bc4 — White",
        "text": "The bishop takes the active a2-g8 diagonal, aiming at f7 and the kingside."
      },
      {
        "label": "6... Bf5 — Black",
        "text": "The light-squared bishop comes out BEFORE ...e6 locks it in. This is the main strategic plus of the Scandinavian, just like in the Caro-Kann."
      },
      {
        "label": "7. Bd2 — White",
        "text": "White breaks the pin on the Nc3. Now the bishop on d2 stands behind the knight, so any knight jump would uncover an attack on the queen — Black must keep an eye on that."
      },
      {
        "label": "7... e6 — Black",
        "text": "Black solidifies d5 and e5 and opens the diagonal for the f8 bishop. With the bishop already on f5, ...e6 costs Black nothing."
      },
      {
        "label": "8. Qe2 — White",
        "text": "The queen connects the rooks and prepares to castle queenside. From e2 it also supports ideas like d5 or Ne5 along the e-file."
      },
      {
        "label": "8... Bb4 — Black",
        "text": "The bishop adds a second attacker to the Nc3 alongside the queen on a5. Black is ready to give up this bishop for the knight if needed."
      },
      {
        "label": "9. O-O-O — White",
        "text": "White castles queenside and brings a rook to d1 behind the d4 pawn. With the kings likely to end up on opposite wings, the game becomes more double-edged."
      },
      {
        "label": "9... Nbd7 — Black",
        "text": "Black completes the minor-piece development. The knight supports the f6 knight and the ...c5 or ...e5 breaks, and keeps the option of ...Nb6."
      },
      {
        "label": "10. a3 — White",
        "text": "White asks the bishop a question: retreat or exchange."
      },
      {
        "label": "10... Bxc3 — Black",
        "text": "Black exchanges rather than retreating to e7, which would only lose time. Giving up the bishop removes a key knight and keeps Black's development smooth."
      },
      {
        "label": "11. Bxc3 — White",
        "text": "White recaptures with the bishop, which now attacks the queen on a5 along the diagonal. White has the bishop pair; Black has a very solid position."
      },
      {
        "label": "11... Qc7 — Black",
        "text": "The queen steps to c7, a safe square where it controls e5 and the b8-h2 diagonal alongside the Bf5."
      },
      {
        "label": "12. Rhe1 — White",
        "text": "White brings the last piece into play. The rook on e1 backs up the queen and supports a later d5 break or Ne5."
      },
      {
        "label": "12... b5 — Black",
        "text": "Black gains space on the queenside, kicks the Bc4 off its strong diagonal, and starts counterplay on the side where White's king lives."
      },
      {
        "label": "13. Bd3 — White",
        "text": "The bishop retreats to d3, offering to trade off Black's good light-squared bishop."
      },
      {
        "label": "13... O-O — Black",
        "text": "Black castles kingside, away from the action in the center. The position is about level: White has the bishop pair and more space, Black has a sound structure and queenside play with ...a5 and ...b4."
      }
    ],
    "keyIdeas": [
      "3...Qa5: the queen is safe from White's minor pieces and pins the Nc3",
      "Develop the bishop to f5 BEFORE ...e6 — the Caro-Kann idea",
      "...c6 takes b5 and d5 away from White's knights, so the queen is not harassed",
      "Watch for discovered attacks on the queen when White's bishop is behind the Nc3"
    ]
  },
  {
    "id": "pirc",
    "name": "Pirc Defense",
    "eco": "B08",
    "category": "black",
    "tagline": "Hypermodern — let White build a center, then strike it",
    "description": "The Pirc Defense (1...d6, 2...Nf6 and 3...g6) is a hypermodern opening: Black allows White a big pawn center, fianchettoes the bishop on g7 and then strikes at the center with ...e5 or ...c5. The Classical Variation shown (4.Nf3 and 5.Be2) is White's calm, solid setup. Black piles up on d4 with ...Bg4 and ...Nc6, breaks with ...e5, and after White exchanges on e5 the open d-file leads to a level position.",
    "moves": [
      "e4",
      "d6",
      "d4",
      "Nf6",
      "Nc3",
      "g6",
      "Nf3",
      "Bg7",
      "Be2",
      "O-O",
      "O-O",
      "Bg4",
      "Be3",
      "Nc6",
      "Qd2",
      "e5",
      "dxe5",
      "dxe5",
      "Rad1",
      "Qc8",
      "Qc1",
      "Rd8",
      "Rxd8+",
      "Qxd8",
      "Rd1",
      "Qf8"
    ],
    "explanations": [
      {
        "label": "1. e4 — White",
        "text": "White opens with the King's Pawn, claiming central space."
      },
      {
        "label": "1... d6 — Black",
        "text": "The Pirc begins. Black makes a modest pawn move that prepares ...Nf6 and keeps a later ...e5 well supported."
      },
      {
        "label": "2. d4 — White",
        "text": "White accepts the invitation and builds the ideal two-pawn center."
      },
      {
        "label": "2... Nf6 — Black",
        "text": "Black attacks the e4 pawn straight away, so White has to spend a move defending it."
      },
      {
        "label": "3. Nc3 — White",
        "text": "White defends e4 with a developing move. This is the most natural reply."
      },
      {
        "label": "3... g6 — Black",
        "text": "Black prepares to fianchetto the bishop on g7, where it will bear down on the long diagonal and White's d4 pawn."
      },
      {
        "label": "4. Nf3 — White",
        "text": "The Classical Variation. Instead of an early pawn storm with f4 or Be3 and Qd2, White simply develops and keeps the center solid."
      },
      {
        "label": "4... Bg7 — Black",
        "text": "The fianchetto is complete. The Bg7 is Black's key piece in the Pirc — it pressures the center from a distance and protects the castled king."
      },
      {
        "label": "5. Be2 — White",
        "text": "A modest but solid square. White's plan is simple: castle and keep the big center."
      },
      {
        "label": "5... O-O — Black",
        "text": "Black castles, completing the kingside setup before choosing how to hit the center."
      },
      {
        "label": "6. O-O — White",
        "text": "White castles too. Both kings are safe, and the fight for the center begins."
      },
      {
        "label": "6... Bg4 — Black",
        "text": "The bishop develops actively and targets the Nf3, one of the key defenders of d4. Black plans to pile up on that pawn."
      },
      {
        "label": "7. Be3 — White",
        "text": "White protects d4 with the bishop and prepares Qd2, connecting the rooks."
      },
      {
        "label": "7... Nc6 — Black",
        "text": "Another piece joins the pressure on d4, and the knight also supports the coming ...e5 break."
      },
      {
        "label": "8. Qd2 — White",
        "text": "The queen connects the rooks and prepares Rad1. From d2 it also eyes Bh6, an idea for trading off the strong Bg7."
      },
      {
        "label": "8... e5 — Black",
        "text": "The central strike! With all the pieces ready, Black challenges d4 directly. This ...e5 break is the heart of most Pirc positions."
      },
      {
        "label": "9. dxe5 — White",
        "text": "White releases the tension and opens the d-file. The sharper 9.d5 gains space and keeps more tension in the center."
      },
      {
        "label": "9... dxe5 — Black",
        "text": "Black recaptures. The center is now symmetrical, and Black's pieces are as well placed as White's."
      },
      {
        "label": "10. Rad1 — White",
        "text": "White puts the rook behind the queen on the open d-file, so the two queens now face each other."
      },
      {
        "label": "10... Qc8 — Black",
        "text": "Black steps off the d-file and keeps the queens on. From c8 the queen also defends the Bg4 and makes room for ...Rd8."
      },
      {
        "label": "11. Qc1 — White",
        "text": "White also keeps the queens on, moving off the d-file so the rook can fight for it."
      },
      {
        "label": "11... Rd8 — Black",
        "text": "Black contests the only open file. Whoever controls the d-file gets the better of the coming middlegame."
      },
      {
        "label": "12. Rxd8+ — White",
        "text": "White trades rooks on d8."
      },
      {
        "label": "12... Qxd8 — Black",
        "text": "The queen recaptures and takes over the d-file for the moment."
      },
      {
        "label": "13. Rd1 — White",
        "text": "White brings the other rook to the d-file with tempo, attacking the queen."
      },
      {
        "label": "13... Qf8 — Black",
        "text": "The queen steps to f8, where it guards the kingside and the back rank. Black will follow with ...Rd8 to challenge the file again. The position is level, with no weaknesses for Black."
      }
    ],
    "keyIdeas": [
      "Hypermodern idea: allow White a big center, then strike it with ...e5 or ...c5",
      "The Bg7 fianchetto is Black's key piece — protect it and keep its diagonal open",
      "...Bg4 and ...Nc6 pile pressure on d4 before the ...e5 break",
      "After dxe5 dxe5, contest the open d-file and the position is level"
    ]
  },
  {
    "id": "petrov",
    "name": "Petrov's Defense",
    "eco": "C42",
    "category": "black",
    "tagline": "Counterattack e4 — symmetrical and very solid",
    "description": "Petrov's Defense, also called the Russian Game, answers 2.Nf3 not by defending e5 but by counterattacking e4 with 2...Nf6. It is known as one of Black's most solid replies to 1.e4. The first lesson comes early: after 3.Nxe5, Black must kick the knight with 3...d6 before taking on e4. The Classical main line shown (5.d4 d5 6.Bd3) leads to a symmetrical position in which Black's active pieces balance White's small lead in development.",
    "moves": [
      "e4",
      "e5",
      "Nf3",
      "Nf6",
      "Nxe5",
      "d6",
      "Nf3",
      "Nxe4",
      "d4",
      "d5",
      "Bd3",
      "Nc6",
      "O-O",
      "Be7",
      "c4",
      "Nb4",
      "Be2",
      "O-O",
      "Nc3",
      "Bf5",
      "a3",
      "Nxc3",
      "bxc3",
      "Nc6",
      "Re1",
      "Re8",
      "Bf4",
      "dxc4",
      "Bxc4",
      "Bd6"
    ],
    "explanations": [
      {
        "label": "1. e4 — White",
        "text": "White opens with the King's Pawn, claiming the center."
      },
      {
        "label": "1... e5 — Black",
        "text": "Black meets the center symmetrically, taking an equal share of space."
      },
      {
        "label": "2. Nf3 — White",
        "text": "White develops and attacks the e5 pawn."
      },
      {
        "label": "2... Nf6 — Black",
        "text": "Petrov's Defense! Instead of defending e5, Black counterattacks White's e4 pawn. The position stays symmetrical and very solid."
      },
      {
        "label": "3. Nxe5 — White",
        "text": "The main line. White takes the pawn, and now Black must be careful about how to win it back."
      },
      {
        "label": "3... d6 — Black",
        "text": "Essential! Black kicks the knight away first. Copying with 3...Nxe4? runs into 4.Qe2!, when 4...Nf6?? loses the queen to 5.Nc6+ (a discovered check), and 4...Qe7 5.Qxe4 leaves White a pawn up."
      },
      {
        "label": "4. Nf3 — White",
        "text": "The knight retreats to its natural square. White keeps a small lead in development."
      },
      {
        "label": "4... Nxe4 — Black",
        "text": "Now it is safe to take. Material is level again and Black's knight stands proudly in the center."
      },
      {
        "label": "5. d4 — White",
        "text": "The Classical main line. White takes the center and prepares Bd3 to challenge the Ne4."
      },
      {
        "label": "5... d5 — Black",
        "text": "Black supports the Ne4 with a pawn and mirrors White's center."
      },
      {
        "label": "6. Bd3 — White",
        "text": "White develops with an attack on the Ne4 and points the bishop at the kingside."
      },
      {
        "label": "6... Nc6 — Black",
        "text": "Black develops and puts pressure on d4. The knight can also jump to b4 to chase White's strong bishop."
      },
      {
        "label": "7. O-O — White",
        "text": "White castles, getting the king safe before opening the position."
      },
      {
        "label": "7... Be7 — Black",
        "text": "A modest, solid square for the bishop. Black prepares to castle and keeps the position compact."
      },
      {
        "label": "8. c4 — White",
        "text": "White strikes at d5, the pawn that supports Black's knight on e4. This is White's main way to fight for an edge."
      },
      {
        "label": "8... Nb4 — Black",
        "text": "The knight attacks the Bd3, White's most dangerous attacking piece, and eyes the c2 square."
      },
      {
        "label": "9. Be2 — White",
        "text": "White keeps the bishop rather than allowing it to be exchanged, retreating to e2."
      },
      {
        "label": "9... O-O — Black",
        "text": "Black castles. Both sides have finished the basic development."
      },
      {
        "label": "10. Nc3 — White",
        "text": "White develops the last knight and challenges Black's centralized Ne4."
      },
      {
        "label": "10... Bf5 — Black",
        "text": "The bishop develops and supports the Ne4. If the knight moves, the bishop will also join the Nb4 in eyeing c2."
      },
      {
        "label": "11. a3 — White",
        "text": "White kicks the Nb4, which has no secure future on that square."
      },
      {
        "label": "11... Nxc3 — Black",
        "text": "Black first exchanges the e4 knight, so White must recapture with a pawn, and only then retreats the other knight."
      },
      {
        "label": "12. bxc3 — White",
        "text": "White recaptures toward the center. Now the Nb4 is attacked by two pawns."
      },
      {
        "label": "12... Nc6 — Black",
        "text": "The knight returns to c6, its best square, where it again presses on d4."
      },
      {
        "label": "13. Re1 — White",
        "text": "White takes the open e-file with the rook."
      },
      {
        "label": "13... Re8 — Black",
        "text": "Black contests the e-file at once, so White cannot use it alone."
      },
      {
        "label": "14. Bf4 — White",
        "text": "White develops the last minor piece to an active square, controlling c7 and the e5 square."
      },
      {
        "label": "14... dxc4 — Black",
        "text": "Black releases the central tension. The e2 bishop has to spend a move recapturing, and the c3 pawn can become a long-term target."
      },
      {
        "label": "15. Bxc4 — White",
        "text": "White recaptures, and the bishop is active on c4, aiming at f7."
      },
      {
        "label": "15... Bd6 — Black",
        "text": "Black offers to trade the active Bf4. With the e-file contested and the pieces evenly matched, the position is level."
      }
    ],
    "keyIdeas": [
      "After 3.Nxe5, play 3...d6 FIRST — 3...Nxe4? walks into 4.Qe2!",
      "The Ne4 is Black's pride — support it with ...d5 and ...Bf5",
      "...Nb4 hunts White's attacking bishop on d3",
      "Symmetrical structure: contest the open e-file and trade active pieces to equalize"
    ],
    "variations": [
      {
        "id": "petrov-modern",
        "name": "Modern Attack (3.d4)",
        "note": "3.d4 branch — Black gives back a pawn for activity",
        "tagline": "Meet 3.d4 with quick development and a pawn sacrifice",
        "description": "Instead of taking on e5, White can open the center with 3.d4. Black takes on e4 and develops quickly; after the c-pawns are exchanged, Black lets the d5 pawn go in return for a lead in development and active bishops aimed at White's king.",
        "moves": [
          "e4",
          "e5",
          "Nf3",
          "Nf6",
          "d4",
          "Nxe4",
          "Bd3",
          "d5",
          "Nxe5",
          "Nd7",
          "Nxd7",
          "Bxd7",
          "O-O",
          "Bd6",
          "c4",
          "c6",
          "cxd5",
          "cxd5",
          "Qh5",
          "O-O",
          "Qxd5",
          "Bc6"
        ],
        "explanations": [
          {
            "label": "1. e4 — White",
            "text": "White opens with the King's Pawn."
          },
          {
            "label": "1... e5 — Black",
            "text": "Black answers symmetrically."
          },
          {
            "label": "2. Nf3 — White",
            "text": "White develops and attacks e5."
          },
          {
            "label": "2... Nf6 — Black",
            "text": "Petrov's Defense — Black counterattacks e4."
          },
          {
            "label": "3. d4 — White",
            "text": "The Modern Attack. Instead of taking on e5, White opens the center at once."
          },
          {
            "label": "3... Nxe4 — Black",
            "text": "Black takes the e4 pawn, which is no longer defended, and centralizes the knight."
          },
          {
            "label": "4. Bd3 — White",
            "text": "White develops with an attack on the Ne4."
          },
          {
            "label": "4... d5 — Black",
            "text": "Black supports the knight with a pawn, building a solid center."
          },
          {
            "label": "5. Nxe5 — White",
            "text": "White wins back the pawn and puts the knight on a strong central square."
          },
          {
            "label": "5... Nd7 — Black",
            "text": "Black challenges the strong Ne5 at once, offering to trade it off."
          },
          {
            "label": "6. Nxd7 — White",
            "text": "White exchanges the knights."
          },
          {
            "label": "6... Bxd7 — Black",
            "text": "Black recaptures with the bishop, developing a piece in the process."
          },
          {
            "label": "7. O-O — White",
            "text": "White castles, getting ready to attack the Ne4 with c4 or Re1."
          },
          {
            "label": "7... Bd6 — Black",
            "text": "The bishop takes an active diagonal pointing at h2, in front of White's castled king."
          },
          {
            "label": "8. c4 — White",
            "text": "White hits d5, the pawn that holds up Black's knight on e4."
          },
          {
            "label": "8... c6 — Black",
            "text": "Black supports d5 with another pawn and keeps the center solid for now."
          },
          {
            "label": "9. cxd5 — White",
            "text": "White trades the c-pawn to open lines."
          },
          {
            "label": "9... cxd5 — Black",
            "text": "Black recaptures, keeping a pawn on d5 to support the knight."
          },
          {
            "label": "10. Qh5 — White",
            "text": "An aggressive queen move: it attacks the d5 pawn and eyes the h7 and f7 squares."
          },
          {
            "label": "10... O-O — Black",
            "text": "Black ignores the threat to d5 and castles. Defending the pawn would cost time; Black prefers to give it back for a lead in development."
          },
          {
            "label": "11. Qxd5 — White",
            "text": "White takes the pawn, but the queen is now exposed in the center."
          },
          {
            "label": "11... Bc6 — Black",
            "text": "The bishop attacks the queen with tempo and lines up on the long diagonal toward g2. Black's lead in development and active bishops give good compensation for the pawn."
          }
        ],
        "keyIdeas": [
          "Against 3.d4, take on e4 and develop quickly",
          "Trade off White's strong Ne5 with ...Nd7",
          "A lead in development can be worth more than a pawn",
          "...Bc6 gains time on the queen and aims at g2"
        ]
      }
    ]
  },
  {
    "id": "alekhine",
    "name": "Alekhine's Defense",
    "eco": "B04",
    "category": "black",
    "tagline": "Provoke the pawns forward, then attack them",
    "description": "Alekhine's Defense (1...Nf6) invites White to chase the knight with pawns. The idea is provocative: a big pawn center can become a target if Black attacks it from the side and from behind. The Modern Variation (4.Nf3) is White's most common setup — White keeps a strong pawn on e5 without overreaching. In the line shown, Black fianchettoes with 4...g6 to hit e5 and d4, and against White's sharp 7.Ng5 and 8.f4 strikes at the base of the chain with ...c5.",
    "moves": [
      "e4",
      "Nf6",
      "e5",
      "Nd5",
      "d4",
      "d6",
      "Nf3",
      "g6",
      "Bc4",
      "Nb6",
      "Bb3",
      "Bg7",
      "Ng5",
      "e6",
      "f4",
      "dxe5",
      "fxe5",
      "c5",
      "c3",
      "cxd4",
      "cxd4",
      "Nc6",
      "Nf3",
      "O-O"
    ],
    "explanations": [
      {
        "label": "1. e4 — White",
        "text": "White opens with the King's Pawn, claiming the center."
      },
      {
        "label": "1... Nf6 — Black",
        "text": "Alekhine's Defense! Black attacks e4 at once and invites White to push the pawn forward with tempo."
      },
      {
        "label": "2. e5 — White",
        "text": "White accepts the challenge, kicking the knight and gaining space."
      },
      {
        "label": "2... Nd5 — Black",
        "text": "The knight jumps to a strong central square. White will try to chase it again, but every pawn move also stretches White's position."
      },
      {
        "label": "3. d4 — White",
        "text": "White builds a big center and supports the e5 pawn."
      },
      {
        "label": "3... d6 — Black",
        "text": "Black attacks e5 right away. The plan is to undermine White's center before it can be backed up by pieces."
      },
      {
        "label": "4. Nf3 — White",
        "text": "The Modern Variation. White defends e5 with a piece instead of more pawns, keeping a sensible, flexible center."
      },
      {
        "label": "4... g6 — Black",
        "text": "Black prepares ...Bg7, where the bishop will bear down on e5 and the d4 pawn behind it."
      },
      {
        "label": "5. Bc4 — White",
        "text": "White develops with an attack on the Nd5, gaining time, and points the bishop at f7."
      },
      {
        "label": "5... Nb6 — Black",
        "text": "The knight retreats and attacks the Bc4 in turn."
      },
      {
        "label": "6. Bb3 — White",
        "text": "White keeps the bishop on the a2-g8 diagonal, where it still eyes the f7 square."
      },
      {
        "label": "6... Bg7 — Black",
        "text": "The fianchetto is complete. The bishop now presses against e5 from g7."
      },
      {
        "label": "7. Ng5 — White",
        "text": "A sharp try. The knight and the Bb3 both aim at f7, and White threatens to break open Black's position with the e6 pawn push."
      },
      {
        "label": "7... e6 — Black",
        "text": "Black blunts the Bb3 and stops e6 for good. Castling first would let White play e6 with a strong attack."
      },
      {
        "label": "8. f4 — White",
        "text": "White supports e5 with another pawn, keeping the Ng5 on its aggressive square."
      },
      {
        "label": "8... dxe5 — Black",
        "text": "Black exchanges on e5, so White has to recapture with the f-pawn. The e5 pawn is then supported only by d4."
      },
      {
        "label": "9. fxe5 — White",
        "text": "White recaptures and keeps a pawn wedge on e5."
      },
      {
        "label": "9... c5 — Black",
        "text": "The key break. Black strikes at d4, the base of White's pawn chain — if d4 falls, the e5 pawn becomes weak."
      },
      {
        "label": "10. c3 — White",
        "text": "White supports d4 with another pawn."
      },
      {
        "label": "10... cxd4 — Black",
        "text": "Black exchanges to open the c-file and make d4 an isolated target."
      },
      {
        "label": "11. cxd4 — White",
        "text": "White recaptures, keeping the two center pawns side by side."
      },
      {
        "label": "11... Nc6 — Black",
        "text": "Black piles up on d4: the knight and the queen on the open d-file both attack it, and the Bg7 waits behind e5."
      },
      {
        "label": "12. Nf3 — White",
        "text": "The knight returns to f3 to defend d4 and e5. White's early attack is over."
      },
      {
        "label": "12... O-O — Black",
        "text": "Black castles. Next comes ...f6 or ...Nd7 to break up the e5 pawn and open the f-file. The position is roughly balanced, with clear targets for Black."
      }
    ],
    "keyIdeas": [
      "Provoke: 1...Nf6 tempts White's pawns forward to become targets",
      "Attack the center immediately with ...d6 — do not let White consolidate",
      "...e6 blunts the Bb3 and stops the e6 thrust against f7",
      "Undermine the chain at its base with ...c5, then hit e5 with ...f6"
    ]
  },
  {
    "id": "sicilian-najdorf",
    "name": "Sicilian Najdorf",
    "eco": "B90",
    "category": "black",
    "tagline": "The sharpest Sicilian — one quiet pawn move, endless fighting chances",
    "description": "The Najdorf (1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6) is named after Miguel Najdorf and became famous as the favorite weapon of Fischer and Kasparov. The modest 5...a6 takes b5 away from White's pieces and keeps every plan open: ...e5, ...e6 and ...b5 are all possible. This line shows the English Attack, where White plays Be3, f3, Qd2 and O-O-O, then storms the kingside with g4-g5 while Black races on the queenside with ...b5-b4. Kings on opposite wings mean every tempo counts.",
    "moves": [
      "e4",
      "c5",
      "Nf3",
      "d6",
      "d4",
      "cxd4",
      "Nxd4",
      "Nf6",
      "Nc3",
      "a6",
      "Be3",
      "e5",
      "Nb3",
      "Be6",
      "f3",
      "Be7",
      "Qd2",
      "O-O",
      "O-O-O",
      "Nbd7",
      "g4",
      "b5",
      "g5",
      "b4",
      "Ne2",
      "Ne8"
    ],
    "explanations": [
      {
        "label": "1. e4 — White",
        "text": "The King's Pawn — White takes the center and frees the queen and bishop."
      },
      {
        "label": "1... c5 — Black",
        "text": "The Sicilian Defense. Black fights for d4 from the flank and creates an unbalanced position from the very first move."
      },
      {
        "label": "2. Nf3 — White",
        "text": "White develops and prepares d4 to open the center."
      },
      {
        "label": "2... d6 — Black",
        "text": "Black controls e5 and opens a path for the c8 bishop. The d6 pawn is the base of most Najdorf structures."
      },
      {
        "label": "3. d4 — White",
        "text": "The Open Sicilian. White strikes in the center to open lines for the pieces."
      },
      {
        "label": "3... cxd4 — Black",
        "text": "Black swaps a wing pawn for a center pawn. The half-open c-file will be Black's main source of counterplay."
      },
      {
        "label": "4. Nxd4 — White",
        "text": "White recaptures with the knight, which now sits powerfully in the center."
      },
      {
        "label": "4... Nf6 — Black",
        "text": "The knight develops with tempo by attacking e4, so White has no time for c4 to clamp down on the center."
      },
      {
        "label": "5. Nc3 — White",
        "text": "White defends e4 and develops the queenside knight."
      },
      {
        "label": "5... a6 — Black",
        "text": "The Najdorf! This quiet move takes b5 away from White's knights and bishop, so Black can play ...e5 without a hole on b5 and later expand with ...b5."
      },
      {
        "label": "6. Be3 — White",
        "text": "The English Attack begins. White plans f3, Qd2 and O-O-O, then a kingside pawn storm with g4-g5."
      },
      {
        "label": "6... e5 — Black",
        "text": "Black gains space and kicks the centralized knight. The d5 square becomes a hole, so Black must keep it covered with pieces."
      },
      {
        "label": "7. Nb3 — White",
        "text": "The knight retreats to b3, where it is safe and keeps an eye on c5 and d4."
      },
      {
        "label": "7... Be6 — Black",
        "text": "The bishop goes straight to e6 to fight for d5 — the key square in this structure. If White ever gets a knight to d5 unchallenged, Black is in trouble."
      },
      {
        "label": "8. f3 — White",
        "text": "White stops ...Ng4, which would hit the Be3, and prepares the g4 advance. This is the trademark English Attack setup."
      },
      {
        "label": "8... Be7 — Black",
        "text": "Black develops the dark-squared bishop and gets ready to castle. The bishop also guards the Nf6 against a later g5."
      },
      {
        "label": "9. Qd2 — White",
        "text": "The queen connects with the Be3 and clears the way for queenside castling."
      },
      {
        "label": "9... O-O — Black",
        "text": "Black castles kingside. White's pawns are about to come forward, so Black must start the queenside counterattack quickly."
      },
      {
        "label": "10. O-O-O — White",
        "text": "White castles queenside. The kings are on opposite wings, and both sides will throw pawns at the enemy king."
      },
      {
        "label": "10... Nbd7 — Black",
        "text": "The knight develops to d7, supporting the Nf6 and keeping the c-file open for a rook. It can later jump to b6 to fight for d5 and c4."
      },
      {
        "label": "11. g4 — White",
        "text": "The pawn storm starts. White wants g5 to chase away the Nf6, Black's best defender of d5 and h7."
      },
      {
        "label": "11... b5 — Black",
        "text": "Black answers with a queenside pawn storm. The b-pawn heads for b4 to kick the Nc3 away from d5."
      },
      {
        "label": "12. g5 — White",
        "text": "White attacks the Nf6 and will follow up with f4-f5 if the knight retreats. Black has to act at once."
      },
      {
        "label": "12... b4 — Black",
        "text": "Counterattack before retreating! Black hits the Nc3 first. If 13.gxf6 bxc3, Black wins back the piece and opens lines toward White's king."
      },
      {
        "label": "13. Ne2 — White",
        "text": "The knight steps back to e2, from where it can head for f4 or g3 and still watch d4."
      },
      {
        "label": "13... Ne8 — Black",
        "text": "The knight retreats to e8, freeing the f-pawn for ...f6 or ...f5 and ready to reroute via c7. Black will continue with ...a5-a4 while White pushes f4. A balanced, razor-sharp race — the essence of the English Attack."
      }
    ],
    "keyIdeas": [
      "5...a6 takes b5 from White's pieces and keeps ...e5, ...e6 and ...b5 all available",
      "After ...e5 the whole game revolves around d5: Black's Be6 and knights must keep it covered",
      "English Attack: Be3, f3, Qd2 and O-O-O, then g4-g5 to drive away the Nf6",
      "Black's counterplay is ...b5-b4 and ...a5-a4 — on opposite wings, the faster attack usually wins"
    ]
  },
  {
    "id": "dutch",
    "name": "Dutch Defense",
    "eco": "A87",
    "category": "black",
    "tagline": "Grab e4 with the f-pawn — an uncompromising answer to 1.d4",
    "description": "The Dutch Defense (1.d4 f5) is one of Black's most combative replies to the Queen's Pawn. Instead of meeting d4 with a central pawn, Black controls e4 with the f-pawn and creates an unbalanced position from move one. The price is a slightly looser king. This line shows the Leningrad Dutch, named after the city whose players developed it: Black fianchettoes with ...g6 and ...Bg7, getting a King's Indian–style setup with the extra punch of f5. The other main system, the Stonewall, puts pawns on d5, e6 and f5 instead.",
    "moves": [
      "d4",
      "f5",
      "g3",
      "Nf6",
      "Bg2",
      "g6",
      "Nf3",
      "Bg7",
      "O-O",
      "O-O",
      "c4",
      "d6",
      "Nc3",
      "Qe8",
      "d5",
      "a5",
      "Nd4",
      "Na6",
      "Rb1",
      "Bd7",
      "b3",
      "c6",
      "Bb2",
      "Nc5"
    ],
    "explanations": [
      {
        "label": "1. d4 — White",
        "text": "The Queen's Pawn — White takes the center and keeps the c-pawn free for c4."
      },
      {
        "label": "1... f5 — Black",
        "text": "The Dutch Defense! Black fights for e4 with the f-pawn instead of a center pawn. It is ambitious and unbalanced, but it loosens the squares around Black's king."
      },
      {
        "label": "2. g3 — White",
        "text": "The most popular setup against the Dutch. The bishop will go to g2, where it fights for e4 — the very square Black is contesting — and d5."
      },
      {
        "label": "2... Nf6 — Black",
        "text": "Natural development. The knight adds a second guard to e4 and prepares quick castling."
      },
      {
        "label": "3. Bg2 — White",
        "text": "The bishop takes the long diagonal, aiming at e4, d5 and Black's queenside."
      },
      {
        "label": "3... g6 — Black",
        "text": "The Leningrad Dutch! Black fianchettoes too, combining the f5 pawn with a King's Indian–style bishop on g7."
      },
      {
        "label": "4. Nf3 — White",
        "text": "White develops the knight and prepares to castle."
      },
      {
        "label": "4... Bg7 — Black",
        "text": "The bishop lands on the long diagonal, pressing on d4 and supporting a later ...e5."
      },
      {
        "label": "5. O-O — White",
        "text": "White castles and gets the king safe before deciding on a central plan."
      },
      {
        "label": "5... O-O — Black",
        "text": "Black castles too. With the f-pawn already advanced, Black's king is a little airier than in a King's Indian, so castling early matters."
      },
      {
        "label": "6. c4 — White",
        "text": "White grabs queenside space and adds control of d5. Space on the queenside is White's main long-term plan."
      },
      {
        "label": "6... d6 — Black",
        "text": "Black prepares the central break ...e5 and opens the diagonal of the c8 bishop."
      },
      {
        "label": "7. Nc3 — White",
        "text": "The knight develops and adds pressure on e4 and d5. White is ready to meet ...e5 with d5 or dxe5."
      },
      {
        "label": "7... Qe8 — Black",
        "text": "A typical Leningrad move! The queen supports ...e5 and can swing to f7 or h5 for kingside play."
      },
      {
        "label": "8. d5 — White",
        "text": "White grabs space and takes c6 and e6 away from Black's pieces. If Black now plays ...e5, White can capture en passant and open the position."
      },
      {
        "label": "8... a5 — Black",
        "text": "Black prepares to plant a knight on c5. With the pawn on a5, White cannot easily drive it away with b4."
      },
      {
        "label": "9. Nd4 — White",
        "text": "The knight jumps to d4, eyeing e6 and b5 and opening the long diagonal for the Bg2."
      },
      {
        "label": "9... Na6 — Black",
        "text": "The knight heads for c5, the outpost Black prepared with ...a5. From there it will press on e4 and b3."
      },
      {
        "label": "10. Rb1 — White",
        "text": "White prepares queenside expansion with b3 and, later, a3 and b4 to push Black's pieces back."
      },
      {
        "label": "10... Bd7 — Black",
        "text": "Black completes development and connects the rooks. The bishop also supports the coming ...c6."
      },
      {
        "label": "11. b3 — White",
        "text": "White supports the c4 pawn and prepares Bb2, bringing the last minor piece to the long diagonal."
      },
      {
        "label": "11... c6 — Black",
        "text": "Black challenges the d5 pawn. If White allows ...cxd5, Black gets the half-open c-file and more room for the pieces."
      },
      {
        "label": "12. Bb2 — White",
        "text": "The bishop joins the long diagonal, facing Black's Bg7. White has a pleasant space advantage on the queenside."
      },
      {
        "label": "12... Nc5 — Black",
        "text": "The knight reaches its outpost on c5, eyeing e4 and b3. Black is fully developed with a flexible, fighting position and chances on both wings."
      }
    ],
    "keyIdeas": [
      "1...f5 fights for e4 from the side — an unbalanced game from the first move",
      "Leningrad setup: ...Nf6, ...g6, ...Bg7, ...O-O and ...d6, a King's Indian with the f-pawn already on f5",
      "...Qe8 supports ...e5 and can swing to f7 or h5 for kingside play",
      "After d5, ...a5 and ...Na6-c5 give Black a strong outpost; ...c6 then challenges White's center"
    ]
  },
  {
    "id": "lasker-trap",
    "name": "Lasker Trap",
    "eco": null,
    "category": "trap",
    "tagline": "A pawn marches to g1 and becomes a knight — with check",
    "description": "The Lasker Trap, named after World Champion Emanuel Lasker, arises from the Albin Countergambit (1.d4 d5 2.c4 e5). After the inaccurate 4.e3? Bb4+ 5.Bd2 dxe3, White must recapture with 6.fxe3. Taking the bishop with 6.Bxb4?? lets Black's pawn crash through: 6...exf2+ 7.Ke2 fxg1=N+! — a rare underpromotion to a knight — and White loses decisive material or gets mated. A promotion to a queen would let White trade queens and survive; the knight comes with check and keeps Black's attack alive.",
    "moves": [
      "d4",
      "d5",
      "c4",
      "e5",
      "dxe5",
      "d4",
      "e3",
      "Bb4+",
      "Bd2",
      "dxe3",
      "Bxb4",
      "exf2+",
      "Ke2",
      "fxg1=N+",
      "Ke1",
      "Qh4+",
      "Kd2",
      "Nc6",
      "Bc3",
      "Bg4",
      "Qe1",
      "O-O-O+"
    ],
    "explanations": [
      {
        "label": "1. d4 — White",
        "text": "The Queen's Pawn opening."
      },
      {
        "label": "1... d5 — Black",
        "text": "Black takes an equal share of the center."
      },
      {
        "label": "2. c4 — White",
        "text": "The Queen's Gambit — White offers the c-pawn to pull Black's d-pawn away from the center."
      },
      {
        "label": "2... e5!? — Black",
        "text": "The Albin Countergambit! Black offers a pawn in return for fast development and a cramping pawn on d4. Objectively it is a little dubious, but it is full of tricks — this trap is the most famous one."
      },
      {
        "label": "3. dxe5 — White",
        "text": "White accepts the gambit pawn."
      },
      {
        "label": "3... d4 — Black",
        "text": "The point of the Albin: the pawn wedge on d4 cramps White, takes away e3 and c3, and makes developing the queenside awkward."
      },
      {
        "label": "4. e3? — White",
        "text": "This natural-looking attack on the wedge is a mistake — after a bishop check, Black's d-pawn can capture on e3 and head for f2. White should play 4.Nf3, the main line, and keep a comfortable edge."
      },
      {
        "label": "4... Bb4+ — Black",
        "text": "Black checks before taking on e3. After 5.Bd2, the capture ...dxe3 will hit the bishop on d2 and the f2 pawn at once."
      },
      {
        "label": "5. Bd2 — White",
        "text": "White blocks with the bishop, the most natural reply."
      },
      {
        "label": "5... dxe3! — Black",
        "text": "Black takes on e3. The pawn now attacks both the Bd2 and f2, while White's Bd2 attacks the Bb4."
      },
      {
        "label": "6. Bxb4?? — White",
        "text": "THE FATAL MISTAKE! Taking the bishop looks like it wins a piece, but it lets the e-pawn through to f2. White had to play 6.fxe3, getting rid of the dangerous pawn; after 6...Qh4+ 7.g3 the game is roughly level."
      },
      {
        "label": "6... exf2+ — Black",
        "text": "The pawn captures on f2 with check. The king cannot take it, because 7.Kxf2 Qxd1 wins White's queen."
      },
      {
        "label": "7. Ke2 — White",
        "text": "Forced. The king steps up to e2 — but now the pawn on f2 can capture the knight on g1."
      },
      {
        "label": "7... fxg1=N+! — Black",
        "text": "THE UNDERPROMOTION! The pawn takes on g1 and becomes a knight — with check. Promoting to a queen instead would allow 8.Qxd8+ Kxd8 9.Rxg1 and White comes out fine. The knight keeps the initiative."
      },
      {
        "label": "8. Ke1 — White",
        "text": "The king goes back. If 8.Rxg1 instead, 8...Bg4+ skewers the king and wins the queen on d1."
      },
      {
        "label": "8... Qh4+ — Black",
        "text": "Black's queen joins the attack with check. If 9.g3, then 9...Qe4+ forks the king and the rook on h1."
      },
      {
        "label": "9. Kd2 — White",
        "text": "The king runs toward the queenside, but it is still stuck in the open center."
      },
      {
        "label": "9... Nc6 — Black",
        "text": "Black calmly brings another piece into the attack, eyeing d4, e5 and b4. There is no hurry — White's king cannot get away."
      },
      {
        "label": "10. Bc3 — White",
        "text": "White saves the bishop, but every White piece except the bishop is still undeveloped."
      },
      {
        "label": "10... Bg4 — Black",
        "text": "The bishop attacks White's queen on d1 and brings yet another piece into the attack."
      },
      {
        "label": "11. Qe1 — White",
        "text": "The queen escapes to e1 — one of the few squares left to it."
      },
      {
        "label": "11... O-O-O+ — Black",
        "text": "Castling with check! The rook joins on the open d-file and Black's whole army is aimed at the stranded king. Black is winning decisively — the Lasker Trap has done its work."
      }
    ],
    "keyIdeas": [
      "Albin Countergambit: 2...e5 3.dxe5 d4 — the d4 wedge cramps White and sets up tactics",
      "The mistake 4.e3? opens lines for ...Bb4+; 4.Nf3 is the safe main line",
      "After 5...dxe3, White must play 6.fxe3 — 6.Bxb4?? exf2+ 7.Ke2 fxg1=N+! wins",
      "Underpromotion: the knight gives check, which a queen on g1 would not — always check every promotion"
    ]
  },
  {
    "id": "noahs-ark-trap",
    "name": "Noah's Ark Trap",
    "eco": null,
    "category": "trap",
    "tagline": "Trap the Spanish bishop on b3 with ...c5-c4",
    "description": "The Noah's Ark Trap is a very old trap in the Ruy Lopez — its name hints at just how old. White's bishop retreats to b3, hemmed in by its own pawns on a2 and c2 and by Black's pawn on b5. If White lets Black win time against the queen, the pawn march ...c5-c4 traps the bishop and wins it. In this line, White grabs a pawn with 8.Qxd4?? and Black springs the trap with ...c5 and ...c4. The lesson: when your bishop has no retreat squares, watch out for pawns that can attack it.",
    "moves": [
      "e4",
      "e5",
      "Nf3",
      "Nc6",
      "Bb5",
      "a6",
      "Ba4",
      "d6",
      "d4",
      "b5",
      "Bb3",
      "Nxd4",
      "Nxd4",
      "exd4",
      "Qxd4",
      "c5",
      "Qd5",
      "Be6",
      "Qc6+",
      "Bd7",
      "Qd5",
      "c4",
      "Bxc4",
      "bxc4",
      "Qxc4",
      "Be7"
    ],
    "explanations": [
      {
        "label": "1. e4 — White",
        "text": "The King's Pawn opening."
      },
      {
        "label": "1... e5 — Black",
        "text": "Black meets e4 in the center."
      },
      {
        "label": "2. Nf3 — White",
        "text": "The knight develops and attacks e5."
      },
      {
        "label": "2... Nc6 — Black",
        "text": "Black defends e5 and develops."
      },
      {
        "label": "3. Bb5 — White",
        "text": "The Ruy Lopez — White pressures the Nc6, the defender of e5."
      },
      {
        "label": "3... a6 — Black",
        "text": "Black asks the bishop what it wants to do. This is the most common reply."
      },
      {
        "label": "4. Ba4 — White",
        "text": "White keeps the pin-like pressure on the Nc6 by retreating to a4."
      },
      {
        "label": "4... d6 — Black",
        "text": "The Modern Steinitz Defense. Black solidly supports e5 before developing the kingside."
      },
      {
        "label": "5. d4 — White",
        "text": "White strikes in the center at once. It is a reasonable move, but it gives Black the chance to set the trap."
      },
      {
        "label": "5... b5 — Black",
        "text": "Black drives the bishop back. On b3 it will have no retreat squares, because a2 and c2 are blocked by White's own pawns."
      },
      {
        "label": "6. Bb3 — White",
        "text": "The bishop retreats to b3, where it aims at f7 — but notice how few squares it has."
      },
      {
        "label": "6... Nxd4 — Black",
        "text": "Black trades on d4. This removes White's center pawn and sets the bait."
      },
      {
        "label": "7. Nxd4 — White",
        "text": "White recaptures with the knight."
      },
      {
        "label": "7... exd4 — Black",
        "text": "Black takes back with the pawn. Now the d4 pawn looks like free material for White's queen."
      },
      {
        "label": "8. Qxd4?? — White",
        "text": "WHITE FALLS INTO THE TRAP! The queen grabs the pawn, but now Black gains time against the queen and attacks the bishop on b3. White should play 8.c3, offering a pawn for development, or 8.a4, attacking b5, with a balanced game."
      },
      {
        "label": "8... c5! — Black",
        "text": "The trap is sprung! The pawn attacks the queen, and the next move ...c4 will attack the bishop, which has nowhere to go."
      },
      {
        "label": "9. Qd5 — White",
        "text": "The queen moves to d5, eyeing a8 and c6 and looking for counterplay before Black finishes developing."
      },
      {
        "label": "9... Be6 — Black",
        "text": "Black develops with tempo, attacking the queen again."
      },
      {
        "label": "10. Qc6+ — White",
        "text": "White tries a check to keep the queen active and buy time."
      },
      {
        "label": "10... Bd7 — Black",
        "text": "Black blocks the check, attacking the queen once more."
      },
      {
        "label": "11. Qd5 — White",
        "text": "The queen returns to d5. If Black went back with 11...Be6, White could keep repeating moves."
      },
      {
        "label": "11... c4! — Black",
        "text": "No repetition! The pawn attacks the bishop on b3, and it is trapped: a2 and c2 are White's own pawns, a4 is covered by the b5 pawn and d5 holds White's queen. Noah's Ark has closed."
      },
      {
        "label": "12. Bxc4 — White",
        "text": "White gives up the bishop for a pawn rather than losing it for nothing."
      },
      {
        "label": "12... bxc4 — Black",
        "text": "Black takes the bishop."
      },
      {
        "label": "13. Qxc4 — White",
        "text": "White collects a second pawn, but two pawns are not enough for a whole piece."
      },
      {
        "label": "13... Be7 — Black",
        "text": "Black calmly develops and prepares to castle. Black is a piece for two pawns up, with a winning position."
      }
    ],
    "keyIdeas": [
      "Noah's Ark Trap: a bishop on b3 with pawns on a2 and c2 can be trapped by ...a6, ...b5 and ...c5-c4",
      "The mistake is 8.Qxd4?? — 8...c5! gains time on the queen and threatens ...c4",
      "White should play 8.c3 or 8.a4 instead of grabbing the pawn",
      "Lesson: before grabbing material, check whether your pieces still have retreat squares"
    ]
  }
];

function attachOpeningVariations() {
  const byId = {};
  OPENINGS.forEach(o => { byId[o.id] = o; });
  const link = (id, name, note) => {
    const op = byId[id];
    if (!op) return null;
    return {
      id,
      name: name || op.name,
      note: note || op.tagline || '',
      description: op.description,
      tagline: op.tagline,
      moves: op.moves,
      explanations: op.explanations,
      keyIdeas: op.keyIdeas
    };
  };
  const italian = byId.italian;
  if (italian) {
    italian.variations = [
      link('evans-gambit', 'Evans Gambit', '4.b4 branch from the Italian'),
      link('fried-liver', 'Fried Liver Attack', 'Ng5 tactical branch'),
      link('blackburne-shilling', 'Blackburne Shilling', '3...Nd4 trap branch')
    ].filter(Boolean);
  }
  const queensGambit = byId['queens-gambit'];
  if (queensGambit) {
    queensGambit.variations = [
      link('slav', 'Slav Defense', '2...c6 branch'),
      link('elephant-trap', 'Elephant Trap', 'QGD trap branch'),
      link('lasker-trap', 'Lasker Trap', 'Albin Countergambit trap branch')
    ].filter(Boolean);
  }
  const ruy = byId['ruy-lopez'];
  if (ruy) {
    ruy.variations = [
      link('noahs-ark-trap', "Noah's Ark Trap", 'Black traps the b3 bishop')
    ].filter(Boolean);
  }
  const sicilian = byId.sicilian;
  if (sicilian) {
    sicilian.variations = [
      link('sicilian-dragon', 'Dragon', 'g6 setup'),
      link('sicilian-schev', 'Scheveningen', 'e6 setup'),
      link('sicilian-najdorf', 'Najdorf', '5...a6 setup')
    ].filter(Boolean);
  }
}
attachOpeningVariations();

