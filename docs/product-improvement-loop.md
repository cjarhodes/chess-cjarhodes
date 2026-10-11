# Daily coaching improvement loop — October 10, 2026

Goal: make a short daily session easier to start, carry from rehearsal into play,
and finish with an honest summary and an obvious next step.

## Cycle 1: Reachable, personalized session plans

Observed in the browser: saving a profile left the old plan visible. Reloading a
new drills-first profile added a drill target despite an empty practice queue.
Longer and tactics-focused plans could also request more drills than available;
play-first profiles could still be routed into practice.

Changed: refresh the unstarted plan on profile save, cap drills to available due
positions, route zero-drill plans to play, and show the actual reviewed-move target.
An already-started daily session retains its target.

Verified: 96 preference/availability combinations, UI profile-save routing, and a
fresh five-minute drills-first profile starting a four-move baseline without drills.

## Cycle 2: Practice leads directly to live play

Observed: the final drill announced session completion while daily transfer moves
were still outstanding, then required another start action after leaving practice.

Changed: distinguish practice completion from daily completion. The final action
says “Continue to live play” and starts a game or restores the preserved live game.

Verified: real engine-graded drills advance to live play; the existing game's PGN,
local identity, and statistics remain exactly the same through the final-drill action.

## Cycle 3: An honest stopping point

Observed: every adaptive completion claimed rehearsal, including baseline-only
sessions; its primary action encouraged another game instead of reviewing progress.

Changed: show actual drill and reviewed-move counts, explicitly offer a stopping
point, distinguish activity from improvement, and link directly to Progress.

Verified: baseline and drill-plus-transfer summaries, progress navigation, and
completion persistence after reload. No claim of measured chess improvement.

## Release validation

JavaScript syntax checks, every repository validator, and the full browser smoke
suite pass on the combined release based on remote main bbf779e. The release
preserves the newer account-memory and learning-accuracy changes on main.
Pre-existing uncommitted opponent-selector work was excluded from this release.

## Next priorities

- Observe real 15-minute sessions to check whether these changes reduce abandonment.
- Make the displayed time estimate and saved session-style label reflect the actual
  persisted plan, including after reload.
- Audit recovery for already-persisted impossible drill targets from older versions.
- Evaluate learning transfer with sufficient reviewed-game samples; completions and
  first-try drill scores alone cannot establish that improvement.
