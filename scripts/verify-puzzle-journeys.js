// Puzzles view journeys in fresh browser contexts: rated solving by click,
// drag and keyboard; a wrong move, hint and solution; replay; the daily
// puzzle; Puzzle Rush to the end of a run; Vision; navigation, URL state and
// fit at desktop sizes. Board moves go through the real UI.
async browserPage => {
  const base = browserPage.url().split('?')[0], browser = browserPage.context().browser();
  const contexts = [], errors = [], checks = [];
  const assert = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
  let page;
  const fresh = async (query = '?view=puzzles') => {
    if (page) await page.context().close();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(context);
    page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
    await page.goto(base + query);
  };
  const info = () => page.evaluate(() => {
    const d = PuzzlesView._debug(), s = d.session;
    return { mode: d.mode, phase: s && s.phase, busy: s && s.busy, ply: s && s.ply, outcome: s && s.outcome, source: s && s.source,
      id: s && s.puzzle.id, moves: s && s.puzzle.moves, rating: d.state.rating, history: d.state.history.length, rush: !!d.rush, vision: d.vision };
  });
  const ready = () => page.waitForFunction(() => { const s = PuzzlesView._debug().session; return s && s.phase === 'solving' && !s.busy; }, null, { timeout: 15000 });
  const click = async uci => {
    await page.locator(`#puzzleBoard .square-${uci.slice(0, 2)}`).click();
    await page.locator(`#puzzleBoard .square-${uci.slice(2, 4)}`).click();
    if (uci.length === 5) await page.locator(`#promotion-picker .promotion-choice[data-promotion="${uci[4]}"]`).click();
  };
  const type = async uci => {
    await page.locator('#puzzle-keyboard-move').evaluate(e => { e.open = true; });
    await page.locator('#puzzle-keyboard-move-input').fill(uci);
    await page.locator('#puzzle-keyboard-move-form button[type=submit]').click();
  };
  const drag = async uci => {
    const from = await page.locator(`#puzzleBoard .square-${uci.slice(0, 2)}`).boundingBox();
    const to = await page.locator(`#puzzleBoard .square-${uci.slice(2, 4)}`).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    if (uci.length === 5) await page.locator(`#promotion-picker .promotion-choice[data-promotion="${uci[4]}"]`).click();
  };
  const solveWith = async how => {
    const { moves } = await info();
    for (let i = 1; i < moves.length; i += 2) { await ready(); await how(moves[i]); }
    await page.waitForFunction(() => PuzzlesView._debug().session.phase === 'solved', null, { timeout: 15000 });
  };
  const wrongMove = () => page.evaluate(() => {
    const s = PuzzlesView._debug().session, exp = s.puzzle.moves[s.ply];
    const probe = m => { const g = new Chess(s.game.fen()); g.move(m.san); return g.in_checkmate(); };
    const mv = s.game.moves({ verbose: true }).find(m => m.from + m.to !== exp.slice(0, 4) && !m.promotion && !probe(m));
    return mv.from + mv.to;
  });
  const fits = () => page.evaluate(() => {
    const board = document.getElementById('puzzleBoard').getBoundingClientRect();
    const controls = document.querySelector('.puzzle-controls').getBoundingClientRect();
    return board.width >= 380 && board.bottom <= innerHeight && controls.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth;
  });

  try {
    // ── Navigation and first load ──
    await fresh('?view=coach');
    await page.locator('#nav-puzzles').click();
    await ready();
    assert(await page.locator('#nav-puzzles').getAttribute('aria-selected') === 'true', 'Puzzles tab is selected');
    assert(await page.locator('#coach-view').isHidden() && await page.locator('#library-view').isHidden(), 'other views are hidden');
    assert((await page.evaluate(() => location.search)) === '?view=puzzles', 'URL records the Puzzles view');
    await page.locator('#nav-puzzles').focus();
    await page.keyboard.press('ArrowLeft');
    assert(await page.evaluate(() => document.activeElement.id) === 'nav-coach', 'ArrowLeft from Puzzles reaches Coach');
    await page.keyboard.press('End');
    assert(await page.evaluate(() => document.activeElement.id === 'nav-puzzles' && appView === 'puzzles'), 'End reaches Puzzles');
    for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250);
      assert(await fits(), `board and controls fit at ${w}x${h}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // ── Rated: first-try solve by click raises the rating ──
    let before = await info();
    assert(before.mode === 'rated' && before.source === 'rated' && before.ply === 1, 'a rated puzzle starts after the opponent move');
    assert(!(await page.locator('#puzzle-card-rating').textContent()), 'the puzzle rating is hidden while solving');
    await solveWith(click);
    let after = await info();
    assert(after.outcome === 'win' && after.rating > before.rating && after.history === 1, 'a first-try solve is recorded and raises the rating');
    assert(await page.locator('#puzzle-themes').isVisible() && await page.locator('#puzzle-source').isVisible(), 'themes and source appear after solving');
    assert(!(await page.locator('#btn-puzzle-retry').isDisabled()) && await page.locator('#btn-puzzle-hint').isDisabled(), 'retry is offered and hints are off after solving');

    // ── Rated: a wrong move costs rating once, then the puzzle can be finished ──
    await page.locator('#btn-puzzle-next').click(); await ready();
    before = await info();
    await click(await wrongMove());
    await page.waitForFunction(() => PuzzlesView._debug().session.outcome === 'loss');
    after = await info();
    assert(after.rating < before.rating && after.history === before.history + 1, 'the first wrong move is a rated miss');
    await ready();
    assert(after.ply === before.ply, 'a wrong move is taken back');
    await click(await wrongMove()); await page.waitForTimeout(800);
    assert((await info()).history === after.history, 'a second wrong move is not recorded again');
    await solveWith(drag);
    assert((await info()).history === after.history, 'finishing after a miss does not record a win');

    // ── Hint counts as a miss; solution plays out; keyboard entry works ──
    await page.locator('#btn-puzzle-next').click(); await ready();
    before = await info();
    await page.keyboard.press('h');
    assert(await page.locator('#puzzleBoard .hint-square').count() === 1, 'the first hint marks the piece');
    await page.locator('#btn-puzzle-hint').click();
    assert(await page.locator('#puzzleBoard .hint-square').count() === 2, 'the second hint marks the target square');
    after = await info();
    assert(after.outcome === 'loss' && after.rating < before.rating, 'a hint counts as a miss');
    await page.locator('#btn-puzzle-solution').click();
    await page.waitForFunction(() => PuzzlesView._debug().session.phase === 'solved', null, { timeout: 20000 });
    assert((await info()).ply === after.moves.length && (await info()).history === after.history, 'the solution plays every move without another record');

    // ── Replay from history is unrated ──
    const ratingBeforeReplay = (await info()).rating;
    await page.locator('#puzzle-history .puzzle-history-item').last().click(); await ready();
    assert((await info()).source === 'replay', 'history replays are marked unrated');
    await solveWith(type);
    assert((await info()).rating === ratingBeforeReplay, 'a replay does not change the rating');

    // ── Theme filter selects matching puzzles ──
    await page.locator('#puzzle-theme').selectOption('fork'); await ready();
    assert(await page.evaluate(() => PuzzlesView._debug().session.puzzle.themes.includes('fork')), 'the theme filter picks a fork');

    // ── Persistence across reload ──
    const saved = await info();
    await page.reload(); await ready();
    const reloaded = await info();
    assert(Math.round(reloaded.rating) === Math.round(saved.rating) && reloaded.history === saved.history, 'rating and history survive a reload');
    assert(await page.locator('#puzzle-theme').inputValue() === 'fork', 'the theme choice survives a reload');
    // ── Account sync copy: progress rides in the synced growth state, and a
    // copy from another browser (or a backup import) merges in on load ──
    const synced = await page.evaluate(() => loadGrowthState().puzzles);
    assert(synced && synced.history.length === reloaded.history && Math.round(synced.rating) === Math.round(reloaded.rating), 'puzzle progress is copied into the synced training profile');
    await page.evaluate(() => {
      const growth = loadGrowthState();
      const remote = PuzzleCore.recordAttempt(growth.puzzles, { id: 'from-other-browser', rating: 2400, themes: ['fork'] }, { win: true }, Date.now() + 1000).state;
      growth.puzzles = PuzzleCore.compactState(remote);
      saveGrowthState(growth, undefined, { skipSync: true });
    });
    await page.reload(); await ready();
    const mergedState = await page.evaluate(() => PuzzlesView._debug().state);
    assert(mergedState.history.some(row => row.id === 'from-other-browser') && mergedState.rating > reloaded.rating, 'a synced copy from another browser merges into local puzzle progress');

    // ── Daily puzzle ──
    await page.locator('#puzzle-mode-daily').click(); await ready();
    const daily = await info();
    assert(daily.source === 'daily' && (await page.evaluate(() => location.search)).includes('mode=daily'), 'the daily puzzle opens with its own URL');
    await solveWith(type);
    assert(await page.evaluate(() => { const d = PuzzlesView._debug().state.daily; const k = PuzzleCore.dayKey(); return d[k] && d[k].solved && d[k].firstTry; }), 'the daily result is stored');
    assert((await info()).rating === mergedState.rating, 'the daily puzzle is unrated');
    await page.locator('#puzzle-mode-daily').click(); await ready();
    assert((await info()).id === daily.id && (await info()).source === 'daily-retry', 'reopening the daily puzzle is a retry of the same puzzle');
    assert((await page.locator('#puzzle-daily-detail').textContent()).includes('Solved'), 'the daily mode shows today is solved');

    // ── Puzzle Rush: solve two, miss three ──
    await page.locator('#puzzle-mode-rush').click();
    await page.locator('#btn-puzzle-rush-start').click(); await ready();
    assert(await page.locator('#puzzle-rush-bar').isVisible() && await fits(), 'the Rush clock shows and the board still fits');
    const rushRating = (await info()).rating;
    for (let n = 0; n < 2; n++) {
      const { id, moves } = await info();
      for (let i = 1; i < moves.length; i += 2) { await ready(); await type(moves[i]); }
      await page.waitForFunction(old => { const s = PuzzlesView._debug().session; return s && s.puzzle.id !== old; }, id);
    }
    for (let n = 0; n < 3; n++) { await ready(); await type(await wrongMove()); await page.waitForTimeout(50); }
    await page.waitForFunction(() => !PuzzlesView._debug().rush, null, { timeout: 10000 });
    assert(await page.evaluate(() => PuzzlesView._debug().state.rush.best.three === 2), 'the Rush score is saved as the best');
    assert(await page.locator('#puzzle-rush-review li').count() === 5, 'the run review lists every puzzle');
    assert((await info()).rating === rushRating, 'Rush does not change the puzzle rating');
    assert(!(await page.locator('#btn-puzzle-rush-start').isHidden()), 'a finished run offers another');

    // ── Vision ──
    await page.locator('#puzzle-mode-vision').click();
    await page.locator('#puzzle-vision-side button[data-side="black"]').click();
    await page.locator('#btn-puzzle-vision-start').click();
    assert(await page.evaluate(() => document.querySelectorAll('#puzzleBoard .notation-322f9').length === 0), 'Vision hides coordinates');
    assert(await fits(), 'the Vision prompt and board fit');
    for (let i = 0; i < 5; i++) {
      const target = await page.locator('#puzzle-vision-prompt').textContent();
      await page.locator(`#puzzleBoard .square-${target}`).click();
    }
    const v = (await info()).vision;
    assert(v && v.score === 5 && v.mistakes === 0 && v.side === 'black', 'Vision scores correct clicks on a Black-side board');
    await page.evaluate(() => { PuzzlesView._debug().vision.endsAt = Date.now(); });
    await page.waitForFunction(() => !PuzzlesView._debug().vision);
    assert(await page.evaluate(() => PuzzlesView._debug().state.vision.best.black === 5), 'the Vision best is saved');

    // ── Leaving Puzzles keeps Coach intact ──
    await page.locator('#nav-coach').click();
    assert(await page.locator('#coach-view').isVisible() && await page.locator('#puzzles-view').isHidden(), 'Coach returns');
    await page.locator('#nav-puzzles').click();
    assert(await page.locator('#puzzles-view').isVisible(), 'Puzzles returns');

    assert(errors.length === 0, 'no browser runtime errors: ' + errors.join(' | '));
    return { kind: 'puzzle-journeys', checks: checks.length, errors };
  } finally { for (const context of contexts) if (context.pages().length) await context.close(); }
}
