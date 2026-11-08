// Coach insights: local mistake memory and pattern tagging for reviews.
// Classic script loaded before app.js (see index.html); its top-level
// declarations are shared globals, as they were inside app.js.

// ─────────────────────────────────────────────
// COACH INSIGHTS — local-first mistake pattern memory
// ─────────────────────────────────────────────
const INSIGHTS_KEY = 'coach:insights:v1';
const INSIGHTS_MAX_ENTRIES = 300;
const INSIGHT_PROBLEM_TIERS = new Set(['inaccuracy', 'mistake', 'blunder']);
const INSIGHT_TIER_WEIGHT = { inaccuracy: 1, mistake: 2, blunder: 3 };
const INSIGHT_TAG_META = {
  missed_mate: {
    title: 'Missed mate threats',
    practice: 'Start every candidate scan with forcing checks.',
    theory: 'Forcing moves come first: checks, captures, threats. Mate threats outrank material.'
  },
  missed_check: {
    title: 'Missed forcing checks',
    practice: 'Before quiet moves, list every legal check for both sides.',
    theory: 'Checks force the opponent to spend a tempo. Even when not best, they reveal tactical geometry.'
  },
  missed_capture: {
    title: 'Missed material wins',
    practice: 'Run a captures scan before committing to a positional move.',
    theory: 'Loose pieces and overloaded defenders are tactical signals. Check whether a defender is pinned or distracted.'
  },
  missed_recapture: {
    title: 'Missed recaptures',
    practice: 'After every capture, ask what changed and whether a recapture is forced.',
    theory: 'Recaptures often restore material balance and remove an active enemy piece. Calculate them before looking for quiet improvements.'
  },
  missed_promotion: {
    title: 'Missed promotion chances',
    practice: 'In pawn races, calculate the queening square before any side move.',
    theory: 'Passed pawns become stronger as pieces leave the board. The king and rook belong behind passed pawns.'
  },
  allowed_mate: {
    title: 'Allowed mate threats',
    practice: 'After choosing a move, ask what check the opponent wants next.',
    theory: 'King safety is a concrete calculation problem: count checks, escape squares, and defenders.'
  },
  allowed_forcing: {
    title: 'Missed opponent threats',
    practice: 'Use a final blunder-check: their checks, captures, threats.',
    theory: 'A move is only good if it survives the opponent response. Always calculate their most forcing reply.'
  },
  back_rank: {
    title: 'Back-rank exposure',
    practice: 'Check whether your king has air before allowing heavy pieces onto the back rank.',
    theory: 'Back-rank tactics appear when the king has no flight square and rooks or queens control the first or eighth rank.'
  },
  fork_risk: {
    title: 'Forks and double attacks',
    practice: 'Before ending calculation, scan knight jumps and queen checks that hit two targets.',
    theory: 'Forks win because one move creates two problems. Loose kings and loose pieces make them more likely.'
  },
  hung_material: {
    title: 'Hung pieces',
    practice: 'Before releasing a piece, verify whether the destination is defended enough.',
    theory: 'A piece is safe when its defenders match the tactical reality, not just the attacker count.'
  },
  piece_left_en_prise: {
    title: 'Pieces left en prise',
    practice: 'When you move a piece, check whether the opponent can simply take it next move.',
    theory: 'A moved piece can become tactically loose even on a defended square when the defender is pinned, overloaded, or too valuable.'
  },
  unsafe_trade: {
    title: 'Unsafe trades',
    practice: 'Before trading, count the full sequence and who moves last.',
    theory: 'A trade is favorable only after the whole capture sequence, not after the first exchange.'
  },
  premature_queen: {
    title: 'Premature queen moves',
    practice: 'Delay queen activity until minor pieces are developed or there is a concrete tactic.',
    theory: 'Early queen moves invite tempo gains. Develop knights and bishops before hunting pawns.'
  },
  development: {
    title: 'Slow development',
    practice: 'In the opening, prefer developing a new minor piece unless there is a tactic.',
    theory: 'Opening time matters. Develop pieces, fight for the center, castle, then start operations.'
  },
  king_safety: {
    title: 'King-safety looseners',
    practice: 'Treat early f-, g-, and h-pawn moves as commitments that need a concrete reason.',
    theory: 'Pawn moves near your king cannot retreat. Every pawn advance creates squares the opponent can use.'
  },
  time_to_castle: {
    title: 'Delayed castling',
    practice: 'When the engine wants castling, treat king safety as the tactic.',
    theory: 'Castling is development, king safety, and rook activation in one move. Delaying it requires a concrete reason.'
  },
  missed_center_break: {
    title: 'Missed center breaks',
    practice: 'In the opening, ask whether a central pawn break solves the position.',
    theory: 'Center breaks challenge the opponent before they finish development and can open lines for better-placed pieces.'
  },
  pawn_structure: {
    title: 'Pawn-structure concessions',
    practice: 'Before a pawn move, identify the square it gives up and whether that weakness matters.',
    theory: 'Pawn moves are permanent. Weak squares, backward pawns, and holes near the king often matter more than one tempo.'
  },
  pin_pressure: {
    title: 'Pins and pressure',
    practice: 'Look for pinned defenders before choosing a quiet move.',
    theory: 'Pinned pieces may look like defenders but cannot legally or safely move. Pressure against a pinned piece often wins material.'
  },
  opening_principles: {
    title: 'Opening principle gaps',
    practice: 'Check center, development, king safety, and only then pawn grabs.',
    theory: 'The opening goal is not to win a pawn; it is to reach a playable middlegame with active pieces.'
  },
  // Endgame-track lessons (growth.js ENDGAME_LESSONS) tag their practice
  // attempts with these, so the adaptive focus needs to know them too.
  endgame_conversion: {
    title: 'Endgame conversion',
    practice: 'With extra material, box in the king before you check, then find the finishing move.',
    theory: 'Winning endgames are converted by coordinating the king with the stronger piece to take squares from the enemy king, not by checking at random.'
  },
  passed_pawns: {
    title: 'Passed pawns',
    practice: 'Count the pawn race: who reaches the queening square first, and which piece can stop it?',
    theory: 'A passed pawn must be pushed or stopped. Rooks belong behind passers, and the defender needs control of the promotion square.'
  },
  endgame_technique: {
    title: 'Endgame technique',
    practice: 'Activate the king and calculate pawn races before trading.',
    theory: 'Endgames reward king activity, outside passed pawns, opposition, and rook activity.'
  },
  candidate_moves: {
    title: 'Candidate move selection',
    practice: 'Compare at least two candidate moves before moving.',
    theory: 'Strong move selection starts wide and narrows: candidate moves first, calculation second.'
  }
};

