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
    }]
  };

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(state => {
    localStorage.clear();
    localStorage.setItem('coach:insights:v1', JSON.stringify(state));
  }, insightState);
  await page.reload();

  assert(await page.locator('#practice-section').isVisible(), 'practice queue did not render from a reviewed mistake');
  assert(await page.locator('.practice-load').count() === 1, 'expected one due practice drill');
  await page.locator('.practice-load').click();
  assert(await page.locator('#coach-practice-banner').isVisible(), 'practice banner did not open');
  assert(await page.locator('#btn-coach-resign').isDisabled(), 'normal game controls stayed enabled during practice');

  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('d4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Not the best move'), 'incorrect drill move was not rejected');
  assert(await page.locator('#practice-progress-attempts').textContent() === '1', 'incorrect attempt was not measured');

  await page.locator('#coach-keyboard-move-input').fill('e4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Correct after 2 attempts'), 'correct drill move was not graded');
  assert(await page.locator('#practice-progress-attempts').textContent() === '2', 'completed attempt count is wrong');
  assert(await page.locator('#practice-progress-success').textContent() === '50%', 'practice success rate is wrong');
  assert(await page.locator('#practice-count').textContent() === '0 due', 'completed drill was not rescheduled');
  assert(await page.locator('#practice-empty').isVisible(), 'caught-up state did not render');

  await page.reload();
  assert(await page.locator('#practice-progress-attempts').textContent() === '2', 'practice progress did not survive reload');
  assert(await page.locator('#practice-count').textContent() === '0 due', 'practice schedule did not survive reload');

  await page.evaluate(() => localStorage.removeItem('coach:practice:v1'));
  await page.reload();
  await page.locator('.practice-load').click();
  await page.locator('#btn-coach-practice-answer').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Answer: e4'), 'practice answer was not revealed');
  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('e4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  assert((await page.locator('#coach-practice-status').textContent()).includes('Solved after revealing the answer'), 'revealed answer was not completed');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const resizedCoachBoard = await page.locator('#coachBoard .board-b72b1').boundingBox();
  assert(resizedCoachBoard && resizedCoachBoard.width <= 352, 'existing Coach board did not reflow after desktop-to-mobile resize');
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
  await page.locator('#coach-fen').fill('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
  await page.locator('.side-toggle button[data-side="white"]').click();
  await page.locator('#btn-coach-newgame').click();
  await page.locator('#coach-keyboard-move').evaluate(element => { element.open = true; });
  await page.locator('#coach-keyboard-move-input').fill('Qe4');
  await page.locator('#coach-keyboard-move-form button[type=submit]').click();
  await page.waitForFunction(() => {
    return (document.querySelector('#coach-classification')?.textContent || '').includes('Blunder');
  }, null, { timeout: 30000 }).catch(() => {});
  assert((await page.locator('#coach-classification').textContent()).includes('Blunder'), 'missed mate was not classified as a blunder');
  assert(await page.locator('#coach-best-move').textContent() === 'Qg7#', 'real review did not preserve the mating move');
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

  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  if (failures.length) throw new Error(failures.join('\n'));
  return {
    practice: 'incorrect and correct attempts graded and scheduled',
    coach: 'replacement-game race stayed clean',
    library: 'keyboard quiz advanced',
    mobile: '390px layout stayed within viewport',
    closedLoop: 'missed mate became a post-game drill and delivered mate stayed scorable'
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
