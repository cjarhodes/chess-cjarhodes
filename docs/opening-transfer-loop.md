# Opening-to-game transfer improvement loop

Three audit/fix/verify cycles against main `7a6c09b`. Work used the attached clean release checkout and preserved the original checkout's unfinished changes. The app stays static, desktop-first, browser-only, and usable without an account.

## 1. Repair the opening rehearsal

The real Italian bridge started after its answer, Re1, had already been played. Its saved answer was therefore illegal and the board asked Black to find a White move. The drill now saves the position before that move. Where the lesson supplies them, a legal opponent reply and a second student decision carry the idea forward. The Italian path is Re1, …a6, a4.

The authored solution, student side, and continuation are checked against vendored chess.js for every generated bridge. The browser solved the repaired Italian drill and its follow-up, reloaded a completed drill, and continued into the same opening position in free play. The source lesson cue remains visible instead of becoming a generic candidate-selection reminder.

## 2. Carry a studied position and purpose into real play

Library lessons and completed quizzes now expose an Opening → game action. The player chooses an idea from that line's key ideas and starts from the displayed position. Before the first study step, the default is the end of the selected line. A finished mating line backs up to the student's last playable decision, with an explicit explanation. The lesson's side and variation are retained.

Coach uses its normal engine opponent and move review. There is no scripted opponent sequence or exact-line requirement in the free game. The opening idea stays visible, and the player is reminded to answer the opponent's threats and change plans when needed. Four reviewed moves are a prompt to review the exercise, not a pass mark or a learning claim; the player can review earlier or keep playing.

Starting an opening exercise protects an unfinished Coach game. Its PGN, game identity, statistics, side, opponent level, and review history return intact. Opening play can itself lend the board to a practice drill. Both layers recover after reload. New reviewed moves keep their earned daily progress. Returning from an exercise flushes its normal account game update before restoring another identity, with a bounded wait and an owner/context fence. Opening exercises do not update the player rating.

The review separates engine move quality from the player's self-reported reflection: finding a way to use the idea, adapting to the opponent, or still working out the plan. Up to six recent opening reviews remain in Progress, including two observed move examples and a route back to that line. They share the existing owner-scoped training JSON, backup, adoption, and merge path. No database schema, auth, or difficulty-selector change was required.

## 3. Complete the workflow and keep its story accurate

The completed-workflow checks caught two more gaps. A game beginning at a lesson FEN was being named from its first new move as though it began from the initial chess position. Source opening and variation labels, PGN tags, actual fullmove numbers in live and replay navigation, and Black/White move references now keep the lesson context. The summary retains this source rather than claiming that the continuation stayed in or left a different opening book.

Some authored quiz moves omit “+” or “#”. Literal SAN comparison rejected their legal checking or mating moves, including the final Scholar's Mate move. Quiz answer matching now compares the actual legal move, and keyboard SAN accepts optional check/mate suffixes. Every move in all 35 authored lines is checked through both paths.

The broader browser run also exposed the terminal-mate grading edge case. A legal move whose resulting board is checkmate can be graded from board facts even if no engine analysis is available. The direct check verifies the move and resulting FEN and does not invent an engine preference. Nonterminal reviews still use engine analysis; opponent selection is unchanged.

The new summary keeps its save/return action visible while the body scrolls. Normal post-game summaries regain their original actions after an opening session. Active exercises also protect their borrowed game from replacement PGN imports: the player returns from the exercise before importing.

## Verification

`validate-opening-transfer.js` runs 1,853 behavioral checks covering all 28 openings and 35 lines, every authored quiz/keyboard move, playable transfer positions, terminal-line recovery, legal bridges, side and owner checks, bounded history, merges and adoption, unknown-review exclusion, Black move references, and asynchronous save/owner-change ordering. A terminal checkmate test runs with an engine stub that throws, proving the board fact does not depend on engine output.

`verify-opening-transfer-journeys.js` exercises real workflows and real engine grading:

- A Library position and chosen cue lead to four reviewed moves. A nested drill reloads and returns to the exact opening game; reflection and a second reload preserve the context. Saving returns to the original game and preserves earned daily moves. Progress and a training-backup merge retain one review. The original game's subsequent review has its normal primary action.
- A Black-side Dragon variation gives the engine the first move, preserves orientation and source, reviews the player's reply, protects the session from a replacement import, and returns to the selected Library variation.
- A complete keyboard Scholar's Mate quiz leads to a playable pre-mate position, a real mating move, an unrated review, and lesson return.
- The corrected bridge plays its reply and follow-up, reloads, and starts free play from the matching opening position.

Eighteen screenshot/layout checkpoints cover study, active play, review readiness, the summary, a Black variation, and a finished quiz at 1280×800, 1440×900, and 1920×1080. They check the board, transfer actions, summary return action, keyboard focus, primary-action consistency, and horizontal overflow. The Library keeps its existing independently scrolling navigation area. [Machine-readable results](opening-transfer-verification.json) record the measurements; screenshots are local artifacts under `output/playwright/opening-*.png`.

Release checks are syntax checks for `app.js`, `growth.js`, and `opening-transfer.js`, every `scripts/validate-*.js`, and the full `scripts/verify-browser.sh`. The standard runner now includes the opening journey after existing Library, Coach, teaching, recovery, opponent, UI, and useful-Progress checks. The custom-domain release must serve the exact committed files and pass the opening journey live.

## Evidence limits

Move grades are engine observations, and plan-use reflections are self-reports. Four moves do not establish lasting learning, and a correct book rehearsal is not proof that the idea transfers to a different position. The six-session history is a bounded review aid rather than a longitudinal mastery measure. Browser checks establish functional behavior with real engine responses; human learning improvement still needs actual player evidence.
