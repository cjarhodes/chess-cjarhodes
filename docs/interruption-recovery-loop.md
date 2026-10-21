# Interruption recovery loop — October 20, 2026

Goal: leave and resume a browser session without losing a game or drill position,
forgetting help already used, duplicating results, or stranding an older daily plan.

## Pass 1: Save the board the player is actually using

Browser audit reproduced two losses: a new game vanished before its first move,
and refreshing a hinted drill returned an idle board or only the underlying game.

An explicit new game now has a resume point immediately, including a custom FEN,
local identity, and board orientation. Drill recovery uses a separate, owner-scoped
snapshot. It retains the run index, initial/follow-up position, expected move,
misses, hint/reveal state, completion state, and borrowed live game. Engine promises
and unfinished grading are rebuilt instead of serialized.

The vendored chess.js rejects header-only PGN and resets its board. Zero-move
custom sessions therefore restore from their validated starting FEN. Played PGN
must parse successfully and match the saved FEN; corrupt games are backed up and
rejected with an explanation.

## Pass 2: Recover unfinished work without double credit

A user move is checkpointed before classification. On reload, a validated,
unreviewed last move is replayed through normal analysis exactly once, retaining
the game identity. The opponent then responds normally. Settled moves retain their
review log and totals across repeated reloads.

Misses and hints survive interruption. Refreshing during practice grading returns
the last stable position without inventing a result. A follow-up resumes at its
opponent-reply position. A finished drill restores its saved result and next action
without rerunning completion accounting. Leaving practice restores the original
PGN, identity, statistics, and orientation, then clears the drill resume point.

## Pass 3: Repair older unreachable plans

A saved rehearsal target is compared with currently due positions when no drill
resume point is active. Unavailable slots are removed, completed work is retained,
and the live-play requirement remains. The plan explains the adjustment. Recovery
does not grant a session completion or rewrite an already completed day.

## Pass 4: Select the correct owner after account loading

Account restoration finishes asynchronously after initial rendering. The app now
checkpoints the outgoing local owner and selects the incoming owner's recovery
state when getSession finishes or the account changes. Guest resume points are
adopted only when the incoming account has no corresponding point; successful
copies consume their guest copy. Two signed-in accounts never adopt one another's
resume points. Same-owner token refresh leaves the board in place. Sign-out selects
the guest workspace. Outgoing remote insight references are cleared on the handoff.

No database schema, SDK version, or authentication mechanism changed. The handoff
uses the existing [getSession](https://supabase.com/docs/reference/javascript/auth-getsession)
and [onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
paths. Local owner-transition tests disable remote sync; they do not send magic
links, create accounts, or write to the production database.

## Verification

The required syntax checks, every scripts/validate-*.js validator, and the complete
scripts/verify-browser.sh suite cover the original app journeys, teaching journeys,
and the added scripts/verify-recovery-journeys.js matrix:

- Zero-move custom game, stable identity, orientation, and a new tab reopening it.
- Interrupted real-move classification, one review, and one opponent reply.
- Incorrect attempt surviving reload with no duplicate event.
- Hints, in-flight practice grading, follow-up position, revealed answer, finished
  result, and exact borrowed-game restoration.
- Account-scoped resume-point reads and delayed owner switching/sign-out.
- Older unavailable drills repaired without fabricated completion credit.
- Stable daily completion and its Progress action after reload.
- Corrupt snapshots rejected with backed-up game data and a clear status.

The old smoke test waited on a stale “Best move” badge and refreshed before the
new mating move was reviewed. It now waits for that move's review and ended-game
state; the recovery audit exposed this test race rather than weakening the check.

## Limits

Resume points are local to this browser and origin. They require available browser
storage; clearing site data removes them. This is not cross-device drill sync or
an atomic database transaction across every localStorage key. A worker search and
an unverified candidate are restarted after interruption. Transient analysis/demo
replays return to the real game rather than resuming the illustrative line.

Older versions never saved drill hints or follow-up state, so those details cannot
be reconstructed retroactively. Existing game/progress snapshots and daily plans
remain usable. Simulated owner-transition coverage verifies the local handoff;
production email delivery and live multi-account authentication are unchanged.
