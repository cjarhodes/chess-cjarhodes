// Coach review: the per-move review card, the recommended-line and
// consequence analysis shown on the Coach board, stepping through the
// game (review cursor), captured pieces and material, and the move list
// and PGN. Classification itself is in src/core/classify.js.
// Classic script (see index.html): its top-level declarations are shared
// globals with src/, the other view scripts, growth.js and the feature
// modules, as they were inside app.js. Nothing here runs at load except
// plain initialisers, so the view scripts can call each other freely.

// ─────────────────────────────────────────────
// MOVE REVIEW AND ANALYSIS LINE
// ─────────────────────────────────────────────
function reviewBoardMarkup(fen) {
  if (!fen) return '';
  try {
    const position = new Chess(fen);
    return position.board().map((row, rowIndex) => row.map((piece, colIndex) => {
      const dark = (rowIndex + colIndex) % 2 === 1;
      const glyph = piece
        ? (piece.color === 'w' ? PIECE_GLYPH_WHITE[piece.type] : PIECE_GLYPH_BLACK[piece.type])
        : '';
      return `<span class="review-board-square ${dark ? 'dark' : 'light'}">${glyph || '&nbsp;'}</span>`;
    }).join('')).join('');
  } catch (e) {
    return '';
  }
}

// Review copy is deliberately short at first glance. The engine line and
// position evidence remain available in the expandable review details.
function reviewPositionSummary(review) {
  if (!review || !review.fenBefore) return '';
  try {
    const position = new Chess(review.fenBefore);
    const side = position.turn() === 'w' ? 'White' : 'Black';
    if (review.tier === 'unknown') return `${side} to move here, but the engine could not finish this review.`;
    if (review.bestSan && review.userSan && review.bestSan === review.userSan) {
      return `At this ${side}-to-move position, ${review.userSan} matches the engine's first choice.`;
    }
    const best = review.bestUci ? moveFromUci(review.fenBefore, review.bestUci) : null;
    let reason = review.bestSan ? `${review.bestSan} is the stronger choice here` : 'the engine found a stronger continuation';
    if (best && best.san && best.san.includes('#')) reason = `${best.san} finishes with checkmate`;
    else if (best && best.san && best.san.includes('+')) reason = `${best.san} gives check, requiring a response`;
    else if (best && best.captured) reason = `${best.san} captures the ${PIECE_NAME[best.captured]?.toLowerCase() || 'piece'} on ${best.to}`;
    else if (best && best.flags && (best.flags.includes('k') || best.flags.includes('q'))) reason = `${best.san} improves king safety and activates a rook`;
    else if (best && ['n', 'b'].includes(best.piece)) {
      const homeRank = best.color === 'w' ? '1' : '8';
      const action = best.from[1] === homeRank ? 'develops' : 'repositions';
      reason = `${best.san} ${action} the ${PIECE_NAME[best.piece].toLowerCase()} from ${best.from} to ${best.to}`;
    } else if (best && best.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(best.to)) reason = `${best.san} places a pawn in the centre`;
    return `At this ${side}-to-move position, ${reason}.`;
  } catch (e) {
    return review.whyBetter || '';
  }
}

function reviewEvalLabel(info) {
  if (!info) return '';
  const depth = info.depth ? ` · depth ${info.depth}` : '';
  return `${formatEval(info)}${depth}`;
}

function coachAnalysisFen() {
  return coachReviewAnalysis && coachReviewAnalysis.steps[coachReviewAnalysis.index]
    ? coachReviewAnalysis.steps[coachReviewAnalysis.index].fen
    : null;
}

function updateCoachAnalysisAccessibility(fen, label) {
  const root = document.getElementById('coachBoard');
  if (!root || !fen) return;
  try {
    root.setAttribute('aria-label', `${label || 'Analysis position'} — ${describeChessPosition(new Chess(fen))}`);
  } catch (e) {}
}

