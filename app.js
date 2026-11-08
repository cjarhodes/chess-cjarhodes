// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let board = null;
let game = new Chess();
let currentOpening = null;
let currentLine = null;
let currentLineId = 'main';
let currentMoveIdx = -1;  // -1 = starting position
let quizMode = false;
let exploreMode = false;
let exploreGame = null;
let exploreStartFen = null;
let exploreRequestId = 0;
let currentDb = 'lichess';
let boardFlipped = false;
let quizAttempts = 0;
let feedbackTimeout = null;
let quizSessionMisses = 0;  // misses in current quiz session (before completion)
let quizMissedMoves = [];
let quizReviewMode = false;
let quizReviewQueue = [];
let quizReviewCursor = 0;
let quizTimerGeneration = 0; // invalidates pending quiz auto-play when the quiz restarts
let tapSelected = null;      // square selected for tap-to-move, or null
let pendingPromotionChoice = null;
let promotionReturnFocus = null;
let summaryReturnFocus = null;

// Coach mode (standalone page)
let appView = 'coach';             // 'library' | 'coach' — Coach is the product home
let coachMode = false;             // true when coach view is active
let coachGame = null;
let coachStartFen = null;
let coachStats = null;
let coachReviewLog = [];           // all reviews from current session (for summary turning point)
let coachLastReview = null;        // most recent review (for take back / show best)
let coachThinking = false;
let coachUserSide = 'white';       // 'white' | 'black'
let coachEngineElo = 1200;         // displayed opponent level
let coachOpeningTransfer = null;   // optional Library-to-play context, owned with the saved game
let coachOpeningId = null;         // deepest identified opening in the current game
let coachBoard = null;             // separate Chessboard.js instance
let coachBoardFlipped = false;
let coachGameActive = false;       // true once user hits New Game
let coachGameGeneration = 0;       // invalidates async work from replaced/rewound games
let coachLocalGameId = null;       // stable id for idempotent local lifetime rollups
let coachEndedAt = null;           // timestamp of game end, null while playing
let coachReviewCursor = null;      // null = live; integer = ply index displayed on the board
let coachReviewAnalysis = null;    // transient recommended line shown on the main board
let coachReviewAnalysisToken = 0;  // invalidates stale analysis-board updates
let coachLastEndMsg = null;        // headline from last game-over, used to reopen the review
let candidateRequestId = 0;        // invalidates stale async candidate searches
let threatRequestId = 0;           // invalidates stale async threat scans
let coachPremove = null;           // queued premove while opponent is thinking
let coachPracticeSession = null;   // active mistake-position drill, separate from normal games
let coachPracticeRun = null;       // ordered multi-drill session and its aggregate result
let coachPracticeReturnState = null; // in-progress game restored after the drill
let renderedPracticeItems = new Map();
let summaryPracticeItems = [];
let coachRemoteGameId = null;      // Supabase coach_games.id for current game
let coachRemoteGamePromise = null;
let coachRemoteGamePromiseGeneration = null;
let coachAuthUser = null;
let coachDbClient = null;
let coachDbInitStarted = false;
let coachDbInitPromise = null;
let coachRemoteInsightEntries = null;
let coachDbStatus = 'local';
let coachRemoteInsightsLoaded = false;
let coachAuthEventRevision = 0;
let coachAuthPhase = 'local'; // local | sending | callback | signed-in | signed-out | error
let remoteGameUpdateTimer = null;
let pendingRemoteGameEndReason = null;
let pendingRemoteGameGeneration = null;
let dailySprintSyncTimer = null;
let dailySprintSyncChain = Promise.resolve();
const REMOTE_GAME_SYNC_DEBOUNCE_MS = 2500;
const DAILY_SPRINT_SYNC_DEBOUNCE_MS = 800;

// All durable Coach memory is scoped to either the signed-in account or this
// browser's anonymous workspace. This prevents a second account on the same
// browser from inheriting the first account's insights, games, or statistics.
const COACH_DEVICE_KEY = 'coach:device-id:v1';
function coachDeviceId() {
  try {
    const existing = localStorage.getItem(COACH_DEVICE_KEY);
    if (existing) return existing;
    const id = createCoachGameId();
    localStorage.setItem(COACH_DEVICE_KEY, id);
    return id;
  } catch (e) {
    return 'volatile';
  }
}
function coachMemoryOwnerId() {
  return coachAuthUser && coachAuthUser.id ? `user:${coachAuthUser.id}` : `anon:${coachDeviceId()}`;
}
function coachMemoryKey(baseKey) {
  return `${baseKey}:${coachMemoryOwnerId()}`;
}
function migrateLegacyCoachMemory() {
  const legacyKeys = [
    'coach:insights:v1',
    'coach:lifetime:v1',
    'coach:state:v1',
    'coach:state:corrupt:v1'
  ];
  const anonOwner = coachMemoryOwnerId();
  try {
    legacyKeys.forEach(baseKey => {
      const scopedKey = `${baseKey}:${anonOwner}`;
      if (localStorage.getItem(scopedKey) || !localStorage.getItem(baseKey)) return;
      localStorage.setItem(scopedKey, localStorage.getItem(baseKey));
      localStorage.removeItem(baseKey);
    });
  } catch (e) { /* local progress remains best-effort if storage is blocked */ }
}

const CoachController = {
  phase: 'idle',
  setPhase(phase) {
    this.phase = phase;
    renderCoachPresentation();
    return this.phase;
  }
};

// Optional runtime config. Set these public Supabase values in the deployed
// page when account-backed coach history is ready. Without config, Coach stays
// local-first and uses the existing localStorage insights.
window.COACH_SUPABASE_CONFIG = window.COACH_SUPABASE_CONFIG || {
  url: '',
  publishableKey: ''
};

// ─────────────────────────────────────────────
// PREMOVE — queue your move while the engine is thinking
// ─────────────────────────────────────────────
function setPremoveSquares(from, to) {
  $('#coachBoard .coach-premove-from').removeClass('coach-premove-from');
  $('#coachBoard .coach-premove-to').removeClass('coach-premove-to');
  if (from) $('#coachBoard .square-' + from).addClass('coach-premove-from');
  if (to)   $('#coachBoard .square-' + to).addClass('coach-premove-to');
}
function setPremove(from, to, promotion) {
  coachPremove = { from, to, promotion: promotion || 'q' };
  setPremoveSquares(from, to);
  const suffix = coachPremove.promotion && coachPremove.promotion !== 'q'
    ? '=' + coachPremove.promotion.toUpperCase()
    : '';
  $('#coach-premove-hint').text(`Premove queued: ${from}–${to}${suffix} (click board to cancel)`).show();
}
function clearPremove() {
  coachPremove = null;
  setPremoveSquares(null, null);
  $('#coach-premove-hint').hide().text('');
}
// Called after the opponent's move applies. If the queued premove is still
// legal, dispatch it through the normal user-move pipeline.
function tryApplyPremove() {
  if (!coachPremove || !coachGame || !coachGameActive) return;
  if (!coachIsUserTurn()) { clearPremove(); return; }
  const pm = coachPremove;
  const tmp = new Chess(coachGame.fen());
  const mv = tmp.move({ from: pm.from, to: pm.to, promotion: pm.promotion });
  clearPremove();
  if (!mv) return; // illegal in the new position — silently drop
  // Update the board immediately, then run classification asynchronously.
  if (coachBoard) { coachBoard.position(tmp.fen()); setBoardLastMove('coachBoard', mv); }
  coachHandleUserMove(pm.from, pm.to, pm.promotion, { updateBoard: false });
}

function updateCoachSummary() {
  if (!coachStats) return;
  const total = coachStats.moves;
  $('#coach-moves-count').text(total);
  $('#coach-tally-best').text(coachStats.best);
  $('#coach-tally-excellent').text(coachStats.excellent);
  $('#coach-tally-good').text(coachStats.good);
  $('#coach-tally-inacc').text(coachStats.inaccuracy);
  $('#coach-tally-mistake').text(coachStats.mistake);
  $('#coach-tally-blunder').text(coachStats.blunder);
  if (total === 0) {
    $('#coach-accuracy').text('—');
    $('#coach-accuracy-recent').text('—');
    $('#coach-accuracy-recent-label').text('Recent accuracy');
    return;
  }
  const pct = accuracyFromTallies(coachStats, total);
  $('#coach-accuracy').text((pct === null ? '—' : pct + '%'));
  const roll = rollingAccuracy(10);
  if (roll && roll.pct !== null) {
    $('#coach-accuracy-recent').text(roll.pct + '%');
    $('#coach-accuracy-recent-label').text(`Last ${roll.n} move${roll.n === 1 ? '' : 's'}`);
  } else {
    $('#coach-accuracy-recent').text('—');
    $('#coach-accuracy-recent-label').text('Recent accuracy');
  }
}

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
  $('#coach-review-analysis').text(lineLabel).show();
  $('#btn-coach-review-analysis-prev').prop('disabled', analysis.index <= 0);
  $('#btn-coach-review-analysis-next').prop('disabled', analysis.index >= analysis.steps.length - 1);
  $('#btn-coach-backtogame').show().prop('disabled', false);
  $('#btn-coach-review-analysis-prev, #btn-coach-review-analysis-next').show();
  setCoachStatus('Analysis position shown — your actual game is unchanged.');
}

function clearCoachReviewAnalysis(opts = {}) {
  coachReviewAnalysisToken++;
  const oldAnalysisFen = coachAnalysisFen();
  coachReviewAnalysis = null;
  $('#coach-review-analysis').hide().empty();
  $('#btn-coach-review-analysis-prev, #btn-coach-review-analysis-next, #btn-coach-backtogame').hide();
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
    $('#coach-review-evidence').hide().empty();
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
  $('#coach-review-evidence').html(
    `<div class="coach-review-evidence-head">Your move vs recommendation <span>${escapeHtml(review.userSan || 'Your move')} → ${escapeHtml(review.bestSan || 'Recommended move')}</span></div>` +
    `<div class="coach-review-evidence-boards">` +
      `<div><div class="review-board-label">After your move · ${escapeHtml(actualLabel)}</div><div class="review-board">${reviewBoardMarkup(review.fenAfter)}</div></div>` +
      `<div><div class="review-board-label">Analysis · ${escapeHtml(recommendedLabel)}</div><div class="review-board">${reviewBoardMarkup(bestFen)}</div></div>` +
    `</div>`
  ).show();
}

function renderCoachReview(review) {
  if (!review) { $('#coach-review').hide(); return; }
  const $badge = $('#coach-classification');
  const flair = review.flair === 'brilliant' || review.flair === 'great' ? review.flair : null;
  $badge.text(flair === 'brilliant' ? '!! Brilliant' : flair === 'great' ? '! Great move' : review.emoji + ' ' + review.label);
  $badge.attr('class', 'coach-classification coach-class-' + (flair || review.tier));
  $('#coach-loss').text(review.loss > 0 ? '−' + (review.loss / 100).toFixed(2) : '0.00');
  $('#coach-user-move').text(review.userSan || '—');
  $('#coach-best-move').text(review.bestSan || '—');
  const isBest = review.tier === 'best';
  const isExcellent = review.tier === 'excellent';
  const isUnknown = review.tier === 'unknown';
  const teaching = !isUnknown && review.fenBefore && review.fenAfter && review.bestUci
    ? coachExplanationContext(review.fenBefore, review.userUci, review.bestUci, review.fenAfter, review.evalAfter)
    : null;
  $('#coach-review-consequence').text(teaching ? teaching.consequence : '').toggle(!!(teaching && teaching.consequence));
  const summary = review.reviewSummary || reviewPositionSummary(review);
  $('#coach-review-summary, #coach-explanation').first().text(summary);
  $('#coach-review-details').attr('aria-label', 'Deeper engine review');
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
  if (!$('#coach-review-summary').length) $('#coach-explanation').text(msg);
  $('#coach-review-deep-explanation').text(msg);
  $('#coach-review-lesson')
    .text(review.lesson ? 'Lesson · ' + review.lesson : '')
    .toggle(!!review.lesson);
  $('#coach-review-threat')
    .text(review.opponentThreat || '')
    .toggle(!!review.opponentThreat);
  renderCoachReviewEvidence(review);
  $('#btn-coach-consequence').toggle(!isUnknown && !isBest && !!review.userUci);
  const evalText = [
    review.evalBefore ? `Position before: ${reviewEvalLabel(review.evalBefore)}` : '',
    review.evalAfter ? `After your move: ${reviewEvalLabel(review.evalAfter)}` : ''
  ].filter(Boolean).join(' · ');
  $('#coach-review-eval, #coach-review-eval-deep').text(evalText).toggle(!!evalText);
  const cue = isUnknown
    ? 'Coach cue: Keep playing — this move was not scored, so there is no lesson to carry forward yet.'
    : isBest
      ? 'Keep this habit: you found the engine’s first choice.'
      : isExcellent
        ? 'Keep this habit: your move was in the engine’s top three.'
        : `Next time: ${teaching ? teaching.cue : 'compare checks, captures, and the opponent’s strongest reply before committing.'}`;
  $('#coach-review-cue').text(cue);
  const practiceItem = practiceItemFromReview(review);
  $('#btn-coach-review-practice')
    .text('Practice this move')
    .attr('data-practice-id', practiceItem ? practiceItem.id : '')
    .toggle(!!practiceItem && practiceIsDue(practiceItem));
  if (review.pvSan && review.pvSan.length > 1) {
    $('#coach-pv').show().text('Engine line: ' + review.pvSan.join(' '));
  } else {
    $('#coach-pv').hide();
  }
  // Keep the stored top alternatives in the deeper review details. They are
  // useful even for a good move when the user wants to compare plans.
  const showAlts = !isUnknown && review.topAlternatives && review.topAlternatives.length > 0;
  if (showAlts) {
    const $list = $('#coach-alts-list').empty();
    review.topAlternatives.forEach((alt, i) => {
      const cont = (alt.pvSan || []).slice(1).join(' ');
      const cp = alt.cp == null ? '' : (alt.cp >= 10000 ? '#'
                                       : alt.cp <= -10000 ? '−#'
                                       : (alt.cp >= 0 ? '+' : '') + (alt.cp / 100).toFixed(2));
      const $row = $('<div class="coach-review-alts-row"></div>');
      $row.append(`<span class="alt-rank">#${i + 1}</span>`);
      const $line = $('<span class="alt-line"></span>');
      $line.append(`<span class="alt-san">${alt.san}</span>`);
      if (cont) $line.append(` <span class="alt-cont">${cont}</span>`);
      $row.append($line);
      $row.append(`<span class="alt-cp">${cp}</span>`);
      $list.append($row);
    });
    $('#coach-alts').show().css('display', 'flex');
  } else {
    $('#coach-alts').hide();
  }
  $('#coach-review').show().css('display', 'flex');
  const canExplain = !isBest && !isUnknown && !!review.bestUci && coachMode &&
    !coachThinking && (!coachGameActive || coachIsUserTurn()) && !coachIsReviewing();
  $('#btn-coach-showbest').prop('disabled', !canExplain);
  $('#btn-coach-showwhy').toggle(!isBest && !isUnknown && !!review.bestUci).prop('disabled', !canExplain);
  $('#btn-coach-consequence').prop('disabled', !canExplain);
}

function setCoachStatus(msg) {
  const guidance = {
    'Your move.': 'Play on the board or enter a move below.',
    'Opponent thinking…': 'Choosing a reply. You can queue a premove.',
    'Analyzing your move…': 'Checking your move before the opponent replies.'
  };
  $('#coach-status').text(guidance[msg] || msg);
  renderCoachPresentation();
}

// Presentation follows the existing game/practice state; it never changes it.
function renderCoachPresentation() {
  const view = document.getElementById('coach-view');
  if (!view) return;
  const practicing = !!coachPracticeSession;
  const reviewing = coachIsReviewing();
  const day = dailySprintToday();
  const state = practicing ? (coachPracticeSession.completed ? 'practice-complete' : coachPracticeSession.grading || coachPracticeSession.pendingMove ? 'practice-checking' : 'practice')
    : reviewing ? 'review'
    : coachGameActive ? (coachThinking || CoachController.phase === 'analyzing' ? 'analyzing' : coachIsUserTurn() ? 'user-turn' : 'opponent-turn')
    : coachLastEndMsg ? 'ended' : day && day.completedAt ? 'complete' : 'ready';
  const labels = {
    ready: 'Ready to train', 'user-turn': 'Your turn · ' + (coachUserColor() === 'white' ? 'White' : 'Black'),
    analyzing: 'Reviewing your move', 'opponent-turn': 'Opponent’s turn',
    review: 'Review · viewing another position', practice: 'Practice · find the move',
    'practice-checking': 'Practice · checking your move', 'practice-complete': 'Practice saved · next step', ended: 'Game complete', complete: 'Today’s training complete'
  };
  if (view.dataset.uiState === 'ready' && ['user-turn', 'analyzing', 'opponent-turn'].includes(state)) {
    document.getElementById('coach-game-options').open = false;
  }
  view.dataset.uiState = state;
  const canEnterMove = state === 'user-turn' || state === 'practice';
  $('#coach-keyboard-move-input, #coach-keyboard-move-form button').prop('disabled', !canEnterMove);
  $('#coachBoard-wrap').attr('aria-busy', ['analyzing', 'opponent-turn', 'practice-checking'].includes(state) ? 'true' : 'false');
  $('#coachBoard').attr('aria-describedby', practicing ? 'coach-status coach-practice-prompt' : 'coach-status');
  $('#coach-review-empty').toggle(!coachLastReview && !practicing);

  const selecting = !practicing && document.getElementById('panel-practice').classList.contains('active');
  $('#coach-phase-label').text(selecting && state === 'ready' ? 'Practice · choose a lesson' : labels[state]);
  $('#practice-selection-guidance').toggle(selecting && state === 'ready');
  $('#coach-daily-plan-label').text(practicing ? 'Practice session' : 'Adaptive session · 5–10 min');
  $('.daily-sprint-progress').attr('aria-label', practicing ? 'Practice progress' : 'Adaptive session progress');
  $('#coach-game-options-label').text((coachUserSide === 'random' ? 'Random' : coachUserColor() === 'white' ? 'White' : 'Black') + ' · ' + coachEngineElo);
  const managed = '#btn-practice-session-start, #btn-opening-transfer-review, #btn-progress-next, #btn-coach-next-action, #btn-coach-showwhy, #btn-coach-backtogame, #btn-coach-live, #btn-coach-practice-next, #btn-coach-practice-exit, #coach-keyboard-move-form button';
  $(managed).removeClass('primary').removeAttr('data-primary-action');
  const progressActive = document.getElementById('panel-progress').classList.contains('active');
  $('#btn-progress-next').prop('disabled', ['analyzing', 'opponent-turn', 'practice-checking'].includes(state) || (typeof importedGameAnalysisActive !== 'undefined' && importedGameAnalysisActive));
  const practiceSelection = !practicing && document.getElementById('panel-practice').classList.contains('active');
  view.classList.toggle('practice-browsing', practiceSelection);
  renderPracticeRecommendation();
  let action = null;
  if (practiceSelection && !coachThinking) action = '#btn-practice-session-start';
  else if (progressActive && !$('#btn-progress-next').prop('disabled') && !['analyzing', 'opponent-turn', 'practice-checking', 'practice', 'practice-complete', 'review'].includes(state)) action = '#btn-progress-next';
  else if (state === 'ended' && coachOpeningTransfer && coachStats.moves > 0 && !document.getElementById('panel-game').hidden) action = '#btn-opening-transfer-review';
  else if (state === 'ready' || state === 'complete' || state === 'ended') action = '#btn-coach-next-action';
  else if (state === 'review') action = coachReviewAnalysis ? '#btn-coach-backtogame' : '#btn-coach-live';
  else if (state === 'practice-complete') action = $('#btn-coach-practice-next').is(':visible') && !$('#btn-coach-practice-next').prop('disabled') ? '#btn-coach-practice-next' : '#btn-coach-practice-exit';
  else if (state === 'user-turn' && !document.getElementById('panel-game').hidden && coachOpeningTransfer && coachStats.moves >= 4) action = '#btn-opening-transfer-review';
  else if (state === 'user-turn' && $('#coach-review').is(':visible') && !$('#btn-coach-showwhy').prop('disabled')) action = '#btn-coach-showwhy';
  else if ((state === 'user-turn' || state === 'practice') && document.getElementById('coach-keyboard-move')?.open) action = '#coach-keyboard-move-form button';
  if (action) $(action).addClass('primary').attr('data-primary-action', 'true');
  $('#coachBoard-wrap').attr('data-primary-target', !action && canEnterMove ? 'true' : 'false');
  $('#btn-coach-practice-exit').text(practicing && coachPracticeReturnState ? 'Return to saved game' : 'Exit practice');
  $('#btn-coach-practice-exit').toggle(state !== 'practice-complete' || !!(coachPracticeRun && coachPracticeRun.index + 1 < coachPracticeRun.items.length));
  $('#btn-coach-practice-hint, #btn-coach-practice-answer').toggle(state !== 'practice-complete');
  renderPracticeBoardCue();
  if (typeof renderOpeningTransfer === 'function') renderOpeningTransfer();
  if (typeof renderLearningTransfer === 'function') renderLearningTransfer();
  scheduleCoachBoardFit();
}


