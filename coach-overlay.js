// Coach board feedback drawn on the board itself: a move-quality badge on the
// square your reviewed move landed on, a green arrow for the engine's choice
// when yours was not among its top moves, and an evaluation bar. Drills hide
// all of it so the board never gives away an answer.
(function() {
  'use strict';
  const SETTING_KEY = 'ui:board-feedback';
  const ARROW_TIERS = new Set(['good', 'inaccuracy', 'mistake', 'blunder']);

  function enabled() {
    try { return localStorage.getItem(SETTING_KEY) !== 'off'; } catch (e) { return true; }
  }

  function reviewForPly(ply) {
    if (typeof coachReviewLog === 'undefined' || !Array.isArray(coachReviewLog)) return null;
    for (let i = coachReviewLog.length - 1; i >= 0; i--) {
      const r = coachReviewLog[i];
      if (r && r.ply === ply && (!r.localGameId || typeof coachLocalGameId === 'undefined' || r.localGameId === coachLocalGameId)) return r;
    }
    return null;
  }

  // Engine scores are from the side to move after the user's move, so flip
  // to the user's view, then to White's.
  function whiteEval(review) {
    if (!review || !review.evalAfter || review.tier === 'unknown') return null;
    const info = review.evalAfter;
    const userWhite = String(review.fenBefore || '').split(' ')[1] === 'w';
    const sign = userWhite ? -1 : 1;
    if (info.mate !== null && info.mate !== undefined) return { cp: 0, mate: sign * info.mate };
    return { cp: sign * (info.cp || 0), mate: null };
  }

  function latestEvalAtOrBefore(ply) {
    if (typeof coachReviewLog === 'undefined' || !Array.isArray(coachReviewLog)) return null;
    let best = null;
    coachReviewLog.forEach(r => {
      if (!r || r.ply > ply || r.tier === 'unknown' || !r.evalAfter) return;
      if (r.localGameId && typeof coachLocalGameId !== 'undefined' && r.localGameId !== coachLocalGameId) return;
      if (!best || r.ply > best.ply) best = r;
    });
    return best;
  }

  function spec() {
    if (!enabled() || typeof coachGame === 'undefined' || !coachGame) return null;
    if (typeof coachPracticeSession !== 'undefined' && coachPracticeSession) return null;
    const orientation = typeof coachBoard !== 'undefined' && coachBoard && coachBoard.orientation ? coachBoard.orientation() : 'white';
    // "Show why" steps through an engine line: draw its next move.
    if (typeof coachReviewAnalysis !== 'undefined' && coachReviewAnalysis) {
      const step = coachReviewAnalysis.steps[coachReviewAnalysis.index + 1];
      const move = step && step.move;
      return { arrows: move ? [{ from: move.from, to: move.to, kind: 'best' }] : [], badges: [] };
    }
    const shown = typeof coachReviewCursor !== 'undefined' && coachReviewCursor !== null ? coachReviewCursor : coachGame.history().length;
    const out = { arrows: [], badges: [] };
    const review = reviewForPly(shown);
    if (review && review.userUci && review.tier && review.tier !== 'unknown') {
      out.badges.push({ square: review.userUci.slice(2, 4), tier: review.flair || review.tier });
      // The engine's choice only makes sense on the position it was found in.
      if (ARROW_TIERS.has(review.tier) && review.bestUci && review.bestUci !== review.userUci) {
        out.arrows.push({ from: review.bestUci.slice(0, 2), to: review.bestUci.slice(2, 4), kind: 'best' });
      }
    } else {
      // After the opponent's reply, keep the badge on your last move while
      // your piece still stands on that square.
      const previous = reviewForPly(shown - 1);
      if (previous && previous.userUci && previous.tier && previous.tier !== 'unknown') {
        const square = previous.userUci.slice(2, 4);
        const fen = shown === coachGame.history().length ? coachGame.fen() : (typeof coachFenAtPly === 'function' ? coachFenAtPly(shown) : null);
        const position = fen ? new Chess(fen) : null;
        const piece = position && position.get(square);
        const userColor = String(previous.fenBefore || '').split(' ')[1];
        if (piece && piece.color === userColor) out.badges.push({ square, tier: previous.flair || previous.tier });
      }
    }
    const evalReview = latestEvalAtOrBefore(shown);
    const ev = whiteEval(evalReview);
    if (ev) out.eval = Object.assign(ev, { orientation, stale: evalReview.ply !== shown });
    return out;
  }

  function refresh() {
    if (!window.BoardOverlay) return;
    const s = spec();
    if (s) window.BoardOverlay.set('coachBoard', 'coachBoard-wrap', s);
    else window.BoardOverlay.set('coachBoard', 'coachBoard-wrap', null);
  }

  // Board redraws (moves, cursor steps, flips) and review arrivals both come
  // through DOM changes on the board or the review panel, so follow those
  // instead of threading calls through the game loop.
  function watch() {
    const board = document.getElementById('coachBoard');
    const review = document.getElementById('coach-review');
    const analysis = document.getElementById('coach-review-analysis');
    let frame = null;
    const queue = () => { if (!frame) frame = requestAnimationFrame(() => { frame = null; refresh(); }); };
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(queue);
      if (board) mo.observe(board, { childList: true, subtree: true });
      if (review) mo.observe(review, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
      if (analysis) mo.observe(analysis, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
    }
    const toggle = document.getElementById('board-feedback-toggle');
    if (toggle) {
      toggle.checked = enabled();
      toggle.addEventListener('change', () => {
        try { localStorage.setItem(SETTING_KEY, toggle.checked ? 'on' : 'off'); } catch (e) { /* this page only */ }
        refresh();
      });
    }
    refresh();
  }

  window.CoachOverlay = { refresh, spec };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
