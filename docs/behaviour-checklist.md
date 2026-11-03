# Behaviour checklist

Phase 0 of [the redesign plan](redesign-plan.md). This is what the app must
keep doing through the redesign. Each item says how it is checked today:

- **B**: a behavioural test that runs the code (`validate-practice-logic`,
  `validate-difficulty`, `validate-growth-upgrades`, `validate-practice-upgrades`,
  `validate-review-teaching`, `validate-openings`).
- **S**: the browser smoke suite (`scripts/verify-browser.sh`).
- **R**: only a regex over the source text. **Phase 2 must give each R item a
  behavioural test** (unit test or smoke step) before the code moves.
- **DB**: Supabase migrations and database tests.

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
- [ ] `?view=coach|library` selects the view; URL hydration is isolated in one place. **R**
- [ ] Top-level tabs expose a complete tab/tabpanel relationship and support arrow keys. **R**
- [ ] Coach panel tabs (Game / Practice / Progress) expose a complete tab relationship and support arrow keys. **R** *(changes: IA)*
- [ ] No web app manifest, no service-worker registration, no install prompt. **S**, **R**
- [ ] `service-worker.js` stays a kill switch: it unregisters earlier installs and clears every cache. **R**
- [ ] Below 1024px a desktop notice appears as an accessible dialog with a "continue" option; dismissal lasts for the session and leaves the app usable; the board doesn't shrink below desktop size. **S**, **R** *(changes: removed when phone layout ships, Phase 6)*
- [ ] No console errors or page errors during the full smoke journey. **S**

## 2. Board input and accessibility

- [ ] Drag, tap-to-move and a keyboard move form all work, on both boards. **S**, **R**
- [ ] Keyboard moves accept SAN (`e4`, `Nf3`) and coordinates (`e2e4`). **R**
- [ ] Promotion opens a named dialog with four choices. **R**
- [ ] Dialogs trap focus. **R**
- [ ] Coach status and quiz feedback are live regions that announce changes. **R**
- [ ] Post-game moment rows are real buttons. **R**
- [ ] Pieces use the vendored cburnett SVG set. **R**
- [ ] Board colours are themeable, with a green option. **R**
- [ ] Last-move highlight survives board redraws. **R**

## 3. Coach play and engine

- [ ] New game, resign & review, play as White / Black / Random, take back (move pair), flip. **S** (partial)
- [ ] The opponent replies after every move, including after captures. **S**
- [ ] Every user move is classified (best → blunder) against the engine. **S**
- [ ] A missed mate-in-one is classified as a blunder; delivering mate is classified as best and stays scorable. **S**
- [ ] The engine wrapper detects and uses only the UCI options the bundled Stockfish announces. **S**, **R**
- [ ] A worker error fails both active and queued engine tasks; evaluate tasks carry a reject path. **R**
- [ ] Position resets cancel active and queued engine work. **R**
- [ ] Async work from a replaced or rewound game is discarded (game generation guard); a replacement game never inherits stale results or accuracy. **S**, **R**
- [ ] Move analysis verifies it is still looking at the game it started on. **R**
- [ ] Opponent move failures show a retry message and action. **R**
- [ ] Coach move flow has explicit phases (idle → analyzing → opponentThinking → ended). **R** *(implementation detail; keep the behaviour, drop the name check)*
- [ ] Threat scan: static threats render first, the mate scan runs afterwards, stale results are ignored, and "unavailable" is distinct from "no threat". **R**
- [ ] Games have stable local IDs; lifetime stats roll up once per game, and take-back can remove a completed game's rollup. **R**
- [ ] Copy FEN / copy PGN; clipboard failures are handled. **R**

## 4. Opponent difficulty and player estimate

- [ ] The difficulty mapping is monotonic at every slider step: error probability and error size fall as level rises, and mean loss is lower at high levels. **B**, **S**
- [ ] Candidates are score-sorted and de-duplicated; losses are computed correctly. **B**
- [ ] Errors are capped (≤ 500cp absolute); smaller errors are preferred over the largest allowed. **B**
- [ ] A winning mate is always converted; when every line loses, the longest mate is preferred; a forced losing mate is never chosen over a centipawn alternative. **B**, **S**
- [ ] Beginner opponents don't throw away a mate-in-one or allow mate when a defence exists. **S**
- [ ] Equal-valued alternatives are varied. **B**
- [ ] The player estimate moves in the right direction after completed results, narrows its uncertainty with evidence, and counts each game only once. **S**, **R**
- [ ] Resignations count as completed games. **R**
- [ ] Adaptive opponent strength is on by default and follows the player estimate. **S**
- [ ] Changing the starting estimate resets the calibration evidence. **S**
- [ ] `scripts/calibrate-difficulty.js` runs, and its trend, severe-blunder and mate-in-one rates are reviewed whenever the model changes (CLAUDE.md).

