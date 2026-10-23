# Everyday training polish

Three exercise/screenshot/fix/verify cycles against main `c220635`. Work reused the clean attached release checkout and preserved the original checkout's unrelated changes. Existing features, authored lessons, opponent calibration, owner-scoped persistence, and the static desktop-first architecture remain in place.

## 1. Return to the same task

A real coached game played `e4`, received the opponent's reply, then lent its board to Queen mate. Visiting Library and returning left the drill's request generation stale. Playing the legal solution produced “The position changed before analysis finished” and did not complete the position. Library also described starting an opening while its actual action was Resume current drill.

Returning now restores the visible position from the actual game, review cursor, or practice session. A paused drill receives a fresh runtime analysis object; cancelled searches keep their old object and cannot become current again. Position, hints, attempts, expected move, run progress, and the borrowed game remain unchanged. An interrupted candidate displays a retry instruction. An old keyboard handler cannot clear new input or replace the resumed session's feedback. Stable practice state is saved before leaving Coach.

Library describes the action it can perform: resume the paused lesson or opening session, return while a move finishes, or start the selected opening position. An unavailable idea selector is disabled while resuming another session. Transient Show why analysis returns to the actual board; an intentionally selected historical position keeps its cursor.

## 2. Keep the whole workspace visible

Before the fix, Library's controls extended below 1280×800; changing viewport size could also briefly leave board width and square height out of sync. The Library workspace now fits its board to both available width and the height left by its real controls. It observes open keyboard entry, quiz feedback and resize, matching the existing Coach approach. No mobile layout was introduced.

Study, active Quiz feedback and Explore were exercised at 1280×800, 1440×900 and 1920×1080. The board stays square, the essential controls stay visible, and the page has no horizontal scrolling. Empty feedback does not reserve a large blank strip in Study. Focus indicators use the existing visual palette.

## 3. Finish a game with a reachable next step

A real three-move review placed its takeaway and actions below the laptop viewport: the action row ended around y=1066 at a viewport height of 800. The review now keeps its title, takeaway and action row visible while supporting metrics and moments scroll in a named, keyboard-accessible region. Detailed review content remains available. The post-game practice label uses the same distinct, bounded selection as the launched session.

Keyboard checks also found app shortcuts reaching controls behind a modal and arrow keys reaching the board from form controls. Form fields, active dialogs, already-handled tab events and practice sessions now scope those shortcuts correctly. Escape and Tab retain dialog dismissal/focus behavior. Switching from Quiz to Study immediately refreshes the opening actions instead of leaving them hidden until another move.

## Verification

The new `scripts/verify-cohesion-journeys.js` uses new empty browser contexts. Its normal searches and move grades use the real engine. A held candidate response and a held real opponent search make navigation races deterministic; they do not represent human learning results or contact a real account.

The journey completes normal play, Show why, Library study, Progress resume, a hinted drill, Library-to-drill return, exact game restoration and reload, a post-game review, critical-moment navigation, the advertised post-game practice session, a cancelled-candidate retry, keyboard Quiz play, mode switching, idea selection, Explore, a retained review cursor while an opponent reply finishes, and an empty-game review. It checks visible actions and boards at all three desktop sizes, modal shortcut isolation, focus return, and zero runtime errors. Existing broad regressions retain their account, backup, owner isolation, opening and learning-transfer coverage.

Release gates are syntax checks, all 18 validators and the full browser runner, which now contains 11 journeys. [Machine-readable local evidence](training-cohesion-verification.json) records the measured bounds and tested asset hashes. Screenshots are local artifacts under `output/playwright/cohesion-*.png`. Final release verification checks the exact runtime files at the custom domain and repeats the complete cohesion journey there.

These checks establish behavior and layout in exercised workflows. They do not claim a human usability study, improved chess skill, a new live account sign-in, or changes to account storage contracts.