function renderCoachReviewAnalysis() {
  const analysis = coachReviewAnalysis;
  if (!analysis || !coachBoard) return;
  const step = analysis.steps[analysis.index];
  if (!step) return;
  coachBoard.position(step.fen, false);
  setBoardLastMove('coachBoard', step.move || null);
  updateCapturedDisplay(step.fen);
  updateCoachAnalysisAccessibility(step.fen, step.label);
  const moveLabel = step.san ? ` · ${step.san}` : '';
  const lineLabel = `Analysis position · ${analysis.kind === 'consequence' ? 'possible consequence of your move' : 'recommended continuation'} (${analysis.index + 1}/${analysis.steps.length})${moveLabel}`;
  const analysisLabel = byId('coach-review-analysis');
  analysisLabel.textContent = lineLabel;
  showEl(analysisLabel);
  byId('btn-coach-review-analysis-prev').disabled = analysis.index <= 0;
  byId('btn-coach-review-analysis-next').disabled = analysis.index >= analysis.steps.length - 1;
  const backToGame = byId('btn-coach-backtogame');
  showEl(backToGame);
  backToGame.disabled = false;
  showEl(qsa('#btn-coach-review-analysis-prev, #btn-coach-review-analysis-next'));
  setCoachStatus('Analysis position shown — your actual game is unchanged.');
}

function clearCoachReviewAnalysis(opts = {}) {
  coachReviewAnalysisToken++;
  const oldAnalysisFen = coachAnalysisFen();
  coachReviewAnalysis = null;
  const analysisLabel = byId('coach-review-analysis');
  hideEl(analysisLabel);
  analysisLabel.replaceChildren();
  hideEl(qsa('#btn-coach-review-analysis-prev, #btn-coach-review-analysis-next, #btn-coach-backtogame'));
  if (!coachBoard) return;
  const fen = coachGame
    ? (coachReviewCursor === null ? coachGame.fen() : coachFenAtPly(coachReviewCursor))
    : null;
  // Always use a non-animated draw while leaving analysis. This interrupts
  // any in-flight board tween on reset, practice entry, or view changes.
  const targetFen = opts.restore === false ? (oldAnalysisFen || fen) : fen;
  if (!targetFen) return;
  coachBoard.position(targetFen, false);
  if (opts.restore !== false) {
    coachSyncLastMove();
    updateCapturedDisplay(targetFen);
    updateCoachBoardAccessibility();
  }
}

// Build a legal, bounded recommendation line without touching the live game.
// If an engine PV becomes invalid (for example after a truncated/stale result),
// stop at the last legal position instead of skipping over the bad move.
function buildCoachReviewAnalysisSteps(review) {
  if (!review || !review.fenBefore || !review.bestUci) return [];
  const line = [review.bestUci].concat(
    review.evalBefore && Array.isArray(review.evalBefore.pv) ? review.evalBefore.pv.slice(1, 6) : []
  );
  const position = new Chess(review.fenBefore);
  const steps = [{ fen: position.fen(), move: null, san: '', label: 'Analysis starting position' }];
  for (const uci of line) {
    const move = position.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    if (!move) break;
    steps.push({
      fen: position.fen(),
      move,
      san: move.san,
      label: steps.length === 1 ? 'Analysis · recommended move' : 'Analysis · recommended continuation'
    });
  }
  return steps;
}

// Replay a hypothetical engine response to the player's move. These are
// possible consequences, never a claim that the reply occurred in the game.
function buildCoachConsequenceSteps(review) {
  if (!review || !review.fenBefore || !review.userUci) return [];
  const position = new Chess(review.fenBefore);
  const line = [review.userUci].concat(
    review.evalAfter && Array.isArray(review.evalAfter.pv) ? review.evalAfter.pv.slice(0, 4) : []
  );
  const steps = [{ fen: position.fen(), move: null, san: '', label: 'Analysis before your move' }];
  for (const uci of line) {
    const move = moveFromUci(position.fen(), uci);
    if (!move) break;
    position.move(move);
    steps.push({ fen: position.fen(), move, san: move.san, label: steps.length === 1 ? 'Analysis · your move' : 'Analysis · possible consequence' });
  }
  return steps;
}

function startCoachConsequenceAnalysis(review) {
  const steps = buildCoachConsequenceSteps(review);
  if (steps.length < 2) return;
  startCoachReviewAnalysis(review);
  if (!coachReviewAnalysis || coachReviewAnalysis.review !== review) return;
  coachReviewAnalysis.steps = steps;
  coachReviewAnalysis.kind = 'consequence';
  coachReviewAnalysis.index = Math.min(2, steps.length - 1);
  renderCoachReviewAnalysis();
  updateCoachControlsState();
}

