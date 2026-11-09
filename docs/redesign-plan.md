# Redesign plan

Status: plan agreed in outline, 2 November 2026. Phase 0 done: see
[behaviour-checklist.md](behaviour-checklist.md) and [baseline/](baseline/).
Phase 1 done: see [design-spec.md](design-spec.md) and [design-system/](design-system/).
Phase 3 done: the app uses `styles/tokens.css`, self-hosted fonts and the
Blend look on the existing layout.
Phase 2 done: no validator pattern-matches the app's source any more; see
the *Phase 2 outcome* in [behaviour-checklist.md](behaviour-checklist.md).
Phase 4a done: `app.js` is 4,009 lines (from 9,148); core logic lives in
`src/` as plain scripts, with `scripts/validate-core.js` unit-testing
`src/core/`. Phase 4b (FSRS) is deferred: see decision 3 in §6.
Phase 6, 9 November 2026: `app.js` is gone. Its code moved unchanged into
classic scripts under `src/views/` (`shell.js`, `library.js`, `coach.js`,
`coach-review.js`, `coach-practice.js`, `boot.js`); see the Phase 6 row.
Phase 5 done, 8 November 2026, except a real-phone check: every board runs
on cm-chessboard behind `src/ui/board.js`; see the Phase 5 row in §5. jQuery
is gone (9 November 2026): app code uses DOM APIs and the helpers in
`src/ui/dom.js`.

November 2026 additions (outside the phases, on the current layout): a
Puzzles destination, an on-board overlay (`board-overlay.js`: arrows,
quality badges, eval bar) that Phase 5 can keep using on cm-chessboard
because it reads square positions from the rendered board, Explore as an
analysis board, a game archive with retries, opponent personas, endgame
practice and an activity calendar. Each lives in its own module beside
`app.js` rather than inside it, which is the direction Phase 4 asks for.
The Library quiz now hides unplayed moves (one of the §1 problems).

The goal is an app that is pleasant to use and cheap to change: a new
colour, a new panel, or a new training mode should be a small, local edit
instead of a hunt through an 8,000-line file.

Contents: §0 research · §1 diagnosis · §2 principles · §3 target
experience · §4 architecture · §5 phases · §6 decisions.

---

## 0. What the research says

### How other chess apps do it

- **The board never moves.** Lichess, Chess.com, Chessable and ChessTempo
  all keep one fixed board and change the panel beside it. On Lichess, even
  the opening explorer is a toggle inside the analysis board, not a separate
  mode. That is the opposite of today's split between Library and Coach.
- **One evaluation surface.** The evaluation is a vertical bar next to the
  board, plus a clickable evaluation graph near the move list. Clicking a
  point on the graph jumps to that move.
- **Move quality appears in two places.** The glyph sits next to the move
  in the notation and as an icon on the move's destination square.
