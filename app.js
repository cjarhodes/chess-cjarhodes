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
let tapSelected = null;      // square selected for tap-to-move, or null
let pendingPromotionChoice = null;
let promotionReturnFocus = null;
let summaryReturnFocus = null;

// Coach mode (standalone page)
let appView = 'library';           // 'library' | 'coach'
let coachMode = false;             // true when coach view is active
let coachGame = null;
let coachStartFen = null;
let coachStats = null;
let coachReviewLog = [];           // all reviews from current session (for summary turning point)
let coachLastReview = null;        // most recent review (for take back / show best)
let coachThinking = false;
let coachUserSide = 'white';       // 'white' | 'black'
let coachEngineElo = 1200;         // displayed opponent level
let coachBoard = null;             // separate Chessboard.js instance
let coachBoardFlipped = false;
let coachGameActive = false;       // true once user hits New Game
let coachGameGeneration = 0;       // invalidates async work from replaced/rewound games
let coachLocalGameId = null;       // stable id for idempotent local lifetime rollups
let coachEndedAt = null;           // timestamp of game end, null while playing
let coachReviewCursor = null;      // null = live; integer = ply index displayed on the board
let coachLastEndMsg = null;        // headline from last game-over, used to reopen the review
let candidateRequestId = 0;        // invalidates stale async candidate searches
let threatRequestId = 0;           // invalidates stale async threat scans
let coachPremove = null;           // queued premove while opponent is thinking
let coachPracticeSession = null;   // active mistake-position drill, separate from normal games
let coachPracticeRun = null;       // ordered multi-drill session and its aggregate result
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
let remoteGameUpdateTimer = null;
let pendingRemoteGameEndReason = null;
let pendingRemoteGameGeneration = null;
const REMOTE_GAME_SYNC_DEBOUNCE_MS = 2500;