function startCoachReviewAnalysis(review) {
  if (!review || !review.fenBefore || !review.bestUci || !coachGame || !coachBoard) return;
  // A recommendation is useful only once the live game is idle on the user's
  // turn. It never edits coachGame, so returning to live restores the actual
  // game without undoing or reclassifying anything.
  if (!coachMode || coachThinking || !coachGame || coachIsReviewing()) return;
  if (coachGameActive && !coachIsUserTurn()) return;
  clearCoachReviewAnalysis({ restore: false });
  const token = coachReviewAnalysisToken;
  const steps = buildCoachReviewAnalysisSteps(review);
  if (token !== coachReviewAnalysisToken || !steps.length) return;
  coachReviewAnalysis = { review, steps, index: Math.min(1, steps.length - 1), token };
  CoachController.setPhase('reviewing');
  renderCoachReviewAnalysis();
  updateCoachControlsState();
}

function stepCoachReviewAnalysis(delta) {
  if (!coachReviewAnalysis) return;
  const next = Math.max(0, Math.min(coachReviewAnalysis.steps.length - 1, coachReviewAnalysis.index + delta));
  if (next === coachReviewAnalysis.index) return;
  coachReviewAnalysis.index = next;
  renderCoachReviewAnalysis();
}

function renderCoachReviewEvidence(review) {
  if (!review || !review.fenBefore || !review.fenAfter) {
    const evidence = byId('coach-review-evidence');
    hideEl(evidence);
    evidence.replaceChildren();
    return;
  }
  const replyUci = review.evalAfter && review.evalAfter.pv && review.evalAfter.pv[0];
  const reply = replyUci ? moveFromUci(review.fenAfter, replyUci) : null;
  let bestFen = review.fenBefore;
  try {
    const bestPosition = new Chess(review.fenBefore);
    if (review.bestUci) bestPosition.move({ from: review.bestUci.slice(0, 2), to: review.bestUci.slice(2, 4), promotion: review.bestUci[4] || undefined });
    bestFen = bestPosition.fen();
  } catch (e) {}
  let recommendedReply = null;
  if (review.evalBefore && review.evalBefore.pv && review.evalBefore.pv[1]) {
    recommendedReply = moveFromUci(bestFen, review.evalBefore.pv[1]);
  }
  const actualLabel = reply ? `Possible reply: ${reply.san}` : 'Position after your move';
  const recommendedLabel = recommendedReply
    ? `Recommended continuation: ${recommendedReply.san}`
    : 'Recommended continuation is shown on the main board';
  const evidence = byId('coach-review-evidence');
  evidence.innerHTML =
    `<div class="coach-review-evidence-head">Your move vs recommendation <span>${escapeHtml(review.userSan || 'Your move')} → ${escapeHtml(review.bestSan || 'Recommended move')}</span></div>` +
    `<div class="coach-review-evidence-boards">` +
      `<div><div class="review-board-label">After your move · ${escapeHtml(actualLabel)}</div><div class="review-board">${reviewBoardMarkup(review.fenAfter)}</div></div>` +
      `<div><div class="review-board-label">Analysis · ${escapeHtml(recommendedLabel)}</div><div class="review-board">${reviewBoardMarkup(bestFen)}</div></div>` +
    `</div>`;
  showEl(evidence);
}

