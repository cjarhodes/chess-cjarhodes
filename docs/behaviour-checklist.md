# Behaviour checklist

Phase 0 of [the redesign plan](redesign-plan.md). This is what the app must
keep doing through the redesign. Each item says how it is checked today:

- **B**: a behavioural test that runs the code (`validate-practice-logic`,
  `validate-difficulty`, `validate-growth-upgrades`, `validate-practice-upgrades`,
  `validate-review-teaching`, `validate-openings`, `validate-account-continuity`,
  `validate-learning-transfer`, `validate-opening-transfer`, `validate-recovery`,
  `validate-useful-progress`).
- **S**: the browser smoke suite (`scripts/verify-browser.sh`, which also runs
  the `scripts/verify-*-journeys.js` flows).
- **U**: the browser behaviour suite (`scripts/verify-behaviour-units.js`, the
  last stage of `verify-browser.sh`). It drives the real functions in the
  running app and stubs only the boundary (Worker, Supabase client, storage,
  clipboard, network).
- **A**: checks on shipped files rather than app code: `validate-schema.js`
  (migrations, database tests, CI, service worker), `validate-security.js`,
  `validate-accessibility.js` (contrast from the tokens) and
  `validate-design-tokens.js`.
- **DB**: Supabase migrations and database tests.

Phase 2 removed every regex check over the app's source (the old **R**
code). Each item below now names the test that exercises it, or is listed
under *Known gaps*.

Items marked *(changes)* are expected to change on purpose during the
redesign. The checklist records the current behaviour so the change is
deliberate.

Reference screenshots: [`docs/baseline/`](baseline/), regenerated with
`scripts/capture-baseline.sh`.

---

## 1. App shell and navigation

- [ ] A plain visit opens Coach; Coach is the selected, visible section and Library is secondary. **S** *(changes: Train becomes home)*
- [ ] `?opening=<id>` deep links open Library with that opening loaded. **S**
- [ ] Returning to the root URL restores Coach as home. **S**
- [ ] `?view=coach|library` selects the view. **S**
- [ ] Top-level tabs expose a complete tab/tabpanel relationship and support arrow keys. **U**
- [ ] Coach panel tabs (Game / Practice / Progress) expose a complete tab relationship and support arrow keys. **U** *(changes: IA)*
- [ ] No web app manifest, no service-worker registration, no install prompt. **S**
- [ ] `service-worker.js` stays a kill switch: it unregisters earlier installs and clears every cache. **A**
- [ ] Below 1024px a desktop notice appears as an accessible dialog with a "continue" option; dismissal lasts for the session and leaves the app usable; the board doesn't shrink below desktop size. **S** *(changes: removed when phone layout ships, Phase 6)*
- [ ] No console errors or page errors during the full smoke journey. **S**

## 2. Board input and accessibility

- [ ] Drag, tap-to-move and a keyboard move form all work, on both boards. **S**, **U**
- [ ] Keyboard moves accept SAN (`e4`, `Nf3`) and coordinates (`e2e4`). **S** (SAN), **U** (coordinates)
- [ ] Promotion opens a named dialog with four choices. **U** (every dialog is named and modal)
- [ ] Dialogs trap focus. **S** (review dialog)
- [ ] Coach status and quiz feedback are live regions that announce changes. **U**
- [ ] Post-game moment rows are real buttons. **U**
- [ ] Pieces use the vendored cburnett SVG set. **U**
- [ ] Board colours are themeable: Sage (green, default), Walnut, Slate, High contrast; choices persist and the retired Ivory migrates to Walnut. Light/dark follows the device unless set. **U**, **A**
- [ ] Last-move highlight survives board redraws. **U**

## 3. Coach play and engine