const CoachController = {
  phase: 'idle',
  setPhase(phase) {
    this.phase = phase;
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
// COACH GAME PERSISTENCE
// ─────────────────────────────────────────────
// Snapshot enough state to restore an in-progress (or freshly ended) game on
// next page load. Saved on every move; cleared when the user starts a new
// game or dismisses the review summary after a game ends.
const COACH_STATE_KEY = 'coach:state:v1';
const COACH_STATE_BACKUP_KEY = 'coach:state:corrupt:v1';

function createCoachGameId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveCoachState() {
  try {
    if (!coachGame) return;
    // Practice attempts have their own persistence model and must never be
    // restored as unfinished rated games.
    if (coachPracticeSession) return;
    const total = coachGame.history().length;
    // Skip persisting empty initial state — nothing to recover.
    if (total === 0 && !coachLastEndMsg && !coachRemoteGameId) {
      localStorage.removeItem(COACH_STATE_KEY);
      return;
    }
    const snapshot = {
      v: 1,
      pgn: coachGame.pgn(),
      startFen: coachStartFen,
      userSide: coachUserSide,
      engineElo: coachEngineElo,
      localGameId: coachLocalGameId,
      remoteGameId: coachRemoteGameId,
      reviewLog: coachReviewLog,
      stats: coachStats,
      ended: !coachGameActive,
      lastEndMsg: coachLastEndMsg,
      ts: Date.now()
    };
    localStorage.setItem(COACH_STATE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    // Quota exceeded or storage blocked — fail silently; not critical.
  }
}
function loadCoachState() {
  let raw = null;
  try {
    raw = localStorage.getItem(COACH_STATE_KEY);
    if (!raw) return { ok: false, missing: true };
    const s = JSON.parse(raw);
    if (!s || s.v !== 1) {
      return { ok: false, reason: 'Saved game format is no longer supported.', raw };
    }
    return { ok: true, state: s, raw };
  } catch (e) {
    return { ok: false, reason: 'Saved game data was unreadable.', raw };
  }
}
function clearCoachState() {
  try { localStorage.removeItem(COACH_STATE_KEY); } catch (e) {}
}
function backupCorruptCoachState(raw, reason) {
  if (!raw) return;
  try {
    localStorage.setItem(COACH_STATE_BACKUP_KEY, JSON.stringify({
      raw,
      reason: reason || 'Unknown restore failure',
      ts: Date.now()
    }));
  } catch (e) {}
}

// Restore a saved game (in-progress or just-ended) into the coach UI.
// Returns true if a game was restored, false otherwise. Callers should fall
// back to the empty-board "set a level" state when this returns false.
function tryRestoreCoachGame() {
  const loaded = loadCoachState();
  if (!loaded.ok) {
    if (loaded.missing) return { restored: false };
    backupCorruptCoachState(loaded.raw, loaded.reason);
    clearCoachState();
    return { restored: false, warning: 'Previous game could not be restored; starting fresh.' };
  }
  const s = loaded.state;
  try {
    const g = new Chess(s.startFen || undefined);
    if (s.pgn) g.load_pgn(s.pgn, { sloppy: true });
    coachGame = g;
    coachStartFen = s.startFen || g.fen();
    coachGameGeneration++;
    coachLocalGameId = s.localGameId || createCoachGameId();
    coachUserSide = s.userSide || 'white';
    coachEngineElo = typeof s.engineElo === 'number' ? s.engineElo : 1200;
    coachRemoteGameId = s.remoteGameId || null;
    coachReviewLog = Array.isArray(s.reviewLog) ? s.reviewLog : [];
    coachStats = s.stats || { moves: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    coachLastReview = coachReviewLog.length ? coachReviewLog[coachReviewLog.length - 1] : null;
    coachReviewCursor = null;
    coachThinking = false;
    coachLastEndMsg = s.lastEndMsg || null;
    coachGameActive = !s.ended && !g.game_over();
    coachEndedAt = s.ended ? (s.ts || Date.now()) : null;
    // If we're restoring an ended game, lifetime totals were already rolled
    // when the game ended — don't double-count if the user opens the review.
    coachLifetimeRolledForThisGame = !!s.ended;
    if (s.ended) registerRestoredLifetimeRollup();
    // Sync slider + tier label.
    $('#coach-strength').val(coachEngineElo);
    $('#coach-strength-value').text(coachEngineElo);
    $('#coach-strength-tier').text(strengthTierLabel(coachEngineElo));
    // Sync side toggle.
    $('.side-toggle button').removeClass('active');
    $('.side-toggle button').attr('aria-pressed', 'false');
    $('.side-toggle button[data-side="' + coachUserSide + '"]').addClass('active').attr('aria-pressed', 'true');
    // Build the board oriented for the user.
    coachBoardFlipped = (coachUserColor() === 'black');
    createCoachBoard(g.fen(), coachBoardFlipped ? 'black' : 'white');
    $('#coach-view').addClass('game-active');
    // Repopulate panels.
    updateCapturedDisplay(g.fen());
    updateMoveList();
    updateOpeningLabel();
    updateCoachSummary();
    updateCoachControlsState();
    // Status: live game vs ended game.
    if (coachGameActive) {
      const tier = strengthTierLabel(coachEngineElo);
      setCoachStatus(coachIsUserTurn()
        ? `Resumed — Opponent ${coachEngineElo} (${tier}). Your move.`
        : `Resumed — Opponent ${coachEngineElo} (${tier}). Opponent thinking…`);
      // Re-render last review card if we have one.
      if (coachLastReview) renderCoachReview(coachLastReview);
      // Pre-warm the engine and hand off to the opponent if it's their turn.
      const timed = Promise.race([
        engineClient.init(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Engine load timed out')), 15000))
      ]);
      const generation = coachGameGeneration;
      timed.then(() => {
        if (generation !== coachGameGeneration || !coachGameActive) return;
        if (!coachIsUserTurn() && !g.game_over()) coachOpponentRespond();
      }).catch((err) => {
        if (generation !== coachGameGeneration || isAbortError(err)) return;
        showEngineLoadError(err);
      });
    } else {
      // Game is over — show a status that nudges towards reopening the review.
      setCoachStatus((coachLastEndMsg || 'Game over.') + ' Click Open review to revisit.');
      if (coachLastReview) renderCoachReview(coachLastReview);
    }
    return { restored: true };
  } catch (e) {
    // Corrupted snapshot — drop it so the user gets a fresh start next time.
    backupCorruptCoachState(loaded.raw, e && e.message);
    clearCoachState();
    return { restored: false, warning: 'Previous game could not be restored; starting fresh.' };
  }
}

// ─────────────────────────────────────────────
// LIFETIME STATS — accumulate across games in this browser
// ─────────────────────────────────────────────
const LIFETIME_KEY = 'coach:lifetime:v1';
function emptyLifetime() {
  return { games: 0, moves: 0, accuracySum: 0, blunders: 0, mistakes: 0,
           inaccuracies: 0, best: 0, excellent: 0, good: 0, rollups: {} };
}
function loadLifetime() {
  try {
    const raw = localStorage.getItem(LIFETIME_KEY);
    if (!raw) return emptyLifetime();
    const v = JSON.parse(raw);
    const merged = Object.assign(emptyLifetime(), v || {});
    if (!merged.rollups || typeof merged.rollups !== 'object' || Array.isArray(merged.rollups)) {
      merged.rollups = {};
    }
    return merged;
  } catch (e) { return emptyLifetime(); }
}
function saveLifetime(s) {
  try { localStorage.setItem(LIFETIME_KEY, JSON.stringify(s)); } catch (e) {}
}
// Roll the just-finished game into lifetime totals. Idempotent guard via a
// per-game flag so a refresh on the summary screen doesn't double-count.
let coachLifetimeRolledForThisGame = false;

function lifetimeContribution() {
  if (!coachStats || coachStats.moves === 0) return null;
  const accuracy = accuracyFromTallies(coachStats, coachStats.moves);
  return {
    games: 1,
    moves: coachStats.moves,
    accuracySum: accuracy === null ? 0 : accuracy * coachStats.moves,
    best: coachStats.best || 0,
    excellent: coachStats.excellent || 0,
    good: coachStats.good || 0,
    inaccuracies: coachStats.inaccuracy || 0,
    mistakes: coachStats.mistake || 0,
    blunders: coachStats.blunder || 0
  };
}

function applyLifetimeContribution(lifetime, contribution, direction) {
  if (!contribution) return;
  for (const key of ['games', 'moves', 'accuracySum', 'best', 'excellent', 'good', 'inaccuracies', 'mistakes', 'blunders']) {
    lifetime[key] = Math.max(0, (lifetime[key] || 0) + direction * (contribution[key] || 0));
  }
}

function rollGameIntoLifetime() {
  if (coachLifetimeRolledForThisGame) return;
  const contribution = lifetimeContribution();
  if (!contribution) return;
  if (!coachLocalGameId) coachLocalGameId = createCoachGameId();
  const lt = loadLifetime();
  const previous = lt.rollups[coachLocalGameId];
  if (previous) applyLifetimeContribution(lt, previous, -1);
  applyLifetimeContribution(lt, contribution, 1);
  lt.rollups[coachLocalGameId] = contribution;
  saveLifetime(lt);
  coachLifetimeRolledForThisGame = true;
  renderLifetime();
}

function unrollGameFromLifetime() {
  if (!coachLocalGameId) return;
  const lt = loadLifetime();
  const previous = lt.rollups[coachLocalGameId];
  if (!previous) return;
  applyLifetimeContribution(lt, previous, -1);
  delete lt.rollups[coachLocalGameId];
  saveLifetime(lt);
  renderLifetime();
}

function registerRestoredLifetimeRollup() {
  if (!coachLocalGameId) return;
  const contribution = lifetimeContribution();
  if (!contribution) return;
  const lt = loadLifetime();
  if (lt.rollups[coachLocalGameId]) return;
  // Older saved games predate per-game rollups, but their contribution was
  // already added to the aggregate at game end. Register it without adding
  // again so a subsequent takeback can reverse it exactly once.
  lt.rollups[coachLocalGameId] = contribution;
  saveLifetime(lt);
}
function renderLifetime() {
  const lt = loadLifetime();
  const $sec = $('#lifetime-section');
  if (lt.games === 0) { $sec.hide(); return; }
  $sec.show();
  $('#lifetime-games').text(lt.games);
  $('#lifetime-moves').text(lt.moves);
  const acc = lt.moves > 0 ? Math.round(lt.accuracySum / lt.moves) : null;
  $('#lifetime-accuracy').text(acc === null ? '—' : acc + '%');
  $('#lifetime-blunders').text(lt.blunders);
}

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
    const raw = localStorage.getItem(INSIGHTS_KEY);
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
    localStorage.setItem(INSIGHTS_KEY, JSON.stringify(safe));
  } catch (e) {}
}

function clearInsights() {
  try { localStorage.removeItem(INSIGHTS_KEY); } catch (e) {}
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
    if (bestMove && bestMove.captured && userMove.to === bestMove.from && loss >= 100) add('missed_recapture');
    if (phase === 'endgame' && loss >= 120) add('endgame_technique');
  }

  if (tags.length === 0 && phase === 'opening' && loss >= 120) add('opening_principles');
  if (tags.length === 0) add('candidate_moves');
  return tags.slice(0, 3);
}

function currentCoachOpeningName() {
  try {
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
  return {
    ts: Date.now(),
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
    opening: currentCoachOpeningName()
  };
}

function recordCoachInsight(review) {
  if (!review || !review.tier || review.tier === 'unknown') return;
  review.insightTags = review.insightTags || insightTagsForReview(review);
  const state = loadInsights();
  state.entries.push(insightEntryFromReview(review));
  saveInsights(state);
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

const PRACTICE_QUEUE_LIMIT = 10;

function buildPracticeQueue(entries, counts) {
  const used = new Set();
  const keyForEntry = entry => (entry.id || entry.ts || entry.ply || '') + ':' + entry.fenBefore;
  const rankedTags = (counts || []).map(c => c.tag);
  const sorted = (entries || [])
    .filter(e => e && isInsightProblem(e.tier) && e.fenBefore && e.bestUci)
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const queue = [];

  for (const tag of rankedTags) {
    const entry = sorted.find(e => (e.tags || []).includes(tag) && !used.has(tag));
    if (!entry) continue;
    const key = keyForEntry(entry);
    if (used.has(key)) continue;
    used.add(tag);
    used.add(key);
    queue.push({ entry, tag });
    if (queue.length >= PRACTICE_QUEUE_LIMIT) break;
  }

  for (const entry of sorted) {
    if (queue.length >= PRACTICE_QUEUE_LIMIT) break;
    const tag = insightTagForEntry(entry);
    const key = keyForEntry(entry);
    if (used.has(key)) continue;
    used.add(key);
    queue.push({ entry, tag });
  }
  return queue;
}

function practiceItemsForEntries(entries, counts) {
  return buildPracticeQueue(entries, counts).map(item => {
    const meta = INSIGHT_TAG_META[item.tag] || INSIGHT_TAG_META.candidate_moves;
    return Object.assign(item, {
      id: practiceItemId(item.entry, item.tag),
      meta
    });
  });
}

function currentGameDuePracticeItems() {
  const entries = (coachReviewLog || [])
    .filter(review => review && isInsightProblem(review.tier))
    .map(insightEntryFromReview);
  return practiceItemsForEntries(entries, insightTagCounts(entries))
    .filter(item => practiceIsDue(item));
}

function formatPracticeContext(entry) {
  const ref = formatMoveRef(entry);
  const played = entry.userSan ? `You played ${entry.userSan}.` : 'Review the candidate moves.';
  const opening = entry.opening ? ` ${entry.opening}.` : '';
  return `${ref}: ${played}${opening}`;
}

const PRACTICE_PROGRESS_KEY = 'coach:practice:v2';
const LEGACY_PRACTICE_PROGRESS_KEY = 'coach:practice:v1';
const PRACTICE_EVENT_LIMIT = 2000;
const practiceRemoteSyncChains = new Map();

function emptyPracticeProgress() {
  return { v: 2, records: {}, events: [] };
}

function activePracticeOwnerId() {
  return coachAuthUser && coachAuthUser.id ? coachAuthUser.id : null;
}

function practiceProgressStorageKey(ownerId = activePracticeOwnerId()) {
  return ownerId ? `${PRACTICE_PROGRESS_KEY}:${ownerId}` : PRACTICE_PROGRESS_KEY;
}

function loadPracticeProgress(ownerId = activePracticeOwnerId()) {
  try {
    const currentRaw = localStorage.getItem(practiceProgressStorageKey(ownerId));
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw);
      if (parsed && parsed.v === 2 && parsed.records && typeof parsed.records === 'object') {
        return {
          v: 2,
          records: parsed.records,
          events: Array.isArray(parsed.events) ? parsed.events.slice(-PRACTICE_EVENT_LIMIT) : []
        };
      }
    }
    const legacy = ownerId ? null : JSON.parse(localStorage.getItem(LEGACY_PRACTICE_PROGRESS_KEY));
    if (legacy && legacy.v === 1 && legacy.records && typeof legacy.records === 'object') {
      return { v: 2, records: legacy.records, events: [] };
    }
    return emptyPracticeProgress();
  } catch (e) {
    return emptyPracticeProgress();
  }
}

function savePracticeProgress(state, ownerId = activePracticeOwnerId()) {
  try {
    localStorage.setItem(practiceProgressStorageKey(ownerId), JSON.stringify({
      v: 2,
      records: state.records || {},
      events: (state.events || []).slice(-PRACTICE_EVENT_LIMIT)
    }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function clearPracticeProgress() {
  try {
    const ownerId = activePracticeOwnerId();
    localStorage.removeItem(practiceProgressStorageKey(ownerId));
    if (!ownerId) localStorage.removeItem(LEGACY_PRACTICE_PROGRESS_KEY);
  } catch (e) {}
}

function adoptAnonymousPracticeProgress(ownerId) {
  if (!ownerId) return;
  const anonymous = loadPracticeProgress(null);
  const hasAnonymousData = Object.keys(anonymous.records).length || anonymous.events.length;
  if (!hasAnonymousData) return;

  const account = loadPracticeProgress(ownerId);
  Object.entries(anonymous.records).forEach(([drillId, record]) => {
    const existing = account.records[drillId];
    const recordIsNewer = !existing ||
      (record.lastAttemptAt || 0) > (existing.lastAttemptAt || 0) ||
      ((record.lastAttemptAt || 0) === (existing.lastAttemptAt || 0) &&
       (record.attempts || 0) > (existing.attempts || 0));
    if (recordIsNewer) account.records[drillId] = record;
  });

  const eventIds = new Set(account.events.map(event => event.id));
  anonymous.events.forEach(event => {
    if (!event || !event.id || eventIds.has(event.id)) return;
    account.events.push(Object.assign({}, event, {
      ownerId,
      synced: false
    }));
    eventIds.add(event.id);
  });
  const adopted = savePracticeProgress(account, ownerId);
  if (!adopted.ok) return;
  try {
    localStorage.removeItem(PRACTICE_PROGRESS_KEY);
    localStorage.removeItem(LEGACY_PRACTICE_PROGRESS_KEY);
  } catch (e) {}
}

function hashPracticeValue(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function practiceItemId(entry, tag) {
  return 'drill-' + hashPracticeValue(`${entry.fenBefore}|${entry.bestUci}|${tag}`);
}

function practiceRecordFor(item) {
  return loadPracticeProgress().records[item.id] || null;
}

function practiceIsDue(item, now = Date.now()) {
  const record = practiceRecordFor(item);
  return !record || !record.dueAt || record.dueAt <= now;
}

function practiceProgressTotals() {
  const records = Object.values(loadPracticeProgress().records);
  return records.reduce((totals, record) => {
    totals.attempts += record.attempts || 0;
    totals.correct += record.correct || 0;
    if ((record.reps || 0) >= 3) totals.mastered += 1;
    return totals;
  }, { attempts: 0, correct: 0, mastered: 0 });
}

function practiceDayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function practiceTrendSnapshot(now = Date.now()) {
  const events = loadPracticeProgress().events.filter(event => Number.isFinite(event.at));
  const dayMs = DAY_MS;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const currentStart = today.getTime() - 6 * dayMs;
  const previousStart = currentStart - 7 * dayMs;
  const current = events.filter(event => event.at >= currentStart);
  const previous = events.filter(event => event.at >= previousStart && event.at < currentStart);
  const summarize = list => ({
    attempts: list.length,
    correct: list.filter(event => event.correct).length
  });
  const currentTotals = summarize(current);
  const previousTotals = summarize(previous);
  const currentRate = currentTotals.attempts
    ? Math.round(currentTotals.correct / currentTotals.attempts * 100)
    : null;
  const previousRate = previousTotals.attempts
    ? Math.round(previousTotals.correct / previousTotals.attempts * 100)
    : null;

  const activeDays = new Set(events.map(event => practiceDayKey(event.at)));
  let streak = 0;
  const cursor = new Date(today);
  if (!activeDays.has(practiceDayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (activeDays.has(practiceDayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const days = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = practiceDayKey(date.getTime());
    const dayEvents = current.filter(event => practiceDayKey(event.at) === key);
    days.push({
      key,
      label: date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2),
      attempts: dayEvents.length,
      correct: dayEvents.filter(event => event.correct).length
    });
  }

  const tagStats = {};
  events.filter(event => event.at >= today.getTime() - 13 * dayMs).forEach(event => {
    const tag = event.tag || 'candidate_moves';
    if (!tagStats[tag]) tagStats[tag] = { tag, attempts: 0, correct: 0 };
    tagStats[tag].attempts += 1;
    if (event.correct) tagStats[tag].correct += 1;
  });
  const focus = Object.values(tagStats)
    .sort((a, b) =>
      (b.attempts - b.correct) - (a.attempts - a.correct) ||
      b.attempts - a.attempts
    )[0] || null;

  return {
    attempts: currentTotals.attempts,
    rate: currentRate,
    previousRate,
    streak,
    days,
    focus
  };
}

function renderPracticeTrends() {
  const trend = practiceTrendSnapshot();
  $('#practice-progress-week').text(trend.attempts);
  $('#practice-progress-streak').text(trend.streak + 'd');
  const comparison = trend.rate === null
    ? 'No attempts in the last 7 days.'
    : trend.previousRate === null
      ? `${trend.rate}% success this week — your first trend baseline.`
      : `${trend.rate}% success this week, ${trend.rate - trend.previousRate >= 0 ? '+' : ''}${trend.rate - trend.previousRate} points vs the prior week.`;
  const focus = trend.focus && INSIGHT_TAG_META[trend.focus.tag]
    ? ` Focus next: ${INSIGHT_TAG_META[trend.focus.tag].title}.`
    : '';
  $('#practice-trend-summary').text(comparison + focus);

  const maxAttempts = Math.max(1, ...trend.days.map(day => day.attempts));
  const $bars = $('#practice-trend-bars').empty();
  trend.days.forEach(day => {
    const height = day.attempts ? Math.max(12, Math.round(day.attempts / maxAttempts * 100)) : 4;
    const success = day.attempts ? Math.round(day.correct / day.attempts * 100) : 0;
    const $day = $('<div class="practice-trend-day"></div>')
      .attr('aria-label', `${day.label}: ${day.attempts} attempt${day.attempts === 1 ? '' : 's'}, ${success}% success`);
    $day.append(
      $('<span class="practice-trend-bar"></span>')
        .css('--bar-height', height + '%')
        .css('--bar-success', success + '%')
    );
    $day.append($('<span class="practice-trend-label"></span>').text(day.label));
    $bars.append($day);
  });
}

function practiceEventId() {
  return createCoachGameId();
}

function practiceEventFromAttempt(item, correct, revealed, at) {
  return {
    id: practiceEventId(),
    ownerId: activePracticeOwnerId(),
    drillId: item.id,
    sourceMoveId: item.entry.id || null,
    tag: item.tag,
    fen: item.entry.fenBefore,
    bestUci: item.entry.bestUci,
    bestSan: item.entry.bestSan || null,
    prompt: item.meta.practice,
    at,
    correct: !!correct,
    revealed: !!revealed,
    result: correct ? (revealed ? 'assisted' : 'correct') : 'incorrect',
    synced: false
  };
}

function nextPracticeInterval(record, clean) {
  if (!clean) return 0;
  if (record.reps <= 1) return 1;
  if (record.reps === 2) return 3;
  return Math.max(4, Math.round((record.intervalDays || 3) * (record.ease || 2.5)));
}

function recordPracticeAttempt(item, correct, revealed) {
  const state = loadPracticeProgress();
  const now = Date.now();
  const event = practiceEventFromAttempt(item, correct, revealed, now);
  const previous = state.records[item.id] || {
    attempts: 0, correct: 0, reps: 0, ease: 2.5, intervalDays: 0, dueAt: 0
  };
  const record = Object.assign({}, previous);
  record.attempts += 1;
  record.lastAttemptAt = now;
  record.lastResult = correct ? (revealed ? 'assisted' : 'correct') : 'incorrect';
  if (correct) {
    record.correct += 1;
    record.reps += 1;
    record.ease = Math.max(1.3, record.ease + (revealed ? -0.05 : 0.08));
    record.intervalDays = nextPracticeInterval(record, true);
    record.dueAt = now + record.intervalDays * DAY_MS;
  } else {
    record.reps = 0;
    record.ease = Math.max(1.3, record.ease - 0.2);
    record.intervalDays = 0;
    record.dueAt = now;
  }
  state.records[item.id] = record;
  state.events.push(event);
  const saved = savePracticeProgress(state);
  if (!saved.ok) setCoachStatus('Practice result could not be saved in this browser.');
  queueRemotePracticeProgressSync(event);
  return record;
}

function markPracticeEventSynced(eventId, ownerId = activePracticeOwnerId()) {
  const state = loadPracticeProgress(ownerId);
  const event = state.events.find(item => item.id === eventId);
  if (!event || event.synced) return;
  event.synced = true;
  savePracticeProgress(state, ownerId);
}

function queueRemotePracticeProgressSync(event) {
  if (!hasCoachDbSession() || !event) return;
  const previous = practiceRemoteSyncChains.get(event.drillId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => syncRemotePracticeEvent(event))
    .catch(handleCoachDbError)
    .finally(() => {
      if (practiceRemoteSyncChains.get(event.drillId) === next) {
        practiceRemoteSyncChains.delete(event.drillId);
      }
    });
  practiceRemoteSyncChains.set(event.drillId, next);
}

function mergeRemotePracticeRecords(rows, ownerId = activePracticeOwnerId()) {
  if (!Array.isArray(rows) || !rows.length) return;
  const state = loadPracticeProgress(ownerId);
  let changed = false;
  rows.forEach(row => {
    if (!row || !row.fen || !row.best_uci || !row.tag) return;
    const id = row.drill_key || practiceItemId({ fenBefore: row.fen, bestUci: row.best_uci }, row.tag);
    const local = state.records[id];
    const remoteAttemptAt = row.last_attempt_at ? Date.parse(row.last_attempt_at) : 0;
    if (local && (local.lastAttemptAt || 0) > remoteAttemptAt) return;
    state.records[id] = Object.assign({}, local || {}, {
      reps: row.reps || 0,
      ease: Number(row.ease) || 2.5,
      intervalDays: row.interval_days || 0,
      dueAt: row.due_at ? Date.parse(row.due_at) : 0,
      attempts: row.attempts || 0,
      correct: row.correct || 0,
      lastResult: row.last_result || null,
      lastAttemptAt: remoteAttemptAt,
      remoteUpdatedAt: row.updated_at ? Date.parse(row.updated_at) : 0
    });
    changed = true;
  });
  if (changed) savePracticeProgress(state, ownerId);
}

function mergeRemotePracticeEvents(rows, ownerId = activePracticeOwnerId()) {
  if (!Array.isArray(rows) || !rows.length) return;
  const state = loadPracticeProgress(ownerId);
  const byId = new Map(state.events.map(event => [event.id, event]));
  let changed = false;
  rows.forEach(row => {
    if (!row || !row.id || !row.drill_key || !row.attempted_at) return;
    const existing = byId.get(row.id);
    if (existing) {
      if (!existing.synced) {
        existing.synced = true;
        changed = true;
      }
      return;
    }
    const event = {
      id: row.id,
      ownerId,
      drillId: row.drill_key,
      sourceMoveId: row.source_move_id || null,
      tag: row.tag,
      at: Date.parse(row.attempted_at),
      correct: !!row.correct,
      revealed: !!row.revealed,
      result: row.result,
      synced: true
    };
    state.events.push(event);
    byId.set(event.id, event);
    changed = true;
  });
  if (changed) savePracticeProgress(state, ownerId);
}

async function syncRemotePracticeEvent(event) {
  if (!hasCoachDbSession() || !event) return;
  const ownerId = event.ownerId || activePracticeOwnerId();
  if (!ownerId || activePracticeOwnerId() !== ownerId) return;
  const { data, error } = await coachDbClient.rpc('record_practice_attempt', {
    p_event_id: event.id,
    p_drill_key: event.drillId,
    p_source_move_id: event.sourceMoveId || null,
    p_tag: event.tag,
    p_fen: event.fen,
    p_best_uci: event.bestUci,
    p_best_san: event.bestSan || null,
    p_prompt: event.prompt || null,
    p_correct: !!event.correct,
    p_revealed: !!event.revealed,
    p_attempted_at: new Date(event.at).toISOString()
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (row) mergeRemotePracticeRecords([row], ownerId);
  markPracticeEventSynced(event.id, ownerId);
}

async function syncPendingPracticeEvents() {
  if (!hasCoachDbSession()) return;
  const ownerId = activePracticeOwnerId();
  const pending = loadPracticeProgress(ownerId).events.filter(event => !event.synced);
  for (const event of pending) {
    if (!event.ownerId) event.ownerId = ownerId;
    await syncRemotePracticeEvent(event);
  }
}

function formatPracticeDue(record) {
  if (!record || !record.dueAt || record.dueAt <= Date.now()) return 'Due now';
  const days = Math.max(1, Math.ceil((record.dueAt - Date.now()) / DAY_MS));
  return `Due in ${days}d`;
}

function renderPracticeQueue(entries, counts) {
  const queue = practiceItemsForEntries(entries, counts);
  const $section = $('#practice-section');
  const $list = $('#practice-list').empty();
  const totals = practiceProgressTotals();
  renderedPracticeItems = new Map(queue.map(item => [item.id, item]));
  if (!queue.length) {
    if (!totals.attempts) {
      $section.hide();
      return;
    }
    $('#practice-count').text('0 due');
    $('#practice-progress-attempts').text(totals.attempts);
    $('#practice-progress-success').text(Math.round(totals.correct / totals.attempts * 100) + '%');
    $('#practice-progress-mastered').text(totals.mastered);
    $('#practice-empty').show();
    $('#btn-practice-session-start').text('Start practice').prop('disabled', true);
    renderPracticeTrends();
    $section.show();
    return;
  }
  const due = queue.filter(item => practiceIsDue(item));
  const successRate = totals.attempts ? Math.round(totals.correct / totals.attempts * 100) : null;
  $('#practice-count').text(`${due.length} due`);
  $('#practice-progress-attempts').text(totals.attempts);
  $('#practice-progress-success').text(successRate === null ? '—' : successRate + '%');
  $('#practice-progress-mastered').text(totals.mastered);
  renderPracticeTrends();
  $('#practice-empty').toggle(due.length === 0);
  $('#btn-practice-session-start')
    .text(due.length > 1 ? `Start ${due.length}-drill session` : 'Start practice')
    .prop('disabled', due.length === 0);
  due.forEach(item => {
    const entry = item.entry;
    const meta = item.meta;
    const record = practiceRecordFor(item);
    const $row = $('<div class="practice-row"></div>');
    const $title = $('<div class="practice-title"></div>').text(meta.title);
    const $button = $('<button type="button" class="movelist-copy practice-load"></button>')
      .text(record ? 'Review' : 'Practice')
      .attr('data-practice-id', item.id);
    $row.append($title);
    $row.append($button);
    $row.append($('<div class="practice-detail"></div>').text(`${meta.practice} ${formatPracticeContext(entry)} ${formatPracticeDue(record)}.`));
    $list.append($row);
  });
  $section.show();
}

function renderTheoryCards(entries, counts) {
  const $section = $('#theory-section');
  const $list = $('#theory-list').empty();
  const used = new Set();
  (counts || []).slice(0, 4).forEach(item => {
    if (!INSIGHT_TAG_META[item.tag] || used.has(item.tag)) return;
    used.add(item.tag);
    const meta = INSIGHT_TAG_META[item.tag];
    const $card = $('<div class="theory-card"></div>');
    $card.append($('<div class="theory-title"></div>').text(meta.title));
    $card.append($('<div class="theory-body"></div>').text(meta.theory));
    $list.append($card);
  });
  if (!used.size && entries && entries.length) {
    const $card = $('<div class="theory-card"></div>');
    $card.append($('<div class="theory-title"></div>').text('Candidate move selection'));
    $card.append($('<div class="theory-body"></div>').text(INSIGHT_TAG_META.candidate_moves.theory));
    $list.append($card);
  }
  $section.toggle($list.children().length > 0);
}

function renderInsights() {
  const localEntries = loadInsights().entries.filter(e => e && e.tier && e.tier !== 'unknown');
  const remoteEntries = Array.isArray(coachRemoteInsightEntries)
    ? coachRemoteInsightEntries.filter(e => e && e.tier && e.tier !== 'unknown')
    : [];
  const entries = remoteEntries.length ? remoteEntries : localEntries;
  const usingRemote = remoteEntries.length > 0;
  const $section = $('#insights-section');
  if (!entries.length) {
    $section.hide();
    renderPracticeQueue([], []);
    $('#theory-section').hide();
    return;
  }

  const problemEntries = entries.filter(e => isInsightProblem(e.tier));
  const counts = insightTagCounts(problemEntries);
  const weakPhase = weakestInsightPhase(problemEntries);
  $section.show();
  $('#insights-moves').text(entries.length);
  $('#insights-errors').text(counts.length);
  $('#insights-phase').text(weakPhase ? weakPhase.label : '-');

  const $list = $('#insights-list').empty();
  const $theory = $('#insights-theory').empty();

  if (!counts.length) {
    $('#insights-primary-title').text('No repeated problem yet');
    $('#insights-primary-detail').text(usingRemote
      ? 'Account history is syncing clean reviewed moves. The pattern view will sharpen once it sees inaccuracies, mistakes, or blunders.'
      : 'Coach mode is storing your reviewed moves locally. The pattern view will sharpen once it sees inaccuracies, mistakes, or blunders.');
    $list.append($('<div class="insight-empty"></div>').text('Current sample is clean. Keep playing enough moves to build a useful baseline.'));
    renderPracticeQueue(problemEntries, counts);
    renderTheoryCards(problemEntries, counts);
    return;
  }

  const top = counts[0];
  const topMeta = INSIGHT_TAG_META[top.tag];
  $('#insights-primary-title').text(topMeta.title);
  $('#insights-primary-detail').text(`${top.count} recent occurrence${top.count === 1 ? '' : 's'}. Practice next: ${topMeta.practice}`);

  counts.slice(0, 3).forEach(item => {
    const meta = INSIGHT_TAG_META[item.tag];
    const $row = $('<div class="insight-row"></div>');
    $row.append($('<span class="name"></span>').text(meta.title));
    $row.append($('<span class="count"></span>').text(`${item.count}x`));
    $row.append($('<div class="example"></div>').text(formatInsightExample(item.latest)));
    $list.append($row);
  });

  const usedTheory = new Set();
  counts.slice(0, 3).forEach(item => {
    const theory = INSIGHT_TAG_META[item.tag].theory;
    if (usedTheory.has(theory)) return;
    usedTheory.add(theory);
    $theory.append($('<div class="insight-theory-item"></div>').text(theory));
  });
  renderPracticeQueue(problemEntries, counts);
  renderTheoryCards(problemEntries, counts);
}

// ─────────────────────────────────────────────
// ACCOUNT SYNC — optional Supabase-backed coach history
// ─────────────────────────────────────────────
function supabaseRuntimeConfig() {
  const cfg = window.COACH_SUPABASE_CONFIG || {};
  return {
    url: (cfg.url || cfg.supabaseUrl || '').trim(),
    anonKey: (cfg.publishableKey || cfg.anonKey || cfg.key || cfg.supabaseAnonKey || '').trim()
  };
}

function isSupabaseConfigured() {
  const cfg = supabaseRuntimeConfig();
  return /^https:\/\/.+\.supabase\.co$/.test(cfg.url) &&
         cfg.anonKey.length > 20 &&
         !cfg.anonKey.includes('YOUR_');
}

let coachAuthStoragePersistent = true;

function createMemoryAuthStorage() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = value;
    },
    removeItem(key) {
      delete store[key];
    }
  };
}

function coachAuthStorage() {
  return {
    getItem(key) {
      try { return sessionStorage.getItem(key); } catch (e) { return null; }
    },
    setItem(key, value) {
      try { sessionStorage.setItem(key, value); } catch (e) {}
    },
    removeItem(key) {
      try { sessionStorage.removeItem(key); } catch (e) {}
    }
  };
}
function checkCoachAuthStorage() {
  const key = 'coach:auth-storage-test';
  try {
    sessionStorage.setItem(key, '1');
    sessionStorage.removeItem(key);
    coachAuthStoragePersistent = true;
    return { ok: true, storage: coachAuthStorage() };
  } catch (e) {
    coachAuthStoragePersistent = false;
    return { ok: false, storage: createMemoryAuthStorage(), error: e };
  }
}

function coachAccountSyncStatus() {
  if (!coachAuthStoragePersistent) {
    return 'Account sync cannot persist in this browser session.';
  }
  return coachAuthUser ? 'Account sync on.' : '';
}

function setCoachAuthStatus(msg) {
  $('#coach-auth-status').text(msg || '');
}

function setCoachDbStatus(msg) {
  coachDbStatus = msg || '';
  if (coachAuthUser) setCoachAuthStatus(msg || 'Account sync on.');
}

function renderCoachAuth() {
  const configured = isSupabaseConfigured();
  $('#coach-auth-local').toggle(!configured);
  $('#coach-auth-form').toggle(configured && !coachAuthUser);
  $('#coach-auth-session').toggle(configured && !!coachAuthUser);
  if (!configured) {
    setCoachAuthStatus('Add Supabase config to enable account history.');
    return;
  }
  if (coachAuthUser) {
    $('#coach-auth-user').text(coachAuthUser.email || coachAuthUser.id);
    setCoachAuthStatus(coachDbStatus || 'Account sync on.');
  } else {
    setCoachAuthStatus(coachDbStatus === 'loading' ? 'Connecting...' : (coachDbStatus || 'Sign in to sync games.'));
  }
}

function loadSupabaseScript() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  if (window.__coachSupabaseScriptPromise) return window.__coachSupabaseScriptPromise;
  window.__coachSupabaseScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/supabase/supabase-2.114.0.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Supabase client failed to load'));
    document.head.appendChild(script);
  });
  return window.__coachSupabaseScriptPromise;
}

async function initCoachDb() {
  if (coachDbInitPromise) return coachDbInitPromise;
  coachDbInitStarted = true;
  coachDbInitPromise = (async () => {
    renderCoachAuth();
    if (!isSupabaseConfigured()) return;
    coachDbStatus = 'loading';
    renderCoachAuth();
    try {
      await loadSupabaseScript();
      const cfg = supabaseRuntimeConfig();
      const storageCheck = checkCoachAuthStorage();
      if (!storageCheck.ok) coachDbStatus = coachAccountSyncStatus();
      coachDbClient = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: storageCheck.storage
        }
      });
      const { data } = await coachDbClient.auth.getSession();
      coachAuthUser = data && data.session ? data.session.user : null;
      if (coachAuthUser) adoptAnonymousPracticeProgress(coachAuthUser.id);
      coachDbStatus = coachAccountSyncStatus();
      renderCoachAuth();
      renderInsights();
      if (coachAuthUser) {
        coachSync.loadInsights({ silent: true }).catch(handleCoachDbError);
        if (coachGameActive) ensureRemoteCoachGame().catch(handleCoachDbError);
      }
      coachDbClient.auth.onAuthStateChange((event, session) => {
        coachAuthUser = session ? session.user : null;
        if (coachAuthUser) adoptAnonymousPracticeProgress(coachAuthUser.id);
        coachRemoteInsightEntries = null;
        coachDbStatus = coachAccountSyncStatus();
        renderCoachAuth();
        renderInsights();
        if (coachAuthUser) {
          coachSync.loadInsights({ silent: true }).catch(handleCoachDbError);
          if (coachGameActive) ensureRemoteCoachGame().catch(handleCoachDbError);
        }
      });
    } catch (err) {
      coachDbStatus = 'Account sync unavailable.';
      setCoachAuthStatus((err && err.message) || coachDbStatus);
    }
  })();
  return coachDbInitPromise;
}

function hasCoachDbSession() {
  return !!(coachDbClient && coachAuthUser);
}

function handleCoachDbError(err) {
  const msg = err && err.message ? err.message : 'Sync failed';
  setCoachDbStatus('Sync issue: ' + msg);
}

async function sendCoachLoginLink() {
  if (!coachDbClient) {
    await coachSync.init();
  }
  if (!coachDbClient) return;
  const email = ($('#coach-auth-email').val() || '').trim();
  if (!email) {
    setCoachAuthStatus('Enter an email address.');
    return;
  }
  setCoachAuthStatus('Sending link...');
  const redirectTo = location.origin + location.pathname + '?view=coach';
  const { error } = await coachDbClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo }
  });
  if (error) {
    setCoachAuthStatus(error.message);
  } else {
    setCoachAuthStatus('Check your email for the sign-in link.');
  }
}