function renderCoachReview(review) {
  if (!review) { hideEl(byId('coach-review')); return; }
  const badge = byId('coach-classification');
  const flair = review.flair === 'brilliant' || review.flair === 'great' ? review.flair : null;
  badge.textContent = flair === 'brilliant' ? '!! Brilliant' : flair === 'great' ? '! Great move' : review.emoji + ' ' + review.label;
  badge.className = 'coach-classification coach-class-' + (flair || review.tier);
  byId('coach-loss').textContent = review.loss > 0 ? '−' + (review.loss / 100).toFixed(2) : '0.00';
  byId('coach-user-move').textContent = review.userSan || '—';
  byId('coach-best-move').textContent = review.bestSan || '—';
  const isBest = review.tier === 'best';
  const isExcellent = review.tier === 'excellent';
  const isUnknown = review.tier === 'unknown';
  const teaching = !isUnknown && review.fenBefore && review.fenAfter && review.bestUci
    ? coachExplanationContext(review.fenBefore, review.userUci, review.bestUci, review.fenAfter, review.evalAfter)
    : null;
  const consequence = byId('coach-review-consequence');
  consequence.textContent = (teaching && teaching.consequence) || '';
  toggleEl(consequence, !!(teaching && teaching.consequence));
  const summary = review.reviewSummary || reviewPositionSummary(review);
  const summaryEl = qs('#coach-review-summary, #coach-explanation');
  if (summaryEl) summaryEl.textContent = summary;
  byId('coach-review-details').setAttribute('aria-label', 'Deeper engine review');
  let msg;
  if (isUnknown) {
    msg = 'Engine timed out on this move — skipping classification. The game continues.';
  } else if (isBest) {
    msg = 'Engine\'s #1 choice. Keep it coming.';
  } else if (isExcellent) {
    msg = `Top-3 engine move (#${review.rank}). ${review.bestSan} was #1 — you're in great company.`;
  } else {
    msg = `The engine prefers ${review.bestSan}. You lost ${(review.loss / 100).toFixed(2)} pawns of evaluation with ${review.userSan}.`;
    if (review.whyBetter) msg += ' ' + review.whyBetter;
  }
  // Keep the existing explanation field useful on older markup, while newer
  // markup gets the concise position-linked summary above.
  if (!byId('coach-review-summary') && byId('coach-explanation')) byId('coach-explanation').textContent = msg;
  byId('coach-review-deep-explanation').textContent = msg;
  const lesson = byId('coach-review-lesson');
  lesson.textContent = review.lesson ? 'Lesson · ' + review.lesson : '';
  toggleEl(lesson, !!review.lesson);
  const threat = byId('coach-review-threat');
  threat.textContent = review.opponentThreat || '';
  toggleEl(threat, !!review.opponentThreat);
  renderCoachReviewEvidence(review);
  toggleEl(byId('btn-coach-consequence'), !isUnknown && !isBest && !!review.userUci);
  const evalText = [
    review.evalBefore ? `Position before: ${reviewEvalLabel(review.evalBefore)}` : '',
    review.evalAfter ? `After your move: ${reviewEvalLabel(review.evalAfter)}` : ''
  ].filter(Boolean).join(' · ');
  qsa('#coach-review-eval, #coach-review-eval-deep').forEach(el => {
    el.textContent = evalText;
    toggleEl(el, !!evalText);
  });
  const cue = isUnknown
    ? 'Coach cue: Keep playing — this move was not scored, so there is no lesson to carry forward yet.'
    : isBest
      ? 'Keep this habit: you found the engine’s first choice.'
      : isExcellent
        ? 'Keep this habit: your move was in the engine’s top three.'
        : `Next time: ${teaching ? teaching.cue : 'compare checks, captures, and the opponent’s strongest reply before committing.'}`;
  byId('coach-review-cue').textContent = cue;
  const practiceItem = practiceItemFromReview(review);
  const practiceBtn = byId('btn-coach-review-practice');
  practiceBtn.textContent = 'Practice this move';
  practiceBtn.setAttribute('data-practice-id', practiceItem ? practiceItem.id : '');
  toggleEl(practiceBtn, !!practiceItem && practiceIsDue(practiceItem));
  if (review.pvSan && review.pvSan.length > 1) {
    const pv = byId('coach-pv');
    showEl(pv);
    pv.textContent = 'Engine line: ' + review.pvSan.join(' ');
  } else {
    hideEl(byId('coach-pv'));
  }
  // Keep the stored top alternatives in the deeper review details. They are
  // useful even for a good move when the user wants to compare plans.
  const showAlts = !isUnknown && review.topAlternatives && review.topAlternatives.length > 0;
  if (showAlts) {
    const list = byId('coach-alts-list');
    list.replaceChildren();
    review.topAlternatives.forEach((alt, i) => {
      const cont = (alt.pvSan || []).slice(1).join(' ');
      const cp = alt.cp == null ? '' : (alt.cp >= 10000 ? '#'
                                       : alt.cp <= -10000 ? '−#'
                                       : (alt.cp >= 0 ? '+' : '') + (alt.cp / 100).toFixed(2));
      const row = makeEl('div', 'coach-review-alts-row');
      row.insertAdjacentHTML('beforeend', `<span class="alt-rank">#${i + 1}</span>`);
      const line = makeEl('span', 'alt-line');
      line.insertAdjacentHTML('beforeend', `<span class="alt-san">${alt.san}</span>`);
      if (cont) line.insertAdjacentHTML('beforeend', ` <span class="alt-cont">${cont}</span>`);
      row.append(line);
      row.insertAdjacentHTML('beforeend', `<span class="alt-cp">${cp}</span>`);
      list.append(row);
    });
    const alts = byId('coach-alts');
    showEl(alts);
    alts.style.display = 'flex';
  } else {
    hideEl(byId('coach-alts'));
  }
  const reviewPanel = byId('coach-review');
  showEl(reviewPanel);
  reviewPanel.style.display = 'flex';
  const canExplain = !isBest && !isUnknown && !!review.bestUci && coachMode &&
    !coachThinking && (!coachGameActive || coachIsUserTurn()) && !coachIsReviewing();
  byId('btn-coach-showbest').disabled = !canExplain;
  const showWhy = byId('btn-coach-showwhy');
  toggleEl(showWhy, !isBest && !isUnknown && !!review.bestUci);
  showWhy.disabled = !canExplain;
  byId('btn-coach-consequence').disabled = !canExplain;
}

