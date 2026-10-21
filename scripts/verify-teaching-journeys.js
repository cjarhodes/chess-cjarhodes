// Playwright CLI run-code body. Uses real moves, engine reviews, and UI actions
// in an isolated session; can also verify the public custom domain.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/*', route => route.continue());
  const fixtures = await page.evaluate(() => {
    const fen = moves => { const game = new Chess(); moves.forEach(move => game.move(move)); return game.fen(); };
    return [
      { id: 'hanging-piece', fen: fen(['e4', 'e5', 'Qh5', 'Nc6']), move: 'h5e5', consequence: 'queen', cue: 'destination' },
      { id: 'missed-tactic', fen: '7k/8/5KQ1/8/8/8/8/8 w - - 0 1', move: 'g6e4', consequence: 'immediate checkmate', cue: 'checks' },
      { id: 'king-exposure', fen: fen(['f3', 'e5']), move: 'g2g4', consequence: 'checkmate', cue: 'diagonals' },
      { id: 'poor-development', fen: fen(['e4', 'e5', 'Nf3', 'Nc6']), move: 'h2h4', consequence: 'engine suggests', cue: 'undeveloped' },
      { id: 'endgame', fen: '7k/5K2/6Q1/8/8/8/8/8 w - - 0 1', move: 'g6f5', consequence: 'stalemate', cue: 'legal reply' }
    ];
  });
  const results = [];
  const play = async move => {
    await page.locator('#coach-keyboard-move').evaluate(el => { el.open = true; });
    await page.locator('#coach-keyboard-move-input').fill(move);
    await page.locator('#coach-keyboard-move-form button[type=submit]').click();
    await page.waitForFunction(() => !coachPracticeSession || (!coachPracticeSession.grading && !coachPracticeSession.pendingMove), null, { timeout: 45000 });
  };
  const snapshot = () => page.evaluate(() => ({ pgn: coachGame.pgn(), id: coachLocalGameId, stats: JSON.stringify(coachStats), active: coachGameActive }));
  for (const fixture of fixtures) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('#group-position').evaluate(el => { el.open = true; });
    await page.locator('#coach-fen').fill(fixture.fen);
    await page.locator('.side-toggle button[data-side="white"]').click();
    await page.locator('#btn-coach-newgame').click();
    await play(fixture.move);
    await page.waitForFunction(() => !coachThinking && !!coachLastReview && (!coachGameActive || coachIsUserTurn()), null, { timeout: 60000 });
    // Ended positions open a delayed summary; close it before reviewing.
    if (await page.evaluate(() => !coachGameActive)) {
      await page.locator('#summary-overlay').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('#btn-summary-close').click();
    }
    await page.locator('#tab-game').click();
    const review = await page.evaluate(() => coachLastReview);
    assert(review.tier !== 'unknown' && review.bestUci, fixture.id + ': engine review missing');
    assert(await page.locator('#coach-review-consequence').isVisible(), fixture.id + ': consequence hidden');
    assert((await page.locator('#coach-review-consequence').textContent()).includes(fixture.consequence), fixture.id + ': wrong consequence');
    assert((await page.locator('#coach-review-cue').textContent()).includes(fixture.cue), fixture.id + ': reusable decision cue missing');
    const before = await snapshot();
    await page.locator('#btn-coach-consequence').click();
    assert((await page.locator('#coach-review-analysis').textContent()).includes('possible consequence'), fixture.id + ': hypothetical line mislabeled');
    const consequence = await page.evaluate(() => {
      const analysis = coachReviewAnalysis;
      const game = new Chess(analysis.steps[0].fen);
      return analysis.steps.slice(1).every(step => {
        const move = game.move({ from: step.move.from, to: step.move.to, promotion: step.move.promotion });
        return move && game.fen() === step.fen;
      });
    });
    assert(consequence, fixture.id + ': illegal consequence replay');
    await page.locator('#btn-coach-backtogame').click();
    await page.locator('#btn-coach-showwhy').click();
    assert(await page.evaluate(() => coachReviewAnalysis.steps[1].move.from + coachReviewAnalysis.steps[1].move.to === coachLastReview.bestUci.slice(0, 4)), fixture.id + ': recommended replay mismatch');
    await page.locator('#btn-coach-backtogame').click();
    assert(JSON.stringify(await snapshot()) === JSON.stringify(before), fixture.id + ': demonstration changed the real game ' + JSON.stringify({before, after:await snapshot()}));
    await page.locator('#btn-coach-review-practice').click();
    await page.waitForFunction(() => coachPracticeSession && coachPracticeSession.analysisReady, null, { timeout: 45000 });
    assert(!(await page.locator('#coach-practice-takeaway').isVisible()), fixture.id + ': takeaway leaked before solving');
    await play(fixture.move);
    assert(await page.evaluate(() => coachPracticeSession.misses === 1 && !coachPracticeSession.completed), fixture.id + ': original mistake was accepted');
    const expected = await page.evaluate(() => ({ uci: coachPracticeSession.expectedUci, san: uciToSan(coachGame.fen(), coachPracticeSession.expectedUci) }));
    const prompt = await page.locator('#coach-practice-prompt').textContent();
    await page.locator('#btn-coach-practice-hint').click();
    const idea = await page.locator('#coach-practice-status').textContent();
    assert(idea !== prompt && !idea.includes(expected.san), fixture.id + ': first hint repeats prompt or reveals answer');
    await page.locator('#btn-coach-practice-hint').click();
    assert((await page.locator('#coach-practice-status').textContent()).includes(expected.uci.slice(0, 2)), fixture.id + ': second hint did not locate a piece');
    await page.locator('#btn-coach-practice-hint').click();
    assert((await page.locator('#coach-practice-status').textContent()).includes(expected.uci.slice(2, 4)), fixture.id + ': third hint did not locate destination');
    // Grade another sound move whenever one exists, including equivalent mates.
    const candidate = await page.evaluate(() => {
      const session = coachPracticeSession;
      const moves = coachGame.moves({ verbose: true });
      const alternateMate = moves.find(move => {
        const uci = uciFromMove(move);
        return uci !== session.expectedUci && practiceMoveIsMate(coachGame.fen(), uci);
      });
      if (alternateMate) return uciFromMove(alternateMate);
      if (practiceMoveIsMate(coachGame.fen(), session.expectedUci)) return session.expectedUci;
      return Object.keys(session.analysis.known).find(uci => uci !== session.expectedUci && session.analysis.bestCp - session.analysis.known[uci] <= 60) || session.expectedUci;
    });
    await play(candidate);
    if (await page.evaluate(() => coachPracticeSession.phase === 'followup')) {
      await page.waitForFunction(() => coachPracticeSession.analysisReady, null, { timeout: 45000 });
      await play(await page.evaluate(() => coachPracticeSession.expectedUci));
    }
    assert(await page.evaluate(() => coachPracticeSession.completed), fixture.id + ': sound move rejected');
    assert((await page.locator('#coach-practice-takeaway').textContent()).includes(fixture.cue), fixture.id + ': completion lost the decision cue');
    const progress = await page.evaluate(() => practiceRecordFor(coachPracticeSession.item));
    assert(progress && progress.attempts >= 2 && progress.lastResult === 'assisted', fixture.id + ': assisted practice not recorded');
    await page.locator('#btn-coach-practice-next').click();
    if (before.active) assert(JSON.stringify(await snapshot()) === JSON.stringify(before), fixture.id + ': practice handoff changed preserved game');
    await page.reload();
    assert(await page.evaluate(fixture => loadInsights().entries.some(entry => entry.userUci === fixture.move && entry.decisionCue && entry.decisionCue.includes(fixture.cue)), fixture), fixture.id + ': saved teaching cue did not survive reload');
    results.push({ journey: fixture.id, review: 'consequence and cue visible', replay: 'legal and game preserved', hints: 'idea, piece, destination', soundAlternative: candidate !== expected.uci, takeaway: 'saved cue' });
  }
  assert(errors.length === 0, 'Page errors: ' + errors.join(' | '));
  return { journeys: results, pageErrors: errors.length };
}
