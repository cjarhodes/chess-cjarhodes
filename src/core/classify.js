// Move classification, accuracy and the explanation context for a reviewed move.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

// ─────────────────────────────────────────────
// COACH CLASSIFICATION
// ─────────────────────────────────────────────
const COACH_DEPTH = 12;

// Rank-and-loss aware classification. `rank` is 1 if user played the engine's
// #1 move, 2 or 3 if it was a top-3 alternative, otherwise null. A top-3
// alternative is Excellent only while it stays within the Good margin (60cp):
// when the engine's second choice already loses a piece, rank is no excuse.
function classifyRankLoss(rank, loss) {
  if (rank === 1) return { tier: 'best',      label: 'Best move', emoji: '★' };
  if ((rank === 2 || rank === 3) && loss < 60)
                  return { tier: 'excellent', label: 'Excellent', emoji: '✦' };
  if (loss < 60)  return { tier: 'good',       label: 'Good',       emoji: '👍' };
  if (loss < 120) return { tier: 'inaccuracy', label: 'Inaccuracy', emoji: '⚠' };
  if (loss < 250) return { tier: 'mistake',    label: 'Mistake',    emoji: '✗' };
  return            { tier: 'blunder',     label: 'Blunder',    emoji: '💥' };
}

function movePurposeText(fenBefore, bestUci, userUciMove, bestLine, afterInfo) {
  if (!bestUci || !userUciMove || bestUci === userUciMove) return '';
  const before = new Chess(fenBefore);
  const best = before.move({
    from: bestUci.slice(0, 2),
    to: bestUci.slice(2, 4),
    promotion: bestUci[4] || undefined
  });
  if (!best) return '';

  const userBefore = new Chess(fenBefore);
  const user = userBefore.move({
    from: userUciMove.slice(0, 2),
    to: userUciMove.slice(2, 4),
    promotion: userUciMove[4] || undefined
  });

  const reasons = [];
  if (best.san.includes('#')) reasons.push(`${best.san} delivers checkmate`);
  else if (best.san.includes('+')) reasons.push(`${best.san} gives check and forces a response`);
  if (best.captured) reasons.push(`${best.san} captures the ${PIECE_NAME[best.captured] ? PIECE_NAME[best.captured].toLowerCase() : 'piece'} on ${best.to}`);
  if (best.promotion) reasons.push(`${best.san} promotes immediately`);
  if (best.flags && (best.flags.includes('k') || best.flags.includes('q'))) reasons.push(`${best.san} castles and improves king safety`);

  const bestPv = bestLine && bestLine.pv ? pvToSan(fenBefore, bestLine.pv, 4) : [];
  if (bestPv.length >= 2) {
    reasons.push(`the follow-up is ${bestPv.join(' ')}`);
  }

  const afterCp = afterInfo ? -scoreToCp(afterInfo) : null;
  const beforeCp = bestLine ? scoreToCp(bestLine) : null;
  if (beforeCp !== null && afterCp !== null && beforeCp - afterCp >= 120) {
    reasons.push(`${user ? user.san : 'your move'} lets the position swing by ${(Math.min(beforeCp - afterCp, 1000) / 100).toFixed(1)} pawns`);
  }

  if (!reasons.length) {
    return `${best.san} keeps the engine's preferred plan; your move gives the opponent a better version of the position.`;
  }
  return `${best.san} is better because ${reasons.slice(0, 2).join('; ')}.`;
}