// ─────────────────────────────────────────────
// HISTORY NAVIGATION / REVIEW MODE
// ─────────────────────────────────────────────
function coachIsReviewing() {
  if (coachReviewAnalysis) return true;
  if (!coachGame || coachReviewCursor === null) return false;
  return coachReviewCursor !== coachGame.history().length;
}

// Return the review whose ply matches cursor n, or the most recent review at
// or before n (handles opponent-move plies, which have no review of their own).
// Returns null if no user move has been reviewed up to that point.
function reviewAtCursor(n) {
  if (!coachReviewLog || coachReviewLog.length === 0 || n <= 0) return null;
  let best = null;
  for (const r of coachReviewLog) {
    if (r.ply <= n && (best === null || r.ply > best.ply)) best = r;
  }
  return best;
}

function coachFenAtPly(n) {
  if (!coachGame) return null;
  const tmp = new Chess(coachStartFen);
  const moves = coachGame.history({ verbose: true });
  const end = Math.max(0, Math.min(n, moves.length));
  for (let i = 0; i < end; i++) {
    tmp.move({ from: moves[i].from, to: moves[i].to, promotion: moves[i].promotion });
  }
  return tmp.fen();
}

function coachGotoPly(n) {
  if (!coachGame) return;
  // A drill is played from its position; stepping back would leave the board
  // in review with the step controls hidden.
  if (coachPracticeSession) return;
  clearCoachReviewAnalysis({ restore: false });
  const total = coachGame.history().length;
  n = Math.max(0, Math.min(n, total));
  coachReviewCursor = n === total ? null : n;
  const fen = coachFenAtPly(n);
  if (coachBoard && fen) coachBoard.position(fen, false);
  coachSyncLastMove();
  if (coachIsReviewing()) {
    CoachController.setPhase('reviewing');
    hideEl(byId('threats-section'));
    hideEl(byId('candidates-section'));
    setCoachStatus(`Reviewing move ${n} of ${total} — click Live to return.`);
    // Show the review card for the move at/before this cursor. If nothing has
    // been reviewed yet (n==0 or only opponent moves so far), hide the card.
    const r = reviewAtCursor(n);
    if (r) renderCoachReview(r); else hideEl(byId('coach-review'));
  } else {
    // Back to live — restore the latest review.
    CoachController.setPhase(coachGameActive
      ? (coachIsUserTurn() ? 'userTurn' : 'opponentThinking')
      : 'ended');
    if (coachLastReview) renderCoachReview(coachLastReview);
  }
  updateCoachControlsState();
  updateCapturedDisplay(fen);
  updateMoveList();
  updateOpeningLabel();
}

function coachGotoLive() {
  if (!coachGame) return;
  clearCoachReviewAnalysis({ restore: false });
  coachReviewCursor = null;
  if (coachBoard) coachBoard.position(coachGame.fen(), false);
  coachSyncLastMove();
  if (coachLastReview) renderCoachReview(coachLastReview);
  CoachController.setPhase(coachGameActive
    ? (coachIsUserTurn() ? 'userTurn' : 'opponentThinking')
    : 'ended');
  updateCoachControlsState();
  updateCapturedDisplay(coachGame.fen());
  updateMoveList();
  updateOpeningLabel();
  if (coachGameActive) {
    setCoachStatus(coachIsUserTurn() ? 'Your move.' : 'Opponent thinking…');
  }
}

// ─────────────────────────────────────────────
// CAPTURED PIECES / MATERIAL LEAD
// ─────────────────────────────────────────────
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const PIECE_GLYPH_WHITE = { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕' };
const PIECE_GLYPH_BLACK = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };

