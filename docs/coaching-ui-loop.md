# Coaching UI improvement loop

Completed three improvement cycles against main `cfd6305`, keeping the desktop-first static app and its umber/claret visual identity. The original checkout's unfinished work was preserved; release work used the attached clean checkout.

## 1. Hierarchy and layout

The baseline 1280×800 workspace had 806px of board-column content inside 744px of available height; its lower controls required scrolling. A filled Start training button competed with a filled New game button. Repeated baseline instructions and setup fields dominated the left rail.

The workspace now sizes the board from the actual available space, including open keyboard entry, status text, captures, and controls. Rails scale within desktop bounds. Status sits beside the board, while practice instructions and analysis controls sit in the right rail. New game is secondary; account setup and session statistics are disclosures. Start training remains the main entry point. Board animation is allowed to finish before screenshot checks.

## 2. Training states and next actions

The UI labels ready, your turn, move analysis, opponent turn, position review, practice, practice grading, practice completion, and game/session completion. It derives these labels from existing game state without changing engine selection or saved-game formats.

Each actionable state has one main button or the board as its primary target. Busy states explain the wait and disable move entry. Review emphasizes Show why, then consequence and practice. Completed practice emphasizes its next step; a completed daily session leads to Progress. Starting and resuming training return to the Game panel, fixing the case where a remembered Progress tab hid the next review. Practice still restores the same live game and reviewed-move count.

## 3. Reading and keyboard polish

The session card uses a concise focus cue with its explanation available on demand. Baseline-only repetition is removed. Setup collapses during play; session statistics remain available in a native disclosure. Review reading text and actions use consistent spacing and hierarchy. Keyboard focus remains visible on inputs, buttons, and summaries. Primary button contrast is 6.43:1 normally and 5.49:1 on hover; muted text on the darkest card surface measures 4.53:1. These are targeted palette checks, not a claim of a comprehensive accessibility audit.

## Acceptance evidence

`verify-ui-journeys.js` exercises real classification and opponent searches. Test-only gates hold asynchronous work long enough to inspect analysis, opponent-turn, and practice-grading states; they do not substitute engine results. A real short session completes through reviewed moves. Screenshots cover 11 workflow checkpoints at each required size, including both closed and open keyboard entry across the journey.

| Viewport | Board size across checkpoints | Lowest board controls | Lowest keyboard entry | Horizontal overflow |
|---|---:|---:|---:|---:|
| 1280×800 | 376–592px | 775.5px | 779.1px | 0px |
| 1440×900 | 480–688px | 879.5px | 875.1px | 0px |
| 1920×1080 | 664–752px | 1059.3px | 1011.1px | 0px |
All 33 checks passed with zero page errors, a visible keyboard focus indicator, and at most one primary action in each interactive context. Idle/play/practice states without a primary button use the board as the next action. Measurements include native board borders. Hidden practice-only controls are excluded from clipping checks.

The journey verifies one-action start and resume from Progress, review without changing the live PGN, practice reload, correct completion, return to the original game identity and statistics, live-game reload, daily completion, and navigation to Progress. All existing Library, teaching, opponent, recovery, and daily-plan regressions remain in the suite. [Machine-readable results](coaching-ui-verification.json) retain the measurements.

## Reproduce and limits

Run syntax checks, every `scripts/validate-*.js` validator, then `scripts/verify-browser.sh`. The browser suite now includes `scripts/verify-ui-journeys.js`; screenshots are saved under `output/playwright/`. They are local verification artifacts, not shipped product assets.

The tested sizes use standard browser zoom. Opening keyboard entry deliberately gives some board space to the input and tools. Long rail content scrolls independently; the board and its essential controls remain visible. Smaller screens retain the existing desktop notice. Human usability testing is still needed to establish whether these changes reduce hesitation or improve learning; completed automated workflows establish functional behavior only.