async function signOutCoach() {
  if (!coachDbClient) return;
  clearQueuedRemoteCoachGameUpdate();
  await coachDbClient.auth.signOut();
  coachAuthUser = null;
  coachRemoteInsightEntries = null;
  coachRemoteGameId = null;
  coachRemoteGamePromise = null;
  coachRemoteGamePromiseGeneration = null;
  coachDbStatus = '';
  renderCoachAuth();
  renderInsights();
}

function remoteGameResult(endReason) {
  if (!coachGame) return '*';
  if (coachGame.in_checkmate()) {
    return coachGame.turn() === 'w' ? '0-1' : '1-0';
  }
  if (coachGame.in_stalemate() || coachGame.in_draw() || coachGame.in_threefold_repetition() || coachGame.insufficient_material()) {
    return '1/2-1/2';
  }
  if (endReason && endReason.includes('Resigned')) {
    return coachUserColor() === 'white' ? '0-1' : '1-0';
  }
  return '*';
}

function remoteGamePayload(endReason) {
  const total = coachStats ? coachStats.moves : 0;
  return {
    user_id: coachAuthUser.id,
    user_side: coachUserColor(),
    opponent_level: coachEngineElo,
    start_fen: coachStartFen || (coachGame ? coachGame.fen() : null),
    final_fen: coachGame ? coachGame.fen() : null,
    pgn: coachGame ? coachGetPgn() : '',
    opening_name: currentCoachOpeningName(),
    result: remoteGameResult(endReason),
    end_reason: endReason || null,
    ended_at: endReason ? new Date(coachEndedAt || Date.now()).toISOString() : null,
    moves_count: total,
    accuracy: total ? accuracyFromTallies(coachStats, total) : null,
    acpl: coachReviewLog && coachReviewLog.length ? computeACPL(coachReviewLog) : null,
    stats: coachStats || {},
    updated_at: new Date().toISOString()
  };
}

async function ensureRemoteCoachGame(generation = coachGameGeneration) {
  if (!hasCoachDbSession() || !coachGame) return null;
  if (coachRemoteGameId) return coachRemoteGameId;
  if (coachRemoteGamePromise && coachRemoteGamePromiseGeneration === generation) {
    return coachRemoteGamePromise;
  }
  const gameRef = coachGame;
  const userId = coachAuthUser.id;
  const payload = remoteGamePayload(null);
  coachRemoteGamePromiseGeneration = generation;
  coachRemoteGamePromise = (async () => {
    const { data, error } = await coachDbClient
      .from('coach_games')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw error;
    if (generation !== coachGameGeneration || coachGame !== gameRef ||
        !coachAuthUser || coachAuthUser.id !== userId) {
      // The insert completed after the user replaced the game. Remove the
      // now-orphaned row when the session still permits it, and never attach it
      // to the current game.
      coachDbClient.from('coach_games').delete().eq('id', data.id).eq('user_id', userId).then(() => {});
      return null;
    }
    coachRemoteGameId = data.id;
    saveCoachState();
    setCoachDbStatus('Game sync started.');
    return coachRemoteGameId;
  })();
  try {
    return await coachRemoteGamePromise;
  } finally {
    if (coachRemoteGamePromiseGeneration === generation) {
      coachRemoteGamePromise = null;
      coachRemoteGamePromiseGeneration = null;
    }
  }
}

async function updateRemoteCoachGame(endReason, generation = coachGameGeneration) {
  if (!hasCoachDbSession() || !coachGame) return;
  const gameRef = coachGame;
  const gameId = await ensureRemoteCoachGame(generation);
  if (!gameId) return;
  if (generation !== coachGameGeneration || coachGame !== gameRef || !hasCoachDbSession()) return;
  const { error } = await coachDbClient
    .from('coach_games')
    .update(remoteGamePayload(endReason || null))
    .eq('id', gameId);
  if (error) throw error;
  setCoachDbStatus(endReason ? 'Game saved.' : 'Game synced.');
}

function remoteMovePayload(review, gameId) {
  const tags = review.insightTags || insightTagsForReview(review);
  review.insightTags = tags;
  return {
    user_id: coachAuthUser.id,
    game_id: gameId,
    ply: review.ply,
    pair_num: review.pairNum,
    phase: phaseOf(review.pairNum),
    played_at: new Date().toISOString(),
    fen_before: review.fenBefore,
    fen_after: review.fenAfter,
    user_uci: review.userUci,
    user_san: review.userSan || null,
    best_uci: review.bestUci || null,
    best_san: review.bestSan || null,
    classification: review.tier,
    centipawn_loss: Math.round(review.loss || 0),
    rank: review.rank || null,
    tags,
    explanation: review.whyBetter || null,
    pv_san: review.pvSan || [],
    top_alternatives: review.topAlternatives || [],
    eval_before: review.evalBefore || null,
    eval_after: review.evalAfter || null,
    opening_name: currentCoachOpeningName()
  };
}

function learningArtifactPayloads(review, moveId) {
  if (!review || !moveId || !isInsightProblem(review.tier) || !review.fenBefore) {
    return { drills: [], cards: [] };
  }
  const tags = (review.insightTags || insightTagsForReview(review))
    .filter(tag => INSIGHT_TAG_META[tag])
    .slice(0, 2);
  const now = new Date().toISOString();
  const drills = [];
  const cards = [];

  tags.forEach(tag => {
    const meta = INSIGHT_TAG_META[tag];
    if (review.bestUci) {
      drills.push({
        user_id: coachAuthUser.id,
        drill_key: practiceItemId({ fenBefore: review.fenBefore, bestUci: review.bestUci }, tag),
        source_move_id: moveId,
        tag,
        fen: review.fenBefore,
        best_uci: review.bestUci || null,
        best_san: review.bestSan || null,
        prompt: meta.practice,
        due_at: now,
        updated_at: now
      });
    }
    cards.push({
      user_id: coachAuthUser.id,
      source_move_id: moveId,
      tag,
      title: meta.title,
      body: meta.theory,
      retained: false,
      updated_at: now
    });
  });

  return { drills, cards };
}

async function syncRemoteLearningArtifacts(review, moveId, generation) {
  if (!hasCoachDbSession()) return;
  if (generation !== coachGameGeneration) return;
  const artifacts = learningArtifactPayloads(review, moveId);

  if (!artifacts.drills.length && !artifacts.cards.length) return;
  await deleteRemoteLearningArtifacts(moveId);
  if (generation !== coachGameGeneration) return;

  const writes = [];
  if (artifacts.drills.length) {
    writes.push(coachDbClient
      .from('drill_queue')
      .upsert(artifacts.drills, { onConflict: 'user_id,drill_key' }));
  }
  if (artifacts.cards.length) {
    writes.push(coachDbClient
      .from('theory_cards')
      .upsert(artifacts.cards, { onConflict: 'source_move_id,tag' }));
  }
  const results = await Promise.all(writes);
  for (const result of results) {
    if (result.error) throw result.error;
  }
}

async function deleteRemoteLearningArtifacts(moveId) {
  if (!hasCoachDbSession() || !moveId) return;
  const [drillDelete, cardDelete] = await Promise.all([
    coachDbClient
      .from('drill_queue')
      .delete()
      .eq('source_move_id', moveId)
      .eq('user_id', coachAuthUser.id),
    coachDbClient
      .from('theory_cards')
      .delete()
      .eq('source_move_id', moveId)
      .eq('user_id', coachAuthUser.id)
  ]);
  if (drillDelete.error) throw drillDelete.error;
  if (cardDelete.error) throw cardDelete.error;
}

async function syncRemoteCoachMove(review) {
  if (!hasCoachDbSession() || !review || review.tier === 'unknown') return;
  const generation = review.gameGeneration;
  if (generation !== coachGameGeneration || review.localGameId !== coachLocalGameId) return;
  const gameId = await ensureRemoteCoachGame(generation);
  if (!gameId) return;
  if (generation !== coachGameGeneration || review.localGameId !== coachLocalGameId) return;
  const { data, error } = await coachDbClient
    .from('coach_moves')
    .upsert(remoteMovePayload(review, gameId), { onConflict: 'game_id,ply' })
    .select('id')
    .single();
  if (error) throw error;
  if (generation !== coachGameGeneration || review.localGameId !== coachLocalGameId) return;
  if (data && data.id) await syncRemoteLearningArtifacts(review, data.id, generation);
  if (generation !== coachGameGeneration) return;
  if (data && data.id) upsertRemoteInsightEntry(remoteInsightEntryFromReview(review, data.id));
  queueRemoteCoachGameUpdate(null);
}

async function deleteRemoteCoachMove(review) {
  if (!hasCoachDbSession() || !coachRemoteGameId || !review || !review.ply) return;
  const existing = await coachDbClient
    .from('coach_moves')
    .select('id')
    .eq('game_id', coachRemoteGameId)
    .eq('ply', review.ply)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data && existing.data.id) await deleteRemoteLearningArtifacts(existing.data.id);
  const { error } = await coachDbClient
    .from('coach_moves')
    .delete()
    .eq('game_id', coachRemoteGameId)
    .eq('ply', review.ply);
  if (error) throw error;
  if (existing.data && existing.data.id) removeRemoteInsightEntry(existing.data.id);
  queueRemoteCoachGameUpdate(null);
}