function countPieces(fen) {
  const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  const rows = fen.split(' ')[0].split('/');
  for (const row of rows) {
    for (const ch of row) {
      if (/\d/.test(ch)) continue;
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      const type = ch.toLowerCase();
      if (type === 'k') continue;
      if (counts[color][type] !== undefined) counts[color][type]++;
    }
  }
  return counts;
}

function renderCapturedRow(caps, glyphs) {
  let html = '';
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    for (let i = 0; i < caps[t]; i++) {
      html += '<span class="cap-piece">' + glyphs[t] + '</span>';
    }
  }
  return html;
}

// Count captures from move history up to the cursor (or live if null).
// This is robust to promotions: if a pawn promotes to a queen, the pawn isn't
// "captured" — nothing is, unless the promotion move itself was a capture.
function capturedFromHistory() {
  const caps = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  if (!coachGame) return caps;
  const moves = coachGame.history({ verbose: true });
  const end = coachReviewCursor === null ? moves.length : coachReviewCursor;
  for (let i = 0; i < end; i++) {
    const m = moves[i];
    if (m.captured && caps[m.color][m.captured] !== undefined) {
      caps[m.color][m.captured]++;
    }
  }
  return caps;
}

function updateCapturedDisplay(fen) {
  if (!fen || !coachGame) {
    qsa('#captured-top-pieces, #captured-bottom-pieces').forEach(el => { el.replaceChildren(); });
    qsa('#captured-top-lead, #captured-bottom-lead').forEach(el => { el.textContent = ''; });
    return;
  }
  // Captured rows come from the move history (accurate under promotions).
  const caps = capturedFromHistory();
  const whiteTook = caps.w; // white's captures = pieces white removed from black
  const blackTook = caps.b;
  // Material lead comes from the current board so promotions (and net material
  // after trades) are reflected correctly.
  const counts = countPieces(fen);
  let whiteMat = 0, blackMat = 0;
  for (const t of ['p', 'n', 'b', 'r', 'q']) {
    whiteMat += counts.w[t] * PIECE_VALUES[t];
    blackMat += counts.b[t] * PIECE_VALUES[t];
  }
  const userIsWhite = coachUserColor() === 'white';
  const userTook = userIsWhite ? whiteTook : blackTook;
  const oppTook = userIsWhite ? blackTook : whiteTook;
  const userGlyphs = userIsWhite ? PIECE_GLYPH_BLACK : PIECE_GLYPH_WHITE;
  const oppGlyphs = userIsWhite ? PIECE_GLYPH_WHITE : PIECE_GLYPH_BLACK;
  const userLead = userIsWhite ? (whiteMat - blackMat) : (blackMat - whiteMat);
  byId('captured-bottom-pieces').innerHTML = renderCapturedRow(userTook, userGlyphs);
  byId('captured-top-pieces').innerHTML = renderCapturedRow(oppTook, oppGlyphs);
  byId('captured-bottom-lead').textContent = userLead > 0 ? '+' + userLead : '';
  byId('captured-top-lead').textContent = userLead < 0 ? '+' + (-userLead) : '';
}

