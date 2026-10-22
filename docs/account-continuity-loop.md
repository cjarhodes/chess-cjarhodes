# Account continuity improvement loop

Goal: keep the player's training context recoverable across sign-in, sign-out,
interruption, offline work, another browser, and backup import without changing
the static desktop-first architecture.

## Cycle 1 — Restore the account path and report auth truthfully

The configured production Supabase project was `INACTIVE`. Restoring the existing
project returned it to `ACTIVE_HEALTHY`; no project or billing plan was created.
The production email form sent a real sign-in link, and the user confirmed that
opening it signed them in. No real link, code, credential, or session token was
copied into source, screenshots, logs, or this report.

Auth callbacks now leave the SDK's auth lock before starting database work.
Token refresh for the same owner leaves the current board and history in place.
Account connection has a timeout and reload action. Sending a link prevents
duplicate submissions while the request is pending. **Sign out here** requests
local scope, so other browser sessions remain signed in. Error handling checks
the SDK's actual resulting session: this vendored SDK can remove local
credentials even when server logout confirmation fails. The UI distinguishes
that outcome from a retained session and from an unconfirmed timeout.

## Cycle 2 — Recover a session without overwriting its source

Before the change, another browser could load training history but could not
recover its saved board. Each browser now writes an owner-scoped, bounded
`coach_checkpoints` row. Server revisions guard updates. An older tab pauses
rather than replacing a newer checkpoint, and the pause survives reload.
Explicit continuation from that state forks the tab's checkpoint stream.

**Continue saved session** restores a separate copy of the game or interrupted
practice, including move review, side, level, board orientation, opening return
context, and hint/follow-up state. Remote game IDs are removed and local game
IDs are remapped, including nested return games. The original browser keeps its
board. **Return to previous session** recovers the board displaced here. Copies
are visibly unrated and do not count inherited reviews as another lifetime
game; new moves still receive normal coaching and learning follow-up.

The baseline game export contained owner-scoped reviews but no board. Import
looked for unscoped review/lifetime keys and therefore missed that history.
Backups now include game, practice and return snapshots as well as training
memory. Import validates all supported sections before writing, merges progress,
and offers the incoming board separately. Cross-owner practice imports rebind
ownership and remote references with stable import deduplication. A small
owner-scoped journal retains original values through quota or interrupted-write
failures; sync waits for rollback recovery. Existing version-1 backups remain
supported. Files are limited to 5 MB and session checkpoints to 240 KiB; an
oversized or unreadable session is rejected without replacing the current board.

## Cycle 3 — Preserve offline and simultaneous work

Reviewed moves have a durable owner-scoped retry queue. A reconnect or **Sync
now** uploads pending reviews even after the user starts another game. Local
reviews remain visible alongside loaded account history, with synced copies
deduplicated. Offline takebacks cancel unsent reviews or retain a deletion for
already-uploaded reviews. Serialized move writes prevent a late upload from undoing
a takeback. Game snapshots also serialize per owner/game so a slow earlier
request cannot rewind a newer snapshot. Unrelated account data and auth storage are never reset.

Profile sync compares `updated_at` before writing. A concurrent browser forces
a reread and merge, preserving both browsers' Library, repertoire and learning
observations. Owner/game guards also prevent late responses from changing a
newly selected account's state or status.

## Verification and evidence boundaries

- All syntax checks and every `scripts/validate-*.js` validator are required.
  The continuity validator has 31 behavioral checks, including persistent
  storage failure/recovery and repeated cross-owner import.
- `scripts/verify-browser.sh` runs the existing eight regression journeys plus
  the new account journey. Account coverage uses empty browser contexts, the
  real vendored Supabase SDK, Stockfish and UI, with controlled auth/REST
  responses. It does **not** claim two real email-authenticated production
  browsers. It checks 50 conditions across eleven workflow scenarios.
- Nine account screenshots measure board fit and no horizontal scrolling at
  1280×800, 1440×900 and 1920×1080. They contain synthetic fixture accounts only.
- The additive migration was applied to the existing production project through
  its authenticated management connector. `scripts/verify-account-checkpoints.sql`
  passed against that real database: owner access, other-owner/anonymous denial,
  reassignment rejection, payload bounds, and stale revision rejection. All
  fixture users and rows rolled back. Local Docker/Postgres was unavailable;
  no local database reset was claimed.
- The applied migration is named `account_session_checkpoints` (management
  history version `20261022013302`); its source is
  `20261022013302_account_session_checkpoints.sql`. The canonical schema includes
  the same additive SQL. Existing migration history was preserved.
- The Supabase security advisor reported no new table/policy findings. Its
  existing [leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
  remains outside this passwordless sign-in change.
- The original checkout's unfinished difficulty work is preserved. Release work
  uses the existing isolated checkout and the current `origin/main` base.

Measured browser results are stored in
[account-continuity-verification.json](account-continuity-verification.json).
Deployment and live verification are recorded after the release checks pass.