function showCoachRetryStatus(msg) {
  const $status = $('#coach-status').empty();
  $status.append(document.createTextNode(msg + ' '));
  $('<button type="button" class="movelist-copy" id="btn-coach-retry-opponent">Retry</button>')
    .appendTo($status);
}

function invalidateCoachAsyncWork(reason) {
  coachGameGeneration++;
  candidateRequestId++;
  threatRequestId++;
  clearCoachReviewAnalysis({ restore: false });
  engineClient.cancel(reason || 'Coach position changed.');
  clearQueuedRemoteCoachGameUpdate();
  return coachGameGeneration;
}

function resetCoachState(fen, opts = {}) {
  coachContinuityCopy = false;
  coachTakebackUsed = false;
  coachOpeningTransfer = null;
  coachPendingReview = null;
  invalidateCoachAsyncWork('A new game replaced the previous analysis.');
  coachPracticeSession = null;
  if (!opts.preservePracticeRun) {
    coachPracticeRun = null;
    if (typeof setPracticeFocus === 'function') setPracticeFocus(false);
  }
  summaryPracticeItems = [];
  CoachController.setPhase('idle');
  coachGame = fen ? new Chess(fen) : new Chess();
  coachLocalGameId = createCoachGameId();
  coachStartFen = coachGame.fen();
  coachStats = { moves: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  coachReviewLog = [];
  coachLastReview = null;
  coachThinking = false;
  coachEndedAt = null;
  coachReviewCursor = null;
  coachReviewAnalysis = null;
  coachLastEndMsg = null;
  coachRemoteGameId = null;
  coachRemoteGamePromise = null;
  coachRemoteGamePromiseGeneration = null;
  coachLifetimeRolledForThisGame = false;
  if (coachSummaryTimer) { clearTimeout(coachSummaryTimer); coachSummaryTimer = null; }
  clearPremove();
  $('#coach-status').removeClass('status-ended');
  $('#summary-overlay').hide().attr('aria-hidden', 'true');
  $('#coach-practice-banner').hide();
  $('#coach-review').hide();
  $('#coach-review-analysis').hide().empty();
  $('#threats-section').hide();
  $('#candidates-section').hide();
  $('#opening-section').hide();
  $('#movelist-section').hide();
  $('#liveeval-section').hide();
  updateCoachSummary();
  updateCapturedDisplay(coachGame.fen());
  updateMoveList();
  updateOpeningLabel();
}

async function coachOpponentRespond() {
  if (!coachMode || !coachGameActive) return;
  if (coachGame.game_over()) { coachHandleGameOver(); return; }
  if (coachIsUserTurn()) return;
  const generation = coachGameGeneration;
  const gameRef = coachGame;
  CoachController.setPhase('opponentThinking');
  setCoachStatus('Opponent thinking…');
  const fen = coachGame.fen();
  try {
    // Evaluate several plausible candidates and select one from a calibrated
    // loss distribution. Lower settings favor modest slips while preserving
    // detected mates, without unsupported Elo commands.
    const opts = coachStrengthOpts(coachEngineElo);
    // A chosen opponent personality plays its Library book lines first
    // (opponents.js); the calibrated engine takes over once off book.
    const bookMove = typeof OpponentPersonas !== 'undefined' ? OpponentPersonas.coachBookMove() : null;
    const result = bookMove ? null : await engineClient.evaluate(fen, opts.depth, {
      skill: opts.skill,
      multipv: opts.multipv
    });
    const bestmove = bookMove || chooseCalibratedOpponentMove(result, opts);
    if (generation !== coachGameGeneration || coachGame !== gameRef || !coachMode ||
        !coachGameActive || coachIsUserTurn() || coachGame.fen() !== fen) return;
    if (!bestmove) {
      // The game is not over, so an empty answer means the engine failed
      // (for example its 30 s safety timeout). It is still the opponent's
      // turn: say so and offer a retry rather than claiming it is the user's.
      updateCoachControlsState();
      showCoachRetryStatus('The opponent did not answer — retry or take back.');
      return;
    }
    setTimeout(() => {
      try {
        if (generation !== coachGameGeneration || coachGame !== gameRef || !coachMode || !coachGameActive) return;
        const mv = coachGame.move({
          from: bestmove.slice(0, 2),
          to: bestmove.slice(2, 4),
          promotion: bestmove[4] || undefined
        });
        if (!mv) throw new Error('Opponent move was not legal.');
        if (window.CoachClock) window.CoachClock.tick();
        candidateRequestId++;
        if (!coachIsReviewing()) {
          if (!coachBoard) throw new Error('Coach board is not ready.');
          coachBoard.position(coachGame.fen());
          coachSyncLastMove();
          updateCapturedDisplay(coachGame.fen());
        }
        playSound(soundForMove(mv, coachGame));
        updateMoveList();
        updateOpeningLabel();
        saveCoachState();
        if (coachGame.game_over()) { coachHandleGameOver(); return; }
        if (!coachIsReviewing()) {
          CoachController.setPhase('userTurn');
          setCoachStatus('Your move.');
          showThreats();
        }
        updateCoachControlsState();
        // Apply any queued premove now that it's the user's turn again.
        tryApplyPremove();
      } catch (err) {
        clearPremove();
        coachThinking = false;
        updateCoachControlsState();
        showCoachRetryStatus('Opponent move failed — retry or take back.');
      }
    }, 300);
  } catch (err) {
    if (generation !== coachGameGeneration || isAbortError(err)) return;
    setCoachStatus('Engine error: ' + err.message);
  }
}

async function coachHandleUserMove(source, target, promotion, opts) {
  if (!coachMode || !coachGameActive) return 'snapback';
  if (coachThinking) return 'snapback';
  if (!coachIsUserTurn()) return 'snapback';
  opts = opts || {};
  promotion = promotion || 'q';
  const fenBefore = coachGame.fen();
  const generation = coachGameGeneration;
  const gameRef = coachGame;
  const tempGame = new Chess(fenBefore);
  const move = tempGame.move({ from: source, to: target, promotion });
  if (!move) return 'snapback';

  const userMv = coachGame.move({ from: source, to: target, promotion });
  candidateRequestId++;
  const fenAfter = coachGame.fen();
  const userUci = source + target + (move.promotion || '');
  coachPendingReview = { fenBefore, fenAfter, userUci, ply: coachGame.history().length };
  saveCoachState();
  if (opts.updateBoard !== false && coachBoard && !coachIsReviewing()) coachBoard.position(fenAfter);
  if (!coachIsReviewing()) setBoardLastMove('coachBoard', userMv);
  updateCapturedDisplay(fenAfter);
  playSound(soundForMove(userMv, coachGame));

  // Clear threats/candidates on new move
  $('#threats-section').hide();
  $('#candidates-section').hide();

  coachThinking = true;
  CoachController.setPhase('analyzing');
  // Stop the user's clock at the moment of the move (coach-clock.js), so a
  // move made in time is never charged the rest of a clock tick.
  if (window.CoachClock) window.CoachClock.tick();
  setCoachStatus('Analyzing your move…');
  updateCoachControlsState();
  try {
    const review = await classifyMove(fenBefore, userUci, fenAfter);
    if (generation !== coachGameGeneration || coachGame !== gameRef || !coachGameActive ||
        coachGame.fen() !== fenAfter) {
      return 'stale';
    }
    const ply = coachGame.history().length;
    const pairNum = Number(fenBefore.split(/\s+/)[5]) || Math.ceil(ply / 2);
    const opponentPrevious = coachGame.history({ verbose: true })[ply - 2];
    const logged = Object.assign({}, review, {
      fenBefore,
      fenAfter,
      userUci,
      previousCaptureSquare: opponentPrevious && opponentPrevious.captured ? opponentPrevious.to : null,
      ply,
      pairNum,
      gameGeneration: generation,
      localGameId: coachLocalGameId
    });
    coachPendingReview = null;
    coachLastReview = logged;
    coachReviewLog.push(logged);
    recordCoachInsight(logged);
    if (typeof recordLearningTransferLiveMove === 'function') recordLearningTransferLiveMove(logged);
    coachSync.saveMove(logged).catch(handleCoachDbError);
    // Don't count engine-timeout ("unknown") reviews in stats or accuracy.
    if (review.tier !== 'unknown') {
      coachStats.moves++;
      coachStats[review.tier] = (coachStats[review.tier] || 0) + 1;
      recordDailySprintMove(logged);
    }
    renderCoachReview(logged);
    updateCoachSummary();
    updateCoachControlsState();
    updateMoveList();
    updateOpeningLabel();
    saveCoachState();
    renderCoachDailyPlan();
  } catch (err) {
    if (generation !== coachGameGeneration || isAbortError(err)) return 'stale';
    setCoachStatus('Engine error: ' + err.message);
    coachThinking = false;
    CoachController.setPhase('userTurn');
    return;
  }
  coachThinking = false;
  updateCoachControlsState();

  if (generation !== coachGameGeneration || coachGame !== gameRef) return 'stale';
  if (coachGame.game_over()) { coachHandleGameOver(); return; }
  coachOpponentRespond();
}

// Track pending review-reveal so a new game cancels it.
let coachSummaryTimer = null;
function scheduleSummaryReveal(msg, delayMs) {
  if (coachSummaryTimer) { clearTimeout(coachSummaryTimer); coachSummaryTimer = null; }
  // Flag the status line so it pulses while the user takes in the final position.
  $('#coach-status').addClass('status-ended');
  coachSummaryTimer = setTimeout(() => {
    coachSummaryTimer = null;
    showPostGameSummary(msg);
  }, delayMs);
}

// Ends the live game for a reason the board does not show (resignation, or
// a flag from coach-clock.js): the same bookkeeping as a game over.
function coachFinishGame(msg, revealDelay) {
  if (!coachGameActive) return false;
  CoachController.setPhase('ended');
  candidateRequestId++;
  threatRequestId++;
  clearPremove();
  coachGameActive = false;
  coachEndedAt = Date.now();
  setCoachStatus(msg);
  updateCoachControlsState();
  coachLastEndMsg = msg;
  saveCoachState();
  // A per-move update still waiting on its debounce would otherwise rewrite
  // the saved game as unfinished after this result is saved.
  clearQueuedRemoteCoachGameUpdate();
  coachSync.saveGame(msg).catch(handleCoachDbError);
  rollGameIntoLifetime();
  if (typeof recordRatedCoachResult === 'function') recordRatedCoachResult(msg);
  scheduleSummaryReveal(msg, revealDelay);
  return true;
}

function coachHandleGameOver() {
  if (!coachGameActive) return;
  CoachController.setPhase('ended');
  coachGameActive = false;
  coachEndedAt = Date.now();
  let msg = 'Game over.';
  if (coachGame.in_checkmate()) {
    const loser = coachGame.turn() === 'w' ? 'White' : 'Black';
    const winner = loser === 'White' ? 'Black' : 'White';
    msg = `Checkmate — ${winner} wins.`;
  } else if (coachGame.in_stalemate()) msg = 'Stalemate.';
  else if (coachGame.in_draw()) msg = 'Draw.';
  setCoachStatus(msg);
  updateCoachControlsState();
  // Persist the now-ended state so a refresh keeps the review reachable.
  coachLastEndMsg = msg;
  saveCoachState();
  clearQueuedRemoteCoachGameUpdate();
  coachSync.saveGame(msg).catch(handleCoachDbError);
  // Roll this game's stats into lifetime totals (guarded against double-count).
  rollGameIntoLifetime();
  if (typeof recordRatedCoachResult === 'function') recordRatedCoachResult(msg);
  // Let the user take in the final position before the review overlay arrives.
  scheduleSummaryReveal(msg, 1200);
}

// ─────────────────────────────────────────────
// URL STATE
// ─────────────────────────────────────────────
function updateURL() {
  const params = new URLSearchParams();
  if (appView === 'coach') {
    params.set('view', 'coach');
  } else if (appView === 'puzzles') {
    params.set('view', 'puzzles');
    const mode = window.PuzzlesView && window.PuzzlesView.urlMode();
    if (mode) params.set('mode', mode);
  } else {
    // Preserve an intentional switch to the Library when no opening has been
    // selected. Opening links remain compact and continue to imply Library.
    if (!currentOpening) params.set('view', 'library');
    if (currentOpening) params.set('opening', currentOpening.id);
    if (currentOpening && currentLineId && currentLineId !== 'main') params.set('line', currentLineId);
    if (quizMode) params.set('mode', 'quiz');
    else if (exploreMode) params.set('mode', 'explore');
    if (currentOpening && !quizMode && !exploreMode && currentMoveIdx >= 0) {
      params.set('move', String(currentMoveIdx));
    }
  }
  const q = params.toString();
  const url = q ? `?${q}` : location.pathname;
  // A magic link returns with the session in the fragment. Keep it until the
  // Supabase client has consumed it; clearCoachAuthUrlState removes it after.
  const authHash = readCoachAuthUrlState().present ? location.hash : '';
  history.replaceState(null, '', url + authHash);
}
function readURL() {
  const p = new URLSearchParams(location.search);
  return { view: p.get('view'), opening: p.get('opening'), line: p.get('line'), mode: p.get('mode'), move: parseInt(p.get('move'), 10) };
}

// ─────────────────────────────────────────────
// BOARD INIT (lazy — board is created on first opening load)
// ─────────────────────────────────────────────
// Pieces: the cburnett vector set (Colin M.L. Burnett, CC BY-SA 3.0, as
// shipped by Lichess). Strong outlines and interior shading keep white pieces
// legible on light squares at every board size. Files live in vendor/pieces.
function localPieceTheme(piece) {
  return `vendor/pieces/cburnett/${piece}.svg`;
}

// Last-move highlight. chessboard.js rebuilds the square elements whenever a
// position is drawn, so the highlight is re-applied by a mutation observer on
// the board container rather than set once.
const boardLastMove = { myBoard: null, coachBoard: null };

function applyBoardLastMove(boardId) {
  const root = document.getElementById(boardId);
  if (!root) return;
  root.querySelectorAll('.square-55d63.last-move').forEach(el => el.classList.remove('last-move'));
  const mv = boardLastMove[boardId];
  if (!mv) return;
  [mv.from, mv.to].forEach(sq => {
    const el = root.querySelector('.square-' + sq);
    if (el) el.classList.add('last-move');
  });
}

function setBoardLastMove(boardId, move) {
  boardLastMove[boardId] = move ? { from: move.from, to: move.to } : null;
  applyBoardLastMove(boardId);
}

function observeBoardLastMove(boardId) {
  const root = document.getElementById(boardId);
  if (!root || root.__lastMoveObserver || typeof MutationObserver === 'undefined') return;
  const observer = new MutationObserver(() => {
    applyBoardLastMove(boardId);
    if (boardId === 'coachBoard') renderPracticeBoardCue();
  });
  observer.observe(root, { childList: true, subtree: true });
  root.__lastMoveObserver = observer;
}

// Coach: highlight the move that produced the displayed position (live or
// while stepping through the review).
function coachSyncLastMove() {
  if (!coachGame) { setBoardLastMove('coachBoard', null); return; }
  const hist = coachGame.history({ verbose: true });
  const n = coachReviewCursor === null ? hist.length : coachReviewCursor;
  setBoardLastMove('coachBoard', n > 0 ? hist[n - 1] : null);
}

function librarySyncLastMove(gameObj) {
  const hist = gameObj ? gameObj.history({ verbose: true }) : [];
  setBoardLastMove('myBoard', hist.length ? hist[hist.length - 1] : null);
}

// Board colour themes, defined in styles/tokens.css. The keys are the values
// already saved under ui:board-theme: "green" is shown as Sage (the default),
// "blue" as Slate. The retired "ivory" theme falls back to walnut.
const BOARD_THEME_KEY = 'ui:board-theme';
const BOARD_THEMES = ['green', 'walnut', 'blue', 'contrast'];

function applyBoardTheme(name) {
  const theme = BOARD_THEMES.includes(name) ? name : (name === 'ivory' ? 'walnut' : 'green');
  document.documentElement.setAttribute('data-board-theme', theme);
  $('#board-theme').val(theme);
  try { localStorage.setItem(BOARD_THEME_KEY, theme); } catch (e) { /* preference stays for this page */ }
}

function initBoardTheme() {
  let saved = null;
  try { saved = localStorage.getItem(BOARD_THEME_KEY); } catch (e) { /* default */ }
  applyBoardTheme(saved || 'green');
  $('#board-theme').on('change', function() { applyBoardTheme($(this).val()); });
}

// Light/dark follows the device unless the player picks one; theme-init.js
// applies the saved choice before first paint.
const COLOR_THEME_KEY = 'ui:theme';

function applyColorTheme(name) {
  const theme = name === 'light' || name === 'dark' ? name : 'auto';
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  $('#color-theme').val(theme);
  try {
    if (theme === 'auto') localStorage.removeItem(COLOR_THEME_KEY);
    else localStorage.setItem(COLOR_THEME_KEY, theme);
  } catch (e) { /* preference stays for this page */ }
}

function initColorTheme() {
  let saved = null;
  try { saved = localStorage.getItem(COLOR_THEME_KEY); } catch (e) { /* follow the device */ }
  applyColorTheme(saved);
  $('#color-theme').on('change', function() { applyColorTheme($(this).val()); });
}

function describeChessPosition(gameObj) {
  if (!gameObj) return 'Chess position unavailable.';
  const turn = gameObj.turn() === 'w' ? 'White' : 'Black';
  const state = gameObj.in_checkmate() ? ' Checkmate.' : (gameObj.in_check() ? ' In check.' : '');
  return `${turn} to move.${state} FEN: ${gameObj.fen()}`;
}

function updateLibraryBoardAccessibility() {
  const activeGame = exploreMode && exploreGame ? exploreGame : game;
  $('#myBoard').attr('aria-label', describeChessPosition(activeGame));
}

function updateCoachBoardAccessibility() {
  $('#coachBoard').attr('aria-label', describeChessPosition(coachGame));
}

const DESKTOP_NOTICE_KEY = 'ui:desktop-notice-dismissed';

// Narrow screens get a desktop notice instead of a reflowed layout. Dismissal
// lasts for the browser session so the page is still usable in a pinch.
const COACH_PANEL_TAB_KEY = 'ui:coach-panel-tab';

// Right-rail tabs: Game (live review), Practice (queue and drills), Progress.
function showCoachPanel(name, opts) {
  opts = opts || {};
  const $tab = $('.panel-tab[data-panel="' + name + '"]');
  if (!$tab.length) return;
  $('.panel-tab').removeClass('active').attr({ 'aria-selected': 'false', tabindex: '-1' });
  $tab.addClass('active').attr({ 'aria-selected': 'true', tabindex: '0' });
  $('.panel-page').removeClass('active').attr('hidden', true);
  $('#panel-' + name).addClass('active').removeAttr('hidden');
  if (opts.focus) $tab.trigger('focus');
  try { sessionStorage.setItem(COACH_PANEL_TAB_KEY, name); } catch (e) { /* session only */ }
  renderCoachPresentation();
}

function initCoachPanelTabs() {
  let remembered = null;
  try { remembered = sessionStorage.getItem(COACH_PANEL_TAB_KEY); } catch (e) { /* default */ }
  if (remembered && $('.panel-tab[data-panel="' + remembered + '"]').length) showCoachPanel(remembered);
  $('.panel-tab').on('click', function() { showCoachPanel($(this).data('panel')); });
  $('.panel-tab').on('keydown', function(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const tabs = $('.panel-tab').toArray();
    const index = tabs.indexOf(this);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    showCoachPanel($(next).data('panel'), { focus: true });
  });
}

function updatePracticeTabBadge(dueCount) {
  const $badge = $('#tab-practice-badge');
  if (!$badge.length) return;
  $badge.text(String(dueCount));
  if (dueCount > 0) $badge.removeAttr('hidden'); else $badge.attr('hidden', true);
}

function initDesktopNotice() {
  let dismissed = false;
  try { dismissed = sessionStorage.getItem(DESKTOP_NOTICE_KEY) === '1'; } catch (e) { /* stays visible */ }
  if (dismissed) document.documentElement.classList.add('desktop-notice-dismissed');
  $('#btn-desktop-notice-continue').on('click', function() {
    try { sessionStorage.setItem(DESKTOP_NOTICE_KEY, '1'); } catch (e) { /* session only */ }
    document.documentElement.classList.add('desktop-notice-dismissed');
  });
}

function placeDailySprintCard() {
  const card = document.getElementById('coach-daily-plan');
  const settings = document.querySelector('.coach-settings');
  if (!card || !settings) return;
  // Coach's next action is the product's primary job. Keep it immediately
  // below the heading at every breakpoint; settings and account controls are
  // still available underneath it, while the right panel can focus on live
  // status, review, and progress.
  const hero = settings.querySelector('.coach-hero');
  if (hero && hero.nextElementSibling !== card) hero.insertAdjacentElement('afterend', card);
}

// Library uses the same viewport budget as Coach, including open move entry
// and quiz feedback. Both the width and actual tools determine board size.
let libraryBoardFitFrame = null;
function fitLibraryBoard() {
  const area = document.querySelector('#library-view .board-area');
  const view = document.getElementById('library-view');
  if (!area || !area.clientWidth || !area.clientHeight) return;
  const css = getComputedStyle(area);
  const children = Array.from(area.children).filter(el => el.id !== 'board-wrap' && getComputedStyle(el).display !== 'none');
  const gap = parseFloat(css.rowGap) || 0;
  const height = area.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom)
    - children.reduce((sum, el) => {
      const style = getComputedStyle(el);
      return sum + el.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    }, 0) - gap * children.length;
  const width = area.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const size = Math.max(240, Math.floor((Math.min(760, width, height) - 4) / 8) * 8);
  if (view.style.getPropertyValue('--library-board-size') === size + 'px') return;
  view.style.setProperty('--library-board-size', size + 'px');
  if (board) board.resize();
}
function scheduleLibraryBoardFit() {
  if (libraryBoardFitFrame !== null) return;
  libraryBoardFitFrame = requestAnimationFrame(() => { libraryBoardFitFrame = null; fitLibraryBoard(); });
}
function initLibraryWorkspaceLayout() {
  const area = document.querySelector('#library-view .board-area');
  if (!area) return;
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleLibraryBoardFit);
    observer.observe(area);
    Array.from(area.children).filter(el => el.id !== 'board-wrap').forEach(el => observer.observe(el));
  }
  document.getElementById('library-keyboard-move').addEventListener('toggle', scheduleLibraryBoardFit);
  scheduleLibraryBoardFit();
}