function remoteMoveToInsightEntry(row) {
  return {
    id: row.id || null,
    ts: row.played_at ? Date.parse(row.played_at) : Date.now(),
    tier: row.classification,
    loss: row.centipawn_loss || 0,
    phase: row.phase || phaseOf(row.pair_num || Math.ceil((row.ply || 1) / 2)),
    tags: Array.isArray(row.tags) ? row.tags : [],
    pairNum: row.pair_num || Math.ceil((row.ply || 1) / 2),
    ply: row.ply || 1,
    userSan: row.user_san || null,
    bestSan: row.best_san || null,
    fenBefore: row.fen_before || null,
    userUci: row.user_uci || null,
    bestUci: row.best_uci || null,
    opening: row.opening_name || null
  };
}

function remoteInsightEntryFromReview(review, id) {
  const entry = insightEntryFromReview(review);
  entry.id = id || entry.id || null;
  return entry;
}

function upsertRemoteInsightEntry(entry) {
  if (!entry || !entry.id) return;
  if (!Array.isArray(coachRemoteInsightEntries)) coachRemoteInsightEntries = [];
  const idx = coachRemoteInsightEntries.findIndex(existing => existing && existing.id === entry.id);
  if (idx >= 0) coachRemoteInsightEntries[idx] = entry;
  else coachRemoteInsightEntries.push(entry);
  coachRemoteInsightEntries = coachRemoteInsightEntries
    .filter(e => e && e.tier && e.tier !== 'unknown')
    .slice(-INSIGHTS_MAX_ENTRIES);
  renderInsights();
}

function removeRemoteInsightEntry(id) {
  if (!id || !Array.isArray(coachRemoteInsightEntries)) return;
  coachRemoteInsightEntries = coachRemoteInsightEntries.filter(entry => entry && entry.id !== id);
  renderInsights();
}

function clearQueuedRemoteCoachGameUpdate() {
  if (remoteGameUpdateTimer) {
    clearTimeout(remoteGameUpdateTimer);
    remoteGameUpdateTimer = null;
  }
  pendingRemoteGameEndReason = null;
  pendingRemoteGameGeneration = null;
}

function queueRemoteCoachGameUpdate(endReason) {
  if (!hasCoachDbSession() || !coachGame) return;
  pendingRemoteGameGeneration = coachGameGeneration;
  if (endReason) pendingRemoteGameEndReason = endReason;
  if (remoteGameUpdateTimer) clearTimeout(remoteGameUpdateTimer);
  remoteGameUpdateTimer = setTimeout(() => {
    remoteGameUpdateTimer = null;
    const reason = pendingRemoteGameEndReason;
    const generation = pendingRemoteGameGeneration;
    pendingRemoteGameEndReason = null;
    pendingRemoteGameGeneration = null;
    if (generation !== coachGameGeneration) return;
    updateRemoteCoachGame(reason, generation).catch(handleCoachDbError);
  }, REMOTE_GAME_SYNC_DEBOUNCE_MS);
}

async function refreshRemoteInsights(opts = {}) {
  if (!hasCoachDbSession()) {
    coachRemoteInsightEntries = null;
    renderInsights();
    return;
  }
  const ownerId = activePracticeOwnerId();
  if (!opts.silent) setCoachDbStatus('Loading account insights...');
  await syncPendingPracticeEvents().catch(handleCoachDbError);
  const [movesResult, drillsResult, attemptsResult] = await Promise.all([
    coachDbClient
      .from('coach_moves')
      .select('id,played_at,classification,centipawn_loss,phase,tags,pair_num,ply,fen_before,user_uci,user_san,best_uci,best_san,opening_name')
      .eq('user_id', ownerId)
      .order('played_at', { ascending: false })
      .limit(300),
    coachDbClient
      .from('drill_queue')
      .select('drill_key,source_move_id,tag,fen,best_uci,due_at,interval_days,ease,reps,attempts,correct,last_result,last_attempt_at,updated_at')
      .eq('user_id', ownerId)
      .limit(300),
    coachDbClient
      .from('practice_attempts')
      .select('id,drill_key,source_move_id,tag,attempted_at,correct,revealed,result')
      .eq('user_id', ownerId)
      .order('attempted_at', { ascending: false })
      .limit(PRACTICE_EVENT_LIMIT)
  ]);
  if (movesResult.error) throw movesResult.error;
  if (drillsResult.error) throw drillsResult.error;
  if (attemptsResult.error) throw attemptsResult.error;
  if (activePracticeOwnerId() !== ownerId) return;
  mergeRemotePracticeRecords(drillsResult.data || [], ownerId);
  mergeRemotePracticeEvents((attemptsResult.data || []).slice().reverse(), ownerId);
  coachRemoteInsightEntries = (movesResult.data || []).slice().reverse().map(remoteMoveToInsightEntry);
  if (!opts.silent) setCoachDbStatus('Account insights loaded.');
  renderInsights();
}

const coachSync = {
  init() {
    return initCoachDb();
  },
  saveMove(review) {
    return syncRemoteCoachMove(review);
  },
  deleteMove(review) {
    return deleteRemoteCoachMove(review);
  },
  saveGame(endReason) {
    return updateRemoteCoachGame(endReason);
  },
  loadInsights(opts) {
    return refreshRemoteInsights(opts || {});
  }
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
  if (coachBoard) coachBoard.position(tmp.fen());
  coachHandleUserMove(pm.from, pm.to, pm.promotion, { updateBoard: false });
}

// ─────────────────────────────────────────────
// MOVE SOUNDS (Web Audio synthesized — no binary assets)
// ─────────────────────────────────────────────
// We synthesize short filtered transients instead of shipping audio files. The
// profile is tuned toward a dry wooden-board click: fast attack, low body, and
// a tiny high-frequency edge.
// AudioContext is created lazily on first play because most browsers block
// audio creation outside a user gesture; the toggle checkbox click counts.
const SOUND_PREF_KEY = 'coach:sound:v1';
let coachSoundEnabled = false;
let coachAudioCtx = null;

function readSoundPref() {
  try { return localStorage.getItem(SOUND_PREF_KEY) === '1'; } catch (e) { return false; }
}
function writeSoundPref(on) {
  try { localStorage.setItem(SOUND_PREF_KEY, on ? '1' : '0'); } catch (e) {}
}
function ensureAudioCtx() {
  if (coachAudioCtx) return coachAudioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    coachAudioCtx = new Ctx();
  } catch (e) { return null; }
  return coachAudioCtx;
}
function createNoiseBuffer(ctx, duration) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  return buffer;
}

function applyPercussiveEnvelope(gainNode, start, peak, attack, decay) {
  const gain = gainNode.gain;
  gain.cancelScheduledValues(start);
  gain.setValueAtTime(0.0001, start);
  gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
}

function playTone(freq, durationMs, opts = {}) {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime + (opts.delay || 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type || 'sine';
  osc.frequency.setValueAtTime(freq, now);
  if (opts.endFreq) {
    osc.frequency.exponentialRampToValueAtTime(opts.endFreq, now + durationMs / 1000);
  }
  const peak = opts.gain == null ? 0.16 : opts.gain;
  applyPercussiveEnvelope(gain, now, peak, 0.004, durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

function playNoiseClick(opts = {}) {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const start = ctx.currentTime + (opts.delay || 0);
  const duration = opts.duration || 0.028;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = createNoiseBuffer(ctx, duration);
  filter.type = opts.filterType || 'bandpass';
  filter.frequency.setValueAtTime(opts.frequency || 2400, start);
  filter.Q.setValueAtTime(opts.q || 0.8, start);
  applyPercussiveEnvelope(gain, start, opts.gain || 0.08, 0.0015, duration);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
  source.stop(start + duration + 0.01);
}

function playWoodTap(opts = {}) {
  playNoiseClick({
    delay: opts.delay || 0,
    duration: opts.clickDuration || 0.022,
    frequency: opts.clickFreq || 2600,
    q: opts.clickQ || 0.7,
    gain: opts.clickGain || 0.045
  });
  playTone(opts.bodyFreq || 210, (opts.bodyMs || 58), {
    delay: opts.delay || 0,
    type: 'triangle',
    endFreq: opts.bodyEnd || 115,
    gain: opts.bodyGain || 0.07
  });
  if (opts.lowFreq) {
    playTone(opts.lowFreq, opts.lowMs || 82, {
      delay: (opts.delay || 0) + 0.006,
      type: 'sine',
      endFreq: opts.lowEnd || Math.max(40, opts.lowFreq * 0.55),
      gain: opts.lowGain || 0.045
    });
  }
}

function playSound(kind) {
  if (!coachSoundEnabled) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (kind === 'move') {
    playWoodTap({ bodyFreq: 245, bodyEnd: 128, bodyGain: 0.055, clickFreq: 3100, clickGain: 0.04 });
  } else if (kind === 'capture') {
    playWoodTap({ bodyFreq: 165, bodyEnd: 82, bodyGain: 0.09, lowFreq: 95, lowGain: 0.055, clickFreq: 1700, clickGain: 0.065, bodyMs: 76 });
  } else if (kind === 'castle') {
    playWoodTap({ bodyFreq: 230, bodyEnd: 118, bodyGain: 0.05, clickFreq: 2800, clickGain: 0.038 });
    playWoodTap({ delay: 0.055, bodyFreq: 205, bodyEnd: 104, bodyGain: 0.047, clickFreq: 2400, clickGain: 0.034 });
  } else if (kind === 'promote') {
    playWoodTap({ bodyFreq: 250, bodyEnd: 132, bodyGain: 0.052, clickFreq: 3200, clickGain: 0.04 });
    playTone(720, 92, { delay: 0.045, type: 'triangle', endFreq: 520, gain: 0.026 });
  } else if (kind === 'check') {
    playWoodTap({ bodyFreq: 235, bodyEnd: 122, bodyGain: 0.052, clickFreq: 3000, clickGain: 0.04 });
    playNoiseClick({ delay: 0.052, duration: 0.018, frequency: 4300, q: 1.2, gain: 0.036 });
  } else if (kind === 'gameover') {
    playWoodTap({ bodyFreq: 150, bodyEnd: 78, bodyGain: 0.09, lowFreq: 72, lowGain: 0.06, clickFreq: 1550, clickGain: 0.055, bodyMs: 95 });
    playTone(210, 180, { delay: 0.11, type: 'triangle', endFreq: 92, gain: 0.055 });
  }
}
// Pick the right sound for a chess.js move object.
function soundForMove(mv, gameAfter) {
  if (!mv) return null;
  if (gameAfter && gameAfter.game_over()) return 'gameover';
  if (gameAfter && gameAfter.in_check()) return 'check';
  if (mv.captured) return 'capture';
  if (mv.promotion) return 'promote';
  if (isCastlingMove(mv)) return 'castle';
  return 'move';
}

// ─────────────────────────────────────────────
// STOCKFISH ENGINE WRAPPER
// ─────────────────────────────────────────────
function createAbortError(message) {
  const err = new Error(message || 'Engine work was cancelled.');
  err.name = 'AbortError';
  return err;
}

function isAbortError(err) {
  return !!(err && err.name === 'AbortError');
}

const engineClient = {
  worker: null,
  status: 'idle',   // idle | loading | ready
  queue: [],
  current: null,
  _readyResolvers: [],

  init() {
    if (this.status === 'ready') return Promise.resolve();
    if (this.status === 'loading') {
      return new Promise((resolve, reject) => this._readyResolvers.push({ resolve, reject }));
    }
    this.status = 'loading';
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker('stockfish/stockfish.js');
      } catch (err) {
        this.status = 'idle';
        reject(err);
        return;
      }
      this._readyResolvers.push({ resolve, reject });
      this.worker.onmessage = (e) => this._onMessage(e.data);
      this.worker.onerror = (e) => {
        const err = new Error('Engine failed: ' + (e.message || e.filename || 'worker error'));
        this.failAll(err);
      };
      this.worker.postMessage('uci');
    });
  },

  failAll(err) {
    if (this.current && this.current.timeoutId) {
      clearTimeout(this.current.timeoutId);
      this.current.timeoutId = null;
    }
    const pending = [];
    if (this.current) pending.push(this.current);
    pending.push(...this.queue);
    this.current = null;
    this.queue = [];
    this.status = 'idle';
    if (this.worker) {
      try { this.worker.terminate(); } catch (e) {}
    }
    this.worker = null;
    this._readyResolvers.forEach(waiter => waiter.reject(err));
    this._readyResolvers = [];
    pending.forEach(task => {
      if (task.timeoutId) clearTimeout(task.timeoutId);
      if (task.reject) task.reject(err);
    });
  },

  _onMessage(msg) {
    if (typeof msg !== 'string') return;
    if (msg === 'uciok') { this.worker.postMessage('isready'); return; }
    if (msg === 'readyok' && this.status === 'loading') {
      this.status = 'ready';
      this._readyResolvers.forEach(waiter => waiter.resolve());
      this._readyResolvers = [];
      this._runNext();
      return;
    }
    if (!this.current) return;
    if (msg.startsWith('info ')) {
      const parsed = parseInfo(msg);
      if (!parsed) return;
      // Skip info lines without a pv (e.g. currmove progress reports) — they
      // would otherwise overwrite the real pv1 entry with an empty PV and
      // corrupt ranking / candidate display.
      if (!parsed.pv || parsed.pv.length === 0) return;
      if (this.current.multipv) {
        this.current.pvLines = this.current.pvLines || {};
        this.current.pvLines[parsed.multipv || 1] = parsed;
      } else {
        this.current.lastInfo = parsed;
      }
      return;
    }
    if (msg.startsWith('bestmove ')) {
      const bm = msg.split(' ')[1];
      const done = this.current;
      this.current = null;
      if (done.timeoutId) { clearTimeout(done.timeoutId); done.timeoutId = null; }
      if (done.multipv) {
        const lines = Object.keys(done.pvLines || {})
          .map(k => parseInt(k))
          .sort((a, b) => a - b)
          .map(k => done.pvLines[k]);
        done.resolve({ bestmove: bm === '(none)' ? null : bm, lines });
      } else {
        const info = done.lastInfo || { cp: 0, pv: [bm], depth: 0 };
        done.resolve({ bestmove: bm === '(none)' ? null : bm, info });
      }
      this._runNext();
    }
  },

  evaluate(fen, depth, opts) {
    return this.init().then(() => new Promise((resolve, reject) => {
      const task = {
        fen,
        depth,
        resolve,
        reject: reject,
        lastInfo: null,
        skill: (opts && typeof opts.skill === 'number') ? opts.skill : null,
        elo: (opts && typeof opts.elo === 'number') ? opts.elo : null,
        multipv: (opts && opts.multipv) || null,
        timeoutId: null
      };
      // Safety timeout — if the engine worker stalls or the WASM module
      // wedges, abandon the task after 30s so the queue can drain and
      // subsequent moves aren't permanently blocked.
      task.timeoutId = setTimeout(() => {
        task.timeoutId = null;
        if (this.current === task) {
          this.current = null;
          try { this.worker.postMessage('stop'); } catch (_) {}
        } else {
          this.queue = this.queue.filter(t => t !== task);
        }
        if (task.multipv) {
          resolve({ bestmove: null, lines: [] });
        } else {
          resolve({ bestmove: null, info: { cp: 0, pv: [], depth: 0 } });
        }
        this._runNext();
      }, 30000);
      this.queue.push(task);
      this._runNext();
    }));
  },

  _runNext() {
    if (this.status !== 'ready' || this.current || this.queue.length === 0) return;
    this.current = this.queue.shift();
    this.worker.postMessage('ucinewgame');
    // Apply strength options per task
    if (this.current.elo !== null && this.current.elo !== undefined) {
      this.worker.postMessage('setoption name UCI_LimitStrength value true');
      this.worker.postMessage('setoption name UCI_Elo value ' + this.current.elo);
    } else if (this.current.skill !== null && this.current.skill !== undefined) {
      this.worker.postMessage('setoption name UCI_LimitStrength value false');
      this.worker.postMessage('setoption name Skill Level value ' + this.current.skill);
    } else {
      this.worker.postMessage('setoption name UCI_LimitStrength value false');
      this.worker.postMessage('setoption name Skill Level value 20');
    }
    // MultiPV
    this.worker.postMessage('setoption name MultiPV value ' + (this.current.multipv || 1));
    this.worker.postMessage('position fen ' + this.current.fen);
    this.worker.postMessage('go depth ' + this.current.depth);
  },

  cancel(message) {
    const hasPendingWork = this.status === 'loading' || !!this.current || this.queue.length > 0;
    if (!hasPendingWork) return;
    // Terminating the worker is deliberate: UCI does not tag responses, so
    // starting a new search before the prior `bestmove` arrives can mix results.
    // failAll rejects every active/queued promise and the next evaluation
    // transparently starts a clean worker.
    this.failAll(createAbortError(message));
  }
};