## 5. Move review and teaching

- [ ] Each move review starts with a short explanation that names a chess concept and the opponent's threat, shown separately from the lesson. **S**, **R**
- [ ] The review shows before/after positions. **R**
- [ ] Engine details start collapsed. **S**
- [ ] **Show why** steps through the recommended line on the main board without changing the live game; it is labelled as analysis; it works for ended and imported reviews. **S**, **B**
- [ ] During analysis, drag is blocked, drops snap back and taps are ignored; keyboard moves don't change the live game. **B**, **S**
- [ ] Analysis replay stops at the last legal step if the line becomes illegal, and keeps the live game's PGN. **B**
- [ ] **Back to game** (or history navigation) clears analysis and restores the live position. **B**, **S**
- [ ] The review surfaces an actionable Coach cue and a one-click "practise this" action. **S**, **R**
- [ ] The post-game summary shows accuracy, average loss, move quality, accuracy by phase, an eval chart, the opening, critical moments (click to jump) and best moves. Baseline screenshots
- [ ] The post-game summary offers current-game practice, which opens the generated drill. **S**
- [ ] Coach Insights show recurring mistake trends over time. **S**, **R**
- [ ] The opening context links into the Library study page. **R**

## 6. Practice drills and scheduling

- [ ] Drill IDs are deterministic from position + answer + tag and prefixed `drill-`. **B**
- [ ] A new item is due immediately; spacing intervals are 1 day, then 3 days, then `max(4, round(interval × ease))`; ease starts at 2.5, +0.08 per unassisted correct, −0.05 when the answer was revealed, −0.2 on a miss, floored at 1.3. A miss resets reps and makes the item due now. Three reps means mastered. **B** *(changes: FSRS, Phase 4)*
- [ ] Each attempt appends an event (drill id, tag, FEN, best move, correct, result). **B**
- [ ] Trend snapshots, rates and day streaks are computed correctly; a gap breaks the streak. **B**
- [ ] Grading accepts sound alternatives within 80cp, rejects inaccurate ones, leaves the attempt ungraded when engine scores are missing, and treats a missed immediate mate as wrong. **B**, **S**
- [ ] Hint ladder: concept prompt → piece → destination → answer (legal SAN). **B**, **S**
- [ ] A drill can ask for a bounded, legal follow-up after the opponent's reply. **B**, **S**
- [ ] A completed drill is recorded only once. **B**
- [ ] Practice borrows the board and returns to exactly the same unfinished game and statistics on exit; ended games are not restored. **B**, **S**
- [ ] Focus mode: play controls are hidden, the active drill is highlighted, and controls return on exit. **S**
- [ ] Ordered multi-drill sessions show their position, advance with Next, and complete. **S**
- [ ] The practice queue shows progress metrics, seven-day activity and the streak; a caught-up state renders. **S**
- [ ] Practice progress and schedule survive reload. **S**
- [ ] v1 practice data upgrades to v2 by drill ID, and the event log starts empty. **B**

## 7. Adaptive session (Daily Sprint)

- [ ] First visit explains the bounded baseline (10 reviewed moves), offers a one-click start, explains how adaptation begins and shows the target; on narrow screens it appears before account setup. **S**
- [ ] There is always exactly one clear next training action. **R**
- [ ] The focus is chosen from error severity, recency and practice results; the session names the focus and explains why. **S**, **R**
- [ ] Sessions are bounded and progress from drills to live transfer to completion, with a takeaway that states its uncertainty honestly. **S**
- [ ] Reload mid-phase resumes the right phase, action and position. **S**
- [ ] Completion starts or continues a streak and survives reload. **S**
- [ ] Legacy in-progress sprints upgrade without losing work. **S**
- [ ] The training goal and session style (drills-first / play-first / balanced) shape the plan. **S**, **R**

## 8. Library

- [ ] 28 openings and 35 lines, with unique IDs, names, categories, and exactly one explanation per move. **B**
- [ ] Every opening line is legal chess. Not checked today: `validate-openings.js` checks the structure but never plays the moves. Add this in Phase 2 (cheap with the vendored chess.js).
- [ ] Study: step through with Prev/Next/Start/End; per-move explanations and key ideas. Baseline screenshots
- [ ] Quiz: the opponent's replies play automatically; misses are counted and can be reviewed; spaced repetition is recorded per line. **S**
- [ ] Spaced repetition uses the synced growth store; save failures return an error result and warn the user. **R** *(changes: FSRS)*
- [ ] Share link; Add to my repertoire, which persists across reload. **S**
- [ ] Search plus All / White / Black / Gambits / Traps filters. Baseline screenshots