- [ ] New game, resign & review, play as White / Black / Random, take back (move pair), flip. **S** (partial)
- [ ] The opponent replies after every move, including after captures. **S**
- [ ] Every user move is classified (best → blunder) against the engine. **S**
- [ ] A missed mate-in-one is classified as a blunder; delivering mate is classified as best and stays scorable. **S**
- [ ] The engine wrapper detects and uses only the UCI options the bundled Stockfish announces. **S**
- [ ] A worker error fails both active and queued engine tasks, and the engine resets to idle. **U**
- [ ] Position resets cancel active and queued engine work (as abort errors) and clear any Show why analysis. **U**
- [ ] Async work from a replaced or rewound game is discarded (game generation guard); a replacement game never inherits stale results or accuracy. **S**, **U**
- [ ] Move analysis verifies it is still looking at the game it started on. **S** (replacement-game race)
- [ ] Opponent move failures show a retry message and a Retry button that works. **U**
- [ ] Coach move flow moves through clear states (your turn, analysing, opponent thinking, ended). **S** (`verify-ui-journeys.js` checks the state shown)
- [ ] Threat scan: static threats render first, the mate scan runs afterwards, stale results are ignored, and "unavailable" is distinct from "no threat". **U**
- [ ] Games have stable local IDs; lifetime stats roll up once per game, and take-back removes a completed game's rollup. **S**, **U**
- [ ] Copy FEN / copy PGN / share link; clipboard failures are handled. **U** (share link)

## 4. Opponent difficulty and player estimate

- [ ] The difficulty mapping is monotonic at every slider step: error probability and error size fall as level rises, and mean loss is lower at high levels. **B**, **S**
- [ ] Candidates are score-sorted and de-duplicated; losses are computed correctly. **B**
- [ ] Errors are capped (≤ 500cp absolute); smaller errors are preferred over the largest allowed. **B**
- [ ] A winning mate is always converted; when every line loses, the longest mate is preferred; a forced losing mate is never chosen over a centipawn alternative. **B**, **S**
- [ ] Beginner opponents don't throw away a mate-in-one or allow mate when a defence exists. **S**
- [ ] Equal-valued alternatives are varied. **B**
- [ ] The player estimate moves in the right direction after completed results, narrows its uncertainty with evidence, and counts each game only once. **S**
- [ ] Resignations count as completed games. **U** (lifetime stats); the player-estimate side is a known gap
- [ ] Adaptive opponent strength is on by default and follows the player estimate. **S**
- [ ] Changing the starting estimate resets the calibration evidence. **S**
- [ ] `scripts/calibrate-difficulty.js` runs, and its trend, severe-blunder and mate-in-one rates are reviewed whenever the model changes (CLAUDE.md).

## 5. Move review and teaching

- [ ] Each move review starts with a short explanation that names a chess concept and the opponent's threat, shown separately from the lesson. **S**, **B**
- [ ] The review shows before/after positions. **U**
- [ ] Engine details start collapsed. **S**
- [ ] **Show why** steps through the recommended line on the main board without changing the live game; it is labelled as analysis; it works for ended and imported reviews. **S**, **B**
- [ ] During analysis, drag is blocked, drops snap back and taps are ignored; keyboard moves don't change the live game. **U**, **S**
- [ ] Analysis replay stops at the last legal step if the line becomes illegal, and keeps the live game's PGN. **B**
- [ ] **Back to game** (or history navigation) clears analysis and restores the live position. **B**, **S**
- [ ] The review surfaces an actionable Coach cue and a one-click "practise this" action. **S**
- [ ] The post-game summary shows accuracy, average loss, move quality, accuracy by phase, an eval chart, the opening, critical moments (click to jump) and best moves. Baseline screenshots
- [ ] The post-game summary offers current-game practice, which opens the generated drill. **S**
- [ ] Coach Insights show recurring mistake trends over time. **S**
- [ ] The opening context links into the Library study page. **S** (opening-transfer journeys)

## 6. Practice drills and scheduling