function parseInfo(msg) {
  const depthMatch = msg.match(/\bdepth (\d+)/);
  const cpMatch = msg.match(/\bscore cp (-?\d+)/);
  const mateMatch = msg.match(/\bscore mate (-?\d+)/);
  const mpvMatch = msg.match(/\bmultipv (\d+)/);
  // PV runs from "pv " to next space-delimited keyword or end
  const pvMatch = msg.match(/\bpv ((?:[a-h][1-8][a-h][1-8][qrbn]? ?)+)/);
  if (!depthMatch) return null;
  return {
    depth: parseInt(depthMatch[1]),
    cp: cpMatch ? parseInt(cpMatch[1]) : null,
    mate: mateMatch ? parseInt(mateMatch[1]) : null,
    multipv: mpvMatch ? parseInt(mpvMatch[1]) : 1,
    pv: pvMatch ? pvMatch[1].trim().split(/\s+/) : []
  };
}

function scoreToCp(info) {
  if (info.mate !== null && info.mate !== undefined) {
    return info.mate > 0 ? 10000 - info.mate : -10000 - info.mate;
  }
  return info.cp || 0;
}

function formatEval(info) {
  if (info.mate !== null && info.mate !== undefined) {
    return '#' + Math.abs(info.mate);
  }
  const cp = info.cp || 0;
  const sign = cp > 0 ? '+' : (cp < 0 ? '−' : '±');
  return sign + (Math.abs(cp) / 100).toFixed(2);
}

function uciToSan(fen, uci) {
  const g = new Chess(fen);
  const move = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  return move ? move.san : uci;
}

function pvToSan(fen, pvArr, max) {
  const g = new Chess(fen);
  const out = [];
  for (const uci of pvArr.slice(0, max || 5)) {
    const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    if (!mv) break;
    out.push(mv.san);
  }
  return out;
}

function uciFromMove(mv) {
  if (!mv) return null;
  return mv.from + mv.to + (mv.promotion || '');
}

function materialValue(piece) {
  return ({ p: 100, n: 300, b: 325, r: 500, q: 900, k: 0 })[piece] || 0;
}

function moveHeuristicScore(gameObj, mv) {
  let score = Math.random() * 80;
  if (mv.captured) score += materialValue(mv.captured) - materialValue(mv.piece) * 0.18;
  if (mv.flags && mv.flags.includes('p')) score += materialValue(mv.promotion || 'q') - 100;
  if (mv.san && mv.san.includes('+')) score += 120;
  if (mv.san && mv.san.includes('#')) score += 5000;
  if (['n', 'b'].includes(mv.piece)) score += 25;
  if (mv.piece === 'q') score -= 20;
  if (mv.piece === 'k' && !(mv.flags || '').includes('k') && !(mv.flags || '').includes('q')) score -= 35;
  return score;
}

function chooseWeakOpponentMove(fen, elo) {
  const g = new Chess(fen);
  const moves = g.moves({ verbose: true });
  if (!moves.length) return null;
  if (elo <= 500) {
    return uciFromMove(moves[Math.floor(Math.random() * moves.length)]);
  }
  const randomRate = elo < 700 ? 0.65 : (elo < 900 ? 0.42 : 0.22);
  if (Math.random() < randomRate) {
    return uciFromMove(moves[Math.floor(Math.random() * moves.length)]);
  }
  const noise = elo < 700 ? 650 : (elo < 900 ? 380 : 180);
  const ranked = moves
    .map(mv => ({ mv, score: moveHeuristicScore(g, mv) + (Math.random() * noise) }))
    .sort((a, b) => b.score - a.score);
  const poolSize = elo < 700 ? 8 : (elo < 900 ? 5 : 3);
  const pool = ranked.slice(0, Math.min(poolSize, ranked.length));
  return uciFromMove(pool[Math.floor(Math.random() * pool.length)].mv);
}

// ─────────────────────────────────────────────
// COACH CLASSIFICATION
// ─────────────────────────────────────────────
const COACH_DEPTH = 12;