function coachExplanationContext(fenBefore, userUci, bestUci, fenAfter, afterInfo) {
  const before = new Chess(fenBefore);
  const after = new Chess(fenAfter);
  const user = moveFromUci(fenBefore, userUci);
  const best = moveFromUci(fenBefore, bestUci);
  const reply = afterInfo && afterInfo.pv && afterInfo.pv[0]
    ? moveFromUci(fenAfter, afterInfo.pv[0])
    : null;
  const pieceName = piece => PIECE_NAME[piece]?.toLowerCase() || 'piece';
  const pieces = before.board().flat().filter(Boolean);
  const opening = Number(fenBefore.split(/\s+/)[5]) <= 12 && pieces.filter(piece => !['k', 'p'].includes(piece.type)).length >= 8;
  const develops = best && ['n', 'b'].includes(best.piece) && best.from[1] === (best.color === 'w' ? '1' : '8') && opening;
  let lesson = 'Candidate selection: compare forcing moves and at least one quiet improvement.';
  let cue = 'Before moving, compare two candidates and calculate the opponent’s strongest reply to each.';
  let consequence = reply && user ? `After ${user.san}, the engine suggests ${reply.san} for the opponent.` : '';
  let opponentThreat = reply ? `Opponent’s best reply is ${reply.san}.` : '';

  // Describe legal board facts before naming a general principle. A capture is
  // not automatically a material win, and an engine reply is not a played move.
  if (reply) {
    if (reply.san.includes('#')) {
      consequence = `${user ? user.san : 'Your move'} allows ${reply.san}: checkmate.`;
      opponentThreat = `Opponent’s threat: ${reply.san} is checkmate after your move.`;
    } else if (reply.captured) {
      consequence = `After ${user ? user.san : 'your move'}, ${reply.san} can capture your ${pieceName(reply.captured)} on ${reply.to}.`;
      opponentThreat = `Opponent’s threat: ${reply.san} captures your ${pieceName(reply.captured)} on ${reply.to}.`;
    } else if (reply.san.includes('+')) {
      consequence = `After ${user ? user.san : 'your move'}, ${reply.san} gives check.`;
      opponentThreat = `Opponent’s threat: ${reply.san} gives check.`;
    }
  }
  if (after.in_stalemate()) {
    consequence = `${user ? user.san : 'Your move'} leaves the opponent with no legal move and no check: stalemate, a draw.`;
    lesson = 'Endgame conversion: restricting the king is useful only while a legal reply remains, unless the move is checkmate.';
    cue = 'Before a finishing move, check whether the opponent has a legal reply. No reply without check means stalemate.';
  } else if (reply && reply.san.includes('#')) {
    lesson = 'King safety: calculate the opponent’s forcing checks before committing to your plan.';
    cue = user && user.piece === 'p' && ['f', 'g', 'h'].includes(user.from[0])
      ? 'Before moving a king-side pawn, scan the opponent’s checks and the diagonals leading to your king.'
      : 'Before committing to your plan, scan the opponent’s checks and the lines leading to your king.';
  } else if (reply && reply.captured && reply.to === (user && user.to) && materialValue(user.piece) > materialValue(reply.piece)) {
    lesson = `Piece safety: the ${pieceName(user.piece)} can be taken on its new square.`;
    cue = 'Before moving a piece, scan every enemy capture on its destination and calculate the recapture.';
  } else if (best && best.san.includes('#')) {
    consequence = `${user ? user.san : 'Your move'} misses an immediate checkmate; ${best.san} ends the game.`;
    lesson = 'Forcing moves: check all legal checks for an immediate mate before choosing a longer plan.';
    cue = 'Scan checks first. For each checking move, count the opponent’s legal escapes, captures, and blocks.';
  } else if (best && best.promotion) {
    lesson = 'Pawn-race calculation: a promotion changes the available checks, captures, and escape squares.';
    cue = 'Count the moves to promotion for both sides, then check the position after queening for checks or stalemate.';
  } else if (best && best.captured) {
    lesson = `Tactical awareness: ${best.san} captures the ${pieceName(best.captured)} on ${best.to}; calculate the reply before judging the exchange.`;
    cue = 'Scan captures before quiet moves, and calculate the opponent’s recapture before counting a material gain.';
  } else if (best && best.flags && (best.flags.includes('k') || best.flags.includes('q'))) {
    lesson = 'King safety: castling moves the king and brings the rook into play.';
    cue = 'Before starting an attack, check whether you can castle safely and connect your rooks.';
  } else if (develops) {
    lesson = `Development: ${best.san} brings the ${pieceName(best.piece)} from ${best.from} into play.`;
    cue = 'In the opening, look for an undeveloped knight or bishop before another side-pawn or queen move, then check for tactics.';
  } else if (opening && user && user.piece === 'q' && !user.captured) {
    lesson = 'Development: queen moves need a concrete purpose while other pieces remain at home.';
    cue = 'Before another queen move, check whether a knight or bishop can develop with a threat.';
  } else if (best && best.san.includes('+')) {
    lesson = 'Forcing checks: a check restricts the reply, but its continuation still needs calculation.';
    cue = 'For every candidate check, calculate the opponent’s strongest legal reply before choosing it.';
  } else if (best && ['n', 'b'].includes(best.piece)) {
    lesson = `Piece activity: ${best.san} repositions the ${pieceName(best.piece)} from ${best.from} to ${best.to}.`;
    cue = 'Find your least active piece and compare an improving square with the opponent’s strongest reply.';
  } else if (best && best.piece === 'p' && ['c', 'd', 'e', 'f'].includes(best.from[0])) {
    lesson = 'Central play: compare a central pawn advance with the opponent’s possible captures and breaks.';
    cue = 'Before a side-pawn move, compare a central advance and calculate the opponent’s captures.';
  }
  if (userUci === bestUci || after.in_checkmate()) consequence = '';
  return { lesson, opponentThreat, cue, consequence };
}