// Fit the actual workspace, including expanded keyboard entry and live text.
// Container changes also occur without a window resize (for example practice).
let coachBoardFitFrame = null;
function fitCoachBoard() {
  const area = document.querySelector('.coach-board-area');
  const view = document.getElementById('coach-view');
  if (!area || !view || !area.clientWidth || !area.clientHeight) return;
  const css = getComputedStyle(area);
  const children = Array.from(area.children).filter(el => el.id !== 'coachBoard-wrap' && getComputedStyle(el).display !== 'none');
  const gap = parseFloat(css.rowGap) || 0;
  const height = area.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom)
    - children.reduce((sum, el) => {
      const style = getComputedStyle(el);
      return sum + el.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    }, 0) - gap * children.length;
  const width = area.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const size = Math.max(240, Math.floor((Math.min(760, width, height) - 4) / 8) * 8);
  if (view.style.getPropertyValue('--coach-board-size') === size + 'px') return;
  view.style.setProperty('--coach-board-size', size + 'px');
  if (coachBoard) coachBoard.resize();
}
function scheduleCoachBoardFit() {
  if (coachBoardFitFrame !== null) return;
  coachBoardFitFrame = requestAnimationFrame(() => { coachBoardFitFrame = null; fitCoachBoard(); });
}
function initCoachWorkspaceLayout() {
  const area = document.querySelector('.coach-board-area');
  if (!area) return;
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleCoachBoardFit);
    observer.observe(area);
    Array.from(area.children).filter(el => el.id !== 'coachBoard-wrap').forEach(el => observer.observe(el));
  }
  document.getElementById('coach-keyboard-move').addEventListener('toggle', renderCoachPresentation);
  renderCoachPresentation();
}

function distinctPracticeItems(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    if (!item || !item.entry) return false;
    const key = `${item.entry.fenBefore.split(/\s+/).slice(0, 4).join(' ')}|${item.entry.bestUci}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function practiceRecommendation() {
  const due = orderedPracticeRunItems(Array.from(renderedPracticeItems.values()));
  if (due.length) return { items: due, title: due[0].meta.title,
    detail: `${due.length} position${due.length === 1 ? '' : 's'} from your games. Revisit the decision, then take the idea back into play.`,
    label: `Start ${due.length}-position practice` };
  if (typeof ENDGAME_LESSONS === 'undefined') return null;
  const lesson = ENDGAME_LESSONS.find(row => !practiceRecordFor({ id: row.id })?.correct) || ENDGAME_LESSONS[0];
  const item = endgamePracticeItem(lesson);
  return { items: [item], title: lesson.title, detail: `One short lesson. ${lesson.detail}`,
    label: practiceRecordFor(item)?.correct ? 'Revisit this lesson' : 'Start this lesson' };
}

function renderPracticeRecommendation() {
  const recommendation = practiceRecommendation();
  if (!recommendation) return;
  $('#practice-start-title').text(recommendation.title);
  $('#practice-start-detail').text(recommendation.detail);
  $('#practice-start-context').text(coachGameActive ? 'Your game will be saved while you practise.' : 'Play a move, get feedback, then choose your next step.');
  $('#btn-practice-session-start').text(recommendation.label).prop('disabled', coachThinking);
}

function orderedPracticeRunItems(items, firstItem) {
  const unique = [];
  const seen = new Set();
  const ordered = distinctPracticeItems([firstItem].concat(items || []));
  ordered.forEach(item => {
    if (!item || seen.has(item.id) || !practiceIsDue(item)) return;
    seen.add(item.id);
    unique.push(item);
  });
  // While today's drills phase is open, size the run from the saved day:
  // the rendered plan is not rebuilt after a reload once a day exists.
  const sprint = dailySprintToday();
  const target = sprint && !sprint.completedAt && sprint.mode === 'adaptive' && sprint.phase === 'drills'
    ? (Number(sprint.drillTarget) || 0) - (Number(sprint.drillsCompleted) || 0)
    : renderedAdaptivePlan ? renderedAdaptivePlan.drillTarget : DAILY_DRILL_TARGET;
  return unique.slice(0, Math.max(1, target));
}

function startCoachPracticeSession(items, firstItem) {
  const runItems = orderedPracticeRunItems(items, firstItem || (items && items[0]));
  if (!runItems.length) {
    setCoachStatus('No practice drills are due right now.');
    return;
  }
  coachPracticeRun = {
    items: runItems,
    index: 0,
    completed: 0,
    clean: 0,
    assisted: 0,
    startedAt: Date.now()
  };
  beginDailyDrillSprint(runItems);
  startCoachPractice(runItems[0], { preserveRun: true });
}

function practiceRunPositionText() {
  if (!coachPracticeRun) return 'Single drill';
  return `Drill ${coachPracticeRun.index + 1} of ${coachPracticeRun.items.length}`;
}

// Practice focus: while a drill is active the rails drop everything that is
// not about the drill (play controls, setup groups, metrics, other tabs) and
// the right rail shows only the practice queue with the current drill marked.
function setPracticeFocus(active) {
  const $view = $('#coach-view');
  const wasActive = $view.hasClass('practice-active');
  $view.toggleClass('practice-active', !!active);
  if (active) showCoachPanel('practice');
  else if (wasActive) showCoachPanel('game');
  markActivePracticeRow();
}

function markActivePracticeRow() {
  $('.practice-row').removeClass('is-active');
  const item = coachPracticeSession && coachPracticeSession.item;
  if (!item) return;
  $('.practice-load[data-practice-id="' + item.id + '"]').closest('.practice-row').addClass('is-active');
}

function startCoachPractice(item, opts = {}) {
  if (coachThinking && !coachPracticeSession) {
    setCoachStatus('Wait for the current move to finish before starting practice.');
    return;
  }
  if (!item || !item.entry || !isValidFen(item.entry.fenBefore) || !item.entry.bestUci) {
    setCoachStatus('Practice position is no longer valid.');
    return;
  }
  if (!coachPracticeReturnState) {
    coachPracticeReturnState = captureCoachPracticeReturnState();
    persistCoachPracticeReturnState(coachPracticeReturnState);
    // Keep the normal game's local snapshot available during a refresh while
    // the practice board is borrowed.
    if (coachPracticeReturnState) saveCoachState();
  }
  if (!opts.preserveRun) {
    coachPracticeRun = {
      items: [item],
      index: 0,
      completed: 0,
      clean: 0,
      assisted: 0,
      startedAt: Date.now()
    };
  }
  resetCoachState(item.entry.fenBefore, { preservePracticeRun: true });
  coachPracticeSession = {
    owner: coachMemoryOwnerId(),
    item,
    misses: 0,
    revealed: false,
    hintUsed: false,
    completed: false,
    completionRecorded: false,
    hintStage: 0,
    phase: 'initial',
    expectedUci: item.entry.bestUci,
    initialExpectedUci: item.entry.bestUci,
    analysis: null,
    analysisReady: false,
    analysisPromise: null,
    pendingMove: null,
    positionFen: coachGame.fen(),
    analysisToken: 0,
    requestId: coachGameGeneration
  };
  coachUserSide = fenSideToUserSide(item.entry.fenBefore);
  coachGameActive = true;
  CoachController.setPhase('practice');
  coachBoardFlipped = coachUserColor() === 'black';
  createCoachBoard(coachGame.fen(), coachBoardFlipped ? 'black' : 'white');
  $('#coach-view').addClass('game-active');
  $('#coach-practice-title').text(item.meta.title);
  $('#coach-practice-prompt').text(practicePromptForItem(item));
  $('#coach-practice-session-status').text(practiceRunPositionText());
  $('#coach-practice-status').text('Choose your move. You can ask for a hint at any time.');
  $('#coach-practice-takeaway').hide().empty();
  $('#btn-coach-practice-answer').prop('disabled', false);
  $('#btn-coach-practice-answer').text('Show answer');
  $('#btn-coach-practice-hint').text('Hint').prop('disabled', false).show();
  $('#btn-coach-practice-next').hide().prop('disabled', true);
  $('#coach-practice-banner').show().css('display', 'flex');
  $('#coach-keyboard-move-status').text('');
  setCoachStatus('Play on the board or enter a move below.');
  updateCoachControlsState();
  renderCoachDailyPlan();
  setPracticeFocus(true);
  preparePracticeAnalysis(coachPracticeSession);
  saveCoachPracticeState();
  focusPracticeTarget();
}

function coachPracticeMoveLabel(item) {
  if (!item || !item.entry) return 'the best move';
  if (item.entry.bestSan) return item.entry.bestSan;
  const move = moveFromUci(item.entry.fenBefore, item.entry.bestUci);
  return move ? move.san : item.entry.bestUci;
}

function practicePositionIsCurrent(session) {
  return !!(session && (!session.owner || session.owner === coachMemoryOwnerId()) && coachPracticeSession === session && coachGame && coachGameActive &&
    session.requestId === coachGameGeneration && (!session.positionFen || session.positionFen === coachGame.fen()) && !session.completed);
}

function practiceAfterMoveScore(fen, result) {
  const after = new Chess(fen);
  if (after.in_checkmate()) return 10000;
  if (after.in_draw()) return 0;
  const score = practiceEngineScore(result);
  return score == null ? null : -score;
}

function practiceMoveIsMate(fen, uci) {
  if (!fen || !uci) return false;
  const position = new Chess(fen);
  const move = position.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  return !!(move && position.in_checkmate());
}

function preparePracticeAnalysis(session) {
  if (!session || session.analysisPromise) return session && session.analysisPromise;
  const fen = coachGame && coachGame.fen();
  const token = (session.analysisToken || 0) + 1;
  session.analysisToken = token;
  session.analysisPromise = engineClient.evaluate(fen, PRACTICE_ANALYSIS_DEPTH, { multipv: PRACTICE_MULTIPV })
    .then(result => {
      if (!practicePositionIsCurrent(session) || session.analysisToken !== token || session.positionFen !== fen) return null;
      const lines = (result && result.lines) || [];
      const bestLine = lines[0] || null;
      const bestUci = (bestLine && bestLine.pv && bestLine.pv[0]) || (result && result.bestmove) || null;
      const bestCp = bestLine ? scoreToCp(bestLine) : null;
      const known = {};
      lines.forEach(line => {
        const uci = line && line.pv && line.pv[0];
        if (uci) known[uci] = scoreToCp(line);
      });
      session.analysis = {
        fen,
        bestUci,
        bestCp,
        bestMate: bestLine && bestLine.mate != null ? bestLine.mate : null,
        known,
        candidatePvs: Object.fromEntries(lines.filter(line => line.pv && line.pv[0]).map(line => [line.pv[0], line.pv])),
        pv: bestLine && bestLine.pv ? bestLine.pv.slice() : []
      };
      session.analysisReady = true;
      return session.analysis;
    })
    .catch(err => {
      if (!practicePositionIsCurrent(session) || session.analysisToken !== token || session.positionFen !== fen) return null;
      // A timed-out engine must not turn every legal move into a false error.
      // The saved solution remains playable; alternatives require a reliable
      // score and therefore remain ungraded until a later retry: clearing the
      // promise lets the next attempt analyse the position again.
      session.analysis = { fen, bestUci: null, bestCp: null, known: {}, pv: [], error: err };
      session.analysisReady = true;
      session.analysisPromise = null;
      return session.analysis;
    });
  return session.analysisPromise;
}

async function evaluatePracticeMove(session, actualUci) {
  if (!practicePositionIsCurrent(session)) return { stale: true };
  const expected = session.expectedUci;
  const currentFen = coachGame.fen();
  // Mate is a board fact, so equivalent mating moves need no engine score.
  if (practiceMoveIsMate(currentFen, actualUci)) {
    return { sound: true, exact: practiceUciEqual(actualUci, expected), loss: 0 };
  }
  if (practiceMoveIsMate(currentFen, expected)) {
    return { sound: false, inaccurate: false, loss: 250 };
  }
  if (practiceUciEqual(actualUci, expected)) return { sound: true, exact: true, loss: 0 };
  const analysis = session.analysis || {};
  let replyUci = analysis.candidatePvs && analysis.candidatePvs[actualUci] && analysis.candidatePvs[actualUci][1];
  let candidateCp = analysis.known && analysis.known[actualUci];
  if (candidateCp == null && analysis.bestCp != null) {
    const temp = new Chess(coachGame.fen());
    const mv = temp.move({ from: actualUci.slice(0, 2), to: actualUci.slice(2, 4), promotion: actualUci[4] || 'q' });
    if (!mv) return { legal: false };
    const afterFen = temp.fen();
    const afterResult = await engineClient.evaluate(afterFen, PRACTICE_ANALYSIS_DEPTH, {});
    if (!practicePositionIsCurrent(session)) return { stale: true };
    candidateCp = practiceAfterMoveScore(afterFen, afterResult);
    replyUci = (afterResult.info && afterResult.info.pv && afterResult.info.pv[0]) || (afterResult.lines && afterResult.lines[0] && afterResult.lines[0].pv && afterResult.lines[0].pv[0]);
  }
  if (analysis.bestCp == null || candidateCp == null) return { unknown: true };
  const loss = Math.max(0, Math.round(analysis.bestCp - candidateCp));
  const candidatePosition = new Chess(coachGame.fen());
  const candidateMove = candidatePosition.move({
    from: actualUci.slice(0, 2),
    to: actualUci.slice(2, 4),
    promotion: actualUci[4] || 'q'
  });
  const candidateIsMate = !!(candidateMove && candidatePosition.in_checkmate());
  const expectedIsMate = practiceMoveIsMate(analysis.fen || coachGame.fen(), expected);
  const forcedMateMiss = (analysis.bestMate === 1 || expectedIsMate) && !candidateIsMate;
  return {
    sound: !forcedMateMiss && loss <= PRACTICE_SOUND_LOSS_CP,
    inaccurate: !forcedMateMiss && loss > PRACTICE_SOUND_LOSS_CP && loss <= PRACTICE_INACCURACY_LOSS_CP,
    loss: forcedMateMiss ? Math.max(loss, 250) : loss,
    replyUci
  };
}

function practiceContinuationFor(session, playedUci) {
  if (session.item && session.item.learningTransfer) return null;
  if (!practiceUciEqual(playedUci, session.initialExpectedUci)) return null;
  const authored = session.item && session.item.entry && session.item.entry.continuation;
  const authoredStep = Array.isArray(authored) ? authored[0] : null;
  if (authoredStep && authoredStep.opponentUci && authoredStep.followupUci) {
    const authoredPosition = new Chess(coachGame.fen());
    const opponent = authoredPosition.move({
      from: authoredStep.opponentUci.slice(0, 2),
      to: authoredStep.opponentUci.slice(2, 4),
      promotion: authoredStep.opponentUci[4] || undefined
    });
    const follow = opponent && authoredPosition.move({
      from: authoredStep.followupUci.slice(0, 2),
      to: authoredStep.followupUci.slice(2, 4),
      promotion: authoredStep.followupUci[4] || undefined
    });
    if (follow) return { opponentUci: authoredStep.opponentUci, followupUci: authoredStep.followupUci };
  }
  const pv = session.analysis && session.analysis.pv;
  if (!pv || pv.length < 3 || !practiceUciEqual(playedUci, pv[0])) return null;
  const opponentUci = pv[1];
  const followupUci = pv[2];
  const temp = new Chess(coachGame.fen());
  const opponent = temp.move({ from: opponentUci.slice(0, 2), to: opponentUci.slice(2, 4), promotion: opponentUci[4] || 'q' });
  if (!opponent) return null;
  const follow = temp.move({ from: followupUci.slice(0, 2), to: followupUci.slice(2, 4), promotion: followupUci[4] || 'q' });
  return follow ? { opponentUci, followupUci } : null;
}

function finishCoachPracticeMove(session, played, quality, revealed) {
  if (session.item.learningTransfer && typeof finishLearningTransferCheck === 'function') return finishLearningTransferCheck(session, played);
  if (session.completionRecorded) return;
  session.completed = true;
  session.completionRecorded = true;
  const assisted = !!(revealed || session.hintUsed);
  const record = recordPracticeAttempt(session.item, true, assisted);
  if (typeof recordRepertoirePracticeResult === 'function') {
    recordRepertoirePracticeResult(session.item, !assisted && session.misses === 0, assisted);
  }
  const sprint = recordDailySprintDrill(session.item, assisted, !assisted && session.misses === 0);
  const due = formatPracticeDue(record);
  $('#coach-practice-status').text(`${quality}: ${played.san}. ${due}.`);
  $('#coach-practice-prompt').text('Position solved. Carry the cue into your next game.');
  setCoachStatus(`${quality}. Practice progress saved.`);
  $('#coach-practice-takeaway').text(`Carry into your next game: ${practiceCarryForwardCue(session.item)}`).show();
  $('#btn-coach-practice-answer').prop('disabled', true);
  $('#btn-coach-practice-hint').prop('disabled', true);
  if (coachPracticeRun) {
    coachPracticeRun.completed += 1;
    if (assisted) coachPracticeRun.assisted += 1;
    else if (session.misses === 0) coachPracticeRun.clean += 1;
    const hasNext = coachPracticeRun.index + 1 < coachPracticeRun.items.length;
    const transferNext = !hasNext && sprint && !sprint.completedAt && sprint.mode === 'adaptive' && sprint.phase === 'moves';
    $('#btn-coach-practice-next')
      .text(hasNext ? 'Next drill' : session.item.id.startsWith('opening-bridge:') ? 'Continue this opening in play' : (transferNext ? 'Continue to live play' : coachPracticeReturnState ? 'Return to saved game' : 'Choose another lesson'))
      .show()
      .prop('disabled', false);
    if (!hasNext) $('#coach-practice-status').text(`${quality}: ${played.san}. Practice complete — ${coachPracticeRun.clean}/${coachPracticeRun.completed} first-try.${transferNext ? ' Next: use the same focus in live play.' : ''}`);
  }
  updateCoachControlsState();
  renderInsights();
  if (sprint && sprint.completedAt) renderCoachDailyPlan();
  saveCoachPracticeState();
  focusPracticeTarget();
}

function applyCoachPracticeMove(session, source, target, promotion, evaluation, opts) {
  if (!practicePositionIsCurrent(session)) return 'stale';
  const played = coachGame.move({ from: source, to: target, promotion: promotion || 'q' });
  if (!played) return 'snapback';
  const actualUci = uciFromMove(played);
  session.hintStage = 0;
  const continuation = !evaluation.revealed && practiceContinuationFor(session, actualUci);
  if (continuation && session.phase === 'initial') {
    const opponent = coachGame.move({
      from: continuation.opponentUci.slice(0, 2),
      to: continuation.opponentUci.slice(2, 4),
      promotion: continuation.opponentUci[4] || undefined
    });
    if (opponent) {
      session.phase = 'followup';
      session.expectedUci = continuation.followupUci;
      session.analysis = null;
      session.analysisReady = false;
      session.analysisPromise = null;
      session.analysisToken += 1;
      session.positionFen = coachGame.fen();
      session.requestId = coachGameGeneration;
      preparePracticeAnalysis(session);
      $('#coach-practice-prompt').text('Good first move. Now find the follow-up that keeps the advantage.');
      $('#coach-practice-status').text(`The opponent replies ${opponent.san}. Find your next move.`);
      $('#btn-coach-practice-answer').prop('disabled', false).text('Show answer');
      $('#btn-coach-practice-hint').prop('disabled', false).text('Hint').show();
    }
  } else {
    session.phase = 'complete';
    finishCoachPracticeMove(session, played, evaluation.sound && !evaluation.exact ? 'Sound alternative' : (session.revealed ? 'Solved after revealing the answer' : (session.hintUsed ? 'Solved with hints' : (session.misses ? `Correct after ${session.misses + 1} attempts` : 'Correct on the first try'))), !!evaluation.revealed);
  }
  if (opts && opts.updateBoard !== false && coachBoard) coachBoard.position(coachGame.fen());
  coachSyncLastMove();
  updateCapturedDisplay(coachGame.fen());
  updateCoachBoardAccessibility();
  updateMoveList();
  playSound(soundForMove(played, coachGame));
  saveCoachPracticeState();
  return 'correct';
}

function coachHandlePracticeMove(source, target, promotion, opts) {
  const session = coachPracticeSession;
  if (!session || session.completed || !coachGameActive || !coachGame) return 'snapback';
  const temp = new Chess(coachGame.fen());
  const move = temp.move({ from: source, to: target, promotion: promotion || 'q' });
  if (!move) return 'snapback';
  const actualUci = uciFromMove(move);
  // The last analysis failed: analyse again for this attempt, once (the
  // marked opts stop a second failure from retrying in a loop).
  if (session.analysis && session.analysis.error && !session.analysisPromise && !session.pendingMove && !session.grading &&
      !(opts && opts.analysisRetried)) {
    session.analysis = null;
    session.analysisReady = false;
    preparePracticeAnalysis(session);
    opts = Object.assign({}, opts, { analysisRetried: true });
  }
  if (session.pendingMove) {
    const pendingUci = session.pendingMove.source + session.pendingMove.target + (session.pendingMove.promotion || '');
    if (pendingUci === actualUci) return 'pending';
    return 'snapback';
  }
  const evaluate = () => evaluatePracticeMove(session, actualUci).catch(() => ({ unknown: true })).then(result => {
    if (!practicePositionIsCurrent(session)) return 'stale';
    if (result.unknown) {
      $('#coach-practice-status').text('Engine could not verify that candidate. Try again when analysis is ready.');
      setCoachStatus('Practice move was not scored.');
      return 'ungraded';
    }
    if (typeof recordLearningTransferDecision === 'function' && !recordLearningTransferDecision(session, actualUci, result)) return 'ungraded';
    if (result.sound) {
      return applyCoachPracticeMove(session, source, target, promotion, Object.assign({}, result, { revealed: session.revealed }), opts || {});
    }
    session.misses += 1;
    recordPracticeAttempt(session.item, false, false);
    $('#coach-practice-status').text(practiceMistakeFeedback(session, actualUci, result));
    setCoachStatus('Board reset. Compare another candidate.');
    focusPracticeTarget();
    saveCoachPracticeState();
    renderInsights();
    return 'snapback';
  });
  if (!session.analysisReady && session.analysisPromise) {
    if (session.grading) return 'pending';
    session.grading = true;
    renderCoachPresentation();
    session.pendingMove = { source, target, promotion, opts: opts || {} };
    $('#coach-practice-status').text('Checking the position…');
    return session.analysisPromise.then(() => {
      if (!practicePositionIsCurrent(session)) return 'stale';
      session.pendingMove = null;
      session.grading = false;
      return coachHandlePracticeMove(source, target, promotion, opts || {});
    }).finally(() => {
      session.grading = false;
      renderCoachPresentation();
    });
  }
  if (session.grading) return 'pending';
  session.grading = true;
  renderCoachPresentation();
  return evaluate().finally(() => {
    session.grading = false;
    renderCoachPresentation();
  });
}

function resumeCoachPracticeAfterNavigation() {
  const previous = coachPracticeSession;
  if (!previous || !coachGame || previous.owner !== coachMemoryOwnerId()) return;
  // A new object keeps a cancelled candidate search from becoming current
  // again when the player returns quickly from Library.
  coachPracticeSession = Object.assign({}, previous, {
    requestId: coachGameGeneration, positionFen: coachGame.fen(),
    analysis: null, analysisReady: false, analysisPromise: null,
    analysisToken: (previous.analysisToken || 0) + 1, pendingMove: null, grading: false
  });
  if (coachBoard) coachBoard.position(coachGame.fen(), false);
  coachSyncLastMove();
  updateCoachBoardAccessibility();
  CoachController.setPhase('practice');
  setPracticeFocus(true);
  setCoachStatus(previous.completed ? 'Practice saved. Choose your next step.' : 'Practice resumed. Continue from this position.');
  if (!previous.completed) preparePracticeAnalysis(coachPracticeSession);
  saveCoachPracticeState();
  focusPracticeTarget();
}

function focusPracticeTarget() {
  requestAnimationFrame(() => {
    if (!coachPracticeSession) return;
    const id = coachPracticeSession.completed ? 'btn-coach-practice-next'
      : document.getElementById('coach-keyboard-move')?.open ? 'coach-keyboard-move-input' : 'coachBoard';
    document.getElementById(id)?.focus({ preventScroll: true });
  });
}

function renderPracticeBoardCue() {
  $('#coachBoard .practice-cue-source, #coachBoard .practice-cue-target').removeClass('practice-cue-source practice-cue-target');
  const session = coachPracticeSession;
  if (!session || session.completed || session.hintStage < 2) return;
  const move = practiceMoveFor(coachGame.fen(), session.expectedUci);
  if (!move) return;
  $(`#coachBoard .square-${move.from}`).addClass('practice-cue-source');
  if (session.hintStage >= 3) $(`#coachBoard .square-${move.to}`).addClass('practice-cue-target');
}