- [ ] Drill IDs are deterministic from position + answer + tag and prefixed `drill-`. **B**
- [ ] A new item is due immediately; spacing intervals are 1 day, then 3 days, then `max(4, round(interval × ease))`; ease starts at 2.5, +0.08 per unassisted correct, −0.05 when the answer was revealed, −0.2 on a miss, floored at 1.3. A miss resets reps and makes the item due now. Three reps means mastered. **B** *(changes: FSRS, Phase 4)*
- [ ] Each attempt appends an event (drill id, tag, FEN, best move, correct, result). **B**
- [ ] Trend snapshots, rates and day streaks are computed correctly; a gap breaks the streak. **B**
- [ ] Grading accepts sound alternatives within 80cp, rejects inaccurate ones, leaves the attempt ungraded when engine scores are missing, and treats a missed immediate mate as wrong. **B**, **S**
- [ ] Hint ladder: concept prompt → piece → destination → answer (legal SAN). **B**, **S**
- [ ] A drill can ask for a bounded, legal follow-up after the opponent's reply. **B**, **S**
- [ ] A completed drill is recorded only once. **B**, **S**
- [ ] Practice borrows the board and returns to exactly the same unfinished game and statistics on exit; ended games are not restored. **S**, **U**
- [ ] Focus mode: play controls are hidden, the active drill is highlighted, and controls return on exit. **S**
- [ ] Ordered multi-drill sessions show their position, advance with Next, and complete. **S**
- [ ] The practice queue shows progress metrics, seven-day activity and the streak; a caught-up state renders. **S**
- [ ] Practice progress and schedule survive reload. **S**
- [ ] v1 practice data upgrades to v2 by drill ID, and the event log starts empty. **B**

## 7. Adaptive session (Daily Sprint)

- [ ] First visit explains the bounded baseline (10 reviewed moves), offers a one-click start, explains how adaptation begins and shows the target; on narrow screens it appears before account setup. **S**
- [ ] There is always exactly one clear next training action. **S** (one visible primary action per state)
- [ ] The focus is chosen from error severity, recency and practice results; the session names the focus and explains why. **S**
- [ ] Sessions are bounded and progress from drills to live transfer to completion, with a takeaway that states its uncertainty honestly. **S**
- [ ] Reload mid-phase resumes the right phase, action and position. **S**
- [ ] Completion starts or continues a streak and survives reload. **S**
- [ ] Legacy in-progress sprints upgrade without losing work. **S**
- [ ] The training goal and session style (drills-first / play-first / balanced) shape the plan. **S**

## 8. Library

- [ ] 39 openings and 50 lines, with unique IDs, names, categories, and exactly one explanation per move. **B**
- [ ] Every opening line is legal chess (806 moves replayed with the vendored chess.js). **B**
- [ ] Study: step through with Prev/Next/Start/End; per-move explanations and key ideas. Baseline screenshots
- [ ] Quiz: the opponent's replies play automatically; misses are counted and can be reviewed; spaced repetition is recorded per line. **S**
- [ ] Spaced repetition uses the synced growth store; save failures return an error result and warn the user. **U** *(changes: FSRS)*
- [ ] Share link; Add to my repertoire, which persists across reload. **S**
- [ ] Search plus All / White / Black / Gambits / Traps filters. Baseline screenshots

## 9. Explore (Lichess)

- [ ] The user's Lichess token is kept in `sessionStorage` only; any legacy `localStorage` copy is cleared on load. **U**
- [ ] Token entry is a real form; an empty submit shows feedback. **U**
- [ ] Masters and Lichess databases, from any position; Undo and Reset work. Not automated
- [ ] Stale explorer responses are ignored (request id guard). Not automated

## 10. Growth: profile, repertoire, imports, endgames, backup

- [ ] The training profile saves through onboarding; existing ratings seed the estimate. **S**
- [ ] Personal repertoire: built from Library picks and imported games, with confidence, focus (persists), bridge drills and a repair queue. **S**
- [ ] PGN Inbox: splits multi-game PGNs, reviews every selected-side move across games, keeps game identity, shows progress, and can be cancelled. Cancelling discards the batch and leaves the live game untouched. **B**, **S**
- [ ] Endgame lessons: legal positions, correct best moves and continuations; they run through the graded practice loop and update progress. **B**, **S**
- [ ] The weekly review compares problem recurrence before and after practice, with a 30-sample floor per side and both counts reported; equal rates are reported as unchanged. **B**, **S**
- [ ] Training-data backup: a versioned local export, plus an import that merges safely. **S**, **B**
- [ ] Corrupt local Coach state is recovered without losing data. **B**, **S** (recovery validators and journeys)

## 11. Accounts, sign-in and sync