// Side-to-move perspective: score is always in the mover's favor.
// We pull MultiPV=3 before the move so we know if the user picked #1/#2/#3.
async function classifyMove(fenBefore, userUciMove, fenAfter) {
  // A legal move that ends in checkmate is fully verifiable on the board.
  // It must not become "unknown" if Stockfish has no PV for a terminal node.
  const afterPosition = new Chess(fenAfter);
  if (afterPosition.in_checkmate()) {
    const proof = new Chess(fenBefore);
    const played = proof.move({ from: userUciMove.slice(0, 2), to: userUciMove.slice(2, 4), promotion: userUciMove[4] || undefined });
    if (played && proof.fen() === fenAfter) return {
      tier: 'best', label: 'Best move', emoji: '★', rank: 1, loss: 0,
      userSan: played.san, bestSan: played.san, bestUci: userUciMove,
      pvSan: [played.san], topAlternatives: [{ uci: userUciMove, san: played.san, cp: 9999, pvSan: [played.san] }],
      whyBetter: 'This move delivers checkmate; the opponent has no legal reply.',
      lesson: 'Mating net: check the king and cover every escape, capture, or block.',
      decisionCue: 'Scan forcing checks first and verify every legal response before choosing the move.',
      opponentThreat: 'The opponent has no legal reply.',
      evalBefore: { mate: 1, pv: [userUciMove] }, evalAfter: { mate: 0, pv: [] },
      reviewSummary: 'Your move delivers checkmate. The opponent has no legal reply.'
    };
  }
  const [beforeEval, afterEval] = await Promise.all([
    engineClient.evaluate(fenBefore, COACH_DEPTH, { multipv: 3 }),
    engineClient.evaluate(fenAfter, COACH_DEPTH)
  ]);
  const lines = beforeEval.lines || [];
  const bestLine = lines[0];
  const bestUci = (bestLine && bestLine.pv && bestLine.pv[0]) || beforeEval.bestmove;
  const afterInfo = afterEval.info;
  const afterIsTerminal = afterPosition.game_over();

  // Engine timeout / stall — evaluate resolved with no bestmove and no PV data.
  // Return a neutral review instead of classifying based on zeroes.
  const beforeStalled = !bestUci && lines.length === 0;
  const afterStalled = !afterIsTerminal &&
    !afterEval.bestmove && (!afterInfo || !afterInfo.pv || afterInfo.pv.length === 0);
  if (beforeStalled || afterStalled) {
    return {
      tier: 'unknown',
      label: 'Not analyzed',
      emoji: '·',
      loss: 0,
      rank: null,
      bestUci: null,
      bestSan: null,
      userSan: uciToSan(fenBefore, userUciMove),
      pvSan: [],
      evalBefore: null,
      evalAfter: null,
      reviewSummary: reviewPositionSummary({
        fenBefore,
        tier: 'unknown',
        userSan: uciToSan(fenBefore, userUciMove)
      }),
      stalled: true
    };
  }

  // Determine user's rank in the top-3 (if any)
  let rank = null;
  for (let i = 0; i < lines.length; i++) {
    const pvFirst = lines[i].pv && lines[i].pv[0];
    if (pvFirst === userUciMove) { rank = i + 1; break; }
  }

  const cpBefore = bestLine ? scoreToCp(bestLine) : 0;
  const cpAfter = afterPosition.in_checkmate()
    ? 10000
    : (afterPosition.in_draw() ? 0 : -scoreToCp(afterInfo));
  let loss = Math.max(0, cpBefore - cpAfter);

  // Centipawn conversion intentionally keeps mate scores close together so
  // charts remain bounded, but that makes missing mate-in-one look like a
  // one-centipawn loss when a slower forced mate remains. Preserve the
  // training meaning: any non-mating move that skips an immediate mate is a
  // blunder even if Stockfish still sees a forced win.
  const missedImmediateMate = !!(
    bestLine && bestLine.mate === 1 &&
    userUciMove !== bestUci &&
    !afterPosition.in_checkmate()
  );
  if (missedImmediateMate) loss = Math.max(loss, 250);

  const cls = classifyRankLoss(missedImmediateMate ? null : rank, loss);

  // Build top-3 alternatives for the review card. Each line carries its first-move
  // SAN (the candidate), its eval in centipawns, and a short PV preview.
  const topAlternatives = lines.slice(0, 3).map((line) => {
    const firstUci = line.pv && line.pv[0];
    return {
      uci: firstUci || null,
      san: firstUci ? uciToSan(fenBefore, firstUci) : null,
      cp: scoreToCp(line),
      pvSan: pvToSan(fenBefore, line.pv || [], 4)
    };
  }).filter(a => a.san);
  const whyBetter = movePurposeText(fenBefore, bestUci, userUciMove, bestLine, afterInfo);
  const explanation = coachExplanationContext(fenBefore, userUciMove, bestUci, fenAfter, afterInfo);

  // Display-only Great/Brilliant flag (move-flair.js); tiers are unchanged.
  const flair = rank === 1 && typeof MoveFlair !== 'undefined'
    ? MoveFlair.moveFlair(Chess, fenBefore, userUciMove, lines)
    : null;
  return {
    tier: cls.tier,
    label: cls.label,
    emoji: cls.emoji,
    flair,
    loss: rank === 1 ? 0 : Math.round(loss),
    rank,
    bestUci,
    bestSan: bestUci ? uciToSan(fenBefore, bestUci) : null,
    userSan: uciToSan(fenBefore, userUciMove),
    pvSan: bestLine ? pvToSan(fenBefore, bestLine.pv || [], 5) : [],
    topAlternatives,
    whyBetter,
    decisionCue: explanation.cue,
    lesson: explanation.lesson,
    opponentThreat: explanation.opponentThreat,
    evalBefore: bestLine || null,
    evalAfter: afterInfo,
    reviewSummary: reviewPositionSummary({
      fenBefore,
      tier: cls.tier,
      userSan: uciToSan(fenBefore, userUciMove),
      bestSan: bestUci ? uciToSan(fenBefore, bestUci) : null,
      bestUci
    })
  };
}

