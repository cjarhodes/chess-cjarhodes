# Learning transfer improvement loop

Three audit/fix/verify cycles against main `03d688a`. Work used the attached clean release checkout and preserved the original checkout’s unfinished changes. The app remains static, desktop-first, browser-only, and usable without an account.

## 1. Separate rehearsal from applying an idea

The browser audit solved the queen-mate drill and followed its next action. The app recorded an unassisted rehearsal and moved straight to general play. There was no separate result for using the decision process in a different position.

Completed rehearsals now offer an optional **Try a different position** action. The normal return/play action stays available. Five authored contexts cover checking legal mating defenses, a changed defender, queen safety, a Black-side passed pawn, and development in another central structure. Selection matches the source pattern and excludes the source position, retained reviewed positions, and previously opened checks. Move counters do not make an otherwise identical position different. Opening bridge drills keep their existing direct opening-game handoff.

The initial prompt asks for threats and candidates without displaying the solution. The existing practice grader accepts verified sound alternatives and equivalent mates. Each check saves the first graded move as sound without help, needing work, or assisted. Hints before that decision count as assistance. Opening the board, revealing an answer, illegal input, or an unavailable engine result does not by itself become a graded decision.

The check borrows the board through the existing practice return state. A reload recovers the check, assistance, and protected game. Completing it returns to the exact saved game, or starts play when no game was borrowed. The cue remains available for that playing session. Check attempts are stored separately and do not inflate rehearsal schedules, daily drill counts, or ratings.

## 2. Keep the first result and make the next step useful

A retry, hinted completion, explicit rehearsal, backup import, or merge cannot replace the first decision. Progress places **Applying the idea** beside the existing next-focus recommendation. It shows the first move, result, cue, completion, and routes to rehearse that position or use the cue in play. Rehearsal remains labeled as rehearsal and does not create another independent check. An exhausted or unsupported cue explains that no fresh authored check is available and leaves play reachable.

Choosing play attaches up to six actual, classified live reviews to the chosen cue and game identity. Duplicate and unknown reviews are excluded. A later unrelated game is not silently counted. Matching coaching flags are shown as observations; absent flags are not called successful transfer because reviews do not identify every opportunity to apply an idea. These records share the existing owner-scoped growth JSON, merge, adoption, backup, and optional sync path. No schema or authentication change was required.

## 3. Verify the complete workflow and reading experience

Real browser checks exercised independent success, a first mistake followed by a hinted retry, explicit rehearsal, a changed defender that invalidates the old mating move, an equivalent mating answer, assistance before the first decision, Black-side play, and a strong move different from the authored anchor. Every authored anchor was checked with the real engine. A saved game also lent its board to an opening session, then a rehearsal and different-position check; both levels of game context returned intact, including a real opening-session follow-up review.

Screenshot review caught a Progress disclosure collapsing during evidence refresh. Its open state is now preserved for the current owner while reading. The new result is placed before the longer activity history. Screenshots wait for board animation to finish. The browser checks visible keyboard focus, one dominant action, board bounds, action visibility, and horizontal overflow at 1280×800, 1440×900, and 1920×1080.

## Verification and isolation

The release gates are syntax checks for `app.js`, `growth.js`, `opening-transfer.js`, and `learning-transfer.js`; all `scripts/validate-*.js`; and the complete `scripts/verify-browser.sh`. The runner now includes the learning journey after the existing smoke, teaching, recovery, opponent, UI, Progress, and opening checks. The learning validator adds 50 behavioral checks for legal content, novelty, first-decision integrity, assistance, bounded observations, owner isolation, adoption, and merges.

`verify-learning-transfer-journeys.js` creates a new empty browser context for each scenario. The full regression runner creates its own temporary profile before using test resets. An initial audit storage reset was rejected by automatic approval review because broad deletion could remove saved games and progress; the audit continued in a newly created temporary test profile without clearing existing data.

[Machine-readable local evidence](learning-transfer-verification.json) records the final measured results and source hashes. Screenshots are local artifacts under `output/playwright/learning-*.png`. Release verification also checks the exact deployed source files and repeats the learning workflow on the custom domain.

## Evidence limits

These are prompted application checks drawn from a small authored library, not a test of every chess skill or of long-term retention. “Different” is relative to the source and retained app history, not a guarantee that a person has never encountered the position. History retains up to 24 checks, and Progress presents the latest three. Known checks may be rehearsed; they are not relabeled as fresh independent evidence.

A sound engine grade describes a move in that position. One decision does not establish learning, and six subsequent reviews are a descriptive sample rather than an opportunity-based success rate or a causal training effect. The workflow and controlled fixtures were verified; human learning improvement and a fresh human cross-device login were not measured.
