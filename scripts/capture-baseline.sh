#!/usr/bin/env bash
# Captures reference screenshots of every main view into docs/baseline/.
# Used as the "before" picture for the redesign (docs/redesign-plan.md, Phase 0).
# Engine replies vary between runs, so these are visual references, not a
# pixel-diff test.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${CHESS_SMOKE_PORT:-4176}"
BASE_URL="http://127.0.0.1:${PORT}"
SESSION="chess-baseline-$$"
LOG_FILE="${TMPDIR:-/tmp}/chess-baseline-server-$$.log"
OUT_DIR="${BASELINE_DIR:-$ROOT/docs/baseline}"

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
mkdir -p "$OUT_DIR"
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

CAPTURE_CODE=$(cat <<EOF
async page => {
  const base = '${BASE_URL}';
  const out = '${OUT_DIR}';
  const shots = [];
  const shot = async (name, opts = {}) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: out + '/' + name + '.png', fullPage: !!opts.fullPage });
    shots.push(name);
  };
  // The rails scroll inside a fixed-height grid, so a plain full-page shot
  // stops at the viewport. Unlock their heights to capture whole panels.
  const fullShot = async name => {
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'baseline-unlock';
      style.textContent = '.app, .coach-view { height: auto !important; min-height: 100vh; }' +
        ' .coach-settings, .coach-panel, .info-panel, .library, .board-area, .coach-board-area' +
        ' { overflow: visible !important; height: auto !important; max-height: none !important; }';
      document.head.append(style);
    });
    await shot(name, { fullPage: true });
    await page.evaluate(() => document.getElementById('baseline-unlock').remove());
  };
  const showPanel = async name => {
    await page.evaluate(panel => {
      const tab = document.querySelector('.panel-tab[data-panel="' + panel + '"]');
      if (tab) tab.click();
    }, name);
  };
  const playCoachMove = async move => {
    const plies = await page.evaluate(() => coachGame.history().length);
    await page.locator('#coach-keyboard-move').evaluate(el => { el.open = true; });
    await page.locator('#coach-keyboard-move-input').fill(move);
    await page.locator('#coach-keyboard-move-form button[type=submit]').click();
    await page.waitForFunction(n => coachGame.history().length >= n + 2 && !coachThinking, plies, { timeout: 60000 });
  };

  await page.setViewportSize({ width: 1440, height: 900 });

  // First visit: clean storage so the onboarding state is what we capture.
  await page.goto(base + '/');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(base + '/?view=coach');
  await page.waitForSelector('#coach-view', { state: 'visible' });
  await shot('coach-first-visit');

  await page.evaluate(() => document.querySelectorAll('details.rail-group').forEach(d => { d.open = true; }));
  await fullShot('coach-rail-groups-open');
  await page.evaluate(() => document.querySelectorAll('details.rail-group').forEach(d => { d.open = false; }));

  // A game in progress with a reviewed move.
  await page.locator('#btn-coach-newgame').click();
  await page.waitForFunction(() => coachGameActive && !coachThinking, null, { timeout: 30000 });
  await playCoachMove('e4');
  await playCoachMove('Nf3');
  await shot('coach-game-review-panel');
  await fullShot('coach-game-review-panel-full');

  await page.locator('#coach-review details').first().evaluate(el => { el.open = true; }).catch(() => {});
  await shot('coach-engine-details-open');

  await showPanel('practice');
  await fullShot('coach-practice-tab');
  await showPanel('progress');
  await fullShot('coach-progress-tab');
  await showPanel('game');

  // Game over: resign opens the post-game review.
  await page.locator('#btn-coach-resign').click();
  await page.waitForTimeout(1500);
  await shot('coach-game-over');
  await fullShot('coach-game-over-full');

  // Library.
  await page.goto(base + '/?view=library');
  await page.waitForSelector('#library-view', { state: 'visible' });
  await shot('library-empty');
  await page.goto(base + '/?opening=italian');
  await page.waitForTimeout(800);
  for (let i = 0; i < 6; i++) await page.locator('#btn-next').click();
  await shot('library-study');
  await fullShot('library-study-full');
  await page.locator('#btn-quiz').click();
  await shot('library-quiz');
  await page.locator('#btn-explore').click();
  await shot('library-explore');

  // Narrow screens get the stacked layout.
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.goto(base + '/?view=coach');
  await page.waitForTimeout(600);
  await shot('narrow-stacked');

  return { saved: shots.length, shots };
}
EOF
)

set +e
OUTPUT=$("${CLI[@]}" -s="$SESSION" run-code "$CAPTURE_CODE")
EXIT=$?
set -e
echo "$OUTPUT"
if [[ "$EXIT" -ne 0 || "$OUTPUT" == *"### Error"* ]]; then
  echo "Baseline capture failed." >&2
  exit 1
fi
echo "Baseline screenshots written to $OUT_DIR"
