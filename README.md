# chess-cjarhodes

A static, single-page chess training app served at
[chess.cjarhodes.com](https://chess.cjarhodes.com). No build step, no
backend required — `index.html` and `app.js` run entirely in the browser,
with vendored copies of every third-party library.

## Modes

**Library** — Guided study of 28 openings across 35 total lines (main
lines plus attached variations, e.g. the Italian Game links to the Evans
Gambit, Fried Liver Attack, and Blackburne Shilling as sub-lines). Each
line has move-by-move explanations and key ideas. A quiz mode tests
recall of the moves, tracked with a lightweight SM-2 spaced-repetition
scheduler (`localStorage` key `chess_sr_v1`) that surfaces lines as
new/learning/due/mastered.

**Explore** — Browse the Lichess Opening Explorer's master/lichess
game databases from any position. Requires the user's own Lichess
Personal Access Token, which is kept in `sessionStorage` only (never
`localStorage`, and any legacy `localStorage` copy is actively cleared
on load) so it does not persist across browser sessions.

**Coach** — Play a full game against the vendored Stockfish engine
(WASM), with every move classified against engine evaluation into
tiers (best, excellent, good, inaccuracy, mistake, blunder). After the
game, a post-game review summarizes accuracy, phases, and key moments.
Missed moves feed a practice/drill loop — spaced review of your own
mistakes, independent of the Library's opening quizzes. Coach works
fully local-only; optionally signing in with Supabase makes games,
mistakes, practice attempts, and trends durable across devices and
browsers. Leaving `coach-config.js` blank keeps Coach local-only.

## Stack

- `index.html` + `app.js` (runtime) + `openings.js` (opening content data)
  + `growth.js` (personal training layer: profile, repertoire, imported games,
  endgames, cross-device sync) — no build tooling, no package manager,
  no framework
- Vendored libraries (see `vendor/` and `stockfish/`):
  - `chess.js` 0.10.3
  - `chessboard.js` 1.0.0
  - `jQuery` 3.6.0
  - `@supabase/supabase-js` 2.114.0
  - Stockfish (WASM build: `stockfish.js` + `stockfish.wasm`)
- Lichess Opening Explorer API for Explore mode
- Optional Supabase project for account-backed Coach sync
- Browser-only by design: there is no web app manifest and nothing registers
  a service worker. `service-worker.js` remains only as a kill switch that
  unregisters and clears caches for browsers that installed an earlier
  version; `scripts/validate-growth.js` enforces this.

## Local preview

Serve the folder over plain HTTP so workers and browser security rules
behave the same as in production:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`.

## Validation

Run before committing any change to `app.js` or `index.html`:

```sh
node --check app.js
for f in scripts/validate-*.js; do node "$f" || exit 1; done
```

The validators cover accessibility, maintainability, the openings data
(`scripts/validate-openings.js`), performance, the practice/drill loop,
reliability, and security.

For broader smoke coverage (Library, Coach, the practice loop, a 390px
mobile viewport, and stale-engine handling), run:

```sh
scripts/verify-browser.sh
```

This drives a real browser via `playwright-cli` (resolved from `$PWCLI`,
a local Codex Playwright skill, an installed `playwright-cli`, or
`npx @playwright/cli` as a last resort) against a local `http.server`
instance.

### Supabase schema changes

Coach's optional account sync is backed by Supabase. Schema changes go
into a new file under `supabase/migrations/`, applied with a local
Docker-backed reset/test or a linked `supabase db push`. See
[SUPABASE_SETUP.md](SUPABASE_SETUP.md) for the full setup, local
reset/test flow, and security notes (RLS, disabling open signups, key
handling). `supabase-schema.sql` is a readable canonical reference kept
in sync with the versioned migrations, but the migrations remain the
actual deployment mechanism.

## Deploy

Hosted as the Vercel project `chess-cjarhodes` with custom domain
`chess.cjarhodes.com`. Pushing to `main` triggers an automatic build and
deploy (usually live within ~30 seconds). Security headers (CSP,
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`) and the `www` -> apex redirect live in
`vercel.json`.

## Workflow

1. Edit `index.html`, `app.js`, or the relevant vendored/config file.
2. Run `node --check app.js` and every `scripts/validate-*.js`
   validator.
3. Run `scripts/verify-browser.sh` for the repeatable smoke coverage.
4. For schema changes, add a Supabase migration and run a local reset
   or linked `supabase db push`.
5. Commit and push to `main`; Vercel auto-deploys to
   chess.cjarhodes.com.
6. Confirm the deployment and smoke-test the custom domain.