- [ ] Coach works fully local-only when `coach-config.js` is blank. README
- [ ] Sign-in by magic link; the token fragment survives URL syncing until read, then is stripped; expired links show a status. **S**, **U**
- [ ] The emailed 6-digit code is gated by `emailCodeEnabled` and stays hidden until it is enabled; a pending sign-in survives reload. **S**
- [ ] Auth storage falls back from local to session to memory, says so to the user, and migrates legacy tab-scoped sessions. **S**, **U**
- [ ] Anonymous progress is adopted into the account on sign-in, and only once; a failed adoption keeps the anonymous data. **B**, **S**
- [ ] Practice, Daily Sprint and growth data are isolated per account and survive account switches. **B**, **S**
- [ ] Cross-device merges keep completed drills, transfer moves, phase, drill quality, the newer profile and repertoire, and Library progress. **S**
- [ ] Signed-in attempts go through the transactional practice RPC, with writes serialised per drill; offline events retry after reconnect; the remote schedule and trends hydrate. **S**, **A**, **DB**
- [ ] Manual sync aggregates and reports partial failures. **U**
- [ ] Offline state and reconnection are announced accessibly. **S**, **U** (live region)
- [ ] Remote game updates are debounced and queued; per-move sync and take-backs update insights incrementally, without full reloads; stale games never write. **U**

## 12. Security and data (shipped artefact)

- [ ] No third-party CDN scripts; no inline scripts; `target="_blank"` links carry `noopener`. **A**
- [ ] CSP: no `'unsafe-inline'` in `script-src`; no Wikimedia image hosts. **A**
- [ ] Supabase: RLS on every table, with owner-only policies using `(select auth.uid())`; `handle_new_user` is security definer with an empty search_path and revoked from public; the practice RPC is security invoker, idempotent by event ID and rebuilds schedules chronologically. **A**, **DB**
- [ ] Database tests prove account isolation, idempotency and late-event ordering. **DB**

## 13. Account continuity and recovery

- [ ] A real game saves a checkpoint and its reviewed moves. A second browser is offered the saved session, but cloud history never replaces the board automatically. Continuing keeps the PGN under a separate, unrated game identity and leaves the source game unchanged. **S**, **B**
- [ ] A displaced local session can be recovered, with the exact moves restored. **S**
- [ ] Offline reviewed moves queue durably, stay visible locally and drain after reconnect, even if the board has since been replaced. A take-back cancels an unsent review, and that review never reappears remotely. **S**, **B**
- [ ] Stale-tab checkpoint writes pause instead of overwriting; the pause survives reload; explicit continuation forks the stale tab and leaves the source intact. **S**, **B**, **DB** (`verify-account-checkpoints.sql`)
- [ ] Simultaneous profile syncs from two browsers merge. Profile conflicts reread and retry without overwriting concurrent evidence. Game snapshots commit in order, and a held write doesn't block unrelated games. **S**, **B**
- [ ] Sign-out affects only this browser. If server logout fails, the cleared local credentials are reconciled. A retained SDK session is reported honestly. A different account sees none of the previous account's history or board. **S**
- [ ] Backup export includes saved and unsaved games and practice, never authentication storage. Import is staged for the current owner, without remote IDs, keeps the current board, doesn't duplicate data on repeat, and rejects malformed or partial input with nothing changed. Quota and storage failures roll back. **B**, **S**
- [ ] A recovery journal survives storage failure and recovers once storage returns, without losing data. Ambiguous multi-owner history is refused. **B**

## 14. Learning transfer checks

- [ ] After a rehearsal, a different-position check tests the same idea. It never repeats the source position, the same position with changed move counters still counts as the same, opened checks aren't offered as new, and an exhausted pool doesn't repeat. **B**, **S**
- [ ] The first decision is recorded and kept: correct retries, hints, completion and merges never erase it, and a hinted first decision isn't called unassisted. **B**
- [ ] Unknown or unavailable engine results are never graded as misses. **B**, **S**
- [ ] Checks don't inflate rehearsal or daily progress, and the borrowed game's identity, PGN, stats and level are unchanged afterwards; reload keeps the borrowed game and pending result. **S**
- [ ] Check history is isolated per account; guest evidence is adopted without leaking. **B**

## 15. Opening transfer (study → play → review)