function practiceMistakeFeedback(session, uci, result) {
  const fen = coachGame.fen(), after = new Chess(fen);
  const move = after.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  if (!move) return 'Try another legal move.';
  if (after.in_stalemate()) return `${move.san} leaves no legal reply without giving check: stalemate is a draw. Leave the king a move, or find a checkmate.`;
  if (practiceMoveIsMate(fen, session.expectedUci)) return `${move.san} misses a mate in one. Look for a check, then count the king’s escapes, captures and blocks.`;
  const context = coachExplanationContext(fen, uci, session.expectedUci, after.fen(), result.replyUci ? { pv: [result.replyUci] } : null);
  return `${context.consequence || `${move.san} gives the opponent a stronger position than the best candidates.`} ${context.cue}`;
}

function revealCoachPracticeAnswer() {
  const session = coachPracticeSession;
  if (!session || session.completed) return;
  session.hintStage = 4;
  const text = practiceHintForSession(session, 4);
  if (!session.revealed) {
    session.revealed = true;
    // Record the reveal once. Completion is recorded separately, once, when
    // the requested move is finally played.
    recordPracticeAttempt(session.item, false, true);
    renderInsights();
  }
  $('#coach-practice-status').text(text);
  $('#btn-coach-practice-answer').prop('disabled', true);
  $('#btn-coach-practice-hint').prop('disabled', true);
  setCoachStatus('Practice answer revealed — now play the move.');
  saveCoachPracticeState();
}

function showCoachPracticeHint() {
  const session = coachPracticeSession;
  if (!session || session.completed) return;
  session.hintUsed = true;
  session.hintStage = Math.min(4, (session.hintStage || 0) + 1);
  const text = practiceHintForSession(session, session.hintStage);
  $('#coach-practice-status').text(text);
  if (session.hintStage >= 4) {
    if (!session.revealed) {
      session.revealed = true;
      recordPracticeAttempt(session.item, false, true);
      renderInsights();
    }
    $('#btn-coach-practice-hint').prop('disabled', true);
    $('#btn-coach-practice-answer').prop('disabled', true);
    setCoachStatus('Practice answer revealed — now play the move.');
  } else {
    $('#btn-coach-practice-answer').text('Show answer');
    setCoachStatus('Practice hint shown.');
  }
  saveCoachPracticeState();
}

function advanceCoachPractice() {
  if (!coachPracticeRun || !coachPracticeSession || !coachPracticeSession.completed) return;
  if (coachPracticeSession.item.learningTransfer && typeof continueLearningTransferPlay === 'function') {
    const id = coachPracticeSession.item.learningTransfer.recordId;
    exitCoachPractice('Different-position check saved.');
    continueLearningTransferPlay(id);
    return;
  }
  if (coachPracticeRun.index + 1 >= coachPracticeRun.items.length) {
    const completed = coachPracticeRun.completed;
    const clean = coachPracticeRun.clean;
    const openingItem = coachPracticeSession.item.id.startsWith('opening-bridge:') ? coachPracticeSession.item : null;
    const sprint = dailySprintToday();
    const transferNext = sprint && !sprint.completedAt && sprint.mode === 'adaptive' && sprint.phase === 'moves';
    exitCoachPractice(`Practice session complete — ${clean}/${completed} solved on the first try.`);
    if (openingItem && typeof beginOpeningTransfer === 'function') {
      beginOpeningTransfer(openingItem.entry.openingId, 'main', openingItem.entry.ply + (Array.isArray(openingItem.entry.continuation) && openingItem.entry.continuation.length ? 2 : 0));
      return;
    }
    if (!transferNext && !coachGameActive) showCoachPanel('practice');
    if (transferNext) {
      if (!coachGameActive) startCoachGame();
      else setCoachStatus(`Your game is restored. Use this focus: ${sprint.focusCue || sprint.focus}`);
      document.getElementById('coachBoard')?.focus({ preventScroll: true });
    }
    return;
  }
  coachPracticeRun.index += 1;
  startCoachPractice(coachPracticeRun.items[coachPracticeRun.index], { preserveRun: true });
}

function exitCoachPractice(message) {
  if (!coachPracticeSession) return;
  $('#coach-keyboard-move-status').text('');
  clearCoachPracticeState(coachPracticeSession.owner || coachMemoryOwnerId());
  const returnState = coachPracticeReturnState;
  coachPracticeSession = null;
  coachPracticeReturnState = null;
  coachPracticeRun = null;
  const restoredLive = !!(returnState && restoreCoachPracticeReturnState(returnState));
  if (restoredLive) {
    // The underlying game remains live and its PGN, review log, stats, side,
    // and local/remote identity are back in place.
    persistCoachPracticeReturnState(null);
    CoachController.setPhase(coachIsUserTurn() ? 'userTurn' : 'opponentThinking');
    setCoachStatus(message || (coachIsUserTurn() ? 'Your game is restored. Your move.' : 'Your game is restored. Opponent thinking…'));
    if (!coachIsUserTurn() && !coachGame.game_over()) coachOpponentRespond();
  } else {
    resetCoachState();
    coachGameActive = false;
    CoachController.setPhase('idle');
    createCoachBoard('start', 'white');
    $('#coach-view').removeClass('game-active');
    persistCoachPracticeReturnState(null);
  }
  $('#coach-practice-banner').hide();
  setPracticeFocus(false);
  if (!restoredLive) setCoachStatus(message || 'Practice closed. Start a game or choose another due drill.');
  updateCoachControlsState();
  renderInsights();
}

function createBoard(position, draggable, orientation) {
  if (board) board.destroy();
  board = Chessboard('myBoard', {
    position: position || 'start',
    draggable: !!draggable,
    orientation: orientation || 'white',
    pieceTheme: localPieceTheme,
    onDrop: handleDrop,
    onSnapEnd: handleSnapEnd,
  });
  observeBoardLastMove('myBoard');
  scheduleLibraryBoardFit();
  updateLibraryBoardAccessibility();
}

function createCoachBoard(position, orientation) {
  if (coachBoard) coachBoard.destroy();
  coachBoard = Chessboard('coachBoard', {
    position: position || 'start',
    draggable: true,
    orientation: orientation || 'white',
    pieceTheme: localPieceTheme,
    onDragStart: function(source, piece) {
      if (!coachGameActive || !coachGame) return false;
      if (coachPracticeSession && coachPracticeSession.completed) return false;
      if (coachIsReviewing()) return false;
      // Only allow picking up pieces of the user's colour, ever.
      const userPrefix = coachUserColor() === 'white' ? 'w' : 'b';
      if (piece[0] !== userPrefix) return false;
      // Block during our own classification window — premoves wait for opponent's move.
      if (coachThinking && coachIsUserTurn()) return false;
      // Both regular drags (our turn) and premove drags (their turn) are allowed.
    },
    onDrop: function(source, target) {
      if (!coachGameActive || !coachGame) return 'snapback';
      if (coachIsReviewing()) return 'snapback';
      if (source === target) return 'snapback';
      if (coachIsUserTurn()) {
        if (coachThinking) return 'snapback';
        if (requestPromotionChoice(coachGame, source, target, promotion => {
          if (coachPracticeSession) {
            coachHandlePracticeMove(source, target, promotion, { updateBoard: true });
          } else {
            coachHandleUserMove(source, target, promotion, { updateBoard: true });
          }
        }, true)) {
          return 'snapback';
        }
        // Synchronous legality check — chessboard.js needs a sync return value
        const tempGame = new Chess(coachGame.fen());
        const move = tempGame.move({ from: source, to: target, promotion: 'q' });
        if (!move) return 'snapback';
        if (coachPracticeSession) {
          const result = coachHandlePracticeMove(source, target, 'q', { updateBoard: false });
          return result && typeof result.then === 'function' ? 'snapback' : result;
        }
        // Legal move — dispatch async classification + opponent reply
        coachHandleUserMove(source, target, 'q', { updateBoard: false });
        return;
      }
      // Opponent's turn → queue the move as a premove. The piece visually snaps
      // back; the highlighted source/target squares + status hint show what's
      // queued. We attempt to apply it as soon as the opponent moves.
      if (requestPromotionChoice(coachGame, source, target, promotion => {
        setPremove(source, target, promotion);
      }, false)) {
        return 'snapback';
      }
      setPremove(source, target, 'q');
      return 'snapback';
    },
    onSnapEnd: function() {
      if (!coachGame || !coachBoard) return;
      // chessboard.js calls this after both user drags and programmatic
      // position changes. Keep analysis/review positions on the board instead
      // of snapping them back to the live game.
      const fen = coachAnalysisFen() || (coachReviewCursor !== null ? coachFenAtPly(coachReviewCursor) : coachGame.fen());
      coachBoard.position(fen, false);
      if (coachReviewAnalysis) {
        const step = coachReviewAnalysis.steps[coachReviewAnalysis.index];
        setBoardLastMove('coachBoard', step && step.move ? step.move : null);
        updateCoachAnalysisAccessibility(fen, step && step.label);
      } else coachSyncLastMove();
    }
  });
  observeBoardLastMove('coachBoard');
  coachSyncLastMove();
  updateCoachBoardAccessibility();
  setTimeout(() => {
    if (coachBoard) coachBoard.resize();
  }, 0);
}