## 9. Explore (Lichess)

- [ ] The user's Lichess token is kept in `sessionStorage` only; any legacy `localStorage` copy is cleared on load. Not automated (README only); worth a Phase 2 test because it is a privacy promise.
- [ ] Token entry is a real form; an empty submit shows feedback. **R**
- [ ] Masters and Lichess databases, from any position; Undo and Reset work. Not automated
- [ ] Stale explorer responses are ignored (request id guard). Not automated

## 10. Growth: profile, repertoire, imports, endgames, backup

- [ ] The training profile saves through onboarding; existing ratings seed the estimate. **S**
- [ ] Personal repertoire: built from Library picks and imported games, with confidence, focus (persists), bridge drills and a repair queue. **S**, **R**
- [ ] PGN Inbox: splits multi-game PGNs, reviews every selected-side move across games, keeps game identity, shows progress, and can be cancelled. Cancelling discards the batch and leaves the live game untouched. **B**, **S**
- [ ] Endgame lessons: legal positions, correct best moves and continuations; they run through the graded practice loop and update progress. **B**, **S**
- [ ] The weekly review compares problem recurrence before and after practice, with a 30-sample floor per side and both counts reported; equal rates are reported as unchanged. **B**, **S**
- [ ] Training-data backup: a versioned local export, plus an import that merges safely. **S**, **R**
- [ ] Corrupt local Coach state is backed up to a separate key, with a visible status message. **R**

## 11. Accounts, sign-in and sync

- [ ] Coach works fully local-only when `coach-config.js` is blank. README
- [ ] Sign-in by magic link; tokens are stripped from the URL after use; expired links show a status. **S**, **R**
- [ ] The emailed 6-digit code is gated by `emailCodeEnabled` and stays hidden until it is enabled; a pending sign-in survives reload. **S**, **R**
- [ ] Auth storage is capability-checked, with a visible in-memory fallback; legacy tab-scoped sessions migrate to persistent storage. **S**, **R**
- [ ] Anonymous progress is adopted into the account on sign-in, and only once; a failed adoption keeps the anonymous data. **B**, **S**
- [ ] Practice, Daily Sprint and growth data are isolated per account and survive account switches. **B**, **S**
- [ ] Cross-device merges keep completed drills, transfer moves, phase, drill quality, the newer profile and repertoire, and Library progress. **S**
- [ ] Signed-in attempts go through the transactional practice RPC, with writes serialised per drill; offline events retry after reconnect; the remote schedule and trends hydrate. **R**, **DB**
- [ ] Manual sync aggregates and reports partial failures. **R**
- [ ] Offline state and reconnection are announced accessibly. **S**, **R**
- [ ] Remote game updates are debounced and queued; per-move sync and take-backs update insights incrementally, without full reloads; empty syncs skip work. **R**

## 12. Security and data (shipped artefact)

- [ ] No third-party CDN scripts; no inline scripts; `target="_blank"` links carry `noopener`. **R** (artefact check; keep as is)
- [ ] CSP: no `'unsafe-inline'` in `script-src`; no Wikimedia image hosts. **R** (artefact check; keep)
- [ ] Supabase: RLS on every table, with owner-only policies using `(select auth.uid())`; `handle_new_user` is security definer with an empty search_path and revoked from public; the practice RPC is security invoker, idempotent by event ID and rebuilds schedules chronologically. **R**, **DB**
- [ ] Database tests prove account isolation, idempotency and late-event ordering. **DB**

---

## Known issues found while baselining

- **Quiz shows the answers.** In Library → Quiz, the full move list stays
  visible in the right panel (`docs/baseline/library-quiz.png`), so the
  moves you are being asked to recall are on screen. Fix in Phase 6, when
  Study/Quiz move into one view; consider a quick fix sooner.
- **The left rail is a drawer of seven groups** under game setup
  (`coach-rail-groups-open.png`). Already covered by the IA change.

## Phase 2 to-do summary

Every **R** item needs a behavioural test before the code moves. The
**R**-only items that guard tricky logic, and so deserve unit tests first, are:

1. Engine task failure and cancellation (§3).
2. The game-generation and stale-result guards (§3).
3. Threat-scan ordering and staleness (§3).
4. The player-estimate update and its idempotency (§4).
5. The sign-in URL handling and auth storage fallback (§11).
6. Sync debouncing, queueing and incremental insight updates (§11).
7. Spaced-repetition save failures (§8).

Items under `validate-maintainability.js` (dead-code and naming checks) can
be dropped once the code is in modules; they pin names, not behaviour.