// ─────────────────────────────────────────────
// MOVE LIST / PGN
// ─────────────────────────────────────────────
// Build a minimal PGN from coachGame. Uses chess.js pgn() as the base and
// only adds a couple of safe headers — the rest (result, level) is inferred.
function coachGetPgn() {
  if (!coachGame) return '';
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(today.getUTCDate()).padStart(2, '0');
  let result = '*';
  if (coachGame.in_checkmate()) {
    result = coachGame.turn() === 'w' ? '0-1' : '1-0';
  } else if (coachGame.in_stalemate() || coachGame.in_draw() || coachGame.in_threefold_repetition() || coachGame.insufficient_material()) {
    result = '1/2-1/2';
  }
  // chess.js .pgn() may include auto tags for custom FEN starts (FEN/SetUp).
  // Pull them out and merge into our own tag pair section to keep the PGN
  // standards-compliant (one tag pair section only).
  const rawPgn = coachGame.pgn();
  const autoTags = {};
  const tagRe = /^\[(\w+)\s+"((?:\\.|[^"\\])*)"\]\s*$/gm;
  let m;
  let movetext = rawPgn;
  while ((m = tagRe.exec(rawPgn)) !== null) {
    autoTags[m[1]] = m[2];
  }
  // Strip tag lines and any leading blank lines from the movetext
  movetext = movetext.replace(/^(?:\[[^\]]*\]\s*\n?)+/, '').trim();
  const headers = [
    ['Event', 'Coach Mode training'],
    ['Site', 'chess.cjarhodes.com'],
    ['Date', `${yyyy}.${mm}.${dd}`],
    ['White', coachUserColor() === 'white' ? 'Player' : `Opponent ${coachEngineElo || ''}`.trim()],
    ['Black', coachUserColor() === 'black' ? 'Player' : `Opponent ${coachEngineElo || ''}`.trim()],
    ['Result', result],
  ];
  if (coachOpeningTransfer) {
    headers.push(['Opening', coachOpeningTransfer.title], ['Variation', coachOpeningTransfer.lineName]);
  }
  if (autoTags.SetUp) headers.push(['SetUp', autoTags.SetUp]);
  if (autoTags.FEN) headers.push(['FEN', autoTags.FEN]);
  const header = headers
    .map(([k, v]) => `[${k} "${String(v).replace(/"/g, '\\"')}"]`)
    .join('\n');
  // A valid PGN always ends with the result token. Ensure it's present
  // whether movetext is empty (just the token) or non-empty (appended if
  // chess.js didn't already include it).
  let bodyWithResult;
  if (!movetext) {
    bodyWithResult = result;
  } else if (movetext.endsWith(result)) {
    bodyWithResult = movetext;
  } else {
    bodyWithResult = `${movetext} ${result}`;
  }
  return `${header}\n\n${bodyWithResult}\n`;
}

// Render the move list, highlighting the ply at cursor (or the latest).
function updateMoveList() {
  // Refresh the live eval sparkline alongside the move list — both reflect the same data.
  updateLiveEvalChart();
  updateCoachBoardAccessibility();
  const section = byId('movelist-section');
  const list = byId('movelist');
  if (!coachGame || coachGame.history().length === 0) {
    hideEl(section);
    list.replaceChildren();
    return;
  }
  showEl(section);
  const sans = coachGame.history();
  const total = sans.length;
  const cursor = coachReviewCursor === null ? total : coachReviewCursor;
  // Map ply → classification tier for coloring blunders/mistakes in the list.
  const tierByPly = {};
  const flairByPly = {};
  for (const r of coachReviewLog) {
    if (r && r.ply) { tierByPly[r.ply] = r.tier; flairByPly[r.ply] = r.flair || ''; }
  }
  const glyph = ply => flairByPly[ply] === 'brilliant' ? '<span class="ply-flair brilliant" aria-label="brilliant">!!</span>'
    : flairByPly[ply] === 'great' ? '<span class="ply-flair great" aria-label="great move">!</span>' : '';
  const pairs = Math.ceil(sans.length / 2);
  let html = '';
  for (let i = 0; i < pairs; i++) {
    const wPly = i * 2 + 1;
    const bPly = i * 2 + 2;
    const wSan = sans[wPly - 1] || '';
    const bSan = sans[bPly - 1] || '';
    const wTier = tierByPly[wPly] || '';
    const bTier = tierByPly[bPly] || '';
    const wClasses = ['ply'];
    const bClasses = ['ply'];
    if (wPly === cursor) wClasses.push('current');
    if (bPly === cursor) bClasses.push('current');
    if (['blunder', 'mistake', 'inaccuracy'].includes(wTier)) wClasses.push(wTier);
    if (['blunder', 'mistake', 'inaccuracy'].includes(bTier)) bClasses.push(bTier);
    html += `<span class="num">${i + 1}.</span>`;
    html += `<span class="${wClasses.join(' ')}" data-ply="${wPly}">${escapeHtml(wSan)}${glyph(wPly)}</span>`;
    if (bSan) {
      html += `<span class="${bClasses.join(' ')}" data-ply="${bPly}">${escapeHtml(bSan)}${glyph(bPly)}</span>`;
    } else {
      html += `<span class="ply-empty">…</span>`;
    }
  }
  list.innerHTML = html;
  // Scroll the current ply into view.
  const cEl = list.querySelector('.ply.current');
  if (cEl) {
    const lEl = list;
    const top = cEl.offsetTop - lEl.offsetTop;
    if (top < lEl.scrollTop || top > lEl.scrollTop + lEl.clientHeight - cEl.clientHeight) {
      lEl.scrollTop = top - lEl.clientHeight / 2;
    }
  }
}