function emptyInsights() {
  return { v: 1, entries: [] };
}

function loadInsights() {
  try {
    const raw = localStorage.getItem(coachMemoryKey(INSIGHTS_KEY));
    if (!raw) return emptyInsights();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.entries)) return emptyInsights();
    return { v: 1, entries: parsed.entries.slice(-INSIGHTS_MAX_ENTRIES) };
  } catch (e) {
    return emptyInsights();
  }
}

function saveInsights(state) {
  try {
    const safe = { v: 1, entries: (state.entries || []).slice(-INSIGHTS_MAX_ENTRIES) };
    localStorage.setItem(coachMemoryKey(INSIGHTS_KEY), JSON.stringify(safe));
    return true;
  } catch (e) {
    return false;
  }
}

function clearInsights() {
  try { localStorage.removeItem(coachMemoryKey(INSIGHTS_KEY)); } catch (e) {}
}

function isInsightProblem(tier) {
  return INSIGHT_PROBLEM_TIERS.has(tier);
}

function moveFromUci(fen, uci) {
  if (!fen || !uci) return null;
  try {
    const g = new Chess(fen);
    return g.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || undefined
    });
  } catch (e) {
    return null;
  }
}

function isCastlingMove(mv) {
  return !!(mv && mv.flags && (mv.flags.includes('k') || mv.flags.includes('q')));
}

function undevelopedMinorCount(gameObj, color) {
  const home = color === 'w'
    ? [['b1', 'n'], ['g1', 'n'], ['c1', 'b'], ['f1', 'b']]
    : [['b8', 'n'], ['g8', 'n'], ['c8', 'b'], ['f8', 'b']];
  let count = 0;
  for (const [square, type] of home) {
    const piece = gameObj.get(square);
    if (piece && piece.color === color && piece.type === type) count++;
  }
  return count;
}

