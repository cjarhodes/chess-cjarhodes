# Practice UX improvement loop

Three workflow cycles against `373ee6d`, using the clean attached release checkout. The original checkout's unfinished work was preserved. The app remains static, desktop-first, browser-only, and usable without an account.

## Cycle 1: choose an honest session

A fresh live browser audit found that the Practice tab still promoted Start training, which launched a game. A real `f3` mistake generated three weakness-tag drills with the same position and answer. The queue advertised two or three drills while the adaptive launch selected one. Returning from the drill preserved the original game, but the promised session length was wrong.

Practice now recommends one starting action. New players receive an authored endgame lesson; players with due game positions receive a bounded personal session. The recommendation and launch use the same ordered, distinct selection. Grouping ignores weakness tags and move counters for identical position/answer pairs. The queue keeps existing record IDs, attempt events, owner scopes and account-sync contracts. Scheduling respects the latest attempt across a reviewed position's existing tags; one completion does not manufacture three events or three units of credit.

The browser verified the real multi-tag mistake, exact session count, and exact game return. Behavioral checks cover legacy tag schedules, a newer miss reopening a position, unchanged event totals, selected-position ordering, play-first plans, and fewer available positions than the session cap.

## Cycle 2: teach the current decision

The queen-mate lesson previously asked only for a sound move. A plausible `Qe4` received a pawn-loss number without explaining the missed mate. The lesson now states its authored objective and explains a missed mate in chess terms without revealing the answer. Other rejected candidates can use a legal engine continuation when available; unverified replies are never invented. Sound alternatives and equivalent mates retain their existing grading.

Hints move from an idea to a source square, destination and answer. Source/destination outlines support the text, including after resize and reload. Focus moves to the borrowed board on entry, back to move entry after a retry, and to the next action on completion. Keyboard move entry and board interaction both remain available.

Practice shows its own position count instead of an unrelated daily-session percentage. A one-position lesson finishes at 1 of 1. The daily sprint and saved game remain intact underneath. Queue-empty messaging, unrelated metrics and obsolete help controls step aside during a lesson. Completed lessons retain their existing opening, different-position and live-play handoffs, with one dominant next action.

## Cycle 3: reduce competing information

The recommended action is the existing session-start control, so there is one starting point. Game-derived positions appear before an optional Practice activity disclosure. Compact context identifies the original move; lesson catalogs remain available below. The selection screen points to the lesson instead of asking the player to start a game. The three-column layout, board palette and existing type system remain.

Screenshot review at 1280×800 caught board outlines disappearing when chessboard.js rebuilt its squares. The existing board observer now reapplies them. The final journey checks computed outlines after every resize, rather than only checking for a class before resize.

## Verification

`scripts/verify-practice-ux-journeys.js` uses empty browser contexts and real UI actions. It covers keyboard lesson entry, a real rejected move, staged hints, reload without duplicate attempts, honest completion, a different-position check, live play, exact saved-game return, and a complete bounded multi-position session. The final queue-size scenario uses explicitly controlled review fixtures; real user accounts and existing profiles are untouched. The existing account-continuity journey separately checks owner isolation and portable practice recovery with the real SDK and controlled responses.

All 18 validators and the complete browser runner are release gates. The runner includes the new Practice journey alongside the existing smoke, teaching, recovery, opponent, UI, Progress, opening-transfer, learning-transfer and account-continuity journeys. Existing checks now use the visible Practice start/next controls and assert lesson-local progress. They retain their persistence, grading, event-count and daily-transfer checks.

[Machine-readable verification](practice-ux-verification.json) records viewport bounds and source hashes. Screenshots are local artifacts under `output/playwright/practice-ux-*.png`. Release verification checks the deployed source against this checkout and repeats Practice and saved-game workflows on the custom domain.

These checks establish workflow behavior and layout. They do not measure human learning improvement or long-term retention. No opponent calibration, schema, account protocol or rating changes were made.