// ─────────────────────────────────────────────
// COACH VIEW SWITCHING
// ─────────────────────────────────────────────
// Top navigation: Library | Coach | Puzzles. Exactly one tab is selected and
// focusable; the others stay reachable with the arrow keys.
const APP_VIEWS = ['library', 'coach', 'puzzles'];
function setNavSelection(view) {
  APP_VIEWS.forEach(name => {
    const active = name === view;
    $('#nav-' + name).toggleClass('active', active).attr({ 'aria-selected': active ? 'true' : 'false', tabindex: active ? '0' : '-1' });
  });
}

function switchView(view) {
  if (!APP_VIEWS.includes(view)) view = 'coach';
  const wasCoachMode = coachMode;
  const wasPuzzles = appView === 'puzzles';
  if (wasCoachMode && view !== 'coach') {
    // Leaving Coach must stop any pending engine reply and clear a transient
    // analysis line before the library view takes over.
    if (coachPracticeSession) {
      if (coachPracticeSession.grading || coachPracticeSession.pendingMove) {
        $('#coach-practice-status').text('That move was interrupted. Choose your move again.');
        $('#coach-keyboard-move-status').text('');
      }
      saveCoachPracticeState();
    }
    invalidateCoachAsyncWork('Coach view changed.');
  }
  if (wasPuzzles && view !== 'puzzles' && window.PuzzlesView) window.PuzzlesView.hide();
  appView = view;
  coachMode = (view === 'coach');
  const $app = $('.app');
  const $coach = $('#coach-view');
  const $puzzles = $('#puzzles-view');
  setNavSelection(view);
  if (view === 'puzzles') {
    $app.hide().attr('aria-hidden', 'true');
    $coach.hide().attr('aria-hidden', 'true');
    $puzzles.show().css('display', 'grid').attr('aria-hidden', 'false');
    if (window.PuzzlesView) window.PuzzlesView.show();
    updateURL();
    return;
  }
  $puzzles.hide().attr('aria-hidden', 'true');
  if (view === 'coach') {
    $app.hide().attr('aria-hidden', 'true');
    $coach.show().css('display', 'grid').attr('aria-hidden', 'false');
    // Pre-warm Stockfish in the background so the first New Game starts faster.
    // Errors here are swallowed; the real load gate is inside startCoachGame.
    if (engineClient.status === 'idle') { engineClient.init().catch(() => {}); }
    // Initialize strength display
    $('#coach-strength-value').text(coachEngineElo);
    $('#coach-strength-tier').text(strengthTierLabel(coachEngineElo));
    renderCoachAuth();
    // Show lifetime stats if any are recorded.
    renderLifetime();
    renderInsights();
    if (!coachGame || coachPendingReview) {
      // Try to restore an in-progress (or just-ended) game from localStorage.
      const practice = tryRestoreCoachPractice();
      const restore = practice.restored ? practice : tryRestoreCoachGame();
      if (!restore.restored && practice.warning) restore.warning = practice.warning;
      if (restore.restored && practice.warning) setCoachStatus(practice.warning + ' Your saved game is restored.');
      if (!restore.restored) {
        $('#coach-view').removeClass('game-active');
        // Show an idle board so the user has visual context
        $('#coachBoard-placeholder').hide();
        createCoachBoard('start', 'white');
        setCoachStatus(restore.warning || 'Choose Start training when you’re ready.');
      }
    } else {
      // A view change cancels transient engine work. Restore the displayed
      // position from the actual session before accepting another move.
      if (coachPracticeSession) {
        resumeCoachPracticeAfterNavigation();
      } else {
        const fen = coachReviewCursor === null ? coachGame.fen() : coachFenAtPly(coachReviewCursor);
        if (coachBoard && fen) coachBoard.position(fen, false);
        coachSyncLastMove();
        updateCapturedDisplay(fen);
        updateCoachBoardAccessibility();
        if (coachIsReviewing()) {
          if (coachGameActive && !coachIsUserTurn() && !coachGame.game_over()) coachOpponentRespond();
          CoachController.setPhase('reviewing');
          setCoachStatus('Reviewing an earlier position. Choose Live to return.');
        } else if (coachGameActive && !coachIsUserTurn() && !coachGame.game_over()) {
          coachOpponentRespond();
        } else {
          CoachController.setPhase(coachGameActive ? 'userTurn' : 'ended');
          setCoachStatus(coachGameActive ? 'Your move.' : coachLastEndMsg || 'Choose Start training when you’re ready.');
        }
      }
      if (coachBoard) setTimeout(() => coachBoard.resize(), 0);
    }
    updateCoachControlsState();
  } else {
    $coach.hide().attr('aria-hidden', 'true');
    $app.show().attr('aria-hidden', 'false');
    // If library board exists, kick it into life via a resize so it redraws correctly
    if (board) setTimeout(() => board.resize(), 0);
    scheduleLibraryBoardFit();
  }
  updateURL();
}

function updateNetworkStatus(announce) {
  const $status = $('#network-status');
  if (!$status.length) return;
  if (navigator.onLine) {
    if (announce) {
      $status.removeAttr('hidden').removeClass('offline').text('Back online — local progress will sync when available.');
      clearTimeout(updateNetworkStatus.onlineTimer);
      updateNetworkStatus.onlineTimer = setTimeout(() => $status.attr('hidden', true), 4500);
    } else {
      $status.attr('hidden', true).text('');
    }
  } else {
    clearTimeout(updateNetworkStatus.onlineTimer);
    $status.removeAttr('hidden').addClass('offline').text('Offline mode — your Coach progress is saved locally and will sync when you reconnect.');
  }
}

function isValidFen(fen) {
  try {
    const g = new Chess();
    return g.load(fen);
  } catch (e) { return false; }
}