function coachUserColor() {
  return coachUserSide === 'black' ? 'black' : 'white';
}

function coachIsUserTurn() {
  if (!coachGame) return false;
  const turn = coachGame.turn();
  return (turn === 'w' && coachUserColor() === 'white') ||
         (turn === 'b' && coachUserColor() === 'black');
}

// Weight per classification tier for accuracy %.
const ACCURACY_TIER_WEIGHT = {
  best: 1, excellent: 0.95, good: 0.85,
  inaccuracy: 0.6, mistake: 0.3, blunder: 0.05
};

function accuracyFromTallies(tallies, total) {
  if (!total) return null;
  let w = 0;
  for (const tier in ACCURACY_TIER_WEIGHT) {
    w += (tallies[tier] || 0) * ACCURACY_TIER_WEIGHT[tier];
  }
  return Math.round((w / total) * 100);
}

// Accuracy over the most recent `window` user moves (ignores 'unknown' tiers).
function rollingAccuracy(windowSize) {
  if (!coachReviewLog || coachReviewLog.length === 0) return null;
  const scored = coachReviewLog.filter(r => r.tier && r.tier !== 'unknown');
  if (scored.length === 0) return null;
  const slice = scored.slice(-windowSize);
  const tallies = {};
  for (const r of slice) tallies[r.tier] = (tallies[r.tier] || 0) + 1;
  return { pct: accuracyFromTallies(tallies, slice.length), n: slice.length };
}
