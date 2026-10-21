# Useful progress improvement loop

Three audit/fix/verify cycles against main `6f41f52`. The goal was to make Progress useful for choosing what to work on next, while preserving the static desktop app, local-only use, saved sessions, and existing visual identity. Work used the attached clean release checkout; the original checkout's unfinished changes were preserved.

## 1. Make the evidence honest

The original panel called reviewed moves “learned” and compared monthly raw error counts. A retained history with no prior-period reviews still showed an upward trend. Progress also described all correct practice events as first-try success, including correct retries.

Labels now describe reviewed moves, the most flagged phase, completed attempts, and positions repeated three times. A monthly pattern is reported as flagged moves divided by reviewed moves in each period. Each period needs 30 retained reviews before a descriptive rate comparison appears. A missing or small baseline explicitly remains inconclusive. Invalid dates, future reviews, unknown classifications, and duplicate record IDs are excluded from Progress calculations.

The browser fixture has 10 flags in 100 prior-period reviews and 15 in 200 current-period reviews. It now reports an observed rate 2.5 percentage points lower, despite the higher raw count. Removing the prior reviews produces the insufficient-evidence message. The original and revised panels were captured and visually inspected.

## 2. Connect a focus to a reachable action

Progress now begins with “Work on next”: one focus, the supporting retained review count, a practical cue, and one dominant button. A single flagged review is described as an early signal. The recommendation shares the daily plan's severity, recency, practice, and training-preference logic. An unfinished daily focus stays in place. Completed daily training labels additional work as optional.

The button starts the actual due practice positions, starts focused play when no drill is available, or resumes the current session and game. It reads the active owner's history again when clicked so a stale guest recommendation cannot load into another account. Repeated instances of the same position and solution count as one due drill. Invalid saved moves do not create dead practice actions. The daily card and practice queue use the same reachable count.

Activity, unassisted correct attempts, assisted completions, misses, and the after-practice comparison appear separately. Older examples, theory, and lifetime activity remain available in keyboard-accessible disclosures. The evidence explanation states the retention limit and how imported-game dates work.

The real browser journey followed the button into the saved queen-mate drill, played Qg7#, recorded the unassisted completion, continued into live play, left Show why through Progress without replacing the live game, and resumed the same saved game after reload. The first real follow-up review appeared as 1/30, without claiming improvement.

## 3. Verify the full loop and remove remaining friction

The browser exercised a hinted solve separately. It appeared as assisted and did not start an unassisted comparison checkpoint. A controlled 30-before/30-after history showed 10/30 versus 2/30 flags, an observed rate 26.7 percentage points lower. A later rehearsal and reload retained the eligible checkpoint. With no playable drill, the same focus led to a real playing session.

The audit also caught a stale practice keyboard message after returning to the game, and a daily card that called an existing focus a first session when no playable drill remained. Both were corrected and covered by the browser journey. Monthly trend rows now stack their title and evidence so the pattern name is readable in the laptop rail. The next button has visible keyboard focus, and the retained history starts collapsed.

## Evidence definitions and limits

- Monthly rate: reviews flagged for a given pattern divided by all retained classified reviews in the last 30 days, compared with the prior 30 days. Multiple copies of a tag on one review count once. Thirty reviews per period is a practical descriptive floor, not a significance test.
- Practice comparison: nearest 30 retained reviews before the earliest unassisted correct completion with a full baseline, and first 30 reviews at or after it. Further rehearsals keep that checkpoint while its baseline is retained. If no rehearsal has a full baseline, the latest unassisted completion shows the baseline gap and asks for more reviews followed by another rehearsal.
- Practice counts describe attempts, including retries. Hints and answer use are assisted. Session completion and repeated positions measure activity rather than established learning.
- History is bounded to 300 reviews. Imported games use review timestamps; records do not establish the original game dates or distinguish every live/imported source. The report therefore says “reviewed moves,” and does not infer game frequency, causal training benefit, human Elo, or lasting skill improvement. Legacy records without IDs are retained rather than guessed to be duplicates.
- Account-local and loaded remote histories keep their existing selection rules and owner scopes. No database schema, sync protocol, stored-game format, engine difficulty selector, or dependency changed.

## Verification

`node --check app.js`, `node --check growth.js`, every `scripts/validate-*.js`, and `scripts/verify-browser.sh` are the release checks. The browser runner includes the new `scripts/verify-progress-journeys.js` after the existing Library, Coach, teaching, recovery, opponent, and UI checks. `validate-useful-progress.js` exercises 32 behavioral assertions covering unequal volumes, evidence floors, timestamp boundaries, checkpoint stability, assistance, reachable practice, preferences, and account-source selection.

The Progress journey captures six checkpoints at each required desktop size. It also opens the historical trend, follows the next action into real engine-graded practice and play, checks saved game and daily progress after reload, and refreshes the owner at click time. [Machine-readable verification](useful-progress-verification.json) records the measured results. Screenshots are local artifacts in `output/playwright/progress-*.png`.

| Viewport | Board size across Progress checkpoints | Lowest next button | Horizontal overflow |
|---|---:|---:|---:|
| 1280×800 | 400–456px | 411px | 0px |
| 1440×900 | 504–560px | 391px | 0px |
| 1920×1080 | 680–736px | 369px | 0px |

One overlapping audit/regression run hit a 45-second engine wait timeout. The complete suite was rerun serially for the release; the passing report records that final run. This does not establish the timeout’s precise cause.

These functional checks establish that the loop works with controlled evidence and real engine responses. They do not replace human usability or longitudinal learning research.