- [ ] All 35 authored lines produce valid exercises, while missing lessons and invalid lines produce none. A mismatched opening or side is rejected. **B**
- [ ] Opening context and borrowed games never leak between owners. Opening history is bounded, de-duplicated, survives cross-device merges, and is adopted from guest without loss. **B**, **S**
- [ ] A proven mate stays graded without engine data. Finishing an exercise restores the old game only after the outgoing save completes. **B**
- [ ] Custom and zero-move PGN games keep their FEN and history; invalid snapshots are rejected. **B**

## 16. Useful progress

- [ ] Monthly flag windows count each review once and ignore future, malformed, unknown or duplicate entries. Duplicate tags aren't double-counted. Rates use reviewed volume as the denominator. **B**
- [ ] Comparisons need ≥30 reviews per window (29 stays inconclusive). Missing history never implies improvement, and equal rates say "unchanged". A higher raw count with a lower rate still reports the lower rate. **B**
- [ ] Hinted, revealed, missed and invalid attempts don't open a transfer checkpoint, and an incomplete baseline never implies progress. **B**
- [ ] Progress recommends one real next action. An empty state starts a baseline in one click, sparse evidence uses careful language, unplayable positions produce no dead buttons, it respects the play-first preference, and it doesn't replace an unfinished daily focus or a live game. **B**, **S**
- [ ] Loaded account reviews aren't replaced by stale local data or double-counted. **B**
- [ ] Unreachable daily plans are repaired without fabricating completion or rewriting a completed day or active play. **B**

## 17. Layout and interaction invariants (current desktop UI)

- [ ] At 1280×800, 1440×900 and 1920×1080: the Coach board area doesn't scroll, the board is square and at least 320px, there's no horizontal page scroll, and exactly one visible primary action is shown per state. **S** (`verify-ui-journeys.js`) *(changes: the new shell keeps the spirit of this check and adds 375px and 1024px)*
- [ ] The review dialog traps focus, blocks background board shortcuts, and returns focus to an available control when closed. **S**
- [ ] Top-tab arrow keys don't also step the Library board; the idea selector's arrows aren't consumed by board shortcuts. **S**
- [ ] Navigating away and back preserves the drill position, hints, attempts and daily progress, and a resumed drill accepts its solution. **S**
- [ ] Returning from a transient explanation shows the real live board; resuming from Progress reveals feedback and focuses the board. **S**

---

## Known issues found while baselining

- **Quiz shows the answers.** In Library → Quiz, the full move list stays
  visible in the right panel (`docs/baseline/library-quiz.png`), so the
  moves you are being asked to recall are on screen. Fix in Phase 6, when
  Study/Quiz move into one view; consider a quick fix sooner.
- **The left rail is a drawer of seven groups** under game setup
  (`coach-rail-groups-open.png`). Already covered by the IA change.

## Phase 2 outcome

The seven risky areas flagged in Phase 0 now have behaviour tests:

1. Engine task failure and cancellation: **U**.
2. Game-generation and stale-result guards: **U**, **S**.
3. Threat-scan ordering and staleness: **U**.
4. Player-estimate update and idempotency: **S** (already covered).
5. Sign-in URL handling and auth storage fallback: **U**.
6. Sync debouncing, queueing and incremental insights: **U**.
7. Spaced-repetition save failures: **U**.

A mutation run confirmed the suite catches real regressions: forgetting
queued engine tasks, dropping the magic-link fragment during URL sync, and
reloading every insight per move each failed the right check.

### Known gaps

- Resignations feeding the player estimate (the lifetime-stats side is
  tested).
- Learning-artifact sync skipping empty work, and Copy PGN/FEN clipboard
  failure (share link is tested).
- Explorer database switching, Undo/Reset, and its stale-response guard
  (needs a stubbed Lichess API).
- The older pure-logic validators (`validate-practice-logic`, `-difficulty`,
  `-review-teaching`, and the other `B` validators) still pick functions out
  of the app source by name (now via `scripts/lib/app-source.js`, so moving a
  function between files no longer breaks them; renaming one still does).
  Since Phase 4a, `scripts/validate-core.js` tests `src/core/` by loading each
  file whole; the remaining validators can migrate to that style file by file.