function startCoachGame(options = {}) {
  if (coachOpeningTransfer && !options.openingTransfer) {
    finishOpeningTransfer();
    return;
  }
  clearCoachPracticeState();
  // Starting a new game is the explicit discard/reset action for an active
  // drill. Do not restore the borrowed game after this click.
  if (coachPracticeSession || coachPracticeReturnState) {
    coachPracticeSession = null;
    coachPracticeRun = null;
    coachPracticeReturnState = null;
    persistCoachPracticeReturnState(null);
  }
  if (typeof applyAdaptiveCoachElo === 'function') applyAdaptiveCoachElo();
  const transfer = options.openingTransfer || null;
  const fenRaw = transfer ? transfer.sourceFen : ($('#coach-fen').val() || '').trim();
  let startFen = null;
  if (fenRaw) {
    if (!isValidFen(fenRaw)) {
      $('#coach-fen-error').text('Invalid FEN — check the position string.').show();
      return;
    }
    startFen = fenRaw;
  }
  $('#coach-fen-error').hide();
  beginDailyMoveSprint();

  // Resolve "random" side
  const chosenSide = transfer ? transfer.side : $('.side-toggle button.active').data('side') || 'white';
  coachUserSide = chosenSide === 'random'
    ? (Math.random() < 0.5 ? 'white' : 'black')
    : chosenSide;

  resetCoachState(startFen);
  coachOpeningTransfer = transfer;
  const generation = coachGameGeneration;
  coachGameActive = true;
  CoachController.setPhase(coachIsUserTurn() ? 'userTurn' : 'opponentThinking');
  $('#summary-overlay').hide().attr('aria-hidden', 'true');
  // Replace any saved state from a prior game so a refresh before the first
  // move doesn't restore the old session.
  clearCoachState();

  // Orient board so user plays from bottom
  coachBoardFlipped = (coachUserColor() === 'black');
  createCoachBoard(coachGame.fen(), coachBoardFlipped ? 'black' : 'white');
  $('#coach-view').addClass('game-active');

  document.getElementById('coach-game-options').open = false;
  showCoachPanel('game');
  document.getElementById('coachBoard')?.focus({ preventScroll: true });
  const tier = strengthTierLabel(coachEngineElo);
  const opening = coachIsUserTurn()
    ? `Playing ${coachUserColor() === 'white' ? 'White' : 'Black'} vs Opponent ${coachEngineElo} (${tier}). Your move.`
    : `Playing ${coachUserColor() === 'white' ? 'White' : 'Black'} vs Opponent ${coachEngineElo} (${tier}). Opponent opens — thinking…`;
  setCoachStatus(opening);

  updateCoachControlsState();
  renderCoachDailyPlan();
  saveCoachState();
  ensureRemoteCoachGame(generation).catch(err => {
    if (!isAbortError(err)) handleCoachDbError(err);
  });

  // Pre-warm engine, then kick off opponent if it's their turn.
  // Wrap in a 15s timeout so a stuck WASM load surfaces a retry instead of hanging.
  const timed = Promise.race([
    engineClient.init(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Engine load timed out')), 15000))
  ]);
  timed.then(() => {
    if (generation !== coachGameGeneration || !coachGameActive) return;
    if (!coachIsUserTurn()) coachOpponentRespond();
  }).catch((err) => {
    if (generation !== coachGameGeneration || isAbortError(err)) return;
    showEngineLoadError(err);
  });
}

// Display a recoverable error inline in the coach status when Stockfish can't load.
function showEngineLoadError(err) {
  const msg = (err && err.message) || 'Engine could not load.';
  setCoachStatus(msg + ' — refresh to retry.');
  // Also disable in-game actions that require the engine.
  $('#btn-coach-resign').prop('disabled', true);
  $('#btn-coach-takeback').prop('disabled', true);
  $('#btn-coach-showbest').prop('disabled', true);
  $('#btn-coach-showwhy').prop('disabled', true);
  $('#btn-coach-candidates').prop('disabled', true);
}

// ─────────────────────────────────────────────
// CONTROL ENABLED-STATE
// ─────────────────────────────────────────────
function updateCoachControlsState() {
  const active = coachGameActive;
  const practicing = !!coachPracticeSession;
  const reviewing = coachIsReviewing();
  $('#btn-coach-review-practice').prop('disabled', coachThinking && !practicing);
  const hasReview = !!coachLastReview;
  const canExplain = !!coachLastReview && !!coachLastReview.bestUci && coachLastReview.tier !== 'best' &&
    coachLastReview.tier !== 'unknown' && (!active || coachIsUserTurn()) && !reviewing && !coachThinking && !practicing;
  const total = coachGame ? coachGame.history().length : 0;
  const cur = coachReviewCursor === null ? total : coachReviewCursor;
  $('#btn-coach-resign').prop('disabled', !active || reviewing || practicing);
  // "Open review" only appears once the game has ended and we have a summary to reopen.
  $('#btn-coach-openreview').toggle(!practicing && !active && !!coachLastEndMsg);
  $('#btn-coach-takeback').prop('disabled', practicing || !hasReview || reviewing || coachThinking);
  $('#btn-coach-showbest').prop('disabled', !canExplain);
  $('#btn-coach-showwhy').prop('disabled', !canExplain);
  $('#btn-coach-consequence').prop('disabled', !canExplain);
  $('#btn-coach-candidates').prop('disabled', practicing || !active || !coachGame || !coachIsUserTurn() || reviewing || coachThinking);
  $('#btn-coach-prev').prop('disabled', practicing || !coachGame || total === 0 || cur === 0);
  $('#btn-coach-next').prop('disabled', practicing || !coachGame || total === 0 || cur === total);
  $('#btn-coach-live').toggle(reviewing);
  const openingPosition = coachOpeningTransfer && coachGame
    ? (reviewing ? coachFenAtPly(cur) : coachGame.fen()) : null;
  $('#coach-nav-label').text(
    practicing ? 'Practice' : openingPosition ? `Move ${openingPosition.split(/\s+/)[5]} • ${reviewing ? 'Review' : 'Live'}` :
    !coachGame || total === 0 ? '' : reviewing ? `Move ${cur}/${total}` : `Move ${total} • Live`
  );
  renderCoachPresentation();
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
  clearCoachReviewAnalysis({ restore: false });
  const total = coachGame.history().length;
  n = Math.max(0, Math.min(n, total));
  coachReviewCursor = n === total ? null : n;
  const fen = coachFenAtPly(n);
  if (coachBoard && fen) coachBoard.position(fen, false);
  coachSyncLastMove();
  if (coachIsReviewing()) {
    CoachController.setPhase('reviewing');
    $('#threats-section').hide();
    $('#candidates-section').hide();
    setCoachStatus(`Reviewing move ${n} of ${total} — click Live to return.`);
    // Show the review card for the move at/before this cursor. If nothing has
    // been reviewed yet (n==0 or only opponent moves so far), hide the card.
    const r = reviewAtCursor(n);
    if (r) renderCoachReview(r); else $('#coach-review').hide();
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
    $('#captured-top-pieces, #captured-bottom-pieces').empty();
    $('#captured-top-lead, #captured-bottom-lead').text('');
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
  $('#captured-bottom-pieces').html(renderCapturedRow(userTook, userGlyphs));
  $('#captured-top-pieces').html(renderCapturedRow(oppTook, oppGlyphs));
  $('#captured-bottom-lead').text(userLead > 0 ? '+' + userLead : '');
  $('#captured-top-lead').text(userLead < 0 ? '+' + (-userLead) : '');
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
  const $section = $('#movelist-section');
  const $list = $('#movelist');
  if (!coachGame || coachGame.history().length === 0) {
    $section.hide();
    $list.empty();
    return;
  }
  $section.show();
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
  $list.html(html);
  // Scroll the current ply into view.
  const $cur = $list.find('.ply.current');
  if ($cur.length) {
    const cEl = $cur[0];
    const lEl = $list[0];
    const top = cEl.offsetTop - lEl.offsetTop;
    if (top < lEl.scrollTop || top > lEl.scrollTop + lEl.clientHeight - cEl.clientHeight) {
      lEl.scrollTop = top - lEl.clientHeight / 2;
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function reachesPromotionRank(gameObj, source, target) {
  if (!gameObj || !source || !target) return false;
  const piece = gameObj.get(source);
  if (!piece || piece.type !== 'p') return false;
  return (piece.color === 'w' && target[1] === '8') ||
         (piece.color === 'b' && target[1] === '1');
}

function isLegalPromotionMove(gameObj, source, target) {
  if (!reachesPromotionRank(gameObj, source, target)) return false;
  return gameObj.moves({ verbose: true }).some(m => m.from === source && m.to === target && m.promotion);
}

function resolveAccessibleMove(gameObj, rawMove) {
  if (!gameObj) return null;
  const value = String(rawMove || '').trim();
  if (!value) return null;
  const legalMoves = gameObj.moves({ verbose: true });
  const uci = value.toLowerCase().match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (uci) {
    return legalMoves.find(move => move.from === uci[1] && move.to === uci[2] &&
      (!move.promotion || (uci[3] || 'q') === move.promotion)) || null;
  }
  // Case matters in SAN (Bxc3 is the bishop, bxc3 the pawn): an exact match
  // wins, and a case-insensitive one is accepted only when it is unique.
  const bare = san => san.replace(/\s+/g, '').replace(/[+#?!]+$/, '');
  const typed = bare(value);
  const exact = legalMoves.find(move => bare(move.san) === typed);
  if (exact) return exact;
  const loose = legalMoves.filter(move => bare(move.san).toLowerCase() === typed.toLowerCase());
  return loose.length === 1 ? loose[0] : null;
}

function focusableElements(container) {
  return Array.from(container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.hidden && el.getClientRects().length > 0);
}

function trapDialogTab(event, container) {
  if (event.key !== 'Tab') return;
  const focusable = focusableElements(container);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showPromotionPicker(color, onPick) {
  const glyphs = color === 'b'
    ? { q: '♛', r: '♜', b: '♝', n: '♞' }
    : { q: '♕', r: '♖', b: '♗', n: '♘' };
  pendingPromotionChoice = onPick;
  promotionReturnFocus = document.activeElement;
  $('#promotion-picker .promotion-choice').each(function() {
    const piece = $(this).attr('data-promotion');
    $(this).text(glyphs[piece] || piece.toUpperCase());
  });
  $('#promotion-picker').css('display', 'flex').attr('aria-hidden', 'false');
  $('#promotion-picker .promotion-choice[data-promotion="q"]').trigger('focus');
}

function closePromotionPicker() {
  pendingPromotionChoice = null;
  $('#promotion-picker').hide().attr('aria-hidden', 'true');
  if (promotionReturnFocus && typeof promotionReturnFocus.focus === 'function') {
    promotionReturnFocus.focus();
  }
  promotionReturnFocus = null;
}

function closeSummaryOverlay() {
  const overlay = document.getElementById('summary-overlay');
  const requestedTarget = summaryReturnFocus;
  const canRestore = requestedTarget && requestedTarget !== document.body && requestedTarget.isConnected &&
    !(overlay && overlay.contains(requestedTarget));
  const returnTarget = canRestore
    ? requestedTarget
    : (document.getElementById('btn-coach-openreview') || document.getElementById('btn-coach-newgame'));
  $('#summary-overlay').hide().attr('aria-hidden', 'true');
  updateCoachControlsState();
  summaryReturnFocus = null;
  if (returnTarget && typeof returnTarget.focus === 'function') returnTarget.focus();
}

function requestPromotionChoice(gameObj, source, target, onPick, legalOnly) {
  const shouldAsk = legalOnly
    ? isLegalPromotionMove(gameObj, source, target)
    : reachesPromotionRank(gameObj, source, target);
  if (!shouldAsk) return false;
  const piece = gameObj.get(source);
  showPromotionPicker(piece ? piece.color : 'w', onPick);
  return true;
}

function getOpeningLines(opening) {
  if (!opening) return [];
  return [{
    id: 'main',
    name: 'Main line',
    note: opening.tagline || '',
    tagline: opening.tagline,
    description: opening.description,
    moves: opening.moves,
    explanations: opening.explanations,
    keyIdeas: opening.keyIdeas
  }].concat(opening.variations || []);
}

function setActiveLine(lineId) {
  const lines = getOpeningLines(currentOpening);
  currentLine = lines.find(line => line.id === lineId) || lines[0] || null;
  currentLineId = currentLine ? currentLine.id : 'main';
}

function activeMoves() {
  return currentLine && currentLine.moves ? currentLine.moves : [];
}

function activeExplanations() {
  return currentLine && currentLine.explanations ? currentLine.explanations : [];
}

function activeKeyIdeas() {
  if (currentLine && currentLine.keyIdeas) return currentLine.keyIdeas;
  return currentOpening && currentOpening.keyIdeas ? currentOpening.keyIdeas : [];
}

function renderOpeningDetails() {
  if (!currentOpening || !currentLine) return;
  $('#opening-title').text(currentOpening.name);
  if (currentLine.id === 'main') {
    $('#opening-tagline').text(currentOpening.tagline || '');
    $('#opening-desc').text(currentOpening.description || '');
  } else {
    const note = currentLine.note || currentLine.tagline || '';
    $('#opening-tagline').text(note ? `${currentLine.name} · ${note}` : currentLine.name);
    $('#opening-desc').text(currentLine.description || currentOpening.description || '');
  }
}

function renderLineSelector() {
  const lines = getOpeningLines(currentOpening);
  const $wrap = $('#line-selector-wrap');
  const $sel = $('#line-selector').empty();
  if (!currentOpening || lines.length <= 1) {
    $wrap.hide();
    return;
  }
  lines.forEach(line => {
    $('<button class="line-btn"></button>')
      .toggleClass('active', line.id === currentLineId)
      .attr('data-line', line.id)
      .text(line.name)
      .appendTo($sel);
  });
  $wrap.show();
}

function resetQuizTracking() {
  quizTimerGeneration++;
  quizAttempts = 0;
  quizSessionMisses = 0;
  quizMissedMoves = [];
  quizReviewMode = false;
  quizReviewQueue = [];
  quizReviewCursor = 0;
  $('#btn-review-misses').hide();
}

function recordQuizMiss(idx) {
  if (!quizMissedMoves.includes(idx)) quizMissedMoves.push(idx);
}

function moveLabelForIndex(idx) {
  const moveNo = Math.floor(idx / 2) + 1;
  return `${moveNo}${idx % 2 === 0 ? '.' : '...'} ${activeMoves()[idx] || ''}`.trim();
}

function setLineStartPosition() {
  currentMoveIdx = -1;
  quizAttempts = 0;
  game.reset();
  board.position('start', false);
  librarySyncLastMove(null);
  renderMoveList();
  renderExplanation(-1);
  updateProgress();
  updateControls();
}

function switchOpeningLine(lineId) {
  if (!currentOpening) return;
  setActiveLine(lineId);
  resetQuizTracking();
  game.reset();
  currentMoveIdx = -1;
  if (quizMode) boardFlipped = (getUserColor() === 'black');
  createBoard('start', quizMode, boardFlipped ? 'black' : 'white');
  renderOpeningDetails();
  renderLineSelector();
  renderKeyIdeas();
  renderMoveList();
  renderExplanation(-1);
  updateProgress();
  updateControls();
  clearFeedback();
  updateSRPanel();
  updateURL();
  if (quizMode) {
    const colorLabel = getUserColor() === 'white' ? 'White ♙' : 'Black ♟';
    showFeedback('hint', `💡 You're playing ${colorLabel}. The opponent's moves play automatically.`);
    autoPlayOpponent();
  }
}

function startQuizMistakeReview() {
  if (!currentOpening || quizMissedMoves.length === 0) return;
  quizReviewQueue = quizMissedMoves.slice().sort((a, b) => a - b);
  quizReviewCursor = 0;
  quizReviewMode = true;
  quizAttempts = 0;
  $('#btn-review-misses').hide();
  loadQuizReviewPosition();
}

function loadQuizReviewPosition() {
  if (!quizReviewMode || quizReviewCursor >= quizReviewQueue.length) {
    quizReviewMode = false;
    setLineStartPosition();
    showFeedback('correct', 'Review complete — missed moves replayed.');
    return;
  }
  const idx = quizReviewQueue[quizReviewCursor];
  const moves = activeMoves();
  game.reset();
  for (let i = 0; i < idx; i++) game.move(moves[i]);
  currentMoveIdx = idx - 1;
  quizAttempts = 0;
  board.position(game.fen(), false);
  librarySyncLastMove(game);
  renderMoveList();
  renderExplanation(idx - 1);
  updateProgress();
  const moveNo = Math.floor(idx / 2) + 1;
  showFeedback('hint', `Review ${quizReviewCursor + 1}/${quizReviewQueue.length}: find the missed ${idx % 2 === 0 ? moveNo + '.' : moveNo + '...'} move.`);
}

// ─────────────────────────────────────────────
// QUIZ AUTO-PLAY HELPERS
// ─────────────────────────────────────────────
function getUserColor() {
  if (!currentOpening) return 'white';
  // The side that owns the selected line: traps and gambits are played by the
  // side that springs them (Fool's Mate, Stafford, Slav are Black's), which
  // opponents.js already records. It loads after app.js, so look it up here.
  if (typeof OpponentPersonas !== 'undefined' && OpponentPersonas.lineSide) {
    const lineId = currentLine && currentLine.id !== 'main' ? currentLine.id : currentOpening.id;
    return OpponentPersonas.lineSide(lineId, currentOpening) === 'b' ? 'black' : 'white';
  }
  return currentOpening.category === 'black' ? 'black' : 'white';
}

function isUserTurn(idx) {
  // Even indices (0,2,4…) = White's move; odd = Black's move
  const userIsWhite = getUserColor() === 'white';
  return userIsWhite ? (idx % 2 === 0) : (idx % 2 === 1);
}

function finishQuiz() {
  if (!currentOpening) return;
  const m = quizSessionMisses;
  const quality = m === 0 ? 5 : (m <= 2 ? 4 : (m <= 4 ? 3 : 2));
  const saveResult = srRecordQuiz(currentOpening.id, quality);
  const summary = m === 0
    ? '🎉 Opening complete — perfect run!'
    : `🎉 Opening complete — ${m} miss${m === 1 ? '' : 'es'}.`;
  const saveWarning = saveResult && saveResult.ok === false
    ? ' Progress could not be saved in this browser.'
    : '';
  showFeedback('correct', summary + saveWarning);
  if (quizMissedMoves.length > 0) $('#btn-review-misses').show();
  updateSRSidebar();
  updateSRPanel();
  if (typeof renderOpeningTransferEntry === 'function') renderOpeningTransferEntry();
}

function autoPlayOpponent() {
  if (!quizMode || !currentOpening) return;
  if (quizReviewMode) return;
  const moves = activeMoves();
  const nextIdx = currentMoveIdx + 1;
  if (nextIdx >= moves.length) {
    finishQuiz();
    return;
  }
  if (isUserTurn(nextIdx)) return; // user's move, wait for them

  // Play opponent's move after a short pause, unless the quiz restarted
  // (another opening, line or mode) in the meantime.
  const generation = quizTimerGeneration;
  setTimeout(function () {
    if (generation !== quizTimerGeneration) return;
    if (!quizMode) return;
    if (quizReviewMode) return;
    game.move(moves[nextIdx]);
    currentMoveIdx = nextIdx;
    board.position(game.fen(), false);
    librarySyncLastMove(game);
    renderMoveList();
    updateProgress();
    if (currentMoveIdx >= moves.length - 1) {
      finishQuiz();
    } else {
      clearFeedback();
    }
  }, 600);
}

function applyExploreMove(source, target, promotion, opts) {
  if (!exploreGame) return false;
  opts = opts || {};
  const move = exploreGame.move({ from: source, to: target, promotion: promotion || 'q' });
  if (!move) return false;
  if (opts.updateBoard !== false) board.position(exploreGame.fen());
  librarySyncLastMove(exploreGame);
  fetchExploreData();
  return true;
}

function quizMoveMatches(position, played, expectedSan) {
  if (!position || !played || !expectedSan) return false;
  try {
    const expected = new Chess(position.fen()).move(expectedSan);
    return !!expected && uciFromMove(expected) === uciFromMove(played);
  } catch (e) { return false; }
}

function handleQuizDrop(source, target, promotion) {
  if (!quizMode || !currentOpening) return 'snapback';
  promotion = promotion || 'q';
  const moves = activeMoves();
  const explanations = activeExplanations();
  if (quizReviewMode) {
    const expectedIdx = quizReviewQueue[quizReviewCursor];
    const expectedSAN = moves[expectedIdx];
    const tempGame = new Chess(game.fen());
    const move = tempGame.move({ from: source, to: target, promotion });
    if (!move) return 'snapback';
    if (quizMoveMatches(game, move, expectedSAN)) {
      game.move({ from: source, to: target, promotion });
      currentMoveIdx = expectedIdx;
      board.position(game.fen(), false);
      librarySyncLastMove(game);
      renderMoveList();
      renderExplanation(expectedIdx);
      updateProgress();
      quizReviewCursor++;
      showFeedback('correct', '✓ Replayed ' + moveLabelForIndex(expectedIdx));
      setTimeout(loadQuizReviewPosition, 650);
    } else {
      quizAttempts++;
      showFeedback(quizAttempts >= 2 ? 'hint' : 'incorrect',
        quizAttempts >= 2 ? '💡 The correct move is ' + expectedSAN : '✗ Not quite — try again!');
      return 'snapback';
    }
    return;
  }
  const nextIdx = currentMoveIdx + 1;
  if (nextIdx >= moves.length) return 'snapback';
  if (!isUserTurn(nextIdx)) return 'snapback'; // opponent's turn — auto-playing

  const expectedSAN = moves[nextIdx];

  // Try the move on a temp game
  const tempGame = new Chess(game.fen());
  const move = tempGame.move({ from: source, to: target, promotion });
  if (!move) return 'snapback';

  if (quizMoveMatches(game, move, expectedSAN)) {
    game.move({ from: source, to: target, promotion });
    currentMoveIdx = nextIdx;
    quizAttempts = 0;
    const exp = explanations[nextIdx];
    showFeedback('correct', '✓ ' + (exp ? exp.text : moveLabelForIndex(nextIdx)));
    const generation = quizTimerGeneration;
    setTimeout(() => {
      if (generation !== quizTimerGeneration) return;
      board.position(game.fen());
      librarySyncLastMove(game);
      renderMoveList();
      updateProgress();
      autoPlayOpponent();
    }, 300);
  } else {
    quizAttempts++;
    if (quizAttempts === 1) {
      quizSessionMisses++;
      recordQuizMiss(nextIdx);
    }
    if (quizAttempts >= 2) {
      showFeedback('hint', '💡 The correct move is ' + expectedSAN);
    } else {
      showFeedback('incorrect', '✗ Not quite — try again!');
    }
    return 'snapback';
  }
}

function handleDrop(source, target) {
  // Explore mode: free play, any legal move for either colour
  if (exploreMode) {
    if (requestPromotionChoice(exploreGame, source, target, promotion => {
      applyExploreMove(source, target, promotion, { updateBoard: true });
    }, true)) {
      return 'snapback';
    }
    if (!applyExploreMove(source, target, 'q', { updateBoard: false })) return 'snapback';
    return;
  }
  if (!quizMode || !currentOpening) return 'snapback';
  if (requestPromotionChoice(game, source, target, promotion => {
    handleQuizDrop(source, target, promotion);
  }, true)) {
    return 'snapback';
  }
  return handleQuizDrop(source, target, 'q');
}

function handleSnapEnd() {
  if (exploreMode) {
    board.position(exploreGame.fen());
    librarySyncLastMove(exploreGame);
    return;
  }
  if (!quizMode) return;
  board.position(game.fen());
  librarySyncLastMove(game);
}

// ─────────────────────────────────────────────
// LOAD AN OPENING
// ─────────────────────────────────────────────
function loadOpening(id, lineId) {
  currentOpening = OPENINGS.find(o => o.id === id);
  if (!currentOpening) return;
  // Opening links are an explicit request for Library, even though Coach is
  // the app's default home. This also keeps shared opening URLs backwards
  // compatible after the default view change.
  if (appView !== 'library') switchView('library');
  setActiveLine(lineId || 'main');

  // Exit explore mode when user picks an opening
  if (exploreMode) {
    exploreMode = false;
    $('#btn-study, #btn-quiz, #btn-explore').removeClass('active').attr('aria-pressed', 'false');
    $('#btn-study').addClass('active').attr('aria-pressed', 'true');
    $('#btn-start, #btn-prev, #btn-next, #btn-end').show();
    $('#btn-explore-undo, #btn-explore-reset').hide();
    $('#explore-content').hide();
  }

  currentMoveIdx = -1;
  resetQuizTracking();
  game.reset();
  boardFlipped = false;

  // Show board element first (must be visible before chessboard.js measures it)
  $('#board-placeholder').hide();
  $('#myBoard').show();
  createBoard('start', quizMode, 'white');

  // Enable controls
  ['btn-prev', 'btn-start', 'btn-flip'].forEach(id => $('#' + id).prop('disabled', true));
  ['btn-next', 'btn-end'].forEach(id => $('#' + id).prop('disabled', false));
  $('#btn-flip').prop('disabled', false);

  // Update library
  $('.opening-btn').removeClass('active');
  $(`.opening-btn[data-id="${currentOpening.id}"]`).addClass('active');

  // Update info panel
  $('#empty-state').hide();
  $('#opening-content').show();
  $('.app').addClass('has-opening');
  renderOpeningDetails();
  if (typeof renderRepertoireUI === 'function') renderRepertoireUI();

  renderLineSelector();
  renderKeyIdeas();
  renderMoveList();
  renderExplanation(-1);
  updateProgress();
  updateBoardDraggable();
  clearFeedback();
  updateSRPanel();
  updateURL();
  // A quiz carries over to the new opening: orient the board for the side
  // that owns the line and start the opponent's moves.
  if (quizMode) setMode('quiz');
}

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────
function goToMove(idx) {
  if (!currentOpening || !board) return;
  const moves = activeMoves();
  idx = Math.max(-1, Math.min(idx, moves.length - 1));
  game.reset();
  for (let i = 0; i <= idx; i++) {
    game.move(moves[i]);
  }
  currentMoveIdx = idx;
  board.position(idx === -1 ? 'start' : game.fen(), false);
  librarySyncLastMove(idx === -1 ? null : game);
  renderMoveList();
  renderExplanation(idx);
  updateProgress();
  updateControls();
  quizAttempts = 0;
  if (!quizMode) clearFeedback();
  updateURL();
}

function updateControls() {
  const moves = activeMoves();
  const atStart = currentMoveIdx <= -1;
  const atEnd = currentOpening && currentMoveIdx >= moves.length - 1;
  $('#btn-prev').prop('disabled', atStart);
  $('#btn-start').prop('disabled', atStart);
  $('#btn-next').prop('disabled', atEnd || !currentOpening);
  $('#btn-end').prop('disabled', atEnd || !currentOpening);
}

// ─────────────────────────────────────────────
// RENDER FUNCTIONS
// ─────────────────────────────────────────────
function renderMoveList() {
  if (!currentOpening) return;
  const moves = activeMoves();
  // A quiz asks for recall first: moves not reached yet stay hidden, keeping
  // their slots so the length of the line is still visible.
  const chip = (idx, cls) => {
    const hidden = quizMode && idx > currentMoveIdx;
    return hidden
      ? `<button class="move-chip quiz-hidden" data-idx="${idx}" aria-label="Move hidden until you play it" disabled>…</button>`
      : `<button class="move-chip ${cls}" data-idx="${idx}">${escapeHtml(moves[idx])}</button>`;
  };
  let html = '';
  for (let i = 0; i < moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    html += `<div class="move-pair">`;
    html += `<span class="move-num">${moveNum}.</span>`;
    // White move
    const wClass = i === currentMoveIdx ? 'current' : (i < currentMoveIdx ? 'played' : '');
    html += chip(i, wClass);
    // Black move (if exists)
    if (i + 1 < moves.length) {
      const bClass = (i + 1) === currentMoveIdx ? 'current' : (i + 1 < currentMoveIdx ? 'played' : '');
      html += chip(i + 1, bClass);
    }
    html += `</div>`;
  }
  $('#move-list').html(html);

  // Click handlers for move chips
  $('.move-chip').on('click', function () {
    if (quizMode) return; // no clicking in quiz mode
    const idx = parseInt($(this).data('idx'));
    goToMove(idx);
  });
}

function renderExplanation(idx) {
  const box = $('#explanation-box');
  if (idx < 0 || !currentOpening) {
    if (quizMode) {
      box.html(`<span class="move-label">Quiz Mode Active</span><p>Find the correct move on the board. Drag the right piece to the right square.</p>`);
    } else {
      box.html(`<p>Click a move or use <strong>Next →</strong> to step through the opening.</p>`);
    }
    return;
  }
  const exp = activeExplanations()[idx] || { label: moveLabelForIndex(idx), text: 'Continue the selected line from this position.' };
  box.html(`<span class="move-label">${escapeHtml(exp.label)}</span><p>${escapeHtml(exp.text)}</p>`);
}

function renderKeyIdeas() {
  if (!currentOpening) return;
  const html = activeKeyIdeas().map(idea => `<div class="key-idea">${escapeHtml(idea)}</div>`).join('');
  $('#key-ideas').html(html);
}

function updateProgress() {
  if (board) updateLibraryBoardAccessibility();
  if (typeof renderOpeningTransferEntry === 'function') renderOpeningTransferEntry();
  if (!currentOpening) { $('#progress-fill').css('width', '0%'); return; }
  const moves = activeMoves();
  const pct = moves.length ? ((currentMoveIdx + 1) / moves.length) * 100 : 0;
  $('#progress-fill').css('width', pct + '%');
}

// ─────────────────────────────────────────────
// QUIZ MODE
// ─────────────────────────────────────────────
function updateBoardDraggable() {
  if (!board) return;
  createBoard(game.fen(), quizMode, boardFlipped ? 'black' : 'white');
}

function setMode(mode) {
  quizMode = (mode === 'quiz');
  exploreMode = (mode === 'explore');

  $('#btn-study, #btn-quiz, #btn-explore').removeClass('active').attr('aria-pressed', 'false');
  $(`#btn-${mode}`).addClass('active').attr('aria-pressed', 'true');

  if (exploreMode) {
    // Hide study nav, show explore nav
    $('#btn-start, #btn-prev, #btn-next, #btn-end').hide();
    $('#btn-explore-undo, #btn-explore-reset').show();
    $('#btn-flip').prop('disabled', false);

    // Swap info panel to explore view
    $('#empty-state, #opening-content').hide();
    $('#explore-content').show().css('display', 'flex');

    // Build explore game from end of current opening (or start position)
    exploreGame = new Chess();
    if (currentOpening) {
      activeMoves().forEach(m => exploreGame.move(m));
      $('#explore-title').text(currentLineId === 'main' ? currentOpening.name : `${currentOpening.name}: ${currentLine.name}`);
      $('#explore-tagline').text('Exploring from end of line · move freely');
    } else {
      $('#explore-title').text('Free Exploration');
      $('#explore-tagline').text('Move freely from the starting position');
    }
    exploreStartFen = exploreGame.fen();

    // Show board in free-play mode
    $('#board-placeholder').hide();
    $('#myBoard').show();
    createBoard(exploreStartFen, true, boardFlipped ? 'black' : 'white');
    clearFeedback();
    showExploreTokenState();
    fetchExploreData();

  } else if (quizMode) {
    // Back to study nav
    $('#btn-start, #btn-prev, #btn-next, #btn-end').show();
    $('#btn-explore-undo, #btn-explore-reset').hide();
    $('#explore-content').hide();
    if (currentOpening) {
      $('#empty-state').hide();
      $('#opening-content').show();
    }
    $('#btn-next, #btn-prev, #btn-start, #btn-end').prop('disabled', true);
    if (currentOpening) {
      game.reset();
      currentMoveIdx = -1;
      resetQuizTracking();
      // Orient the board so the user plays from the bottom
      boardFlipped = (getUserColor() === 'black');
      createBoard('start', true, boardFlipped ? 'black' : 'white');
      renderMoveList();
      renderExplanation(-1);
      updateProgress();
      clearFeedback();
      const colorLabel = getUserColor() === 'white' ? 'White ♙' : 'Black ♟';
      showFeedback('hint', `💡 You're playing ${colorLabel}. The opponent's moves play automatically.`);
      // For black openings, auto-play White's first move(s)
      autoPlayOpponent();
    }

  } else {
    // Study mode
    $('#btn-start, #btn-prev, #btn-next, #btn-end').show();
    $('#btn-explore-undo, #btn-explore-reset').hide();
    $('#explore-content').hide();
    if (currentOpening) {
      $('#empty-state').hide();
      $('#opening-content').show();
      updateControls();
      createBoard(game.fen(), false, boardFlipped ? 'black' : 'white');
      // Reveal the whole line again after a quiz.
      renderMoveList();
    }
    renderExplanation(currentMoveIdx);
    clearFeedback();
  }
  updateProgress();
  updateSRPanel();
  updateURL();
  scheduleLibraryBoardFit();
}

// ─────────────────────────────────────────────
// FEEDBACK
// ─────────────────────────────────────────────
function showFeedback(type, message) {
  const bar = $('#feedback-bar');
  bar.removeClass('correct incorrect hint').addClass(type + ' show').text(message);
  if (feedbackTimeout) clearTimeout(feedbackTimeout);
  if (type === 'correct') {
    feedbackTimeout = setTimeout(clearFeedback, 5000);
  }
}

function clearFeedback() {
  $('#feedback-bar').removeClass('show correct incorrect hint');
}

// ─────────────────────────────────────────────
// EVENT HANDLERS
// ─────────────────────────────────────────────
$(function () {
  // Board is initialized lazily on first opening selection
  initDesktopNotice();
  initBoardTheme();
  initColorTheme();
  initCoachPanelTabs();
  migrateLegacyCoachMemory();
  coachSync.init();
  let applySearch;

  function bindLibraryEvents() {

  // Promotion picker
  $('#promotion-picker .promotion-choice').on('click', function() {
    const promotion = $(this).attr('data-promotion');
    const cb = pendingPromotionChoice;
    closePromotionPicker();
    if (cb) cb(promotion);
  });
  $('#promotion-picker').on('click', function(e) {
    if (e.target === this) closePromotionPicker();
  });

  // Library buttons
  $('.opening-btn').on('click', function () {
    loadOpening($(this).data('id'));
  });

  // Category tab filtering
  $('.cat-tab').on('click', function () {
    $('.cat-tab').removeClass('active');
    $(this).addClass('active');
    applySearch($('#library-search-input').val());
  });

  // Navigation
  $('#btn-prev').on('click', () => goToMove(currentMoveIdx - 1));
  $('#btn-next').on('click', () => goToMove(currentMoveIdx + 1));
  $('#btn-start').on('click', () => goToMove(-1));
  $('#btn-end').on('click', () => { if (currentOpening) goToMove(activeMoves().length - 1); });
  $('#btn-review-misses').on('click', startQuizMistakeReview);

  // Opening line selector
  $(document).on('click', '.line-btn', function () {
    const lineId = $(this).attr('data-line');
    if (lineId && lineId !== currentLineId) switchOpeningLine(lineId);
  });

  // Flip board
  $('#btn-flip').on('click', function () {
    if (!currentOpening) return;
    boardFlipped = !boardFlipped;
    board.flip();
  });

  // Mode toggle
  $('#btn-study').on('click', () => setMode('study'));
  $('#btn-quiz').on('click', () => { if (currentOpening) setMode('quiz'); });
  $('#btn-explore').on('click', () => setMode('explore'));

  $('#library-keyboard-move-form').on('submit', function(event) {
    event.preventDefault();
    const $status = $('#library-keyboard-move-status');
    if (!quizMode && !exploreMode) {
      $status.text('Switch to Quiz or Explore mode to play a move.');
      return;
    }
    const activeGame = exploreMode ? exploreGame : game;
    const move = resolveAccessibleMove(activeGame, $('#library-keyboard-move-input').val());
    if (!move) {
      $status.text('That move is not legal here. Try SAN such as Nf3 or coordinates such as g1f3.');
      return;
    }
    const result = exploreMode
      ? applyExploreMove(move.from, move.to, move.promotion || 'q', { updateBoard: true })
      : handleQuizDrop(move.from, move.to, move.promotion || 'q');
    if (!exploreMode && result === 'snapback') {
      $status.text('Legal move, but not the quiz answer. Try again.');
      return;
    }
    $('#library-keyboard-move-input').val('');
    $status.text('Move played: ' + move.san);
    updateLibraryBoardAccessibility();
  });
  }

  function bindCoachEvents() {

  // ─── Header nav (Library / Coach) ───────
  $('#nav-library').on('click', () => switchView('library'));
  $('#nav-coach').on('click', () => switchView('coach'));
  $('#nav-puzzles').on('click', () => switchView('puzzles'));
  $('.top-nav-btn').on('keydown', function(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const current = APP_VIEWS.indexOf(String(this.id).replace(/^nav-/, ''));
    let index = current < 0 ? 1 : current;
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = APP_VIEWS.length - 1;
    else if (event.key === 'ArrowLeft') index = Math.max(0, index - 1);
    else index = Math.min(APP_VIEWS.length - 1, index + 1);
    const nextView = APP_VIEWS[index];
    switchView(nextView);
    $('#nav-' + nextView).trigger('focus');
  });

  // ─── Coach settings ─────────────────────
  $('#coach-strength').on('input', function() {
    coachEngineElo = parseInt($(this).val(), 10);
    $('#coach-strength-value').text(coachEngineElo);
    $('#coach-strength-tier').text(strengthTierLabel(coachEngineElo));
    renderCoachPresentation();
  });

  $('.side-toggle button').on('click', function() {
    $('.side-toggle button').removeClass('active').attr('aria-pressed', 'false');
    $(this).addClass('active').attr('aria-pressed', 'true');
    const side = $(this).data('side');
    coachUserSide = side; // 'white' | 'black' | 'random'
    renderCoachPresentation();
  });

  $('#coach-fen').on('input', function() {
    $('#coach-fen-error').hide();
  });

  $('#coach-auth-email-form').on('submit', function(event) {
    event.preventDefault();
    sendCoachLoginLink().catch(handleCoachDbError);
  });
  $('#coach-auth-code-form').on('submit', function(event) {
    event.preventDefault();
    verifyCoachLoginCode().catch(handleCoachDbError);
  });
  $('#btn-coach-logout').on('click', function() {
    signOutCoach().catch(handleCoachDbError);
  });
  $('#btn-coach-reconnect').on('click', () => location.reload());
  $('#btn-coach-sync').on('click', async function() {
    if (!hasCoachDbSession()) {
      setCoachDbStatus('Sign in to sync games.');
      return;
    }
    const syncOwner = coachMemoryOwnerId();
    setCoachDbStatus('Syncing...');
    const [insightsResult, gameResult] = await Promise.allSettled([
      coachSync.loadInsights(),
      coachPracticeSession ? Promise.resolve() : coachSync.saveGame(coachGameActive ? null : coachLastEndMsg)
    ]);
    if (syncOwner !== coachMemoryOwnerId()) return;
    if (typeof flushAccountCheckpoint === 'function') flushAccountCheckpoint().catch(handleAccountCheckpointError);
    const insightError = insightsResult.status === 'rejected' ? insightsResult.reason : null;
    const gameError = gameResult.status === 'rejected' ? gameResult.reason : null;
    if (insightError && gameError) {
      setCoachDbStatus('Sync failed: ' + ((gameError && gameError.message) || (insightError && insightError.message) || 'Unknown error'));
    } else if (insightError) {
      setCoachDbStatus('Game saved, insights failed: ' + ((insightError && insightError.message) || 'Unknown error'));
    } else if (gameError) {
      setCoachDbStatus('Insights loaded, game save failed: ' + ((gameError && gameError.message) || 'Unknown error'));
    } else {
      setCoachDbStatus('Games, insights, and training sessions synced.');
    }
  });

  // Lifetime stats reset.
  $('#btn-coach-lifetime-reset').on('click', function() {
    if (!confirm('Reset all lifetime stats? This cannot be undone.')) return;
    saveLifetime(emptyLifetime());
    renderLifetime();
  });

  $('#btn-coach-insights-reset').on('click', function() {
    if (!confirm('Reset coach insights for this browser? This cannot be undone.')) return;
    clearInsights();
    renderInsights();
  });

  $('#btn-practice-progress-reset').on('click', function() {
    if (!confirm('Reset all practice attempts and scheduling for this browser?')) return;
    clearPracticeProgress();
    renderInsights();
  });

  $(document).on('click', '.practice-load', function() {
    const item = renderedPracticeItems.get($(this).attr('data-practice-id'));
    if (!item) {
      setCoachStatus('Practice position is no longer valid.');
      return;
    }
    const due = Array.from(renderedPracticeItems.values()).filter(candidate => practiceIsDue(candidate));
    startCoachPracticeSession(due, item);
  });

  $('#btn-practice-session-start').on('click', function() {
    const recommendation = practiceRecommendation();
    if (!recommendation || coachThinking) return;
    if (recommendation.items[0].id.startsWith('drill-')) startCoachPracticeSession(recommendation.items, recommendation.items[0]);
    else startCoachPractice(recommendation.items[0]);
  });

  $('#btn-coach-next-action').on('click', function() {
    const action = $(this).attr('data-action');
    if (action === 'progress') {
      if (coachPracticeSession) exitCoachPractice();
      document.querySelector('.panel-tab[data-panel="progress"]')?.click();
      document.getElementById('tab-progress')?.focus();
      return;
    }
    if (action === 'practice') {
      const due = Array.from(renderedPracticeItems.values()).filter(item => practiceIsDue(item));
      startCoachPracticeSession(due, due[0]);
      return;
    }
    if (action === 'continue') {
      if (!coachPracticeSession && coachIsReviewing()) coachGotoLive();
      showCoachPanel(coachPracticeSession ? 'practice' : 'game');
      document.querySelector('.coach-board-area')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      document.getElementById('coachBoard')?.focus({ preventScroll: true });
      return;
    }
    startCoachGame();
  });
  $('#btn-coach-practice-answer').on('click', revealCoachPracticeAnswer);
  $('#btn-coach-practice-hint').on('click', showCoachPracticeHint);
  $('#btn-coach-practice-next').on('click', advanceCoachPractice);
  $('#btn-coach-practice-exit').on('click', function() { exitCoachPractice(); });
  $('#btn-coach-review-practice').on('click', function() {
    const item = practiceItemFromReview(coachLastReview);
    if (!item || !practiceIsDue(item)) {
      $(this).hide();
      setCoachStatus('This move is already scheduled for later practice.');
      return;
    }
    startCoachPracticeSession([item], item);
  });
  $('#btn-coach-opening-study').on('click', function() {
    if (!coachOpeningId || !OPENINGS.some(opening => opening.id === coachOpeningId)) {
      setCoachStatus('This opening is not in the local study library yet.');
      return;
    }
    const context = coachOpeningTransfer;
    loadOpening(coachOpeningId, context ? context.lineId : undefined);
    if (context) goToMove(context.sourcePly - 1);
  });

  // Sound toggle — restore prior preference, persist on change. The first
  // change is also a user gesture so we can prime the AudioContext here.
  coachSoundEnabled = readSoundPref();
  $('#coach-sound-toggle').prop('checked', coachSoundEnabled);
  $('#coach-sound-toggle').on('change', function() {
    coachSoundEnabled = this.checked;
    writeSoundPref(coachSoundEnabled);
    if (coachSoundEnabled) {
      // Prime the audio context with a quiet wood-tap preview so a real
      // sound fires immediately on the next move.
      const ctx = ensureAudioCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      playWoodTap({ bodyFreq: 220, bodyEnd: 130, bodyGain: 0.018, clickGain: 0.014 });
    }
  });

  $('#btn-coach-newgame').on('click', function() {
    startCoachGame();
  });

  $('#coach-keyboard-move-form').on('submit', async function(event) {
    event.preventDefault();
    const $status = $('#coach-keyboard-move-status');
    if (!coachGameActive || !coachGame) {
      $status.text('Start a Coach game first.');
      return;
    }
    if (!coachIsUserTurn() || coachThinking || coachIsReviewing()) {
      $status.text(coachIsReviewing() ? 'Return to the live position first.' : 'Wait until it is your turn.');
      return;
    }
    const move = resolveAccessibleMove(coachGame, $('#coach-keyboard-move-input').val());
    if (!move) {
      $status.text('That move is not legal here. Try SAN such as Nf3 or coordinates such as g1f3.');
      return;
    }
    const inputGeneration = coachGameGeneration;
    const inputPractice = coachPracticeSession;
    const result = coachPracticeSession
      ? await coachHandlePracticeMove(move.from, move.to, move.promotion || 'q', { updateBoard: true })
      : await coachHandleUserMove(move.from, move.to, move.promotion || 'q', { updateBoard: true });
    if (!coachMode || inputGeneration !== coachGameGeneration || inputPractice !== coachPracticeSession) return;
    if (result === 'snapback') {
      $status.text(coachPracticeSession ? 'Position reset. Read the feedback, then try another move.' : 'That move could not be played.');
      if (coachPracticeSession) $('#coach-keyboard-move-input').trigger('focus').trigger('select');
      return;
    }
    if (result === 'stale') {
      $status.text('The position changed before analysis finished.');
      return;
    }
    if (result === 'ungraded' || result === 'pending') {
      $status.text(result === 'ungraded' ? 'Engine did not score that move.' : 'Checking the position…');
      return;
    }
    $('#coach-keyboard-move-input').val('');
    $status.text(coachPracticeSession ? 'Practice move played: ' + move.san : 'Move played: ' + move.san);
    updateCoachBoardAccessibility();
  });

  $(document).on('click', '#btn-coach-retry-opponent', function() {
    if (!coachMode || !coachGameActive || !coachGame) return;
    if (coachIsUserTurn()) {
      setCoachStatus('Your move.');
      return;
    }
    coachOpponentRespond();
  });

  $('#btn-coach-resign').on('click', function() {
    if (!coachGameActive) return;
    const loser = coachUserColor() === 'white' ? 'White' : 'Black';
    const winner = loser === 'White' ? 'Black' : 'White';
    // User-initiated — keep it snappy but still buffer with a small beat + animation.
    coachFinishGame(`Resigned — ${winner} wins.`, 350);
  });

  // Coach: flip board
  $('#btn-coach-flip').on('click', function() {
    if (!coachBoard) return;
    coachBoardFlipped = !coachBoardFlipped;
    coachBoard.flip();
    if (coachPracticeSession) saveCoachPracticeState(); else saveCoachState();
  });

  // Coach: take back (undo user move + opponent reply if present)
  $('#btn-coach-takeback').on('click', function() {
    if (!coachMode || !coachGame) return;
    const removedReview = coachLastReview;
    invalidateCoachAsyncWork('The position was taken back.');
    clearPremove();
    // Remove the prior completed-game contribution before allowing this game
    // to end again with a revised score.
    if (coachLifetimeRolledForThisGame) unrollGameFromLifetime();
    coachLifetimeRolledForThisGame = false;
    // A game with a take-back is unrated from here on. A result already rated
    // stands: taking it back must not erase a loss from the rating.
    coachTakebackUsed = true;
    // If the game just ended and the post-game summary is pending, abort it —
    // taking back un-ends the game.
    if (coachSummaryTimer) { clearTimeout(coachSummaryTimer); coachSummaryTimer = null; }
    $('#coach-status').removeClass('status-ended');
    // Undo opponent reply if it was played
    if (coachLastReview && coachGame.fen() !== coachLastReview.fenAfter) {
      coachGame.undo();
    }
    // Undo user move
    coachGame.undo();
    // Roll back stats
    // Unscored ('unknown') reviews never counted, so they must not uncount.
    if (coachLastReview && coachStats && coachLastReview.tier !== 'unknown') {
      coachStats.moves = Math.max(0, coachStats.moves - 1);
      coachStats[coachLastReview.tier] = Math.max(0, (coachStats[coachLastReview.tier] || 0) - 1);
    }
    coachLastReview = null;
    coachThinking = false;
    coachGameActive = true;
    CoachController.setPhase('userTurn');
    coachReviewCursor = null;
    if (coachBoard) coachBoard.position(coachGame.fen());
    coachSyncLastMove();
    updateCapturedDisplay(coachGame.fen());
    // Also remove the rolled-back review from the log so rolling accuracy and
    // the move list's tier coloring reflect the takeback.
    if (coachReviewLog && coachReviewLog.length > 0) coachReviewLog.pop();
    $('#coach-review').hide();
    $('#threats-section').hide();
    $('#candidates-section').hide();
    updateCoachSummary();
    updateMoveList();
    updateOpeningLabel();
    setCoachStatus('Your move. A game with a take-back is unrated.');
    updateCoachControlsState();
    saveCoachState();
    if (removedReview) {
      const insights = loadInsights();
      insights.entries = insights.entries.filter(entry =>
        !(removedReview.insightId && entry.id === removedReview.insightId) &&
        !(removedReview.localGameId && entry.localGameId === removedReview.localGameId && entry.ply === removedReview.ply));
      saveInsights(insights);
      renderInsights();
    }
    coachSync.deleteMove(removedReview).catch(handleCoachDbError);
  });

  // Coach: show why — display the recommended continuation on the main board.
  // The actual game object and review log remain untouched.
  $('#btn-coach-showbest').on('click', function() {
    startCoachReviewAnalysis(coachLastReview);
  });
  $('#btn-coach-showwhy').on('click', function() {
    startCoachReviewAnalysis(coachLastReview);
  });
  $('#btn-coach-consequence').on('click', function() { startCoachConsequenceAnalysis(coachLastReview); });
  $('#btn-coach-review-analysis-prev').on('click', function() { stepCoachReviewAnalysis(-1); });
  $('#btn-coach-review-analysis-next').on('click', function() { stepCoachReviewAnalysis(1); });
  $('#btn-coach-backtogame').on('click', function() {
    clearCoachReviewAnalysis();
    coachGotoLive();
  });

  // Coach: show top-3 candidate moves
  $('#btn-coach-candidates').on('click', function() {
    if (!coachMode || !coachGame) return;
    if (coachIsReviewing()) return;
    showCandidates();
  });

  // Coach: history navigation
  $('#btn-coach-prev').on('click', function() {
    if (!coachGame) return;
    const total = coachGame.history().length;
    const cur = coachReviewCursor === null ? total : coachReviewCursor;
    if (cur > 0) coachGotoPly(cur - 1);
  });
  $('#btn-coach-next').on('click', function() {
    if (!coachGame) return;
    const total = coachGame.history().length;
    const cur = coachReviewCursor === null ? total : coachReviewCursor;
    if (cur < total) coachGotoPly(cur + 1);
  });
  $('#btn-coach-live').on('click', function() {
    if (!coachGame) return;
    coachGotoLive();
  });

  // Generic clipboard helper used by every Copy * button in coach mode.
  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    throw new Error('Clipboard API unavailable');
  }
  // Coach: Copy PGN to clipboard
  $('#btn-coach-copypgn').on('click', async function() {
    const $btn = $(this);
    const pgn = coachGetPgn();
    if (!pgn) return;
    try {
      await copyToClipboard(pgn);
      $btn.addClass('copied').text('Copied!');
      setTimeout(() => $btn.removeClass('copied').text('Copy PGN'), 1500);
    } catch (e) {
      $btn.text('Copy unavailable');
      setTimeout(() => $btn.text('Copy PGN'), 1500);
    }
  });
  // Coach: Copy FEN of the position currently displayed (respects review cursor).
  $('#btn-coach-copyfen').on('click', async function() {
    const $btn = $(this);
    if (!coachGame) return;
    let fen;
    if (coachReviewCursor !== null) {
      // Build a chess.js instance up to the cursor ply to read its FEN.
      const tmp = new Chess(coachStartFen || undefined);
      const sans = coachGame.history();
      for (let i = 0; i < coachReviewCursor && i < sans.length; i++) tmp.move(sans[i]);
      fen = tmp.fen();
    } else {
      fen = coachGame.fen();
    }
    try {
      await copyToClipboard(fen);
      $btn.addClass('copied').text('Copied!');
      setTimeout(() => $btn.removeClass('copied').text('Copy FEN'), 1500);
    } catch (e) {
      $btn.text('Copy unavailable');
      setTimeout(() => $btn.text('Copy FEN'), 1500);
    }
  });

  // Coach: click a ply in the move list to jump to that position.
  $(document).on('click', '#movelist .ply', function() {
    const ply = parseInt($(this).attr('data-ply'), 10);
    if (!isNaN(ply)) coachGotoPly(ply);
  });

  // Coach: click anywhere on the board to cancel a queued premove. Only fires
  // when no drag is in progress (a real drop fires onDrop instead).
  $(document).on('mousedown touchstart', '#coachBoard', function() {
    if (coachPremove) clearPremove();
  });

  // Coach: keyboard shortcuts for history navigation.
  // ← previous ply, → next ply, End returns to the live position. Only
  // fire in coach mode and never while the user is typing in a form field.
  $(document).on('keydown', function(e) {
    if (!coachMode || !coachGame || coachPracticeSession || e.isDefaultPrevented() ||
        $('#summary-overlay, #promotion-picker, #desktop-notice').is(':visible')) return;
    // Ignore if the user is typing (inputs, textareas, contenteditable).
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') {
      const total = coachGame.history().length;
      const cur = coachReviewCursor === null ? total : coachReviewCursor;
      if (cur > 0) { e.preventDefault(); coachGotoPly(cur - 1); }
    } else if (e.key === 'ArrowRight') {
      const total = coachGame.history().length;
      const cur = coachReviewCursor === null ? total : coachReviewCursor;
      if (cur < total) { e.preventDefault(); coachGotoPly(cur + 1); }
    } else if (e.key === 'End') {
      if (coachIsReviewing()) { e.preventDefault(); coachGotoLive(); }
    } else if (e.key === 'Home') {
      if (coachGame.history().length > 0) { e.preventDefault(); coachGotoPly(0); }
    }
  });

  // Summary overlay buttons
  $('#btn-summary-newgame').on('click', function() {
    closeSummaryOverlay();
    startCoachGame();
  });
  $('#btn-summary-practice').on('click', function() {
    const item = summaryPracticeItems[0];
    if (!item) return;
    closeSummaryOverlay();
    startCoachPracticeSession(summaryPracticeItems, item);
  });
  $('#btn-summary-close').on('click', function() {
    closeSummaryOverlay();
  });
  // Reopen the review summary once the game has ended.
  $('#btn-coach-openreview').on('click', function() {
    if (!coachLastEndMsg) return;
    showPostGameSummary(coachLastEndMsg);
  });
  // Copy PGN from within the summary — shares logic with the move-list copy button.
  $('#btn-summary-copypgn').on('click', async function() {
    const $btn = $(this);
    const pgn = coachGetPgn();
    if (!pgn) return;
    try {
      await copyToClipboard(pgn);
      $btn.text('Copied!');
      setTimeout(() => $btn.text('Copy PGN'), 1500);
    } catch (e) {
      $btn.text('Copy unavailable');
      setTimeout(() => $btn.text('Copy PGN'), 1500);
    }
  });
  // Click a critical/best moment to close the overlay and jump to that position.
  $(document).on('click', '.moment-row', function() {
    const ply = parseInt(this.dataset.ply, 10);
    if (!Number.isInteger(ply)) return;
    closeSummaryOverlay();
    coachGotoPly(ply);
    // Surface the "Open review" button so the user can get back to the summary.
    updateCoachControlsState();
  });
  // Allow pressing Escape to dismiss the summary overlay.
  $(document).on('keydown.summary', function(e) {
    const summary = document.getElementById('summary-overlay');
    if (!summary || !$('#summary-overlay').is(':visible')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSummaryOverlay();
    } else {
      trapDialogTab(e, summary);
    }
  });
  }

  function bindExploreEvents() {

  // Explore: database toggle
  $('.db-btn').on('click', function() {
    currentDb = $(this).data('db');
    $('.db-btn').removeClass('active').attr('aria-pressed', 'false');
    $(this).addClass('active').attr('aria-pressed', 'true');
    if (exploreMode) fetchExploreData();
  });

  // Explore: token save
  $('#lichess-token-form').on('submit', function(event) {
    event.preventDefault();
    const token = $('#lichess-token-input').val().trim();
    if (!token) {
      $('#token-error').text('Paste a Lichess token first.').show();
      $('#lichess-token-input').trigger('focus');
      return;
    }
    $('#token-error').hide();
    const $btn = $(this).prop('disabled', true).text('Checking…');
    $.ajax({
      url: 'https://explorer.lichess.ovh/lichess',
      data: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', topGames: 0, recentGames: 0 },
      dataType: 'json',
      headers: { 'Authorization': 'Bearer ' + token },
      success: function() {
        $btn.prop('disabled', false).text('Connect');
        if (!setLichessToken(token)) {
          $('#token-error').text('Could not store token for this tab. Check browser storage settings.').show();
          return;
        }
        showExploreTokenState();
        fetchExploreData();
      },
      error: function(xhr) {
        $btn.prop('disabled', false).text('Connect');
        const msg = xhr.status === 401
          ? 'Invalid token — check you copied it correctly.'
          : (xhr.status === 429 ? LICHESS_RATE_LIMIT_MESSAGE : 'Could not reach Lichess. Try again.');
        $('#token-error').text(msg).show();
      }
    });
  });

  // Explore: disconnect Lichess
  $('#btn-disconnect-lichess').on('click', function() {
    clearLichessToken();
    exploreCache.clear();
    $('#lichess-token-input').val('');
    showExploreTokenState();
  });

  // Explore: undo last move
  $('#btn-explore-undo').on('click', function() {
    if (!exploreMode || !exploreGame) return;
    if (exploreGame.fen() === exploreStartFen) return; // already at start
    exploreGame.undo();
    board.position(exploreGame.fen());
    librarySyncLastMove(exploreGame);
    fetchExploreData();
  });

  // Explore: reset to opening end position (or initial if no opening)
  $('#btn-explore-reset').on('click', function() {
    if (!exploreMode) return;
    exploreGame = new Chess(exploreStartFen);
    board.position(exploreStartFen);
    fetchExploreData();
  });
  }

  function bindGlobalInputEvents() {

  // chessboard.js measures its internal grid at creation time. Re-measure both
  // boards after responsive layout changes so desktop-to-mobile resizing and
  // device rotation cannot leave a 440px grid clipped inside a smaller shell.
  let boardResizeTimer = null;
  $(window).on('resize', function() {
    if (boardResizeTimer) clearTimeout(boardResizeTimer);
    boardResizeTimer = setTimeout(() => {
      boardResizeTimer = null;
      if (board) board.resize();
      if (coachBoard) coachBoard.resize();
      placeDailySprintCard();
      scheduleCoachBoardFit();
      scheduleLibraryBoardFit();
      updateLibraryBoardAccessibility();
      updateCoachBoardAccessibility();
    }, 120);
  });

  // ─── SEARCH ─────────────────────────────
  applySearch = function(q) {
    q = (q || '').trim().toLowerCase();
    const activeCat = $('.cat-tab.active').data('cat') || 'all';
    let visibleCount = 0;
    // When searching, ignore category filter and flatten view
    $('.library > .library-section').each(function() {
      const $sec = $(this);
      let secVisible = 0;
      $sec.find('.opening-btn').each(function() {
        const id = $(this).data('id');
        const op = OPENINGS.find(o => o.id === id);
        const hay = (($(this).text() || '') + ' ' + (op ? op.moves.join(' ') : '')).toLowerCase();
        const matchesQuery = !q || hay.includes(q);
        const matchesCat = q ? true : (activeCat === 'all' || op?.category === activeCat);
        const show = matchesQuery && matchesCat;
        $(this).toggle(show);
        if (show) { secVisible++; visibleCount++; }
      });
      $sec.toggle(secVisible > 0);
    });
    $('#library-empty').toggle(visibleCount === 0);
    $('.cat-tabs').toggle(!q);
    // Hide the SR due section while searching
    if (q) $('#sr-due-section').hide();
    else updateSRSidebar();
  };
  $('#library-search-input').on('input', function() { applySearch($(this).val()); });

  // ─── SHARE LINK ─────────────────────────
  $('#btn-share').on('click', function() {
    const $btn = $(this);
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      const original = $btn.text();
      $btn.text('Copy unavailable');
      setTimeout(() => $btn.text(original), 1500);
      return;
    }
    navigator.clipboard.writeText(location.href).then(() => {
      const orig = $btn.text();
      $btn.text('Copied ✓').addClass('copied');
      setTimeout(() => $btn.text(orig).removeClass('copied'), 1500);
    }).catch(() => {
      const original = $btn.text();
      $btn.text('Copy unavailable');
      setTimeout(() => $btn.text(original), 1500);
    });
  });

  // ─── KEYBOARD SHORTCUTS ─────────────────
  $(document).on('keydown', function (e) {
    if (e.isDefaultPrevented() || $('#summary-overlay').is(':visible') || $('#desktop-notice').is(':visible')) return;
    if ($('#promotion-picker').is(':visible')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePromotionPicker();
        return;
      }
      trapDialogTab(e, document.getElementById('promotion-picker'));
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Puzzles handles its own shortcuts (puzzles.js).
    if (appView === 'puzzles') return;

    // In coach view, only handle the flip shortcut; everything else is scoped to library
    // Coach: F flips; arrows step through the game like the nav buttons,
    // Home goes to the first position and End back to live.
    if (coachMode) {
      const usable = id => { const $b = $(id); return $b.length && $b.is(':visible') && !$b.prop('disabled'); };
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        $('#btn-coach-flip').trigger('click');
      } else if (e.key === 'ArrowLeft' && usable('#btn-coach-prev')) {
        e.preventDefault();
        $('#btn-coach-prev').trigger('click');
      } else if (e.key === 'ArrowRight' && usable('#btn-coach-next')) {
        e.preventDefault();
        $('#btn-coach-next').trigger('click');
      } else if (e.key === 'Home' && usable('#btn-coach-prev') && coachGame && coachGame.history().length) {
        e.preventDefault();
        coachGotoPly(0);
      } else if (e.key === 'End' && usable('#btn-coach-live')) {
        e.preventDefault();
        $('#btn-coach-live').trigger('click');
      }
      return;
    }

    // Arrow keys: prev/next in study mode
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (quizMode || exploreMode) return;
      e.preventDefault();
      if (!$('#btn-next').prop('disabled')) goToMove(currentMoveIdx + 1);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (quizMode || exploreMode) return;
      e.preventDefault();
      if (!$('#btn-prev').prop('disabled')) goToMove(currentMoveIdx - 1);
      return;
    }

    const k = e.key.toLowerCase();
    // Focus search
    if (k === '/' ) { e.preventDefault(); $('#library-search-input').trigger('focus').select(); return; }
    // Flip board
    if (k === 'f') {
      if (!currentOpening && !exploreMode) return;
      e.preventDefault();
      if (exploreMode) { boardFlipped = !boardFlipped; board.flip(); return; }
      $('#btn-flip').trigger('click');
      return;
    }
    // Reset
    if (k === 'r') {
      e.preventDefault();
      if (exploreMode) { $('#btn-explore-reset').trigger('click'); return; }
      if (quizMode) { setMode('quiz'); return; }
      if (currentOpening) goToMove(-1);
      return;
    }
    // Mode switch: 1=Study, 2=Quiz, 3=Explore
    if (k === '1') { e.preventDefault(); setMode('study'); return; }
    if (k === '2') { if (currentOpening) { e.preventDefault(); setMode('quiz'); } return; }
    if (k === '3') { e.preventDefault(); setMode('explore'); return; }
  });

  // ─── TAP-TO-MOVE (mobile) ───────────────
  function clearTapSelection() {
    $('.square-55d63').removeClass('tap-selected tap-target');
    tapSelected = null;
  }
  $(document).on('click', '#myBoard .square-55d63', function(e) {
    // Only intercept taps in interactive modes (study has no interaction)
    if (!quizMode && !exploreMode) return;
    // If the drop already happened (pointerup after drag), chessboard will have already moved — don't interfere
    const sq = $(this).data('square');
    if (!sq) return;
    const activeGame = exploreMode ? exploreGame : game;
    if (!activeGame) return;

    if (tapSelected && tapSelected !== sq) {
      // Attempt move
      if (exploreMode) {
        const from = tapSelected;
        if (requestPromotionChoice(exploreGame, from, sq, promotion => {
          applyExploreMove(from, sq, promotion, { updateBoard: true });
        }, true)) {
          clearTapSelection();
          return;
        }
        applyExploreMove(from, sq, 'q', { updateBoard: true });
      } else {
        // Quiz: delegate to handleDrop to reuse validation logic
        const result = handleDrop(tapSelected, sq);
        if (result !== 'snapback') {
          // handleDrop already updated game; update board position
          board.position(game.fen());
          librarySyncLastMove(game);
        }
      }
      clearTapSelection();
    } else if (tapSelected === sq) {
      clearTapSelection();
    } else {
      // Select source if it has a piece of the side to move
      const piece = activeGame.get(sq);
      if (!piece) return;
      const turn = activeGame.turn(); // 'w' or 'b'
      if (piece.color !== turn) return;
      clearTapSelection();
      tapSelected = sq;
      $(this).addClass('tap-selected');
      // Highlight legal target squares
      const moves = activeGame.moves({ square: sq, verbose: true });
      moves.forEach(m => $('.square-' + m.to).addClass('tap-target'));
    }
  });

  // Coach board: tap-to-move (scoped to #coachBoard)
  $(document).on('click', '#coachBoard .square-55d63', function() {
    if (!coachMode || !coachGameActive || !coachGame || coachIsReviewing()) return;
    const sq = $(this).data('square');
    if (!sq) return;
    if (tapSelected && tapSelected !== sq) {
      const from = tapSelected;
      if (requestPromotionChoice(coachGame, from, sq, promotion => {
        coachHandleUserMove(from, sq, promotion, { updateBoard: true }).then(() => {
          if (coachBoard) coachBoard.position(coachGame.fen());
        });
      }, true)) {
        clearTapSelection();
        return;
      }
      coachHandleUserMove(from, sq, 'q', { updateBoard: true }).then(() => {
        if (coachBoard) coachBoard.position(coachGame.fen());
      });
      clearTapSelection();
    } else if (tapSelected === sq) {
      clearTapSelection();
    } else {
      const piece = coachGame.get(sq);
      if (!piece) return;
      if (piece.color !== coachGame.turn()) return;
      if (!coachIsUserTurn()) return;
      clearTapSelection();
      tapSelected = sq;
      $(this).addClass('tap-selected');
      const moves = coachGame.moves({ square: sq, verbose: true });
      moves.forEach(m => $('.square-' + m.to).addClass('tap-target'));
    }
  });

  // ─── SWIPE FOR PREV/NEXT (mobile, study only) ───
  let touchStartX = null;
  let touchStartY = null;
  $('.board-area').on('touchstart', function(e) {
    if (quizMode || exploreMode) return;
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  });
  $('.board-area').on('touchend', function(e) {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = touchStartY = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (quizMode || exploreMode) return;
    if (dx < 0) { if (!$('#btn-next').prop('disabled')) goToMove(currentMoveIdx + 1); }
    else { if (!$('#btn-prev').prop('disabled')) goToMove(currentMoveIdx - 1); }
  });
  }

  // ─── SR SIDEBAR INIT ────────────────────
  function hydrateFromUrl() {

  // ─── HYDRATE FROM URL ───────────────────
  const initial = readURL();
  if (initial.view === 'coach') {
    switchView('coach');
  } else if (initial.view === 'puzzles') {
    if (window.PuzzlesView) window.PuzzlesView.setInitialMode(initial.mode);
    switchView('puzzles');
  } else if (initial.opening) {
    const op = OPENINGS.find(o => o.id === initial.opening);
    if (op) {
      loadOpening(op.id, initial.line || 'main');
      if (initial.mode === 'quiz') setMode('quiz');
      else if (initial.mode === 'explore') setMode('explore');
      else if (!isNaN(initial.move) && initial.move >= 0) goToMove(initial.move);
    }
  } else if (initial.view === 'library') {
    switchView('library');
    if (initial.mode === 'explore') setMode('explore');
  } else if (initial.mode === 'explore') {
    switchView('library');
    setMode('explore');
  } else {
    // Coach is the app's home: make the default explicit so direct visits,
    // reloads, and clients with no prior URL state all start there.
    switchView('coach');
  }
  }

  bindLibraryEvents();
  bindCoachEvents();
  bindExploreEvents();
  bindGlobalInputEvents();
  placeDailySprintCard();
  initCoachWorkspaceLayout();
  initLibraryWorkspaceLayout();
  updateSRSidebar();
  validateOpeningData();
  hydrateFromUrl();
  updateNetworkStatus(false);
  window.addEventListener('offline', () => updateNetworkStatus(false));
  window.addEventListener('online', () => updateNetworkStatus(true));
});
