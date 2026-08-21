#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${CHESS_SMOKE_PORT:-4173}"
BASE_URL="http://127.0.0.1:${PORT}"
SESSION="chess-smoke-$$"
LOG_FILE="${TMPDIR:-/tmp}/chess-smoke-server-$$.log"

if [[ -n "${PWCLI:-}" ]]; then
  CLI=("$PWCLI")
elif [[ -x "${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh" ]]; then
  CLI=("${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh")
elif command -v playwright-cli >/dev/null 2>&1; then
  CLI=("playwright-cli")
else
  CLI=("npx" "--yes" "--package" "@playwright/cli" "playwright-cli")
fi

cleanup() {
  "${CLI[@]}" -s="$SESSION" close >/dev/null 2>&1 || true
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "$ROOT"
python3 -m http.server "$PORT" --bind 127.0.0.1 >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

for _ in {1..30}; do
  if curl -fsS "$BASE_URL/health.html" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
curl -fsS "$BASE_URL/health.html" >/dev/null

"${CLI[@]}" -s="$SESSION" open "$BASE_URL/" >/dev/null

SMOKE_CODE=$(cat <<'EOF'
async page => {
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  const insightState = {
    v: 1,
    entries: [{
      ts: 1760000000000,
      tier: 'blunder',
      loss: 300,
      phase: 'opening',
      tags: ['opening_principles'],
      pairNum: 1,
      ply: 1,
      userSan: 'h4',
      bestSan: 'e4',
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      userUci: 'h2h4',
      bestUci: 'e2e4',
      opening: 'Smoke test'
    }, {
      ts: 1760000001000,
      tier: 'mistake',
      loss: 180,
      phase: 'opening',
      tags: ['development'],
      pairNum: 2,
      ply: 3,
      userSan: 'a3',
      bestSan: 'Nf3',
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      userUci: 'a2a3',
      bestUci: 'g1f3',
      opening: 'Smoke test'
    }]
  };

  await page.setViewportSize({ width: 1280, height: 800 });
  assert(page.url().endsWith('?view=coach'), 'direct app visit did not default to Coach');
  assert(await page.locator('#nav-coach').getAttribute('aria-selected') === 'true', 'Coach was not selected on the default app visit');
  assert(await page.locator('#coach-view').isVisible(), 'Coach view was not visible on the default app visit');
  assert(!(await page.locator('#library-view').isVisible()), 'Library view was not secondary on the default app visit');
  await page.goto(page.url().split('?')[0] + '?opening=italian');
  assert(await page.locator('#nav-library').getAttribute('aria-selected') === 'true', 'an opening deep link did not select Library');
  assert(await page.locator('#opening-title').textContent() === 'Italian Game', 'an opening deep link did not load the requested opening');
  await page.goto(page.url().split('?')[0]);
  await page.waitForFunction(() => location.search === '?view=coach', null, { timeout: 3000 }).catch(() => {});
  assert(page.url().endsWith('?view=coach'), 'returning to the app root did not restore Coach as home');

  const legacyUpgrade = await page.evaluate(() => {
    const baseline = {
      focusTag: null, focus: 'Build your baseline', cue: 'Play naturally.',
      drillTarget: 0, moveTarget: 10
    };
    const focused = {
      focusTag: 'development', focus: 'Slow development', cue: 'Develop pieces.',
      drillTarget: 2, moveTarget: 6
    };
    const moves = upgradeLegacyDailySprint({ mode: 'moves', target: 10, completedUnits: 4, unitIds: ['a', 'b', 'c', 'd'] }, baseline);
    const drills = upgradeLegacyDailySprint({ mode: 'drills', target: 3, completedUnits: 1, unitIds: ['a'], focus: 'Slow development' }, focused);
    return {
      movesPreserved: moves.mode === 'adaptive' && moves.movesCompleted === 4 && moves.target === 10,
      drillsPreserved: drills.mode === 'adaptive' && drills.drillsCompleted === 1 && drills.target === 8 && drills.phase === 'drills'
    };
  });
  assert(legacyUpgrade.movesPreserved, 'in-progress legacy move sprint was not preserved during upgrade');
  assert(legacyUpgrade.drillsPreserved, 'in-progress legacy drill sprint was not preserved during upgrade');
  const crossDeviceMerge = await page.evaluate(() => {
    const local = {
      mode: 'adaptive', phase: 'drills', focus: 'Development', drillTarget: 2, moveTarget: 6,
      target: 8, drillsCompleted: 1, movesCompleted: 0, completedUnits: 1,
      drillIds: ['drill-a'], moveIds: [], cleanDrillIds: ['drill-a'], clean: 1,
      startedAt: 1000, updatedAt: 2000
    };
    const remote = {
      mode: 'adaptive', phase: 'moves', focus: 'Development', drillTarget: 2, moveTarget: 6,
      target: 8, drillsCompleted: 1, movesCompleted: 2, completedUnits: 3,
      drillIds: ['drill-b'], moveIds: ['game-b:1', 'game-b:2'], assistedDrillIds: ['drill-b'], assisted: 1,
      startedAt: 1100, updatedAt: 3000
    };
    return mergeDailySprintDay(local, remote);
  });
  assert(crossDeviceMerge.drillsCompleted === 2, 'cross-device merge lost a completed drill');
  assert(crossDeviceMerge.movesCompleted === 2, 'cross-device merge lost transfer moves');
  assert(crossDeviceMerge.completedUnits === 4 && crossDeviceMerge.phase === 'moves', 'cross-device merge derived the wrong adaptive phase');
  assert(crossDeviceMerge.clean === 1 && crossDeviceMerge.assisted === 1, 'cross-device merge lost drill quality');
  await page.evaluate(state => {
    localStorage.clear();
    localStorage.setItem('coach:insights:v1', JSON.stringify(state));
  }, insightState);
  await page.reload();

  const growthMerge = await page.evaluate(() => mergeGrowthStates({
    v: 1,
    updatedAt: 10,
    profile: { rating: 900, updatedAt: 10 },
    repertoire: { ids: ['italian'], updatedAt: 10 },
    library: { records: { italian: { quality: 3, lastReviewed: 20 } } }
  }, {
    v: 1,
    updatedAt: 30,
    profile: { rating: 1300, updatedAt: 30 },
    repertoire: { ids: ['queens-gambit'], updatedAt: 30 },
    library: { records: { italian: { quality: 5, lastReviewed: 40 }, london: { quality: 4, lastReviewed: 35 } } }
  }));
  assert(growthMerge.profile.rating === 1300, 'cross-device growth merge ignored the newer profile');
  assert(growthMerge.profile.ratingEstimate === 1300, 'existing profile rating did not become the initial calibrated estimate');
  assert(growthMerge.repertoire.ids.length === 1 && growthMerge.repertoire.ids[0] === 'queens-gambit', 'cross-device growth merge ignored the newer repertoire');
  assert(growthMerge.library.records.italian.quality === 5 && growthMerge.library.records.london.quality === 4, 'cross-device growth merge lost Library progress');

  const ratingCalibration = await page.evaluate(async () => {
    const levels = [];
    for (let level = 400; level <= 2400; level += 50) levels.push(coachStrengthOpts(level));
    const monotonic = levels.every((item, index) => !index || (
      item.skill >= levels[index - 1].skill &&
      item.depth >= levels[index - 1].depth &&
      item.multipv <= levels[index - 1].multipv &&
      item.targetLoss <= levels[index - 1].targetLoss &&
      item.spread <= levels[index - 1].spread
    ));
    const candidates = {
      bestmove: 'e2e4',
      lines: [
        { cp: 100, mate: null, pv: ['e2e4'] },
        { cp: 0, mate: null, pv: ['d2d4'] },
        { cp: -100, mate: null, pv: ['g1f3'] },
        { cp: -300, mate: null, pv: ['a2a3'] }
      ]
    };
    const lowMove = chooseCalibratedOpponentMove(candidates, coachStrengthOpts(400), () => 0.5);
    const highMove = chooseCalibratedOpponentMove(candidates, coachStrengthOpts(2400), () => 0.5);
    const base = emptyGrowthState().profile;
    const win = nextPlayerRatingEstimate(base, 1200, 1, 'rating-win', 1000);
    const duplicate = nextPlayerRatingEstimate(win.profile, 1200, 1, 'rating-win', 2000);
    const loss = nextPlayerRatingEstimate(win.profile, 1200, 0, 'rating-loss', 3000);
    await engineClient.init();
    return {
      monotonic,
      lowMove,
      highMove,
      winRaisedEstimate: win.after > win.before,
      confidenceNarrowed: win.deviation < base.ratingDeviation,
      duplicateIgnored: duplicate.duplicate && duplicate.profile.ratingGames === 1,
      lossLoweredEstimate: loss.after < win.after,
      skillSupported: engineClient.supportedOptions.has('Skill Level'),
      unsupportedEloAbsent: !engineClient.supportedOptions.has('UCI_Elo') && !engineClient.supportedOptions.has('UCI_LimitStrength')
    };
  });
  assert(ratingCalibration.monotonic, 'opponent difficulty mapping was not monotonic at every slider step');
  assert(ratingCalibration.lowMove === 'a2a3' && ratingCalibration.highMove === 'e2e4', 'candidate selection did not tighten as difficulty increased');
  assert(ratingCalibration.winRaisedEstimate && ratingCalibration.lossLoweredEstimate, 'completed results did not move the player estimate in the correct direction');
  assert(ratingCalibration.confidenceNarrowed, 'player estimate uncertainty did not narrow after evidence');
  assert(ratingCalibration.duplicateIgnored, 'the same completed game updated the player estimate twice');
  assert(ratingCalibration.skillSupported && ratingCalibration.unsupportedEloAbsent, 'engine capability detection did not match the bundled Stockfish options');

  await page.locator('#player-rating').fill('1350');
  await page.locator('#player-minutes').fill('5');
  await page.locator('#player-goal').selectOption('tactics');
  await page.locator('#player-profile-form button[type=submit]').click();
  assert((await page.locator('#player-profile-status').textContent()).includes('Profile saved'), 'training profile did not save through onboarding UI');
  assert((await page.locator('#player-profile-status').textContent()).includes('Player estimate 1350'), 'changing the starting estimate did not reset calibration evidence');
  assert(await page.locator('#coach-auto-elo').isChecked(), 'adaptive opponent strength was not enabled by default');
  assert(Number(await page.locator('#coach-strength').inputValue()) > 0, 'adaptive opponent strength did not produce a rating');
  await page.evaluate(() => {
    savePlayerProfile({ rating: 1200, minutes: 10, goal: 'balanced', autoElo: true });
    hydrateGrowthUI();
    renderCoachDailyPlan();
  });
  assert((await page.locator('#weekly-review-list .weekly-item').count()) === 3, 'weekly coaching review did not render its three evidence sections');
  const roadmapFeatures = await page.evaluate(() => {
    const multiGame = splitPgnGames('[Event "One"]\n\n1. e4 *\n\n[Event "Two"]\n\n1. d4 *');
    const backup = readTrainingBackup();
    const imported = mergeImportedTrainingData({
      schema: 'chess-coach-training-backup',
      version: 1,
      data: { 'coach:insights:v1': { v: 1, entries: [{ id: 'roadmap-backup', ts: Date.now(), tier: 'mistake', tags: ['candidate_moves'] }] } }
    });
    coachGame = new Chess();
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'].forEach(move => coachGame.move(move));
    updateOpeningLabel();
    const openingId = coachOpeningId;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
    const offline = document.querySelector('#network-status')?.textContent || '';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
    return { multiGameCount: multiGame.length, backupSets: Object.keys(backup.data).length, imported, backupEntry: loadInsights().entries.some(entry => entry.id === 'roadmap-backup'), openingId, offline };
  });
  assert(roadmapFeatures.multiGameCount === 2, 'PGN Inbox did not split multiple games');
  assert(roadmapFeatures.backupSets >= 1 && roadmapFeatures.backupEntry, 'training backup merge did not preserve data');
  assert(roadmapFeatures.openingId === 'italian', 'Coach did not identify the opening bridge target');
  assert(roadmapFeatures.offline.includes('Offline mode'), 'offline state was not announced in Coach');
  const pwaReady = await page.evaluate(async () => {
    const manifestHref = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
    const manifestResponse = await fetch(manifestHref);
    const registration = 'serviceWorker' in navigator
      ? await Promise.race([navigator.serviceWorker.ready, new Promise(resolve => setTimeout(() => resolve(null), 5000))])
      : null;
    return manifestResponse.ok && !!registration;
  });
  assert(pwaReady, 'installable offline app shell did not register');

  assert(await page.locator('#coach-daily-plan-title').textContent() === 'Train Opening principle gaps, then transfer', 'adaptive plan did not choose the highest-severity focus');
  assert(await page.locator('#btn-coach-next-action').textContent() === 'Start adaptive session', 'adaptive plan did not offer the one-click session');
  assert(await page.locator('#daily-sprint-progress-label').textContent() === '0 of 8 steps', 'adaptive session did not explain its drill-plus-transfer target');
  assert(await page.locator('#daily-sprint-focus-title').textContent() === 'Focus · Opening principle gaps', 'adaptive session did not name its selected focus');
  assert((await page.locator('#daily-sprint-focus-detail').textContent()).includes('reviewed error'), 'adaptive session did not explain why it selected the focus');
  assert(await page.locator('#practice-section').isVisible(), 'practice queue did not render from a reviewed mistake');
  assert(await page.locator('.practice-load').count() === 2, 'expected two due practice drills');
  await page.locator('#btn-coach-next-action').click();
  assert(await page.locator('#coach-practice-banner').isVisible(), 'practice banner did not open');
  assert(await page.locator('#coach-practice-session-status').textContent() === 'Drill 1 of 2', 'multi-drill session did not start');
  assert(await page.locator('#btn-coach-resign').isDisabled(), 'normal game controls stayed enabled during practice');
  await page.reload();
  assert(await page.locator('#coach-daily-plan-title').textContent() === 'Continue rehearsing Opening principle gaps', 'reload skipped an unfinished adaptive drill phase');
  assert(await page.locator('#btn-coach-next-action').textContent() === 'Continue focused drills', 'reload did not restore the adaptive drill action');
  assert(await page.locator('#daily-sprint-progress-label').textContent() === '0 of 8 steps', 'reload did not preserve adaptive session progress');
  await page.locator('#btn-coach-next-action').click();
  assert(await page.locator('#coach-practice-session-status').textContent() === 'Drill 1 of 2', 'restored adaptive drill session did not restart at the due position');

  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('d4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Not the best move'), 'incorrect drill move was not rejected');
  assert(await page.locator('#practice-progress-attempts').textContent() === '1', 'incorrect attempt was not measured');

  await page.locator('#coach-keyboard-move-input').fill('e4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Correct after 2 attempts'), 'correct drill move was not graded');
  assert(await page.locator('#practice-progress-attempts').textContent() === '2', 'first drill attempt count is wrong');
  assert(await page.locator('#practice-progress-success').textContent() === '50%', 'first drill success rate is wrong');
  assert(await page.locator('#practice-count').textContent() === '1 due', 'first completed drill did not leave the next drill due');
  assert(await page.locator('#btn-coach-practice-next').isVisible(), 'next-drill action did not appear');
  await page.locator('#btn-coach-practice-next').click();
  assert(await page.locator('#coach-practice-session-status').textContent() === 'Drill 2 of 2', 'session did not advance to drill two');
  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('Nf3');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Session complete'), 'multi-drill session did not complete');
  assert(await page.locator('#practice-progress-attempts').textContent() === '3', 'session attempt count is wrong');
  assert(await page.locator('#practice-progress-success').textContent() === '67%', 'session success rate is wrong');
  assert(await page.locator('#practice-count').textContent() === '0 due', 'completed drill was not rescheduled');
  assert(await page.locator('#practice-empty').isVisible(), 'caught-up state did not render');
  assert(await page.locator('#practice-progress-week').textContent() === '3', 'seven-day attempts did not update');
  assert(await page.locator('#practice-progress-streak').textContent() === '1d', 'practice streak did not update');
  await page.locator('#btn-coach-practice-next').click();
  assert(await page.locator('#coach-daily-plan-title').textContent() === 'Transfer Opening principle gaps into play', 'focused drills did not advance into transfer play');
  assert(await page.locator('#daily-sprint-progress-label').textContent() === '2 of 8 steps', 'adaptive session did not retain drill progress');
  assert(await page.locator('#btn-coach-next-action').textContent() === 'Start transfer game', 'adaptive session did not offer the transfer game');

  await page.evaluate(() => {
    coachLocalGameId = 'adaptive-smoke';
    coachReviewLog = [];
    for (let ply = 1; ply <= 6; ply++) recordDailySprintMove({ ply, tier: 'good', tags: [] });
    renderCoachDailyPlan();
  });
  assert(await page.locator('#coach-daily-plan-title').textContent() === '✓ Today’s training complete', 'drill-plus-transfer session did not complete');
  assert(await page.locator('#daily-sprint-progress-label').textContent() === '8 of 8 steps', 'adaptive session completion progress is wrong');
  assert(await page.locator('#daily-sprint-streak').textContent() === '1-day streak', 'adaptive session completion did not start a streak');
  assert((await page.locator('#daily-sprint-takeaway').textContent()).includes('did not repeat during the transfer moves'), 'adaptive takeaway did not assess live transfer');

  await page.reload();
  assert(await page.locator('#practice-progress-attempts').textContent() === '3', 'practice progress did not survive reload');
  assert(await page.locator('#practice-count').textContent() === '0 due', 'practice schedule did not survive reload');
  assert(await page.locator('#coach-daily-plan-title').textContent() === '✓ Today’s training complete', 'adaptive session completion did not survive reload');

  const accountIsolation = await page.evaluate(() => {
    const accountA = '00000000-0000-0000-0000-000000000001';
    const accountB = '00000000-0000-0000-0000-000000000002';
    const accountAKey = `coach:practice:v2:${accountA}`;
    const dailyAKey = `coach:daily-sprint:v1:${accountA}`;
    const originalSetItem = Storage.prototype.setItem;
    let failedWritePreserved = false;
    try {
      Storage.prototype.setItem = function(key, value) {
        if (key === accountAKey) throw new DOMException('Storage full', 'QuotaExceededError');
        return originalSetItem.call(this, key, value);
      };
      coachAuthUser = { id: accountA };
      adoptAnonymousPracticeProgress(accountA);
      failedWritePreserved =
        localStorage.getItem('coach:practice:v2') !== null &&
        localStorage.getItem(accountAKey) === null;
    } finally {
      Storage.prototype.setItem = originalSetItem;
      coachAuthUser = null;
    }
    coachAuthUser = { id: accountA };
    adoptAnonymousPracticeProgress(accountA);
    adoptAnonymousDailySprint(accountA);
    const moved = JSON.parse(localStorage.getItem(accountAKey));
    const movedDaily = JSON.parse(localStorage.getItem(dailyAKey));
    coachAuthUser = { id: accountB };
    const other = loadPracticeProgress();
    const otherDaily = dailySprintToday();
    coachAuthUser = { id: accountA };
    const restored = loadPracticeProgress();
    const restoredDaily = dailySprintToday();
    coachAuthUser = null;
    return {
      failedWritePreserved,
      anonymousRemoved: localStorage.getItem('coach:practice:v2') === null,
      importedAttempts: moved.records[Object.keys(moved.records)[0]].attempts,
      importedOwner: moved.events[0].ownerId,
      otherAttempts: Object.keys(other.records).length,
      restoredEvents: restored.events.length,
      anonymousDailyRemoved: localStorage.getItem('coach:daily-sprint:v1') === null,
      importedDailyCompleted: Object.values(movedDaily.days)[0].completedAt > 0,
      otherDailyMissing: otherDaily === null,
      restoredDailyCompleted: restoredDaily.completedAt > 0
    };
  });
  assert(accountIsolation.failedWritePreserved, 'failed account adoption removed anonymous progress');
  assert(accountIsolation.anonymousRemoved, 'anonymous progress was not moved into the signed-in account scope');
  assert(accountIsolation.importedAttempts >= 1, 'anonymous progress did not import into the account scope');
  assert(accountIsolation.importedOwner === '00000000-0000-0000-0000-000000000001', 'imported attempts were not assigned to the account');
  assert(accountIsolation.otherAttempts === 0, 'practice progress leaked between browser accounts');
  assert(accountIsolation.restoredEvents === 3, 'account progress did not survive an account switch');
  assert(accountIsolation.anonymousDailyRemoved, 'anonymous daily sprint was not moved into the signed-in account scope');
  assert(accountIsolation.importedDailyCompleted, 'daily sprint completion did not import into the account scope');
  assert(accountIsolation.otherDailyMissing, 'daily sprint progress leaked between browser accounts');
  assert(accountIsolation.restoredDailyCompleted, 'daily sprint completion did not survive an account switch');

  await page.evaluate(() => {
    localStorage.removeItem('coach:practice:v1');
    localStorage.removeItem('coach:practice:v2');
    localStorage.removeItem('coach:practice:v2:00000000-0000-0000-0000-000000000001');
    localStorage.removeItem('coach:practice:v2:00000000-0000-0000-0000-000000000002');
    localStorage.removeItem('coach:daily-sprint:v1');
    localStorage.removeItem('coach:daily-sprint:v1:00000000-0000-0000-0000-000000000001');
    localStorage.removeItem('coach:daily-sprint:v1:00000000-0000-0000-0000-000000000002');
  });
  await page.reload();
  await page.locator('.practice-load').first().click();
  await page.locator('#btn-coach-practice-answer').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Answer: e4'), 'practice answer was not revealed');
  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('e4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Solved after revealing the answer'), 'revealed answer was not completed');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const resizedCoachBoard = await page.locator('#coachBoard .board-b72b1').boundingBox();
  const sprintCard = await page.locator('#coach-daily-plan').boundingBox();
  assert(resizedCoachBoard && resizedCoachBoard.width <= 352, 'existing Coach board did not reflow after desktop-to-mobile resize');
  assert(sprintCard && sprintCard.width <= 390, 'Daily Sprint card overflowed the mobile viewport');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(250);

  await page.locator('#btn-coach-newgame').click();
  await page.locator('#coach-keyboard-move-input').fill('e4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  await page.waitForTimeout(40);
  await page.locator('#btn-coach-newgame').click();
  await page.waitForTimeout(4500);
  assert(await page.locator('#movelist .ply').count() === 0, 'stale engine result leaked into a replacement game');
  assert(await page.locator('#coach-accuracy').textContent() === '—', 'replacement game inherited stale accuracy');

  await page.locator('#nav-library').click();
  await page.locator('.opening-btn[data-id="italian"]').click();
  await page.locator('#btn-repertoire-toggle').click();
  assert((await page.locator('#btn-repertoire-toggle').textContent()).includes('In my repertoire'), 'opening was not added to the personal repertoire');
  await page.reload();
  assert((await page.locator('#btn-repertoire-toggle').textContent()).includes('In my repertoire'), 'personal repertoire did not persist across reload');
  await page.locator('#btn-quiz').click();
  await page.locator('#library-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#library-keyboard-move-input').fill('e4');
  await page.locator('#library-keyboard-move-form button[type=submit]').click();
  await page.waitForFunction(() => {
    const label = document.querySelector('#myBoard')?.getAttribute('aria-label') || '';
    return label.startsWith('White to move.');
  }, null, { timeout: 3000 }).catch(() => {});
  const libraryLabel = await page.locator('#myBoard').getAttribute('aria-label');
  assert((libraryLabel || '').startsWith('White to move.'), `Library quiz did not advance through the opponent reply (${libraryLabel})`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(page.url().split('?')[0] + '?opening=italian&mode=quiz');
  await page.waitForTimeout(400);
  const boardBox = await page.locator('#myBoard').boundingBox();
  const libraryTabBox = await page.locator('#nav-library').boundingBox();
  assert(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, 'mobile layout has horizontal overflow');
  assert(await page.locator('#btn-mobile-openings').isVisible(), 'mobile opening control is hidden');
  assert(!(await page.locator('#library').isVisible()), 'opening catalog did not collapse after selection');
  assert(boardBox && boardBox.width <= 352, 'mobile Library board exceeds the viewport');
  assert(libraryTabBox && libraryTabBox.width > 120, 'mobile navigation tabs collapsed');

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(page.url().split('?')[0] + '?view=coach');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  assert(await page.locator('#coach-daily-plan-title').textContent() === 'Start your first coached session', 'clean first visit did not explain the bounded baseline');
  assert(await page.locator('#btn-coach-next-action').textContent() === 'Start training', 'clean first visit did not offer a one-click training start');
  assert(await page.locator('#daily-sprint-focus-title').textContent() === 'Focus · Build your baseline', 'clean first visit did not explain how adaptation begins');
  assert(await page.locator('#daily-sprint-progress-label').textContent() === '0 of 10 moves', 'clean first visit did not show the sprint target');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const firstVisitSprintBox = await page.locator('#coach-daily-plan').boundingBox();
  const firstVisitAccountBox = await page.locator('#coach-auth-card').boundingBox();
  const firstVisitBoardBox = await page.locator('#coachBoard').boundingBox();
  assert(firstVisitSprintBox && firstVisitAccountBox && firstVisitSprintBox.y < firstVisitAccountBox.y, 'mobile first visit did not show the Daily Sprint before optional account setup');
  assert(firstVisitSprintBox && firstVisitBoardBox && firstVisitSprintBox.y < firstVisitBoardBox.y, 'mobile first visit hid the Daily Sprint below the chessboard');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(250);
  await page.locator('#coach-fen').fill('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
  await page.locator('.side-toggle button[data-side="white"]').click();
  await page.locator('#btn-coach-next-action').click();
  assert(await page.locator('#coach-daily-plan-title').textContent() === 'Build your baseline in play', 'active baseline did not explain its in-progress state');
  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('Qe4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  await page.waitForFunction(() => {
    return (document.querySelector('#coach-classification')?.textContent || '').includes('Blunder');
  }, null, { timeout: 30000 }).catch(() => {});
  assert((await page.locator('#coach-classification').textContent()).includes('Blunder'), 'missed mate was not classified as a blunder');
  assert((await page.locator('#coach-review-cue').textContent()).startsWith('Next time:'), 'review did not surface an actionable Coach cue');
  assert(await page.locator('#btn-coach-review-practice').isVisible(), 'review did not offer one-click practice for the mistake');
  assert(await page.locator('#coach-best-move').textContent() === 'Qg7#', 'real review did not preserve the mating move');
  assert(await page.locator('#daily-sprint-progress-label').textContent() === '1 of 10 moves', 'reviewed move did not advance the Daily Sprint');
  assert(await page.locator('.practice-load').count() >= 1, 'real reviewed mistake did not create a due drill');
  const generatedBest = await page.locator('#coach-best-move').textContent();
  await page.locator('#btn-coach-resign').click();
  await page.locator('#summary-overlay').waitFor({ state: 'visible', timeout: 5000 });
  assert(await page.locator('#btn-summary-practice').isVisible(), 'post-game summary did not offer current-game practice');
  await page.locator('#btn-summary-practice').click();
  assert(await page.locator('#coach-practice-banner').isVisible(), 'post-game practice action did not open the generated drill');
  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill(generatedBest);
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Correct on the first try'), 'generated drill did not accept the reviewed best move');
  assert(await page.locator('#practice-progress-success').textContent() === '100%', 'generated drill result was not measured');

  await page.locator('#btn-coach-practice-exit').click();
  await page.locator('#btn-coach-newgame').click();
  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('Qg7#');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  await page.waitForFunction(() => {
    return (document.querySelector('#coach-classification')?.textContent || '').includes('Best move');
  }, null, { timeout: 30000 }).catch(() => {});
  assert((await page.locator('#coach-classification').textContent()).includes('Best move'), 'mating move was not classified as best');

  await page.evaluate(() => {
    for (let ply = 3; ply <= 10; ply++) {
      recordDailySprintMove({ ply, tier: 'good', tags: [] });
    }
    renderCoachDailyPlan();
  });
  assert(await page.locator('#coach-daily-plan-title').textContent() === '✓ Today’s training complete', 'ten reviewed moves did not complete the Daily Sprint');
  assert(await page.locator('#daily-sprint-progress-label').textContent() === '10 of 10 moves', 'move sprint completion total is wrong');
  assert((await page.locator('#daily-sprint-takeaway').textContent()).length > 20, 'move sprint completion did not provide a learning takeaway');
  await page.reload();
  assert(await page.locator('#coach-daily-plan-title').textContent() === '✓ Today’s training complete', 'move sprint completion did not persist across reload');

  await page.locator('#endgame-track-list .endgame-item button').first().click();
  assert(await page.locator('#coach-practice-banner').isVisible(), 'structured endgame lesson did not open in Coach practice');
  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('Qg7#');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Correct on the first try'), 'structured endgame lesson was not graded');
  assert(await page.locator('#endgame-track-progress').textContent() === '1/4', 'structured endgame progress did not update');
  await page.locator('#btn-coach-practice-exit').click();

  await page.locator('#game-inbox-pgn').fill('[Event "Smoke import"]\n[Result "*"]\n\n1. e4 *');
  await page.locator('#game-inbox-side').selectOption('white');
  await page.locator('#btn-analyse-pgn').click();
  await page.waitForFunction(() => {
    return (document.querySelector('#game-inbox-status')?.textContent || '').includes('reviewed. Mistakes');
  }, null, { timeout: 30000 }).catch(() => {});
  assert((await page.locator('#game-inbox-status').textContent()).includes('1 move reviewed'), 'PGN Game Inbox did not complete a bounded imported review');

  await page.goto(page.url().split('?')[0] + '?view=coach');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#coach-fen').fill('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
  await page.locator('.side-toggle button[data-side="white"]').click();
  await page.locator('#btn-coach-next-action').click();
  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('Qe4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  await page.waitForFunction(() => {
    return (document.querySelector('#coach-classification')?.textContent || '').includes('Blunder');
  }, null, { timeout: 30000 }).catch(() => {});
  assert(await page.locator('#btn-coach-review-practice').isVisible(), 'review did not offer one-click practice for the mistake');
  await page.locator('#btn-coach-review-practice').click();
  assert(await page.locator('#coach-practice-banner').isVisible(), 'review practice action did not open the drill');
  assert((await page.locator('#coach-practice-prompt').textContent()).includes('Find the best move'), 'review practice action did not open the current position');

  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  if (failures.length) throw new Error(failures.join('\n'));
  return {
    practice: 'adaptive focus was selected, rehearsed, transferred, assessed, and persisted',
    coach: 'replacement-game race stayed clean',
    library: 'keyboard quiz advanced',
    mobile: '390px layout stayed within viewport',
    closedLoop: 'missed mate became a post-game drill and delivered mate stayed scorable',
    dailyHabit: 'first-visit baseline and returning adaptive session completed with takeaways, streaks, persistence, and account isolation',
    growth: 'profile, repertoire, adaptive strength, weekly review, endgames, PGN Inbox, and offline shell worked in-browser'
  };
}
EOF
)

set +e
SMOKE_OUTPUT=$("${CLI[@]}" -s="$SESSION" run-code "$SMOKE_CODE")
SMOKE_EXIT=$?
set -e
echo "$SMOKE_OUTPUT"
if [[ "$SMOKE_EXIT" -ne 0 || "$SMOKE_OUTPUT" == *"### Error"* ]]; then
  echo "Browser smoke validation failed." >&2
  exit 1
fi
echo "Browser smoke validation passed."
