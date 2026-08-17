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

"${CLI[@]}" -s="$SESSION" open "$BASE_URL/?view=coach" >/dev/null

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
  await page.evaluate(state => {
    localStorage.clear();
    localStorage.setItem('coach:insights:v1', JSON.stringify(state));
  }, insightState);
  await page.reload();

  assert(await page.locator('#coach-daily-plan-title').textContent() === '2-drill Daily Sprint', 'daily plan did not prioritize a bounded due-drill sprint');
  assert(await page.locator('#btn-coach-next-action').textContent() === 'Start 2-drill sprint', 'daily plan did not offer the one-click sprint');
  assert(await page.locator('#daily-sprint-progress-label').textContent() === '0 of 2 drills', 'daily sprint did not explain its bounded target');
  assert(await page.locator('#practice-section').isVisible(), 'practice queue did not render from a reviewed mistake');
  assert(await page.locator('.practice-load').count() === 2, 'expected two due practice drills');
  await page.locator('#btn-coach-next-action').click();
  assert(await page.locator('#coach-practice-banner').isVisible(), 'practice banner did not open');
  assert(await page.locator('#coach-practice-session-status').textContent() === 'Drill 1 of 2', 'multi-drill session did not start');
  assert(await page.locator('#btn-coach-resign').isDisabled(), 'normal game controls stayed enabled during practice');

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
  assert(await page.locator('#coach-daily-plan-title').textContent() === '✓ Today’s training complete', 'daily sprint did not produce a clear completion state');
  assert(await page.locator('#daily-sprint-progress-label').textContent() === '2 of 2 drills', 'daily sprint completion progress is wrong');
  assert(await page.locator('#daily-sprint-streak').textContent() === '1-day streak', 'daily sprint completion did not start a streak');
  assert((await page.locator('#daily-sprint-takeaway').textContent()).startsWith('You trained '), 'daily sprint did not explain what the player learned');

  await page.reload();
  assert(await page.locator('#practice-progress-attempts').textContent() === '3', 'practice progress did not survive reload');
  assert(await page.locator('#practice-count').textContent() === '0 due', 'practice schedule did not survive reload');
  assert(await page.locator('#coach-daily-plan-title').textContent() === '✓ Today’s training complete', 'daily sprint completion did not survive reload');

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
  assert(await page.locator('#coach-daily-plan-title').textContent() === '10-move Daily Sprint', 'clean first visit did not explain the bounded training action');
  assert(await page.locator('#btn-coach-next-action').textContent() === 'Start Daily Sprint', 'clean first visit did not offer a one-click sprint');
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
  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('Qe4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  await page.waitForFunction(() => {
    return (document.querySelector('#coach-classification')?.textContent || '').includes('Blunder');
  }, null, { timeout: 30000 }).catch(() => {});
  assert((await page.locator('#coach-classification').textContent()).includes('Blunder'), 'missed mate was not classified as a blunder');
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

  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  if (failures.length) throw new Error(failures.join('\n'));
  return {
    practice: 'bounded Daily Sprint graded, completed, persisted, and updated trends',
    coach: 'replacement-game race stayed clean',
    library: 'keyboard quiz advanced',
    mobile: '390px layout stayed within viewport',
    closedLoop: 'missed mate became a post-game drill and delivered mate stayed scorable',
    dailyHabit: 'first-visit move sprint and returning drill sprint completed with takeaways, streaks, persistence, and account isolation'
  };
}
EOF
)

SMOKE_OUTPUT=$("${CLI[@]}" -s="$SESSION" run-code "$SMOKE_CODE")
echo "$SMOKE_OUTPUT"
if [[ "$SMOKE_OUTPUT" == *"### Error"* ]]; then
  echo "Browser smoke validation failed." >&2
  exit 1
fi
echo "Browser smoke validation passed."