- **Coach text points at the board.** In Chess.com's Game Review v2,
  hovering over a highlighted word ("the knight on f6") draws the arrow or
  highlight on the board. Explaining a move steps through the line with a
  comment after each move.
  ([Game Review v2](https://www.chess.com/news/view/chesscom-launches-game-review-v2),
  [design update](https://www.chess.com/news/view/game-review-design-update))
- **Review shows a summary first, then the key moments.** The summary covers
  accuracy, accuracy by phase, and the evaluation graph. After that come
  3–5 key moments, each with Retry / Show best / Explain. Lichess's
  "Learn from your mistakes" turns those moments into a guided retry.
  ([Lichess blog](https://lichess.org/@/lichess/blog/learn-from-your-mistakes/WFvLpiQA))
- **Classification uses win probability, not raw centipawns.** Chess.com
  only calls a move a blunder if it also loses material or allows mate. It
  also has a "Miss" class for tactics you failed to punish.
  ([how moves are classified](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-move))
- **Drills schedule each move separately.** Chessable, Listudy and
  Chessbook schedule individual moves, not whole lines. ChessTempo lets you
  narrow training by branch, colour or depth. It also has a "most resistant
  moves" mode for the moves you keep forgetting.
  ([Chessable scheduling](https://support.chess.com/en/articles/10319322-how-does-the-spaced-repetition-scheduling-work),
  [ChessTempo](https://el.chesstempo.com/opening-training/))
- **Progress you can act on.** Lichess's puzzle dashboard sorts themes into
  strengths and weaknesses, each with a rating and a solve rate, and offers
  "replay failed puzzles". Badges play no part.
- **Visual settings are becoming user-tunable.** Lichess's 2026 changelog
  adds settings for interface roundness, board brightness and a transparent
  theme. These are exactly the knobs a token system makes cheap.
  ([changelog](https://lichess.org/changelog))
- **"What would someone at my level play"** is becoming a second axis next
  to "what is best". MaiaChess v1 shows this.
  ([MaiaChess v1](https://www.maiachess.com/blog/platform-v1))
  This plan doesn't add it, but the context panel should leave room for it.

### Learning science that should shape the UX

- **Retrieval practice and spacing** are the only two of ten techniques
  rated "high utility" by Dunlosky et al. (2013). Rereading is rated low.
  For this app, Study should lean toward "try to recall it" with the
  explanation as the fallback.
  ([summary](https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html))
- **Interleaving.** In Rohrer & Taylor (2007), mixing problem types beat
  practising one type at a time. For this app, the Train queue should mix
  openings and mistake themes. It can also hide the opening name, so that
  recognising the position becomes part of the task.
  ([paper](https://digitalcommons.usf.edu/psy_facpub/1767/))
- **Feedback timing.** Feedback right away helps beginners and works well
  in drills. Delayed feedback often helps long-term retention. A sensible
  split:
  - right/wrong immediately in drills;
  - during games, a light touch by default;
  - full explanations in the post-game review.
  ([Butler, Karpicke & Roediger 2007](https://pcllab.github.io/downloads/2007/2007_Butler_Karpicke_Roediger_JEPA.pdf))
- **Worked examples, then fading.** Demonstrations help newcomers, then get
  in the way once a learner knows the material (the "expertise reversal"
  effect). For this app, demonstrate a line first, then hide more of it on
  each pass. Cards the learner already knows well should skip the
  explanation.
- **One primary action per screen** keeps the cognitive load down. Engine
  lines and explorer stats belong behind toggles.
- **Gamification has small, short-lived effects.** Badges and leaderboards
  show no consistent effect (Sailer & Homner 2020). Prefer due counts,
  mastery for each line, and lists of strengths and weaknesses.
- **Scheduler.** FSRS is the modern open-source successor to SM-2.
  [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) is MIT and
  ships an ESM build, so it can be vendored without a build step.

### Board libraries

| | License | No build step | Arrows / marks | Premoves | Accessibility |
|---|---|---|---|---|---|
| chessboard.js 1.0 (replaced in Phase 5) | MIT | yes, needs jQuery | none | no | none; last release 2019 |
| [chessground](https://github.com/lichess-org/chessground) | **GPL-3.0** | yes (min bundle / ESM) | built-in SVG shapes, right-click drawing | yes | none built in |
| [cm-chessboard](https://github.com/shaack/cm-chessboard) | MIT (code); bundled piece sets carry their own licences | yes, pure ES modules | Markers + Arrows extensions | no | best of the three: extension with alt text, a table view and typed input |
| react-chessboard | MIT | no (needs React/JSX) | yes | yes | some |

Shipping chessground means the client JavaScript you distribute is a GPL
work. The app's front-end would have to be licensed GPL-3.0, with its
source available. That is fine for an open personal project, but it is a
real commitment.


---

## 1. Why it feels un-tweakable today

Measured against `main` at `4a941b3` (22 October 2026). Some pure logic has
already moved out of `app.js` into `account-continuity.js`,
`learning-transfer.js` and `opening-transfer.js`, with behavioural
validators. That's the right direction, and the plan builds on it.

### Code

| Symptom | Evidence | Why it hurts |
|---|---|---|
| One giant runtime file | `app.js` is 9,019 lines, with 383 top-level functions and 81 module-level `let`s (`app.js:1-100`) | Any change means reading far more than you touch, and state can be mutated from anywhere |
| UI state lives in the DOM | 67 inline `style="display:none"` in `index.html`; ~140 show/hide calls in `app.js` | To know what's on screen, you have to replay every handler that ran |
| Hard-wired element ids | 360 ids in `index.html`; ~290 distinct `$('#…')` lookups across the scripts | Moving or renaming markup silently breaks behaviour |
| Two board stacks | `board` (`#myBoard`) and `coachBoard` (`#coachBoard`), each with its own nav, flip, keyboard-move form, highlight and accessibility code (`app.js:6442`, `app.js:6457`) | Every board feature is built twice, or exists in only one mode |
| Board library ceiling | chessboard.js 1.0 + jQuery: no arrows, no square markers, no premove API, and pieces can only be swapped as images | "Show why", candidates, threats and drill hints all work around the board instead of drawing on it |
| Tests that pin the source text | ~200 `requirePattern`/`forbidPattern` regexes over the source in `scripts/validate-*.js`, e.g. `requirePattern(/const CoachController\s*=/)` | A refactor that keeps behaviour intact still fails the validators; renaming a function counts as a "regression" |

The source-regex validators need special mention. They were a cheap way
to lock in fixes, but they now act as a cast around the code. They are the
main reason restructuring feels risky. The plan replaces them with
behaviour tests before moving code (Phase 2). The newer validators
(`validate-account-continuity`, `-learning-transfer`, `-opening-transfer`,
`-useful-progress`, `-recovery`) already test behaviour, and are the model
to follow.

### Styles

| Symptom | Evidence |
|---|---|
| Tokens exist but are bypassed | 28 custom properties in `:root`, yet 58 distinct hard-coded hex colours across 85 uses in `styles.css` |
| No type scale | 47 distinct `font-size` values; 106 `font-family` declarations |
| No spacing or radius scale | Paddings and gaps are hand-picked per rule |
| Specificity fights | 24 `!important`; view styles and component styles share one flat 2,549-line file |
| Monospace as the body font | Everything is the same width and tone, so hierarchy has to come from tiny uppercase labels |
| The brand fonts never load | `--font-mono` (JetBrains Mono) and `--font-reading` (Newsreader) have no `@font-face` and no font files, and the CSP (`default-src 'self'`) would block Google Fonts anyway. Most visitors see Menlo/Consolas and Georgia |

### Product / UX (observed at 1440×900; see `docs/baseline/`)

The October work already fixed some of this. Coach now has a status line
above the board, a single filled "Start training" button, collapsed game
setup and a calmer first review panel. What remains:

- **Two apps in one tab.** Library and Coach have different layouts, board
  sizes, empty states and control bars. Moving between them feels like
  changing products.
- **Navigation doesn't match the jobs.** The header offers Library | Coach,
  but the real jobs are spread across Study/Quiz/Explore toggles, Game/
  Practice/Progress tabs, an adaptive-session card, and seven collapsible
  rail groups (starting position, account, profile, import, repertoire,
  board & sounds, training data).
- **The Coach left rail is still a drawer.** Game setup, account sign-in,
  profile, PGN import, repertoire, settings and backups all sit in one
  column (`coach-rail-groups-open.png`).
- **The board loses space to stacked strips.** `--board-size` is
  `100vh - 300px` because the centre column stacks a status line, a practice
  banner, an analysis strip, two captured bars, a keyboard-move drawer, a nav
  row and a control row. `verify-ui-journeys.js` keeps it all on screen at
  1280×800 and up, but at 1440×900 the controls only just fit along the
  bottom edge.
- **The right rail is one long scroll.** Review, threats, opening,
  evaluation, move list and session stats stack vertically. Library's move
  list is a grid of chips rather than a notation table.
- **Quiz shows the answers.** In Library → Quiz, the full move list stays
  visible (`library-quiz.png`).
- **Feedback is off the board.** Move quality, best move and threats are
  shown as text in the rail, not as arrows, square tints or glyphs on the
  board where the eye already is.

---

## 2. Design principles for the new version

1. **The board is the stage.** Every mode uses the same board workspace;
   panels change around it, the board never moves or resizes between modes.
2. **One primary action per screen.** Exactly one filled button; everything
   else is secondary or tucked into a menu.
3. **Say it on the board first, in words second.** Arrows for best move and
   threats, square tints for the move just played, a quality glyph on the
   destination square; the panel explains *why*.
4. **Retrieval before explanation.** Drills and quizzes ask first and reveal
   on demand (progressive hints), as today, but with the board doing the
   showing.
5. **Plain language.** "Practise 2 of your recent mistakes, then play a
   short game" beats "focused drills → transfer".
6. **Settings live in Settings.** Account, data, board theme, sounds and
   imports move out of the play surface.
7. **Change one token, see it everywhere.** No raw colours, sizes or fonts
   outside the token file.
8. **One layout, three widths.** Phone, tablet and desktop are the same
   components rearranged, not separate designs. On a phone the board is
   edge to edge, actions sit within thumb reach, and nothing depends on
   hover or a keyboard.

---

## 3. Target experience

### Information architecture

Replace Library | Coach with four destinations in a slim left nav (see §6
for why four):

| Destination | Contains (today's equivalent) |
|---|---|
| **Train** (home) | Top: today's plan card (adaptive session, due count, streak, "continue where you left off"). Below: one queue of mistake drills, opening reviews and endgame lessons, with filters instead of separate apps |
| **Play** | New game vs engine with live coaching (Live / Quiet chosen at setup); post-game review opens in place; "Review a game" for PGN import |
| **Study** | Opening library + Lichess explorer + personal repertoire, on one board |
| **Progress** | Insights, accuracy by phase, strengths/weaknesses, transfer comparison, game history |

Plus a **Settings** sheet (account/sync, board & pieces, sounds, theme,
training profile, import/export, backups).

### The board workspace (shared by every destination)

```
┌────┬──────────────────────────────────────────┬───────────────────────┐
│nav │  opponent strip  (name · captured · clock)│  CONTEXT PANEL         │
│    │ ┌─┐┌──────────────────────────────────┐  │  title + one primary   │
│ ◉  │ │e││                                  │  │  action                │
│ ◉  │ │v││             BOARD                │  │ ─────────────────────  │
│ ◉  │ │a││  arrows · tints · quality glyphs │  │  notation table        │
│ ◉  │ │l││                                  │  │  (1. e4  e5 …)         │
│ ◉  │ └─┘└──────────────────────────────────┘  │ ─────────────────────  │
│    │  player strip    (name · captured · clock)│  mode content          │
│ ⚙  │  ◀ ▶ ⇅ ⋯   (one toolbar, keyboard-first) │  (review / drill / ... )│
└────┴──────────────────────────────────────────┴───────────────────────┘
```

- Board size is computed from the space left after **two** thin strips and
  one toolbar, so it gains roughly 120–150px of height at 900px.
- The eval bar sits beside the board and can be hidden (Settings, or
  automatically during drills so it doesn't leak the answer).
- Keyboard move entry becomes a command field opened with `/` or by
  typing, instead of a permanent drawer.
- Keyboard shortcuts everywhere: ←/→ step, ↑/↓ start/end, `f` flip,
  `space` engine line, `h` hint, `Esc` back to game.

### Phone and tablet

Same components, rearranged at two breakpoints. The prototype in
`docs/design-directions/` implements all three widths (the `phone-*.jpg`
and `tablet-*.png` screenshots sit beside it).

| Width | Layout |
|---|---|
| **≥ 1200px** desktop | Three columns: labelled nav, board workspace, 400px context panel (the diagram above) |
| **760–1199px** tablet / small laptop | Same three columns with icon-only nav (64px) and a 340px panel. A 1024px iPad in landscape fits a ~500px board beside the panel |
| **< 760px** phone (and tablets in portrait) | One column: app bar → board edge to edge → horizontal move strip → panel content; four-item tab bar fixed at the bottom; Settings behind a gear in the app bar |

Phone specifics:

- **Board edge to edge.** No frame, full viewport width (375px on a small
  iPhone gives 47px squares). The eval bar becomes a 6px horizontal bar
  above the board.
- **Notation becomes a strip.** A single horizontally scrolling row of moves
  under the board, kept centred on the current move. The full notation table
  stays on tablet and desktop.
- **Order follows the task.** In review, the key-moment card and its primary
  button come straight after the board; the game summary follows. In
  training, the "3 of 8" header and the question sit *above* the board so
  they are read first, and the step controls are hidden because a drill
  doesn't need them.
- **Touch targets at least 44px.** Step buttons span the full width, and the
  primary action is full width and 48px tall.
- **No hover-only behaviour.** Coach text that draws on the board on hover
  does it on tap on touch screens. Keyboard shortcuts stay as extras;
  tap-to-move (already supported today via `tapSelected`) and drag both
  work.
- **Respect the notch and home bar.** `env(safe-area-inset-*)` padding on the
  app bar and tab bar; `100dvh` instead of `100vh` so mobile browser chrome
  doesn't hide the bottom bar.
- **Landscape phones** use the phone layout and scroll; no special design.

Risks that only appear on phones (resolve before shipping phone support):

1. **Magic-link sign-in.** On a phone the link usually opens from the mail
   app, often in a different browser or an in-app web view from the one
   where you asked for it, so the session lands in the wrong place. The
   6-digit emailed code (`emailCodeEnabled` in `coach-config.js`) fixes
   this, but per CLAUDE.md it needs the Magic Link template to carry
   `{{ .Token }}`, which needs custom SMTP, a Pro plan or a Send Email hook.
   Treat that as a prerequisite for Phase 6.
2. **Local-only data on iPhone.** Safari can clear a site's script-written
   storage (including `localStorage`) after 7 days of browser use without a
   visit. Because the app is deliberately browser-only (no home-screen
   install, which would be exempt), local-only phone users could lose
   training history. Mitigation: on phones, nudge sign-in for sync and show
   "last backed up" in Settings. Done in `backup-nudge.js`: Training data
   shows the last backup date at every width; in the stacked layout a
   signed-out user with three or more finished games, drill attempts,
   puzzles or Library reviews sees a banner (sign in / back up now) until
   they back up (gone for 7 days) or hide it (gone for 14 days).
3. **Engine speed.** Opponent strength is set by search depth
   (`COACH_DIFFICULTY_KEYFRAMES`, depth 10 with up to 20 lines), so it plays
   at the same strength on a phone, just more slowly. Measure think time on
   a mid-range phone in Phase 5. If it is too slow, any phone-specific
   reduction has to go through `scripts/calibrate-difficulty.js`, as
   CLAUDE.md requires.
4. **Existing guardrails assume desktop-only.** `scripts/verify-browser.sh`
   asserts that the desktop notice appears at narrow widths, and
   `validate-accessibility.js` requires the notice dialog. CLAUDE.md and
   README describe "no mobile layout by design". All of these change when
   the new shell lands.

### Key flows

- **Play → Review.** At game end the panel switches to *Key moments*
  (3–5 biggest swings) under a summary strip (accuracy by phase, clickable
  eval graph). Each moment: board jumps there, arrows show played vs best,
  one sentence of why, then **Retry** / **Show line** / **Add to
  training**. Piece and square names in coach text draw on the board on
  hover. Full move-by-move review stays one click away.
- **Train.** One card at a time: prompt, board, hint ladder (idea → piece →
  square → answer), then grade and next. Session header shows "3 of 8".
  Mistake drills, opening lines and endgames share this card.
- **Study.** Pick an opening, read the line on the board with arrows for
  each move's idea, switch the same view to Quiz (hides upcoming moves) or
  Explorer (shows database stats per move in the notation panel).
- **Train home.** One card at the top that says what to do next and why,
  in plain words, with one button. The queue sits below it.

### Visual direction

- A new direction, chosen in Phase 1 from the prototypes in
  `docs/design-directions/` (see §6), built as a token system with light
  and dark themes.
- Whatever the direction: a UI typeface for controls, a reading face for
  explanations, a mono face only for notation, FEN and numbers.
- A short type scale and a 4px spacing scale replace the 47 ad-hoc sizes.
- Board themes and piece sets are token swaps.

---

## 4. Architecture (still no build step)

### Files

```
index.html                    shell only: nav, workspace, panel slot
styles/
  tokens.css                  primitives → semantic → component tokens; themes
  base.css                    reset, typography, focus
  components.css              button, card, tabs, notation table, sheet…
  views.css                   per-destination layout tweaks
src/
  main.js                     boot, router, store wiring
  store.js                    tiny observable store (state + actions)
  core/                       pure, DOM-free, testable in node
    rules.js                  chess.js wrapper helpers
    engine.js                 engineClient (Stockfish worker)
    classify.js               move tiers, accuracy
    opponent.js               calibrated difficulty (COACH_DIFFICULTY_KEYFRAMES)
    schedule.js               SM-2 + drill queue
    explain.js                movePurposeText, lessons
  data/
    local.js                  localStorage keys + migrations (keys unchanged)
    sync.js                   coachSync (Supabase)
    lichess.js                explorer client
  ui/
    board.js                  the one Board component (arrows, marks, glyphs)
    notation.js  evalbar.js  strips.js  toolbar.js  sheet.js
  views/
    train.js  play.js  review.js  study.js  progress.js  settings.js
openings.js                   unchanged content data (later: data/openings.js)
```

- **Native ES modules + an import map** for vendored libraries. Vercel
  serves them as static files; nothing to compile.
- **One store, render from state.** Views subscribe to slices of state and
  re-render their region. Visibility is derived (`state.view === 'train'`),
  never toggled by hand.
- **Small `html` tagged-template helper** with escaping by default (the
  current `escapeHtml` discipline, made automatic). Optionally vendor
  lit-html later if diffing becomes worth it.
- **Board library.** Replace chessboard.js with a single `ui/board.js`
  wrapper so the rest of the app never touches the library directly. See
  §6 for the choice. jQuery goes once the board no longer needs it (done
  9 November 2026; see the Phase 5 row).
- **Data compatibility.** Keep every `localStorage` key and the Supabase
  schema as they are; `data/local.js` owns read/write and versioned
  migrations, so existing users lose nothing.

### CSS conventions

- `@layer reset, tokens, base, components, views, utilities;` so order of
  precedence is declared, not fought with `!important`.
- Component classes (`.c-button`, `.c-notation`) with `:where()` for
  defaults so overrides stay one class deep.
- `[data-theme]` and `[data-board-theme]` on `<html>` swap token sets.
- A lint script fails on raw hex colours or `font-size` outside
  `tokens.css`.

### Tests

- **Replace source-regex validators with behaviour tests.** `core/` modules
  get `node --test` unit tests (no dependencies). Each regex assertion is
  either turned into a test of the behaviour it was protecting or deleted
  if it only pinned a name.
- **Keep** the invariant checks that are genuinely about the shipped
  artefact: no service worker registration, no manifest, token kept out of
  `localStorage`, CSP-relevant rules.
- **Keep and extend** `scripts/verify-browser.sh` as the end-to-end smoke
  suite, driven by `data-testid` attributes instead of layout ids.
- `scripts/calibrate-difficulty.js` keeps working against `core/opponent.js`.

---

## 5. Phased migration

Ship each phase to `main` on its own. The app stays usable throughout;
no long-lived rewrite branch.

The new visual direction is a priority, so it starts first. It is also
applied to the current layout early (Phase 3), so you see the new look
long before the restructuring is finished.

| Phase | Scope | Done when |
|---|---|---|
| **0. Baseline** ✅ | Commit or shelve the current uncommitted work. Capture reference screenshots of every view (`scripts/capture-baseline.sh` → `docs/baseline/`). Write a behaviour checklist from README + validators (`docs/behaviour-checklist.md`). | Checklist and screenshots exist |
| **1. Visual direction** ✅ | Refine **D · Blend** (Paper + Club, see §6) in `docs/design-directions/`, then specify it fully at all three widths (phone, tablet, desktop): type scale, colour (dark + light), board and piece themes, move-quality colours, arrows, buttons, cards, tabs, notation table and strip, tab bar. Choose fonts that can be vendored as woff2 under the CSP. | One direction chosen; a written token spec with phone and desktop mockups |
| **2. Safety net** ✅ | Convert source-regex validators into behaviour tests (node unit tests for logic, browser smoke for UI). Add `data-testid`s. *Done without test ids: the tests use existing element ids; Phase 6 adds `data-testid`s when it rewrites the markup.* Can run alongside Phase 1. | Validators no longer read `app.js` as text; all checks green |
| **3. Tokens + reskin** ✅ | Introduce `styles/tokens.css` and layers with the chosen direction's values; replace every raw colour, size, radius and font; vendor the fonts; add the lint script and theme switch. The current layout gets the new look. It stays desktop-only (with the notice) because the old layout can't reflow cheaply. | Lint passes; whole app is in the new direction; light + dark both pass contrast |
| **4. Extract the core** (4a ✅, 4b FSRS deferred) | Move pure logic (engine, classification, opponent, explanations, storage, sync) into `src/core` and `src/data` as ES modules. Replace SM-2 with FSRS (see §6). | `app.js` < 5,000 lines; core has unit tests; calibration script runs unchanged. *4a used plain scripts under `src/` rather than ES modules: the app, `growth.js`, the feature modules and the browser tests share these functions as globals, so ES modules wait for the Phase 6 shell rewrite.* |
| **5. One board** ✅ (one item left) | Build `ui/board.js` on cm-chessboard; switch Coach and Library to it; add arrows, square marks, quality glyphs, eval bar beside board; drop jQuery. Check touch drag, tap-to-move and engine think time on a real phone. *Done 8 November 2026:* cm-chessboard 8.15.4 is vendored (`vendor/cm-chessboard/`, loaded as ES modules by `src/ui/board-module.js`) and `src/ui/board.js` wraps it in the chessboard.js-style API the app already used, so all four boards (Library, Coach, Puzzles, game archive) switched with small edits and chessboard.js is gone. Drag, click and tap share one input path through `onDragStart`/`onDrop`/`onSnapEnd` (the app's own tap-to-move handlers were removed; tapping now also works in Coach drills and for premoves). The board draws square marks (last move, hints, premoves, practice cues, selection, legal-move dots per §4 of the design spec) and coordinates itself, styled from tokens; the cburnett pieces come from a generated sprite (`scripts/build-piece-sprite.js`). Arrows, quality badges and the eval bar stay in `board-overlay.js`, which now reads cm-chessboard's square rects. `verify-behaviour-units.js` covers drag, click, touch tap and touch drag (in a `hasTouch` context), illegal-drop snapback, castling, en passant and promotion redraws, flip and board themes. *jQuery removed 9 November 2026:* every call site uses DOM APIs and the few helpers in `src/ui/dom.js` (lookup, binding with delegation, ready ordering, show/hide with jQuery's display rules); the Lichess explorer requests use `fetch`; `vendor/jquery/` is gone. *Left:* the real-phone check (touch drag, tap-to-move, engine think time on a mid-range phone). | One board implementation; Show why / candidates / hints draw on the board; works by touch |
| **6. New shell & IA** | Responsive workspace (phone / tablet / desktop from the start), nav + tab bar, router (`?view=` URLs kept as aliases), Settings sheet; migrate destinations in order: Play (incl. review) → Train → Study → Progress. Turn on the emailed sign-in code. Remove the desktop notice and update CLAUDE.md, README, `verify-browser.sh` and `validate-accessibility.js` to match. *Router and Settings done 9 November 2026:* `src/ui/router.js` keeps the place in the address bar with real history (Back and Forward across views, openings, Library and Puzzles modes and Settings; old `?view=` / `?opening=` / `mode=` links parse as before), and `src/ui/settings.js` is the Settings sheet behind an app-bar gear (Appearance, Account, Training data; a bottom sheet on phones), holding the controls moved out of Coach's rail. *`app.js` removed 9 November 2026:* its code moved, unchanged, into classic scripts under `src/views/` that load where it did: `shell.js` (current view and view switching, the route, account and device-scoped storage state, board last-move marks, themes, phone notice, board fitting, promotion picker, keyboard move parsing), `library.js` (Study / Quiz / Explore), `coach.js` (game loop, board, controls, panel tabs, summary overlay), `coach-review.js` (review card, analysis line, review cursor, captured pieces, move list / PGN), `coach-practice.js` (mistake drills) and `boot.js` (the ready handler: event binding and startup, last). They stay plain scripts sharing globals, as Phase 4a decided; ES modules still wait for the destinations to be rebuilt. | `app.js` gone; every view is a module under `src/views`; smoke suite runs at 375px, 1024px and 1440px |
| **7. Polish** | Copy pass (plain language), first-visit onboarding, keyboard shortcut sheet, accessibility audit (focus order, live regions, contrast in both themes), performance pass, testing on real iOS Safari and Android Chrome. | Smoke suite + a11y validator green in both themes and at all three widths |

Rough size: Phases 1 and 3 deliver the new look; 2 and 4 are the
unglamorous part and the biggest win for tweakability; 5 and 6 are where
the app's behaviour visibly changes.

---

## 6. Decisions

Recorded 2 November 2026.

| # | Question | Decision |
|---|---|---|
| 1 | Board library | **cm-chessboard** (MIT), behind `ui/board.js`. Keep cburnett pieces (CC BY-SA 3.0, attribution already in `vendor/pieces/cburnett/LICENSE.txt`). |
| 2 | In-game feedback | **Live coaching stays.** It is a game-setup choice (Live / Quiet), defaulting to Live. Quiet shows only a quality tick in the notation and saves explanations for the review. |
| 3 | Scheduler | **FSRS** via vendored `ts-fsrs` (MIT, ESM), **deferred on 6 November 2026.** By then there were three SM-2 schedulers (Library lines, practice drills scheduled in Supabase SQL, and the repertoire trainer in PR #5), and drills need a migration on the database shared with OOTD. When revisited: one shared scheduler in `src/core/` for all three. See migration note below. |
| 4 | Visual identity | **D · Blend: Paper + Club**, light and dark themes, following the device setting with an override in Settings. High priority (Phase 1). Spec below. |
| 5 | Small screens | **Design for phone and tablet now.** Responsive from the new shell (Phase 6) onwards; see §3 "Phone and tablet". |
| 6 | Navigation | **Recommended: four destinations** (Train, Play, Study, Progress) + Settings. See below. |

### FSRS migration note

Today `chess_sr_v1` stores one record per opening line (`ease`, `interval`,
`reps`, `nextDue`, `lastReviewed`) and no review log, so FSRS history
cannot be replayed. Plan:

- Each line becomes one FSRS card per user move in that line (per-move
  scheduling, as Chessable/Listudy do).
- Seed each card from its line's record: due = `nextDue`, stability ≈
  `interval` days, difficulty mapped from `ease` (2.5 → mid, 1.3 → high),
  state = Review if `reps > 0`, else New.
- Keep `chess_sr_v1` untouched as a backup; write FSRS cards under a new
  key with a version, and start keeping a review log from day one.
- Mistake drills move onto the same scheduler so Train is one queue.

### Recommendation: navigation (#6)

Four destinations, each a verb you would say out loud:

- **Train** is the home screen. "Today" and "Train" both answer "what
  should I practise now?", so a separate Today page would be a near
  duplicate. The plan card sits at the top of Train.
- **Play** includes review. A review is the end of a game, not a place you
  navigate to. Importing a PGN is "Review a game" inside Play.
- **Study** puts the opening library, the explorer and your repertoire on
  one board, as Lichess does.
- **Progress** gets its own place because it is read occasionally, at a
  different moment from training, and it would crowd Train.
- **Settings** sits behind a gear and holds account, sync, board & pieces,
  sounds, theme, training profile and backups.

Why not fewer: folding Play into Train hides the one thing you can always
do. Why not five: every extra destination is one more choice before you
start practising. Four is within what people scan at a glance, and every
current feature has an obvious home. Four also fits a phone tab bar without a "More" overflow menu.

### Visual direction (#4): the three starting points

`docs/design-directions/index.html` is one shared page skinned three ways
(screenshots sit beside it). Serve the repo locally and open
`http://127.0.0.1:4173/docs/design-directions/`. The switcher at the bottom
changes the direction and flips the side panel between a game review and
a training card. Narrow the window, or use a phone-sized viewport, to see the tablet and
phone layouts.

All three share the new layout: four-item nav, board with an eval bar,
arrows, a quality glyph, one toolbar, and a context panel with exactly one
primary button. Only the tokens differ (colour, fonts, radius, shadow,
board colours, arrow colours). That is the point of the token
architecture, and it shows how cheaply the look can change later.

| | A · Paper | B · Night | C · Club |
|---|---|---|---|
| Feel | Light, editorial, calm: a study you sit down in | Dark, cool, precise: an analysis instrument | Warm, bold, friendly: a coach glad to see you |
| Type | Newsreader for headlines and explanations, Public Sans UI, IBM Plex Mono notation | Inter everywhere, JetBrains Mono notation | Fraunces display, DM Sans UI, DM Mono notation |
| Shape | Hairline rules, 4px radius, no shadows | Thin borders, 6px radius, flat | Floating rounded cards (14–20px), soft shadows |
| Board | Parchment and stone | Slate blue-grey | Ivory and green |
| Risk | Light-only apps tire some eyes at night, so it needs a dark sibling | Closest to Lichess and Chess.com, so the least distinctive | Most personality; can feel heavy over long sessions |

**Chosen: D · Blend (Paper + Club).** The full spec, which supersedes the
starting values below and settles the open questions, is in
[design-spec.md](design-spec.md). Starting spec as first proposed:

| Token group | Light | Dark |
|---|---|---|
| Page / surface / raised | `#f5efe3` / `#fffcf6` / `#f1e8d6` | `#121714` / `#1b221e` / `#242d28` |
| Text / secondary / muted | `#1f1b15` / `#5c5446` / `#6e6452` | `#f2ece0` / `#c2c4b6` / `#8d9587` |
| Accent (primary button) | brass `#e9ac3f` with ink `#261a05`; brass as text/icon `#8f620c` | brass `#f0b84a` with ink `#1f1607` |
| Board | ivory `#f1e6cb` / sage `#84a184` | ivory `#e8dcc0` / sage `#6e8d71` |
| Arrows: best / played / threat | `#2f7d4c` / `#cf4f35` / `#c58f22` | `#8fdc6a` / `#ff7a59` / `#f0b84a` |
| Move quality: best → blunder | `#2f7d4c` `#6b8f3a` `#b5861b` `#cc6a21` `#c2412d` | `#7fd65a` `#b5d86b` `#f0c95a` `#ff9a52` `#ff6a5a` |
| Shape | radius 8 / 12 / 18px; cards float with a soft warm shadow and a hairline border | same radii; deeper shadow, no border |

- **From Paper:** the calm, warm page; Newsreader for coach explanations
  and prompts; sentence-length copy given room to breathe.
- **From Club:** Fraunces (600) for headlines, DM Sans for UI, DM Mono for
  notation; rounded floating cards for the context panel; brass as the
  single accent colour; the ivory-and-green board.
- **Light / dark:** follows `prefers-color-scheme` by default, with
  `data-theme="light|dark"` on `<html>` as the Settings override. In the
  real `tokens.css` the dark block is written once and applied by both
  selectors.
- **Open questions for Phase 1:**
  - Two serifs (Fraunces headlines, Newsreader prose) is a deliberate
    pairing; confirm it reads well at length, or move prose to Fraunces'
    text optical size.
  - Contrast checked for the starting values: body, secondary and muted text
    are at least 4.5:1 on every surface in both themes (muted was darkened
    to `#6e6452` to get there). Re-check after any palette change.
  - Check contrast for brass on cream (it is used only as a fill with dark
    ink, or as the darker `#8f620c` for text and icons).
  - Choose board themes beyond the default sage, and decide whether piece
    sets beyond cburnett are worth vendoring.

The fonts are vendored as woff2 under `/fonts/` (Google
Fonts are only used by the prototype, and the production CSP would block
them).