// Rank-and-loss aware classification. `rank` is 1 if user played the engine's
// #1 move, 2 or 3 if it was a top-3 alternative, otherwise null.
function classifyRankLoss(rank, loss) {
  if (rank === 1) return { tier: 'best',      label: 'Best move', emoji: '★' };
  if (rank === 2 || rank === 3)
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
  if (best.captured) reasons.push(`${best.san} wins the ${PIECE_NAME[best.captured] ? PIECE_NAME[best.captured].toLowerCase() : 'piece'} on ${best.to}`);
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

// Side-to-move perspective: score is always in the mover's favor.
// We pull MultiPV=3 before the move so we know if the user picked #1/#2/#3.
async function classifyMove(fenBefore, userUciMove, fenAfter) {
  const [beforeEval, afterEval] = await Promise.all([
    engineClient.evaluate(fenBefore, COACH_DEPTH, { multipv: 3 }),
    engineClient.evaluate(fenAfter, COACH_DEPTH)
  ]);
  const lines = beforeEval.lines || [];
  const bestLine = lines[0];
  const bestUci = (bestLine && bestLine.pv && bestLine.pv[0]) || beforeEval.bestmove;
  const afterInfo = afterEval.info;
  const afterPosition = new Chess(fenAfter);
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

  return {
    tier: cls.tier,
    label: cls.label,
    emoji: cls.emoji,
    loss: rank === 1 ? 0 : Math.round(loss),
    rank,
    bestUci,
    bestSan: bestUci ? uciToSan(fenBefore, bestUci) : null,
    userSan: uciToSan(fenBefore, userUciMove),
    pvSan: bestLine ? pvToSan(fenBefore, bestLine.pv || [], 5) : [],
    topAlternatives,
    whyBetter,
    evalBefore: bestLine || null,
    evalAfter: afterInfo
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

// Opponent search depth matches review depth; strength is controlled by Elo.
function strengthTierLabel(elo) {
  if (elo < 600)  return 'Absolute beginner';
  if (elo < 800)  return 'Learning the rules';
  if (elo < 1000) return 'Beginner';
  if (elo < 1300) return 'Club novice';
  if (elo < 1600) return 'Improving club';
  if (elo < 1900) return 'Strong club';
  if (elo < 2200) return 'Expert';
  return 'Master';
}

// Translate the slider's displayed Elo into opponent behavior. Very low levels
// need explicit noisy move selection; shallow Stockfish still finds too many
// forcing moves and does not feel like a 400-rated opponent.
function coachStrengthOpts(elo) {
  if (elo < 1000) {
    return { weak: true };
  }
  if (elo < 1320) {
    // 1000 -> skill 4, depth 3; 1300 -> skill 9, depth 6.
    const t = Math.max(0, Math.min(1, (elo - 1000) / 320));
    const skill = 4 + Math.round(t * 5);
    const depth = 3 + Math.round(t * 3);
    return { skill, depth };
  }
  if (elo < 1400) {
    // Stockfish's native UCI_Elo floor is around 1320.
    const depth = 6;
    return { elo: Math.max(1320, elo), depth };
  }
  if (elo < 1600) {
    const t = Math.max(0, Math.min(1, (elo - 1400) / 200));
    const skill = Math.round(t * 8);
    const depth = 6 + Math.round(t * 2);
    return { skill, depth };
  }
  // 1600+: Stockfish's native Elo limiter, with depth tiered for realism.
  const depth = elo < 2000 ? 10 : 16;
  return { elo, depth };
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

function renderCoachReview(review) {
  if (!review) { $('#coach-review').hide(); return; }
  const $badge = $('#coach-classification');
  $badge.text(review.emoji + ' ' + review.label);
  $badge.attr('class', 'coach-classification coach-class-' + review.tier);
  $('#coach-loss').text(review.loss > 0 ? '−' + (review.loss / 100).toFixed(2) : '0.00');
  $('#coach-user-move').text(review.userSan || '—');
  $('#coach-best-move').text(review.bestSan || '—');
  const isBest = review.tier === 'best';
  const isExcellent = review.tier === 'excellent';
  const isUnknown = review.tier === 'unknown';
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
  $('#coach-explanation').text(msg);
  if (review.pvSan && review.pvSan.length > 1) {
    $('#coach-pv').show().text('Engine line: ' + review.pvSan.join(' '));
  } else {
    $('#coach-pv').hide();
  }
  // Auto-surface the top-3 candidate alternatives for mistake/blunder so the
  // user doesn't have to click "Candidates" — the data is already classified.
  const showAlts = (review.tier === 'mistake' || review.tier === 'blunder')
                   && review.topAlternatives && review.topAlternatives.length > 0;
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
  $('#btn-coach-showbest').prop('disabled', isBest || isUnknown || !review.bestUci);
}

function setCoachStatus(msg) {
  $('#coach-status').text(msg);
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
  engineClient.cancel(reason || 'Coach position changed.');
  clearQueuedRemoteCoachGameUpdate();
  return coachGameGeneration;
}

function resetCoachState(fen, opts = {}) {
  invalidateCoachAsyncWork('A new game replaced the previous analysis.');
  coachPracticeSession = null;
  if (!opts.preservePracticeRun) coachPracticeRun = null;
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
    // Opponent uses configured strength. Below 1000, explicit noisy move
    // selection is more realistic than asking Stockfish for a shallow best move.
    const opts = coachStrengthOpts(coachEngineElo);
    let bestmove;
    if (opts.weak) {
      bestmove = chooseWeakOpponentMove(fen, coachEngineElo);
    } else {
      const { depth, ...strength } = opts;
      const result = await engineClient.evaluate(fen, depth, strength);
      bestmove = result.bestmove;
    }
    if (generation !== coachGameGeneration || coachGame !== gameRef || !coachMode ||
        !coachGameActive || coachIsUserTurn() || coachGame.fen() !== fen) return;
    if (!bestmove) { setCoachStatus('Your move.'); return; }
    setTimeout(() => {
      try {
        if (generation !== coachGameGeneration || coachGame !== gameRef || !coachMode || !coachGameActive) return;
        const mv = coachGame.move({
          from: bestmove.slice(0, 2),
          to: bestmove.slice(2, 4),
          promotion: bestmove[4] || undefined
        });
        if (!mv) throw new Error('Opponent move was not legal.');
        candidateRequestId++;
        if (!coachIsReviewing()) {
          if (!coachBoard) throw new Error('Coach board is not ready.');
          coachBoard.position(coachGame.fen());
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
  if (opts.updateBoard !== false && coachBoard && !coachIsReviewing()) coachBoard.position(fenAfter);
  updateCapturedDisplay(fenAfter);
  playSound(soundForMove(userMv, coachGame));

  // Clear threats/candidates on new move
  $('#threats-section').hide();
  $('#candidates-section').hide();

  coachThinking = true;
  CoachController.setPhase('analyzing');
  setCoachStatus('Analyzing your move…');
  updateCoachControlsState();
  try {
    const review = await classifyMove(fenBefore, userUci, fenAfter);
    if (generation !== coachGameGeneration || coachGame !== gameRef || !coachGameActive ||
        coachGame.fen() !== fenAfter) {
      return 'stale';
    }
    const ply = coachGame.history().length;
    const pairNum = Math.ceil(ply / 2);
    const logged = Object.assign({}, review, {
      fenBefore,
      fenAfter,
      userUci,
      ply,
      pairNum,
      gameGeneration: generation,
      localGameId: coachLocalGameId
    });
    coachLastReview = logged;
    coachReviewLog.push(logged);
    recordCoachInsight(logged);
    coachSync.saveMove(logged).catch(handleCoachDbError);
    // Don't count engine-timeout ("unknown") reviews in stats or accuracy.
    if (review.tier !== 'unknown') {
      coachStats.moves++;
      coachStats[review.tier] = (coachStats[review.tier] || 0) + 1;
    }
    renderCoachReview(review);
    updateCoachSummary();
    updateCoachControlsState();
    updateMoveList();
    updateOpeningLabel();
    saveCoachState();
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
  // Let the user take in the final position before the review overlay arrives.
  scheduleSummaryReveal(msg, 1200);
}

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
  const userChar = userColor === 'white' ? 'w' : 'b';
  const oppChar = userColor === 'white' ? 'b' : 'w';
  const hangs = [];
  const boardArr = game.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = boardArr[r][f];
      if (!sq || sq.color !== userChar) continue;
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

// ─────────────────────────────────────────────
// CANDIDATE MOVES (top-3)
// ─────────────────────────────────────────────
async function showCandidates() {
  if (!coachMode || !coachGame) return;
  if (coachThinking) return;
  if (!coachIsUserTurn()) return; // never compute candidates for opponent's turn
  const fen = coachGame.fen();
  const requestId = ++candidateRequestId;
  const $section = $('#candidates-section').show();
  const $list = $('#candidates-list');
  $list.html('<div class="explore-loading">Computing top moves at depth 18…</div>');
  try {
    // Depth 18 with MultiPV=3 is strong enough to see most tactics up to ~9 moves
    // deep. Depth 12 was leaving blunders on the board and producing candidates
    // that didn't actually win material when the user expected them to.
    const res = await engineClient.evaluate(fen, 18, { multipv: 3 });
    if (requestId !== candidateRequestId || !coachMode || !coachGame || !coachGameActive ||
        !coachIsUserTurn() || coachIsReviewing() || coachGame.fen() !== fen) {
      return;
    }
    $list.empty();
    if (!res.lines || res.lines.length === 0) {
      $list.html('<div class="explore-empty">No candidates found.</div>');
      return;
    }
    const bestCp = res.lines[0].mate !== null && res.lines[0].mate !== undefined
      ? (res.lines[0].mate > 0 ? 10000 : -10000)
      : (res.lines[0].cp || 0);
    // Small hint so users don't assume "best move" means "wins material immediately".
    const $hint = $('<div class="candidate-hint"></div>').text(
      'Top moves by full-position evaluation — continuation shown after each.'
    );
    $list.append($hint);
    res.lines.forEach((line, idx) => {
      const uci = (line.pv && line.pv[0]) || null;
      if (!uci) return;
      const san = uciToSan(fen, uci);
      const evalLabel = formatEval(line);
      const cp = line.mate !== null && line.mate !== undefined
        ? (line.mate > 0 ? 10000 : -10000)
        : (line.cp || 0);
      const delta = cp - bestCp;
      const continuation = pvToSan(fen, line.pv || [], 5);
      const $row = $('<div class="candidate-row"></div>');
      $row.append($('<span class="rank"></span>').text((idx + 1) + '.'));
      $row.append($('<span class="move"></span>').text(san));
      const $eval = $('<span class="eval"></span>').text(evalLabel + (idx > 0 ? ` (${(delta / 100).toFixed(2)})` : ''));
      $row.append($eval);
      $list.append($row);
      if (continuation.length > 1) {
        const $cont = $('<div class="candidate-cont"></div>').text(continuation.slice(1).join(' '));
        $list.append($cont);
      }
    });
  } catch (err) {
    if (requestId !== candidateRequestId) return;
    $list.html('<div class="token-error">Engine error: ' + err.message + '</div>');
  }
}

// ─────────────────────────────────────────────
// POST-GAME SUMMARY
// ─────────────────────────────────────────────

// Eval from user's POV (centipawns) after a given review's position.
// evalAfter is stockfish's score from opponent-to-move POV, so we negate.
function evalAfterUserCp(r) {
  if (!r || !r.evalAfter) return null;
  return -scoreToCp(r.evalAfter);
}

// Average centipawn loss across scored (non-'unknown') moves. Cap each move's
// contribution at 1000cp so a single mate allowance (loss ~10000cp) doesn't
// make ACPL meaningless — this matches the Lichess convention.
const ACPL_CAP = 1000;
function computeACPL(reviews) {
  const scored = reviews.filter(r => r && r.tier && r.tier !== 'unknown');
  if (!scored.length) return null;
  const total = scored.reduce((s, r) => s + Math.min(r.loss || 0, ACPL_CAP), 0);
  return Math.round(total / scored.length);
}

// Format a centipawn loss as a signed pawn value. Losses past 10 pawns
// (e.g. allowing mate) collapse to "9.9+" so rows don't show "−100.0".
function formatLossPawns(loss) {
  if (loss >= 1000) return '9.9+';
  return (loss / 100).toFixed(1);
}

// Simple ply-based phase classifier. A game that resigns mid-opening
// will legitimately have zero moves in later phases.
function phaseOf(pairNum) {
  if (pairNum <= 12) return 'opening';
  if (pairNum <= 25) return 'middlegame';
  return 'endgame';
}

function phaseBreakdown(reviews) {
  const buckets = {
    opening: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, moves: 0 },
    middlegame: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, moves: 0 },
    endgame: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, moves: 0 }
  };
  for (const r of reviews) {
    if (!r || !r.tier || r.tier === 'unknown') continue;
    const p = phaseOf(r.pairNum);
    buckets[p][r.tier] = (buckets[p][r.tier] || 0) + 1;
    buckets[p].moves++;
  }
  return {
    opening: { ...buckets.opening, pct: accuracyFromTallies(buckets.opening, buckets.opening.moves) },
    middlegame: { ...buckets.middlegame, pct: accuracyFromTallies(buckets.middlegame, buckets.middlegame.moves) },
    endgame: { ...buckets.endgame, pct: accuracyFromTallies(buckets.endgame, buckets.endgame.moves) }
  };
}

// Format "14. Qh5" or "14... Qh5" based on ply parity.
function formatMoveRef(r) {
  const dots = (r.ply % 2 === 1) ? '.' : '...';
  return `${r.pairNum}${dots} ${r.userSan}`;
}

// Build an inline SVG eval chart from review log.
// X axis: review index. Y axis: eval after user's move from user's POV.
// Clamped to ±800 cp (±8 pawns) so blowouts don't flatten the interesting region.
function renderEvalChart(reviews) {
  const pts = [];
  for (const r of reviews) {
    if (!r || r.tier === 'unknown') continue;
    const cp = evalAfterUserCp(r);
    if (cp === null) continue;
    pts.push({ cp, r });
  }
  if (pts.length < 2) return ''; // need at least 2 points for a line

  const W = 580, H = 96, PAD = 4;
  const CLAMP = 800;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const xStep = innerW / (pts.length - 1);
  const midY = PAD + innerH / 2;
  const yFor = (cp) => {
    const c = Math.max(-CLAMP, Math.min(CLAMP, cp));
    return midY - (c / CLAMP) * (innerH / 2);
  };

  let d = '';
  pts.forEach((p, i) => {
    const x = PAD + i * xStep;
    const y = yFor(p.cp);
    d += (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`);
  });

  // Area fill down to zero line — gives visual weight to who's winning.
  let area = '';
  pts.forEach((p, i) => {
    const x = PAD + i * xStep;
    const y = yFor(p.cp);
    area += (i === 0 ? `M${x.toFixed(1)},${midY.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`);
  });
  area += ` L${(PAD + (pts.length - 1) * xStep).toFixed(1)},${midY.toFixed(1)} Z`;

  // Dots for mistakes/blunders so users can eyeball where things went wrong.
  const markers = pts.map((p, i) => {
    const x = PAD + i * xStep;
    const y = yFor(p.cp);
    const tier = p.r.tier;
    let color = null;
    if (tier === 'blunder') color = '#a23346';
    else if (tier === 'mistake') color = '#c28a4e';
    if (!color) return '';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evaluation over time">
      <line x1="${PAD}" y1="${midY}" x2="${W - PAD}" y2="${midY}" stroke="#5a4a3b" stroke-dasharray="2,3" stroke-width="0.5"/>
      <path d="${area}" fill="rgba(207, 109, 123, 0.12)"/>
      <path d="${d}" fill="none" stroke="#cf6d7b" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${markers}
    </svg>
  `;
}

// Compact eval sparkline shown next to the move list during play.
// Same shape as renderEvalChart but smaller, no markers — just a line + zero rule.
function renderLiveEvalChart(reviews) {
  const pts = [];
  for (const r of reviews) {
    if (!r || r.tier === 'unknown') continue;
    const cp = evalAfterUserCp(r);
    if (cp === null) continue;
    pts.push({ cp, r });
  }
  if (pts.length < 2) return '';
  // Show only the trailing 24 plies so the line keeps moving instead of compressing.
  const recent = pts.slice(-24);
  const W = 280, H = 44, PAD = 2;
  const CLAMP = 800;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const xStep = innerW / (recent.length - 1);
  const midY = PAD + innerH / 2;
  const yFor = (cp) => {
    const c = Math.max(-CLAMP, Math.min(CLAMP, cp));
    return midY - (c / CLAMP) * (innerH / 2);
  };
  let d = '';
  recent.forEach((p, i) => {
    const x = PAD + i * xStep;
    const y = yFor(p.cp);
    d += (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`);
  });
  let area = '';
  recent.forEach((p, i) => {
    const x = PAD + i * xStep;
    const y = yFor(p.cp);
    area += (i === 0 ? `M${x.toFixed(1)},${midY.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`);
  });
  area += ` L${(PAD + (recent.length - 1) * xStep).toFixed(1)},${midY.toFixed(1)} Z`;
  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Live evaluation">
      <line x1="${PAD}" y1="${midY}" x2="${W - PAD}" y2="${midY}" stroke="#5a4a3b" stroke-dasharray="2,3" stroke-width="0.5"/>
      <path d="${area}" fill="rgba(207, 109, 123, 0.12)"/>
      <path d="${d}" fill="none" stroke="#cf6d7b" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
  `;
}

function updateLiveEvalChart() {
  const html = renderLiveEvalChart(coachReviewLog || []);
  if (!html) {
    $('#liveeval-section').hide();
    $('#liveeval-chart').empty();
    return;
  }
  $('#liveeval-chart').html(html);
  $('#liveeval-section').show();
}

// Human-readable coaching takeaway inferred from pattern in reviews.
function coachingTakeaway(reviews, phases) {
  const scored = reviews.filter(r => r.tier && r.tier !== 'unknown');
  if (scored.length === 0) return null;
  const blunders = reviews.filter(r => r.tier === 'blunder').length;
  const mistakes = reviews.filter(r => r.tier === 'mistake').length;
  const bestCnt = reviews.filter(r => r.tier === 'best').length;
  const pctBest = bestCnt / scored.length;

  const op = phases.opening.pct;
  const mi = phases.middlegame.pct;
  const en = phases.endgame.pct;

  if (blunders === 0 && mistakes === 0 && pctBest >= 0.5) {
    return 'Clean game — no blunders, over half your moves matched the engine.';
  }
  if (blunders === 0 && mistakes <= 1) {
    return 'Solid play with no blunders. Keep the discipline on every move.';
  }
  if (op !== null && mi !== null && op - mi >= 20) {
    return 'You played the opening sharply but the middlegame got away from you. Before each move, check what your opponent threatens.';
  }
  if (mi !== null && en !== null && mi - en >= 20) {
    return 'Middlegame was steady but the endgame slipped. Endgame technique — king activity, passed pawns, opposition — often decides close games.';
  }
  if (blunders >= 3) {
    return `${blunders} blunders tipped this one. Use the Threats tool before committing to a move — it surfaces hanging pieces and forcing replies.`;
  }
  if (blunders >= 1) {
    return 'One blunder was the turning point — scrub to the critical moment below and try a different move with Show best to see the line you missed.';
  }
  if (mistakes >= 3) {
    return 'Several mistakes without blunders — often a sign of missed candidate moves. Before moving, ask: what\'s the engine\'s #1 doing that mine isn\'t?';
  }
  return 'Mixed game with room to grow. The critical moments below are where the game turned.';
}

function showPostGameSummary(endMsg) {
  coachLastEndMsg = endMsg;
  // Status-line pulse handed the baton to the overlay — remove it so reopens don't pulse again.
  $('#coach-status').removeClass('status-ended');
  // Refresh the "Open review" button visibility now that we have an end message.
  updateCoachControlsState();
  $('#summary-title').text(endMsg);

  // Subtitle: opponent level + user color context
  const eloEl = document.getElementById('coach-strength-value');
  const elo = eloEl ? eloEl.textContent : '';
  const sideName = coachUserColor() === 'white' ? 'White' : 'Black';
  const subtitleParts = [];
  if (sideName) subtitleParts.push(`You played ${sideName}`);
  if (elo) subtitleParts.push(`vs Opponent ${elo}`);
  if (subtitleParts.length) {
    $('#summary-subtitle').text(subtitleParts.join(' · ')).show();
  } else {
    $('#summary-subtitle').hide();
  }

  // Headline metrics
  const total = coachStats.moves;
  const pct = accuracyFromTallies(coachStats, total);
  $('#summary-accuracy').text(pct === null ? '—' : pct + '%');
  $('#summary-moves').text(total);
  const acpl = computeACPL(coachReviewLog);
  $('#summary-acpl').text(acpl === null ? '—' : acpl);

  // Classification distribution bar + legend
  const tiers = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
  const tierLabel = {
    best: 'Best', excellent: 'Excellent', good: 'Good',
    inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder'
  };
  const $bar = $('#summary-tier-bar').empty();
  const $leg = $('#summary-tier-legend').empty();
  if (total > 0) {
    for (const t of tiers) {
      const n = coachStats[t] || 0;
      if (n > 0) {
        const wPct = (n / total) * 100;
        $bar.append(`<div class="tier-bar-seg ${t}" style="width:${wPct.toFixed(2)}%" title="${tierLabel[t]}: ${n}"></div>`);
      }
      // Legend always shows even zero counts so users can see "no blunders".
      $leg.append(
        `<span class="tier-legend-item"><span class="swatch ${t}"></span>${tierLabel[t]} <span class="count">${n}</span></span>`
      );
    }
    $('#summary-tier-section').show();
  } else {
    // No moves scored — hide the whole section rather than show an empty bar.
    $('#summary-tier-section').hide();
  }

  // Phase breakdown
  const phases = phaseBreakdown(coachReviewLog);
  const anyPhase = phases.opening.moves + phases.middlegame.moves + phases.endgame.moves > 0;
  const $phaseGrid = $('#summary-phase-grid').empty();
  if (anyPhase) {
    const rows = [
      ['Opening', phases.opening, '(moves 1–12)'],
      ['Middlegame', phases.middlegame, '(13–25)'],
      ['Endgame', phases.endgame, '(26+)']
    ];
    for (const [name, data, range] of rows) {
      const acc = data.pct === null ? '—' : `${data.pct}%`;
      const moves = data.moves === 0 ? '—' : `${data.moves} move${data.moves === 1 ? '' : 's'}`;
      $phaseGrid.append(
        `<span class="phase-name">${name} <span style="color:var(--muted);font-size:0.72rem">${range}</span></span>` +
        `<span class="phase-acc">${acc}</span>` +
        `<span class="phase-count">${moves}</span>`
      );
    }
    $('#summary-phase-section').show();
  } else {
    $('#summary-phase-section').hide();
  }

  // Eval chart — need ≥ 2 scored points
  const chartHtml = renderEvalChart(coachReviewLog);
  if (chartHtml) {
    $('#summary-eval-chart').html(chartHtml);
    $('#summary-eval-section').show();
  } else {
    $('#summary-eval-section').hide();
  }

  // Opening — identify based on full history
  const openingSans = coachGame ? coachGame.history() : [];
  if (openingSans.length > 0 && typeof identifyOpening === 'function') {
    const info = identifyOpening(openingSans);
    if (info.match) {
      const mNum = Math.ceil(info.matchedPlies / 2);
      const lineText = info.exact
        ? `Stayed in theory through move ${mNum}.`
        : `Left book after move ${mNum}.`;
      $('#summary-opening-line').html(
        `<span class="eco">${escapeHtml(info.match.eco)}</span>` +
        `<strong>${escapeHtml(info.match.name)}</strong> — ${escapeHtml(lineText)}`
      );
      $('#summary-opening-section').show();
    } else {
      $('#summary-opening-section').hide();
    }
  } else {
    $('#summary-opening-section').hide();
  }

  // Critical moments — top 3 worst non-best moves, threshold loss ≥ 30cp
  const critical = coachReviewLog
    .filter(r => r.tier && r.tier !== 'unknown' && r.tier !== 'best' && (r.loss || 0) >= 30)
    .sort((a, b) => (b.loss || 0) - (a.loss || 0))
    .slice(0, 3);
  const $crit = $('#summary-critical-list').empty();
  if (critical.length) {
    for (const r of critical) {
      const ref = formatMoveRef(r);
      const lossPawns = formatLossPawns(r.loss || 0);
      const best = r.bestSan ? ` — best was ${r.bestSan}` : '';
      const desc = `${tierLabel[r.tier]}${best}`;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `moment-row ${r.tier}`;
      row.dataset.ply = r.ply;
      row.innerHTML =
        `<span class="moment-num">${escapeHtml(ref)}</span>` +
        `<span class="moment-desc">${escapeHtml(desc)}</span>` +
        `<span class="moment-loss">−${lossPawns}</span>`;
      $crit.append(row);
    }
    $('#summary-critical-section').show();
  } else {
    $('#summary-critical-section').hide();
  }

  // Best moments — top 3 'best'-tier or 'excellent'-tier moves spaced through the game
  // Prefer moves where engine rank=1 and there was a real alternative (>1 line seen).
  // Simple approach: take the first 3 'best' tier reviews with a best alternative.
  const bestMoves = coachReviewLog
    .filter(r => r.tier === 'best' || r.tier === 'excellent')
    .slice(0, 3);
  const $best = $('#summary-best-list').empty();
  if (bestMoves.length) {
    for (const r of bestMoves) {
      const ref = formatMoveRef(r);
      const rankNote = r.rank === 1 ? 'top engine choice' : (r.rank ? `#${r.rank} engine choice` : '');
      const tierNote = r.tier === 'best' ? 'Best' : 'Excellent';
      const desc = rankNote ? `${tierNote} · ${rankNote}` : tierNote;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `moment-row ${r.tier}`;
      row.dataset.ply = r.ply;
      row.innerHTML =
        `<span class="moment-num">${escapeHtml(ref)}</span>` +
        `<span class="moment-desc">${escapeHtml(desc)}</span>` +
        `<span class="moment-loss" style="color:#8aa074">✓</span>`;
      $best.append(row);
    }
    $('#summary-best-section').show();
  } else {
    $('#summary-best-section').hide();
  }

  // Takeaway
  const takeaway = coachingTakeaway(coachReviewLog, phases);
  if (takeaway) {
    $('#summary-takeaway-text').text(takeaway);
    $('#summary-takeaway').show();
  } else {
    $('#summary-takeaway').hide();
  }

  summaryPracticeItems = currentGameDuePracticeItems();
  const dueCount = summaryPracticeItems.length;
  $('#btn-summary-practice')
    .text(dueCount === 1 ? 'Practice this mistake' : `Practice ${dueCount} mistakes`)
    .toggle(dueCount > 0);

  summaryReturnFocus = document.activeElement;
  $('#summary-overlay').css('display', 'flex').attr('aria-hidden', 'false');
  // Scroll to top when reopening on a new game
  $('.summary-card').scrollTop(0);
  $('.summary-card').trigger('focus');
}

// ─────────────────────────────────────────────
// SPACED REPETITION (SM-2 lite)
// ─────────────────────────────────────────────
const SR_KEY = 'chess_sr_v1';
const DAY_MS = 86400000;

function loadSR() {
  try { return JSON.parse(localStorage.getItem(SR_KEY)) || {}; }
  catch(e) { return {}; }
}
function saveSR(data) {
  try {
    localStorage.setItem(SR_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
function getSRRecord(id) {
  const data = loadSR();
  return data[id] || null;
}
function srStatus(id) {
  const rec = getSRRecord(id);
  if (!rec) return 'new';
  if (Date.now() >= rec.nextDue) return 'due';
  if (rec.reps >= 3) return 'mastered';
  return 'learning';
}
function srRecordQuiz(id, quality) {
  // quality: 5=perfect, 4=1-2 misses, 0=many misses (reset)
  const data = loadSR();
  let rec = data[id] || { ease: 2.5, interval: 0, reps: 0, attempts: 0 };
  rec.attempts = (rec.attempts || 0) + 1;
  rec.ease = Math.max(1.3, rec.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  if (quality < 3) {
    rec.reps = 0;
    rec.interval = 1;
  } else {
    rec.reps += 1;
    if (rec.reps === 1) rec.interval = 1;
    else if (rec.reps === 2) rec.interval = 3;
    else rec.interval = Math.round(rec.interval * rec.ease);
  }
  rec.lastReviewed = Date.now();
  rec.nextDue = Date.now() + rec.interval * DAY_MS;
  data[id] = rec;
  return saveSR(data);
}
function updateSRSidebar() {
  $('.opening-btn').each(function() {
    const id = $(this).data('id');
    const status = srStatus(id);
    $(this).removeClass('sr-due sr-mastered sr-learning');
    if (status !== 'new') $(this).addClass('sr-' + status);
    if ($(this).find('.sr-dot').length === 0) {
      $(this).prepend('<span class="sr-dot"></span>');
    }
  });
  // Populate "Due for Review" section
  const due = OPENINGS.filter(o => srStatus(o.id) === 'due');
  const $section = $('#sr-due-section');
  const $list = $('#sr-due-list');
  if (due.length === 0) {
    $section.hide();
  } else {
    const html = due.map(o => {
      const badge = o.category === 'trap' ? '<span class="trap-badge">trap</span>' : `<span class="eco">${o.eco || ''}</span>`;
      return `<button class="opening-btn sr-due" data-id="${o.id}" data-cat="${o.category}"><span class="sr-dot"></span>${o.name} ${badge}</button>`;
    }).join('');
    $list.html(html);
    $section.show();
    $list.find('.opening-btn').on('click', function() { loadOpening($(this).data('id')); });
  }
}
function updateSRPanel() {
  const $panel = $('#sr-status-panel');
  if (!currentOpening || !quizMode) { $panel.hide(); return; }
  const rec = getSRRecord(currentOpening.id);
  const status = srStatus(currentOpening.id);
  const statusLabel = { new: 'Never attempted', due: 'Due for review', learning: 'Learning', mastered: 'Mastered' }[status];
  let html = `<div class="sr-line"><span>Status</span><strong>${statusLabel}</strong></div>`;
  if (rec) {
    html += `<div class="sr-line"><span>Clean runs</span><strong>${rec.reps}</strong></div>`;
    html += `<div class="sr-line"><span>Attempts</span><strong>${rec.attempts}</strong></div>`;
    if (rec.nextDue) {
      const days = Math.max(0, Math.round((rec.nextDue - Date.now()) / DAY_MS));
      html += `<div class="sr-line"><span>Next review</span><strong>${days === 0 ? 'now' : days + 'd'}</strong></div>`;
    }
  }
  $panel.html(html).show();
}

function validateOpeningData() {
  const errors = [];
  const seenIds = new Set();
  OPENINGS.forEach(opening => {
    if (!opening.id) errors.push('Opening missing id');
    if (seenIds.has(opening.id)) errors.push(`Duplicate opening id: ${opening.id}`);
    seenIds.add(opening.id);
    if (!Array.isArray(opening.moves) || opening.moves.length === 0) {
      errors.push(`${opening.id}: missing moves`);
    }
    if (!Array.isArray(opening.explanations) || opening.explanations.length !== opening.moves.length) {
      errors.push(`${opening.id}: explanations length does not match moves length`);
    }
    const lineIds = new Set();
    getOpeningLines(opening).forEach(line => {
      const lineKey = `${opening.id}/${line.id}`;
      if (lineIds.has(line.id)) errors.push(`${opening.id}: duplicate line id ${line.id}`);
      lineIds.add(line.id);
      if (!Array.isArray(line.moves) || line.moves.length === 0) {
        errors.push(`${lineKey}: missing moves`);
        return;
      }
      if (!Array.isArray(line.explanations) || line.explanations.length !== line.moves.length) {
        errors.push(`${lineKey}: explanations length does not match moves length`);
      }
      const g = new Chess();
      for (let i = 0; i < line.moves.length; i++) {
        const san = line.moves[i];
        if (!g.move(san)) {
          errors.push(`${lineKey}: illegal SAN at ply ${i + 1}: ${san}`);
          break;
        }
      }
    });
  });
  if (errors.length) console.warn('Opening data validation failed:', errors);
  return errors;
}

// ─────────────────────────────────────────────
// URL STATE
// ─────────────────────────────────────────────
function updateURL() {
  const params = new URLSearchParams();
  if (appView === 'coach') {
    params.set('view', 'coach');
  } else {
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
  history.replaceState(null, '', url);
}
function readURL() {
  const p = new URLSearchParams(location.search);
  return { view: p.get('view'), opening: p.get('opening'), line: p.get('line'), mode: p.get('mode'), move: parseInt(p.get('move'), 10) };
}

// ─────────────────────────────────────────────
// BOARD INIT (lazy — board is created on first opening load)
// ─────────────────────────────────────────────
const PIECE_THEME_GLYPHS = {
  bB: '♝', bK: '♚', bN: '♞', bP: '♟', bQ: '♛', bR: '♜',
  wB: '♗', wK: '♔', wN: '♘', wP: '♙', wQ: '♕', wR: '♖'
};

function localPieceTheme(piece) {
  const glyph = PIECE_THEME_GLYPHS[piece] || '';
  const fill = piece && piece[0] === 'w' ? '#fff8ed' : '#17100c';
  const stroke = piece && piece[0] === 'w' ? '#2a1f17' : '#f1ebe0';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="45" height="45" viewBox="0 0 45 45"><text x="22.5" y="36" text-anchor="middle" font-family="Georgia,serif" font-size="41" fill="${fill}" stroke="${stroke}" stroke-width="0.45">${glyph}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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

function isCompactLayout() {
  return window.matchMedia && window.matchMedia('(max-width: 1100px)').matches;
}

function setMobileLibraryOpen(open) {
  const expanded = !!open;
  $('.app').toggleClass('mobile-library-open', expanded);
  $('#btn-mobile-openings')
    .attr('aria-expanded', String(expanded))
    .text(expanded ? 'Hide openings' : 'Change opening');
}

function scrollLibraryBoardIntoViewOnMobile() {
  if (!isCompactLayout()) return;
  window.requestAnimationFrame(() => {
    document.querySelector('.board-area')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

function scrollCoachBoardIntoViewOnMobile() {
  if (!isCompactLayout()) return;
  window.requestAnimationFrame(() => {
    document.querySelector('.coach-board-area')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

function orderedPracticeRunItems(items, firstItem) {
  const unique = [];
  const seen = new Set();
  const ordered = [firstItem].concat(items || []);
  ordered.forEach(item => {
    if (!item || seen.has(item.id) || !practiceIsDue(item)) return;
    seen.add(item.id);
    unique.push(item);
  });
  return unique.slice(0, PRACTICE_QUEUE_LIMIT);
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
  startCoachPractice(runItems[0], { preserveRun: true });
}

function practiceRunPositionText() {
  if (!coachPracticeRun) return 'Single drill';
  return `Drill ${coachPracticeRun.index + 1} of ${coachPracticeRun.items.length}`;
}

function startCoachPractice(item, opts = {}) {
  if (!item || !item.entry || !isValidFen(item.entry.fenBefore) || !item.entry.bestUci) {
    setCoachStatus('Practice position is no longer valid.');
    return;
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
    item,
    misses: 0,
    revealed: false,
    completed: false
  };
  coachUserSide = fenSideToUserSide(item.entry.fenBefore);
  coachGameActive = true;
  CoachController.setPhase('practice');
  clearCoachState();
  coachBoardFlipped = coachUserColor() === 'black';
  createCoachBoard(coachGame.fen(), coachBoardFlipped ? 'black' : 'white');
  $('#coach-view').addClass('game-active');
  $('#coach-practice-title').text(item.meta.title);
  $('#coach-practice-prompt').text(item.meta.practice + ' Find the best move in this position.');
  $('#coach-practice-session-status').text(practiceRunPositionText());
  $('#coach-practice-status').text('Attempt the move without engine help.');
  $('#btn-coach-practice-answer').prop('disabled', false);
  $('#btn-coach-practice-next').hide().prop('disabled', true);
  $('#coach-practice-banner').show().css('display', 'flex');
  $('#coach-keyboard-move-status').text('');
  setCoachStatus('Practice drill — find the best move.');
  updateCoachControlsState();
  scrollCoachBoardIntoViewOnMobile();
}

function coachPracticeMoveLabel(item) {
  if (!item || !item.entry) return 'the best move';
  if (item.entry.bestSan) return item.entry.bestSan;
  const move = moveFromUci(item.entry.fenBefore, item.entry.bestUci);
  return move ? move.san : item.entry.bestUci;
}

function coachHandlePracticeMove(source, target, promotion, opts) {
  const session = coachPracticeSession;
  if (!session || session.completed || !coachGameActive || !coachGame) return 'snapback';
  const temp = new Chess(coachGame.fen());
  const move = temp.move({ from: source, to: target, promotion: promotion || 'q' });
  if (!move) return 'snapback';
  const actualUci = uciFromMove(move);
  if (actualUci !== session.item.entry.bestUci) {
    session.misses += 1;
    recordPracticeAttempt(session.item, false, false);
    const hint = session.misses >= 2
      ? ` Hint: the best move starts on ${session.item.entry.bestUci.slice(0, 2)}.`
      : '';
    $('#coach-practice-status').text(`Not the best move yet.${hint}`);
    setCoachStatus('Practice: try another candidate.');
    renderInsights();
    return 'snapback';
  }

  const played = coachGame.move({ from: source, to: target, promotion: promotion || 'q' });
  if (!played) return 'snapback';
  session.completed = true;
  const record = recordPracticeAttempt(session.item, true, session.revealed);
  if (opts && opts.updateBoard !== false && coachBoard) coachBoard.position(coachGame.fen());
  updateCapturedDisplay(coachGame.fen());
  updateCoachBoardAccessibility();
  playSound(soundForMove(played, coachGame));
  const due = formatPracticeDue(record);
  const quality = session.revealed
    ? 'Solved after revealing the answer'
    : (session.misses > 0 ? `Correct after ${session.misses + 1} attempts` : 'Correct on the first try');
  $('#coach-practice-status').text(`${quality}: ${played.san}. ${due}.`);
  setCoachStatus(`${quality}. Practice progress saved.`);
  $('#btn-coach-practice-answer').prop('disabled', true);
  if (coachPracticeRun) {
    coachPracticeRun.completed += 1;
    if (session.revealed) coachPracticeRun.assisted += 1;
    else if (session.misses === 0) coachPracticeRun.clean += 1;
    const hasNext = coachPracticeRun.index + 1 < coachPracticeRun.items.length;
    $('#btn-coach-practice-next')
      .text(hasNext ? 'Next drill' : 'Finish session')
      .show()
      .prop('disabled', false);
    if (!hasNext) {
      $('#coach-practice-status').text(
        `${quality}: ${played.san}. Session complete — ${coachPracticeRun.clean}/${coachPracticeRun.completed} first-try.`
      );
    }
  }
  updateCoachControlsState();
  renderInsights();
  return 'correct';
}

function revealCoachPracticeAnswer() {
  const session = coachPracticeSession;
  if (!session || session.completed) return;
  if (!session.revealed) {
    session.revealed = true;
    recordPracticeAttempt(session.item, false, true);
    renderInsights();
  }
  const label = coachPracticeMoveLabel(session.item);
  $('#coach-practice-status').text(`Answer: ${label}. Play it on the board to complete the drill.`);
  $('#btn-coach-practice-answer').prop('disabled', true);
  setCoachStatus('Practice answer revealed — now play the move.');
}

function advanceCoachPractice() {
  if (!coachPracticeRun || !coachPracticeSession || !coachPracticeSession.completed) return;
  if (coachPracticeRun.index + 1 >= coachPracticeRun.items.length) {
    const completed = coachPracticeRun.completed;
    const clean = coachPracticeRun.clean;
    exitCoachPractice(`Practice session complete — ${clean}/${completed} solved on the first try.`);
    return;
  }
  coachPracticeRun.index += 1;
  startCoachPractice(coachPracticeRun.items[coachPracticeRun.index], { preserveRun: true });
}

function exitCoachPractice(message) {
  if (!coachPracticeSession) return;
  resetCoachState();
  coachGameActive = false;
  CoachController.setPhase('idle');
  createCoachBoard('start', 'white');
  $('#coach-view').removeClass('game-active');
  $('#coach-practice-banner').hide();
  setCoachStatus(message || 'Practice closed. Start a game or choose another due drill.');
  updateCoachControlsState();
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
          return coachHandlePracticeMove(source, target, 'q', { updateBoard: false });
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
      if (coachGame) coachBoard.position(coachGame.fen());
    }
  });
  updateCoachBoardAccessibility();
}

// ─────────────────────────────────────────────
// COACH VIEW SWITCHING
// ─────────────────────────────────────────────
function switchView(view) {
  appView = view;
  coachMode = (view === 'coach');
  const $app = $('.app');
  const $coach = $('#coach-view');
  if (view === 'coach') {
    $app.hide().attr('aria-hidden', 'true');
    $coach.show().css('display', 'grid').attr('aria-hidden', 'false');
    $('#nav-library').removeClass('active').attr('aria-selected', 'false');
    $('#nav-library').attr('tabindex', '-1');
    $('#nav-coach').addClass('active').attr({ 'aria-selected': 'true', tabindex: '0' });
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
    if (!coachGame) {
      // Try to restore an in-progress (or just-ended) game from localStorage.
      const restore = tryRestoreCoachGame();
      if (!restore.restored) {
        $('#coach-view').removeClass('game-active');
        // Show an idle board so the user has visual context
        $('#coachBoard-placeholder').hide();
        createCoachBoard('start', 'white');
        setCoachStatus(restore.warning || 'Set a level and start a new game.');
      }
    } else {
      // Returning to an existing game — resize the board and re-kick the
      // opponent if the previous respond was aborted by the view switch.
      if (coachBoard) setTimeout(() => coachBoard.resize(), 0);
      if (coachGameActive && !coachIsUserTurn() && !coachGame.game_over()) {
        coachOpponentRespond();
      }
    }
    updateCoachControlsState();
  } else {
    $coach.hide().attr('aria-hidden', 'true');
    $app.show().attr('aria-hidden', 'false');
    $('#nav-coach').removeClass('active').attr('aria-selected', 'false');
    $('#nav-coach').attr('tabindex', '-1');
    $('#nav-library').addClass('active').attr({ 'aria-selected': 'true', tabindex: '0' });
    // If library board exists, kick it into life via a resize so it redraws correctly
    if (board) setTimeout(() => board.resize(), 0);
  }
  updateURL();
}

function isValidFen(fen) {
  try {
    const g = new Chess();
    return g.load(fen);
  } catch (e) { return false; }
}

function startCoachGame() {
  const fenRaw = ($('#coach-fen').val() || '').trim();
  let startFen = null;
  if (fenRaw) {
    if (!isValidFen(fenRaw)) {
      $('#coach-fen-error').text('Invalid FEN — check the position string.').show();
      return;
    }
    startFen = fenRaw;
  }
  $('#coach-fen-error').hide();

  // Resolve "random" side
  const chosenSide = $('.side-toggle button.active').data('side') || 'white';
  coachUserSide = chosenSide === 'random'
    ? (Math.random() < 0.5 ? 'white' : 'black')
    : chosenSide;

  resetCoachState(startFen);
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
  scrollCoachBoardIntoViewOnMobile();

  const tier = strengthTierLabel(coachEngineElo);
  const opening = coachIsUserTurn()
    ? `Playing ${coachUserColor() === 'white' ? 'White' : 'Black'} vs Opponent ${coachEngineElo} (${tier}). Your move.`
    : `Playing ${coachUserColor() === 'white' ? 'White' : 'Black'} vs Opponent ${coachEngineElo} (${tier}). Opponent opens — thinking…`;
  setCoachStatus(opening);

  updateCoachControlsState();
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
  $('#btn-coach-candidates').prop('disabled', true);
}

// ─────────────────────────────────────────────
// CONTROL ENABLED-STATE
// ─────────────────────────────────────────────
function updateCoachControlsState() {
  const active = coachGameActive;
  const practicing = !!coachPracticeSession;
  const reviewing = coachIsReviewing();
  const hasReview = !!coachLastReview;
  const total = coachGame ? coachGame.history().length : 0;
  const cur = coachReviewCursor === null ? total : coachReviewCursor;
  $('#btn-coach-resign').prop('disabled', !active || reviewing || practicing);
  // "Open review" only appears once the game has ended and we have a summary to reopen.
  $('#btn-coach-openreview').toggle(!practicing && !active && !!coachLastEndMsg);
  $('#btn-coach-takeback').prop('disabled', practicing || !hasReview || reviewing || coachThinking);
  $('#btn-coach-showbest').prop('disabled', practicing || !hasReview || (coachLastReview && coachLastReview.tier === 'best') || reviewing || coachThinking);
  $('#btn-coach-candidates').prop('disabled', practicing || !active || !coachGame || !coachIsUserTurn() || reviewing || coachThinking);
  $('#btn-coach-prev').prop('disabled', practicing || !coachGame || total === 0 || cur === 0);
  $('#btn-coach-next').prop('disabled', practicing || !coachGame || total === 0 || cur === total);
  $('#btn-coach-live').toggle(reviewing);
  $('#coach-nav-label').text(
    practicing ? 'Practice' : !coachGame || total === 0 ? '' :
    reviewing ? `Move ${cur}/${total}` : `Move ${total} • Live`
  );
}

// ─────────────────────────────────────────────
// HISTORY NAVIGATION / REVIEW MODE
// ─────────────────────────────────────────────
function coachIsReviewing() {
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
  const total = coachGame.history().length;
  n = Math.max(0, Math.min(n, total));
  coachReviewCursor = n === total ? null : n;
  const fen = coachFenAtPly(n);
  if (coachBoard && fen) coachBoard.position(fen);
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
  coachReviewCursor = null;
  if (coachBoard) coachBoard.position(coachGame.fen());
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
// Returns { match, exact, matchedPlies } — exact=true only if every move in
// `sans` walked into a trie node; matchedPlies is how far the named opening
// extends (i.e. the depth of the last {eco,name}-bearing node we passed).
function identifyOpening(sans) {
  if (!sans || sans.length === 0) return { match: null, exact: false, matchedPlies: 0 };
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
  return { match: last, exact: walked === sans.length, matchedPlies: lastDepth };
}

function updateOpeningLabel() {
  if (!coachGame) {
    $('#opening-section').hide();
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
  const info = identifyOpening(sans);
  if (!info.match) {
    $('#opening-section').hide();
    return;
  }
  $('#coach-opening-eco').text(info.match.eco);
  if (info.exact) {
    // Still in book — just show the current opening name.
    $('#coach-opening-name').text(info.match.name);
  } else {
    // Out of book — pin the deepest named match and say after which move.
    const moveNum = Math.ceil(info.matchedPlies / 2);
    $('#coach-opening-name').text(
      `${info.match.name} — out of book after move ${moveNum}`
    );
  }
  $('#opening-section').show();
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
  for (const r of coachReviewLog) {
    if (r && r.ply) tierByPly[r.ply] = r.tier;
  }
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
    html += `<span class="${wClasses.join(' ')}" data-ply="${wPly}">${escapeHtml(wSan)}</span>`;
    if (bSan) {
      html += `<span class="${bClasses.join(' ')}" data-ply="${bPly}">${escapeHtml(bSan)}</span>`;
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
  const normalized = value.replace(/\s+/g, '').toLowerCase();
  return legalMoves.find(move => move.san.replace(/\s+/g, '').toLowerCase() === normalized) || null;
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

  // Play opponent's move after a short pause
  setTimeout(function () {
    if (!quizMode) return;
    if (quizReviewMode) return;
    game.move(moves[nextIdx]);
    currentMoveIdx = nextIdx;
    board.position(game.fen(), false);
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
  fetchExploreData();
  return true;
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
    if (move.san === expectedSAN) {
      game.move({ from: source, to: target, promotion });
      currentMoveIdx = expectedIdx;
      board.position(game.fen(), false);
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

  if (move.san === expectedSAN) {
    game.move({ from: source, to: target, promotion });
    currentMoveIdx = nextIdx;
    quizAttempts = 0;
    const exp = explanations[nextIdx];
    showFeedback('correct', '✓ ' + (exp ? exp.text : moveLabelForIndex(nextIdx)));
    setTimeout(() => {
      board.position(game.fen());
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
    return;
  }
  if (!quizMode) return;
  board.position(game.fen());
}

// ─────────────────────────────────────────────
// LOAD AN OPENING
// ─────────────────────────────────────────────
function loadOpening(id, lineId) {
  currentOpening = OPENINGS.find(o => o.id === id);
  if (!currentOpening) return;
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
  setMobileLibraryOpen(false);
  renderOpeningDetails();

  renderLineSelector();
  renderKeyIdeas();
  renderMoveList();
  renderExplanation(-1);
  updateProgress();
  updateBoardDraggable();
  clearFeedback();
  updateSRPanel();
  updateURL();
  scrollLibraryBoardIntoViewOnMobile();
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
  let html = '';
  for (let i = 0; i < moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    html += `<div class="move-pair">`;
    html += `<span class="move-num">${moveNum}.</span>`;
    // White move
    const wClass = i === currentMoveIdx ? 'current' : (i < currentMoveIdx ? 'played' : '');
    html += `<button class="move-chip ${wClass}" data-idx="${i}">${escapeHtml(moves[i])}</button>`;
    // Black move (if exists)
    if (i + 1 < moves.length) {
      const bClass = (i + 1) === currentMoveIdx ? 'current' : (i + 1 < currentMoveIdx ? 'played' : '');
      html += `<button class="move-chip ${bClass}" data-idx="${i + 1}">${escapeHtml(moves[i + 1])}</button>`;
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
    }
    renderExplanation(currentMoveIdx);
    clearFeedback();
  }
  updateSRPanel();
  updateURL();
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
// EXPLORE MODE — LICHESS TOKEN + API
// ─────────────────────────────────────────────
const LICHESS_TOKEN_KEY = 'lichess_token';
const EXPLORE_CACHE_TTL_MS = 10 * 60 * 1000;
const EXPLORE_CACHE_MAX = 120;
const exploreCache = new Map();
try { localStorage.removeItem(LICHESS_TOKEN_KEY); } catch (e) { /* ignore */ }
function getLichessToken() {
  try { return sessionStorage.getItem(LICHESS_TOKEN_KEY); }
  catch (e) { return null; }
}
function setLichessToken(t) {
  try { sessionStorage.setItem(LICHESS_TOKEN_KEY, t); return true; }
  catch (e) { return false; }
}
function clearLichessToken() {
  try { sessionStorage.removeItem(LICHESS_TOKEN_KEY); } catch (e) { /* ignore */ }
  try { localStorage.removeItem(LICHESS_TOKEN_KEY); } catch (e) { /* ignore */ }
}

function showExploreTokenState() {
  if (getLichessToken()) {
    $('#explore-token-setup').hide();
    $('#explore-continuations').show().css('display', 'flex');
  } else {
    $('#explore-continuations').hide();
    $('#explore-token-setup').show();
  }
}

function exploreCacheKey(db, fen) {
  return db + '|' + fen;
}

function getCachedExploreData(key) {
  const cached = exploreCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.time > EXPLORE_CACHE_TTL_MS) {
    exploreCache.delete(key);
    return null;
  }
  exploreCache.delete(key);
  exploreCache.set(key, cached);
  return cached.data;
}

function setCachedExploreData(key, data) {
  exploreCache.set(key, { time: Date.now(), data });
  while (exploreCache.size > EXPLORE_CACHE_MAX) {
    exploreCache.delete(exploreCache.keys().next().value);
  }
}

function fetchExploreData() {
  if (!exploreGame) return;
  const token = getLichessToken();
  if (!token) { showExploreTokenState(); return; }

  const fen = exploreGame.fen();
  const db = currentDb;
  const requestId = ++exploreRequestId;
  const cacheKey = exploreCacheKey(db, fen);
  const cached = getCachedExploreData(cacheKey);
  if (cached) {
    renderContinuations(cached, { cached: true });
    return;
  }
  const endpoint = db === 'masters'
    ? 'https://explorer.lichess.ovh/masters'
    : 'https://explorer.lichess.ovh/lichess';
  $('#continuations-list').html('<div class="explore-loading">Fetching data…</div>');
  $.ajax({
    url: endpoint,
    data: { fen: fen, topGames: 0, recentGames: 0 },
    dataType: 'json',
    headers: { 'Authorization': 'Bearer ' + token },
    success: function(data) {
      if (requestId !== exploreRequestId || !exploreMode || !exploreGame ||
          exploreGame.fen() !== fen || currentDb !== db) {
        return;
      }
      setCachedExploreData(cacheKey, data);
      renderContinuations(data);
    },
    error: function(xhr) {
      if (requestId !== exploreRequestId || !exploreMode || !exploreGame ||
          exploreGame.fen() !== fen || currentDb !== db) {
        return;
      }
      if (xhr.status === 401) {
        clearLichessToken();
        exploreCache.clear();
        showExploreTokenState();
        $('#token-error').text('Token invalid or expired — please reconnect.').show();
      } else {
        $('#continuations-list').html('<div class="explore-empty">Could not reach Lichess. Check your connection.</div>');
      }
    }
  });
}

function renderContinuations(data, opts) {
  const list = $('#continuations-list');
  const totalPos = (Number(data.white) || 0) + (Number(data.draws) || 0) + (Number(data.black) || 0);

  if (!data.moves || data.moves.length === 0) {
    const msg = totalPos === 0
      ? 'No games found for this position.'
      : `${formatNum(totalPos)} total games — no further continuations recorded.`;
    list.html(`<div class="explore-empty">${msg}</div>`);
    return;
  }

  list.empty();
  const cacheNote = opts && opts.cached ? ' · cached' : '';
  list.append($('<div class="explore-total"></div>').text(`${formatNum(totalPos)} games from this position${cacheNote}`));
  data.moves.slice(0, 8).forEach(function(m) {
    const white = Number(m.white) || 0;
    const draws = Number(m.draws) || 0;
    const black = Number(m.black) || 0;
    const total = white + draws + black;
    if (total === 0) return;
    const wPct = Math.round(white / total * 100);
    const dPct = Math.round(draws / total * 100);
    const bPct = 100 - wPct - dPct;
    const san = String(m.san || '');
    const $bar = $('<div class="cont-bar"></div>')
      .append($('<div class="cont-bar-w"></div>').css('width', wPct + '%'))
      .append($('<div class="cont-bar-d"></div>').css('width', dPct + '%'))
      .append($('<div class="cont-bar-b"></div>').css('width', bPct + '%'));
    const $row = $('<div class="continuation-row"></div>')
      .attr('data-san', san)
      .append($('<div class="cont-move"></div>').text(san))
      .append($('<div class="cont-bar-wrap"></div>')
        .append($bar)
        .append($('<div class="cont-pct"></div>').text(`${wPct}% · ${dPct}% · ${bPct}%`)))
      .append($('<div class="cont-games"></div>').text(formatNum(total)));
    list.append($row);
  });

  // Click a continuation to play it
  list.find('.continuation-row').on('click', function() {
    const san = $(this).attr('data-san');
    if (exploreGame.move(san)) {
      board.position(exploreGame.fen());
      fetchExploreData();
    }
  });
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return n.toString();
}

// ─────────────────────────────────────────────
// EVENT HANDLERS
// ─────────────────────────────────────────────
$(function () {
  // Board is initialized lazily on first opening selection
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

  $('#btn-mobile-openings').on('click', function() {
    setMobileLibraryOpen($(this).attr('aria-expanded') !== 'true');
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
  $('.top-nav-btn').on('keydown', function(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const nextView = (event.key === 'ArrowLeft' || event.key === 'Home') ? 'library' : 'coach';
    switchView(nextView);
    $('#nav-' + nextView).trigger('focus');
  });

  // ─── Coach settings ─────────────────────
  $('#coach-strength').on('input', function() {
    coachEngineElo = parseInt($(this).val(), 10);
    $('#coach-strength-value').text(coachEngineElo);
    $('#coach-strength-tier').text(strengthTierLabel(coachEngineElo));
  });

  $('.side-toggle button').on('click', function() {
    $('.side-toggle button').removeClass('active').attr('aria-pressed', 'false');
    $(this).addClass('active').attr('aria-pressed', 'true');
    const side = $(this).data('side');
    coachUserSide = side; // 'white' | 'black' | 'random'
  });

  $('#coach-fen').on('input', function() {
    $('#coach-fen-error').hide();
  });

  $('#coach-auth-email-form').on('submit', function(event) {
    event.preventDefault();
    sendCoachLoginLink().catch(handleCoachDbError);
  });
  $('#btn-coach-logout').on('click', function() {
    signOutCoach().catch(handleCoachDbError);
  });
  $('#btn-coach-sync').on('click', async function() {
    if (!hasCoachDbSession()) {
      setCoachDbStatus('Sign in to sync games.');
      return;
    }
    setCoachDbStatus('Syncing...');
    const [insightsResult, gameResult] = await Promise.allSettled([
      coachSync.loadInsights(),
      coachSync.saveGame(coachGameActive ? null : coachLastEndMsg)
    ]);
    const insightError = insightsResult.status === 'rejected' ? insightsResult.reason : null;
    const gameError = gameResult.status === 'rejected' ? gameResult.reason : null;
    if (insightError && gameError) {
      setCoachDbStatus('Sync failed: ' + ((gameError && gameError.message) || (insightError && insightError.message) || 'Unknown error'));
    } else if (insightError) {
      setCoachDbStatus('Game saved, insights failed: ' + ((insightError && insightError.message) || 'Unknown error'));
    } else if (gameError) {
      setCoachDbStatus('Insights loaded, game save failed: ' + ((gameError && gameError.message) || 'Unknown error'));
    } else {
      setCoachDbStatus('Game and insights synced.');
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
    const due = Array.from(renderedPracticeItems.values()).filter(item => practiceIsDue(item));
    startCoachPracticeSession(due, due[0]);
  });
  $('#btn-coach-practice-answer').on('click', revealCoachPracticeAnswer);
  $('#btn-coach-practice-next').on('click', advanceCoachPractice);
  $('#btn-coach-practice-exit').on('click', function() { exitCoachPractice(); });

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
    const result = coachPracticeSession
      ? coachHandlePracticeMove(move.from, move.to, move.promotion || 'q', { updateBoard: true })
      : await coachHandleUserMove(move.from, move.to, move.promotion || 'q', { updateBoard: true });
    if (result === 'snapback') {
      $status.text(coachPracticeSession ? 'Not the best move yet. Try again.' : 'That move could not be played.');
      return;
    }
    if (result === 'stale') {
      $status.text('The position changed before analysis finished.');
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
    CoachController.setPhase('ended');
    candidateRequestId++;
    threatRequestId++;
    clearPremove();
    coachGameActive = false;
    coachEndedAt = Date.now();
    const loser = coachUserColor() === 'white' ? 'White' : 'Black';
    const winner = loser === 'White' ? 'Black' : 'White';
    const msg = `Resigned — ${winner} wins.`;
    setCoachStatus(msg);
    updateCoachControlsState();
    coachLastEndMsg = msg;
    saveCoachState();
    coachSync.saveGame(msg).catch(handleCoachDbError);
    rollGameIntoLifetime();
    // User-initiated — keep it snappy but still buffer with a small beat + animation.
    scheduleSummaryReveal(msg, 350);
  });

  // Coach: flip board
  $('#btn-coach-flip').on('click', function() {
    if (!coachBoard) return;
    coachBoardFlipped = !coachBoardFlipped;
    coachBoard.flip();
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
    if (coachLastReview && coachStats) {
      coachStats.moves = Math.max(0, coachStats.moves - 1);
      coachStats[coachLastReview.tier] = Math.max(0, (coachStats[coachLastReview.tier] || 0) - 1);
    }
    coachLastReview = null;
    coachThinking = false;
    coachGameActive = true;
    CoachController.setPhase('userTurn');
    coachReviewCursor = null;
    if (coachBoard) coachBoard.position(coachGame.fen());
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
    setCoachStatus('Your move.');
    updateCoachControlsState();
    saveCoachState();
    coachSync.deleteMove(removedReview).catch(handleCoachDbError);
  });

  // Coach: show best — replay the best move instead of the user's
  $('#btn-coach-showbest').on('click', function() {
    if (!coachMode || !coachGame || !coachLastReview || !coachLastReview.bestUci) return;
    invalidateCoachAsyncWork('The best-move replay replaced the prior position.');
    const prev = coachLastReview;
    // Undo opponent reply (if played) + user move
    if (coachGame.fen() !== prev.fenAfter) coachGame.undo();
    coachGame.undo();
    // Play best move
    const bu = prev.bestUci;
    coachGame.move({ from: bu.slice(0, 2), to: bu.slice(2, 4), promotion: bu[4] || undefined });
    const newFenAfter = coachGame.fen();
    // Adjust stats: convert prior classification to 'best'
    if (coachStats) {
      coachStats[prev.tier] = Math.max(0, (coachStats[prev.tier] || 0) - 1);
      coachStats.best = (coachStats.best || 0) + 1;
    }
    if (coachBoard) coachBoard.position(newFenAfter);
    updateCapturedDisplay(newFenAfter);
    renderCoachReview({
      tier: 'best', label: 'Best move', emoji: '★',
      loss: 0,
      bestSan: prev.bestSan,
      userSan: prev.bestSan,
      pvSan: prev.pvSan
    });
    // Keep a review pointer so take-back can roll back cleanly
    coachLastReview = {
      tier: 'best',
      fenBefore: prev.fenBefore,
      fenAfter: newFenAfter,
      userUci: prev.bestUci,
      bestUci: prev.bestUci,
      bestSan: prev.bestSan
    };
    // Also fix the rolling review log so tier coloring reflects the swap.
    if (coachReviewLog && coachReviewLog.length > 0) {
      const last = coachReviewLog[coachReviewLog.length - 1];
      last.tier = 'best';
      last.userSan = prev.bestSan;
      last.userUci = prev.bestUci;
      last.fenAfter = newFenAfter;
      last.loss = 0;
      last.insightTags = [];
      last.gameGeneration = coachGameGeneration;
      last.localGameId = coachLocalGameId;
      coachSync.saveMove(last).catch(handleCoachDbError);
    }
    updateCoachSummary();
    updateMoveList();
    updateOpeningLabel();
    CoachController.setPhase('opponentThinking');
    setCoachStatus('Opponent thinking…');
    updateCoachControlsState();
    saveCoachState();
    if (coachGame.game_over()) { coachHandleGameOver(); return; }
    coachOpponentRespond();
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
    if (!coachMode || !coachGame) return;
    // Ignore if the user is typing (inputs, textareas, contenteditable).
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
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
          : 'Could not reach Lichess. Try again.';
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
    if ($('#promotion-picker').is(':visible')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePromotionPicker();
        return;
      }
      trapDialogTab(e, document.getElementById('promotion-picker'));
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // In coach view, only handle the flip shortcut; everything else is scoped to library
    if (coachMode) {
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        $('#btn-coach-flip').trigger('click');
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
    if (!coachMode || !coachGameActive || !coachGame) return;
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
  } else if (initial.opening) {
    const op = OPENINGS.find(o => o.id === initial.opening);
    if (op) {
      loadOpening(op.id, initial.line || 'main');
      if (initial.mode === 'quiz') setMode('quiz');
      else if (initial.mode === 'explore') setMode('explore');
      else if (!isNaN(initial.move) && initial.move >= 0) goToMove(initial.move);
    }
  } else if (initial.mode === 'explore') {
    setMode('explore');
  }
  }

  bindLibraryEvents();
  bindCoachEvents();
  bindExploreEvents();
  bindGlobalInputEvents();
  updateSRSidebar();
  validateOpeningData();
  hydrateFromUrl();
});