function isEarlyKingPawnLoosener(mv) {
  return mv && mv.piece === 'p' && ['f', 'g', 'h'].includes(mv.from[0]);
}

function isCentralPawnMove(mv) {
  return !!(mv && mv.piece === 'p' && ['c', 'd', 'e', 'f'].includes(mv.from[0]));
}

function isNonCapturePawnWeakener(mv) {
  if (!mv || mv.piece !== 'p' || mv.captured) return false;
  return ['a', 'b', 'f', 'g', 'h'].includes(mv.from[0]);
}

function isLikelyBackRankTactic(mv) {
  if (!mv || !mv.san || !mv.san.includes('#')) return false;
  return ['r', 'q'].includes(mv.piece) && ['1', '8'].includes(mv.to[1]);
}

function isLikelyPinPressure(mv) {
  if (!mv || !mv.san) return false;
  return ['b', 'r', 'q'].includes(mv.piece) && (mv.san.includes('+') || mv.san.includes('x'));
}

// Piece values in centipawns for insight tagging. Removed by mistake when the
// old weak-move scorer was deleted; insightTagsForReview still depends on it.
function materialValue(piece) {
  return ({ p: 100, n: 300, b: 325, r: 500, q: 900, k: 0 })[piece] || 0;
}

function insightTagsForReview(review) {
  if (!review || !isInsightProblem(review.tier)) return [];
  const tags = [];
  const add = tag => {
    if (INSIGHT_TAG_META[tag] && !tags.includes(tag)) tags.push(tag);
  };
  const loss = review.loss || 0;
  const pairNum = review.pairNum || Math.ceil((review.ply || 1) / 2);
  const phase = phaseOf(pairNum);
  const userMove = moveFromUci(review.fenBefore, review.userUci);
  const bestMove = moveFromUci(review.fenBefore, review.bestUci);
  const replyUci = review.evalAfter && review.evalAfter.pv && review.evalAfter.pv[0];
  const opponentReply = moveFromUci(review.fenAfter, replyUci);

  if (bestMove) {
    if (bestMove.san && bestMove.san.includes('#')) add('missed_mate');
    else if (bestMove.san && bestMove.san.includes('+')) add('missed_check');
    if (bestMove.captured) add('missed_capture');
    if (bestMove.promotion) add('missed_promotion');
    if (isCastlingMove(bestMove)) {
      add('time_to_castle');
      add('king_safety');
    }
    if (phase === 'opening' && isCentralPawnMove(bestMove) && !(userMove && isCentralPawnMove(userMove))) {
      add('missed_center_break');
    }
    if (isLikelyPinPressure(bestMove)) add('pin_pressure');
  }

  if (opponentReply && loss >= 120) {
    if (opponentReply.san && opponentReply.san.includes('#')) add('allowed_mate');
    else if (opponentReply.san && opponentReply.san.includes('+')) add('allowed_forcing');
    if (opponentReply.captured && (materialValue(opponentReply.captured) >= 300 || loss >= 250)) add('hung_material');
    if (isLikelyBackRankTactic(opponentReply)) add('back_rank');
    if (opponentReply.piece === 'n' && (opponentReply.captured || (opponentReply.san || '').includes('+'))) add('fork_risk');
    if (userMove && opponentReply.captured && opponentReply.to === userMove.to) {
      add('piece_left_en_prise');
      if (userMove.captured) add('unsafe_trade');
    }
  }

  if (userMove) {
    const before = new Chess(review.fenBefore);
    if (pairNum <= 12) {
      if (userMove.piece === 'q' && !userMove.captured && !(userMove.san || '').match(/[+#]/)) add('premature_queen');
      if (undevelopedMinorCount(before, userMove.color) >= 2 &&
          !['n', 'b'].includes(userMove.piece) &&
          !isCastlingMove(userMove) &&
          !userMove.captured &&
          loss >= 80) {
        add('development');
      }
      if (isEarlyKingPawnLoosener(userMove) && !userMove.captured && !(bestMove && bestMove.captured) && loss >= 80) {
        add('king_safety');
      }
      if (isNonCapturePawnWeakener(userMove) && loss >= 120) add('pawn_structure');
    }
    if (userMove.captured && loss >= 120) add('unsafe_trade');
    // A recapture: the opponent has just captured on a square, the best move
    // takes back there, and the move played did not.
    if (bestMove && bestMove.captured && review.previousCaptureSquare &&
        bestMove.to === review.previousCaptureSquare && userMove.to !== bestMove.to && loss >= 100) {
      add('missed_recapture');
    }
    if (phase === 'endgame' && loss >= 120) add('endgame_technique');
  }

  if (tags.length === 0 && phase === 'opening' && loss >= 120) add('opening_principles');
  if (tags.length === 0) add('candidate_moves');
  return tags.slice(0, 3);
}

function currentCoachOpeningName() {
  try {
    if (coachOpeningTransfer) return coachOpeningTransfer.title;
    if (!coachGame || typeof identifyOpening !== 'function') return null;
    const info = identifyOpening(coachGame.history());
    return info && info.match ? info.match.name : null;
  } catch (e) {
    return null;
  }
}

function insightEntryFromReview(review) {
  const pairNum = review.pairNum || Math.ceil((review.ply || 1) / 2);
  const tags = review.insightTags || insightTagsForReview(review);
  review.insightTags = tags;
  // Imported games (pasted or fetched) are not the live Coach game, so they
  // never borrow its ids or opening.
  const imported = review.source === 'import';
  return {
    id: review.insightId || null,
    gameId: review.remoteGameId || (imported ? null : coachRemoteGameId) || null,
    localGameId: review.localGameId || (imported ? null : coachLocalGameId) || null,
    ts: review.insightAt || Date.now(),
    tier: review.tier,
    loss: Math.round(review.loss || 0),
    phase: phaseOf(pairNum),
    tags,
    pairNum,
    ply: review.ply || pairNum * 2,
    userSan: review.userSan || null,
    bestSan: review.bestSan || null,
    fenBefore: review.fenBefore || null,
    userUci: review.userUci || null,
    bestUci: review.bestUci || null,
    opening: review.opening || (imported ? null : currentCoachOpeningName()),
    openingId: review.openingId || (!imported && coachOpeningTransfer ? coachOpeningTransfer.openingId : null),
    continuation: Array.isArray(review.continuation) ? review.continuation.slice(0, 1) : null,
    lesson: review.lesson || null,
    opponentThreat: review.opponentThreat || null,
    decisionCue: review.decisionCue || null
  };
}

function recordCoachInsight(review) {
  if (!review || !review.tier || review.tier === 'unknown') return;
  review.insightTags = review.insightTags || insightTagsForReview(review);
  const state = loadInsights();
  review.insightAt = review.insightAt || Date.now();
  state.entries.push(insightEntryFromReview(review));
  saveInsights(state);
  if (typeof queuePendingAccountReview === 'function') {
    try { queuePendingAccountReview(review); } catch (error) { handleAccountCheckpointError(error); }
  }
  renderInsights();
}

function insightTagCounts(entries) {
  const counts = {};
  for (const entry of entries) {
    if (!entry || !isInsightProblem(entry.tier)) continue;
    const weight = INSIGHT_TIER_WEIGHT[entry.tier] || 1;
    for (const tag of entry.tags || []) {
      if (!counts[tag]) counts[tag] = { tag, count: 0, score: 0, loss: 0, latest: entry };
      counts[tag].count += 1;
      counts[tag].score += weight;
      counts[tag].loss += Math.min(entry.loss || 0, ACPL_CAP);
      counts[tag].latest = entry;
    }
  }
  return Object.values(counts).sort((a, b) =>
    b.score - a.score || b.count - a.count || b.loss - a.loss
  );
}

function recurringMistakeSummaries(entries, now = Date.now()) {
  const currentStart = now - 30 * DAY_MS;
  const previousStart = currentStart - 30 * DAY_MS;
  const reviewed = reviewedProgressEntries(entries, now);
  const current = reviewed.filter(entry => entry.ts >= currentStart);
  const previous = reviewed.filter(entry => entry.ts >= previousStart && entry.ts < currentStart);
  const tags = new Set(reviewed.filter(entry => entry.ts >= previousStart && isInsightProblem(entry.tier))
    .flatMap(entry => Array.isArray(entry.tags) ? entry.tags : []).filter(tag => INSIGHT_TAG_META[tag]));
  const flagged = (list, tag) => list.filter(entry => isInsightProblem(entry.tier) && Array.isArray(entry.tags) && entry.tags.includes(tag));
  return Array.from(tags).map(tag => {
    const recent = flagged(current, tag), earlier = flagged(previous, tag);
    const currentRate = current.length ? recent.length / current.length : null;
    const previousRate = previous.length ? earlier.length / previous.length : null;
    const comparable = current.length >= 30 && previous.length >= 30;
    return { tag, current: recent.length, previous: earlier.length,
      currentSamples: current.length, previousSamples: previous.length,
      currentRate, previousRate, comparable,
      change: comparable ? currentRate - previousRate : null,
      latestAt: recent.length ? recent[recent.length - 1].ts : 0,
      loss: recent.reduce((sum, entry) => sum + Math.min(entry.loss || 0, ACPL_CAP), 0) };
  }).sort((a, b) => b.current - a.current || b.latestAt - a.latestAt);
}

function renderRecurringMistakeDashboard(entries) {
  const $list = $('#insights-recurring-list').empty();
  if (!$list.length) return;
  const summaries = recurringMistakeSummaries(entries);
  if (!summaries.length) {
    $list.append($('<div class="insight-empty"></div>').text('No flagged pattern in the retained reviews from the last 60 days.'));
    return;
  }
  summaries.slice(0, 4).forEach(summary => {
    const meta = INSIGHT_TAG_META[summary.tag];
    const current = `${summary.current}/${summary.currentSamples} reviewed moves flagged in the last 30 days`;
    const previous = `${summary.previous}/${summary.previousSamples} in the prior 30 days`;
    const direction = !summary.comparable
      ? 'Too few retained reviews to compare rates; need 30 in each period.'
      : Math.abs(summary.change * 100) < 0.05 ? 'Observed flag rate is unchanged.'
        : `Observed flag rate is ${Math.abs(summary.change * 100).toFixed(1)} percentage points ${summary.change < 0 ? 'lower' : 'higher'}.`;
    const $row = $('<div class="insight-recurring-row"></div>');
    $row.append($('<strong></strong>').text(meta.title));
    $row.append($('<span></span>').text(`${current}; ${previous}. ${direction}`));
    $list.append($row);
  });
}

function weakestInsightPhase(entries) {
  const phaseName = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };
  const phases = {
    opening: { phase: 'opening', count: 0, loss: 0 },
    middlegame: { phase: 'middlegame', count: 0, loss: 0 },
    endgame: { phase: 'endgame', count: 0, loss: 0 }
  };
  for (const entry of entries) {
    if (!entry || !isInsightProblem(entry.tier)) continue;
    const phase = phases[entry.phase] || phases.middlegame;
    phase.count += 1;
    phase.loss += Math.min(entry.loss || 0, ACPL_CAP);
  }
  const ranked = Object.values(phases)
    .filter(p => p.count > 0)
    .sort((a, b) => b.count - a.count || b.loss - a.loss);
  if (!ranked.length) return null;
  return { label: phaseName[ranked[0].phase], data: ranked[0] };
}

function formatInsightExample(entry) {
  if (!entry) return '';
  const ref = formatMoveRef(entry);
  const best = entry.bestSan ? `; best was ${entry.bestSan}` : '';
  const opening = entry.opening ? ` in ${entry.opening}` : '';
  return `${ref}${best}${opening}`;
}

function insightTagForEntry(entry) {
  const tags = entry && Array.isArray(entry.tags) ? entry.tags : [];
  return tags.find(tag => INSIGHT_TAG_META[tag]) || 'candidate_moves';
}

function fenSideToUserSide(fen) {
  const turn = (fen || '').split(/\s+/)[1];
  return turn === 'b' ? 'black' : 'white';
}
