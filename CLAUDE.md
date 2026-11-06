# chess-cjarhodes

Static single-page chess training app served at https://chess.cjarhodes.com.

## Stack
- Static `index.html` + `styles.css` + `app.js` (no build step or package manager); opening content data (move lists, explanations, key ideas, variations) lives in `openings.js`, loaded before `app.js`; `growth.js` adds the training layer; the Puzzles view is `puzzles-core.js` (pure logic) + `puzzles.js` (view) + lazily loaded `puzzle-data.js` (Lichess CC0 puzzles, regenerate with `scripts/build-puzzle-data.py`, never hand-edit)
- Desktop-first UI: three-column rails, board sized from viewport height (`--board-size`), top nav Library / Coach / Puzzles, Coach right rail tabbed (Game / Practice / Progress), Coach left rail groups collapsible. Below 1024px a desktop notice overlays the page; there is no mobile layout by design
- Client-side only — chessboard.js, chess.js, jQuery, Supabase JS, and Stockfish are vendored locally
- Design system: colours, type, space and board themes are tokens in `styles/tokens.css` (spec: `docs/design-spec.md`, gallery: `docs/design-system/`). `styles.css` uses tokens only, which `scripts/validate-design-tokens.js` enforces; `scripts/check-contrast.js` checks WCAG contrast for both themes. Light/dark follows the device unless Settings overrides it (`ui:theme`, applied before paint by `theme-init.js`). Fonts are self-hosted woff2 in `fonts/` (OFL) because the CSP blocks font CDNs
- Feature modules added on top of `app.js` (each loads after it, keeps its own state, and talks to app globals only through small hooks): `board-overlay.js` (SVG arrows/badges/eval bar over any chessboard.js board, reusable for the planned cm-chessboard switch), `coach-overlay.js`, `move-flair.js` (Great/Brilliant), `explore-analysis.js` (engine lines in Explore; never `engineClient.cancel()` from here, send UCI `stop`), `game-archive.js`, `opponents.js` (bot personas; book moves only, the calibrated selector is untouched), `activity.js`, `shortcuts.js`, `endgames.js`. Pure logic in these files has a Node validator (`validate-puzzles`, `-move-flair`, `-opponents`, `-activity`, `-endgames`); UI is covered by `verify-puzzle-journeys.js` and `verify-behaviour-units.js`
- Lichess Opening Explorer API for Explore mode (user supplies their own Lichess Personal Access Token, kept in sessionStorage only)
- Optional Supabase account sync; Coach remains fully usable in local-only mode
- Browser-only by design: no web app manifest, no service worker registration, no install prompt. Installed copies captured magic-link URLs and opened them outside the browser. `service-worker.js` stays as a kill switch for earlier installs.
- The Supabase project is shared with OOTD (ootd.cjarhodes.com, repo `cjarhodes/Clothing`): one user list, one email template and one set of redirect URLs. OOTD's tables, function and bucket are prefixed `ootd_`/`ootd-`; its migration is mirrored in `supabase/migrations` so `db push` stays in step. Keep the email template neutral (it serves both apps) and keep both domains in Auth → Redirect URLs.
- Sign-in is a Supabase magic link, plus an emailed 6-digit code (`verifyOtp`) when `emailCodeEnabled` is true in `coach-config.js`. The flag stays off until the project's Magic Link email template carries `{{ .Token }}`, which needs custom SMTP, a Pro plan, or a Send Email hook. The template lives in `supabase/templates/magic_link.html`.

## Hosting
- **Vercel project:** `chess-cjarhodes`
- **Custom domain:** chess.cjarhodes.com
- **Auto-deploy:** push to `main` -> Vercel builds & deploys within ~30s

## Local preview
Serve the folder over HTTP so workers and browser security rules behave like production:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`.

## Workflow
1. Edit `index.html`, `app.js`, or the relevant vendored/config file.
2. Run `node --check app.js` and every `scripts/validate-*.js` validator.
3. Run `scripts/verify-browser.sh` for the repeatable Library, Coach, practice-loop, journey and behaviour-unit coverage. Test behaviour, not source text: new checks go in `scripts/verify-behaviour-units.js` (browser, stub only the boundary) or a Node validator that runs the logic, never a regex over `app.js`. Checks on shipped files (migrations, CI, CSP) belong in `validate-schema.js` / `validate-security.js`.
4. For schema changes, add a Supabase migration and run a local reset or linked `supabase db push`.
5. If you touch `COACH_DIFFICULTY_KEYFRAMES` or `chooseCalibratedOpponentMove`, run `node scripts/calibrate-difficulty.js` (several minutes; uses the vendored engine). Check the difficulty trend, severe-blunder and mate-in-one rates as well as ACPL. The seeded suite measures regression proxies, not human Elo; do not tune toward an unsourced human ACPL curve.
6. Commit and push to `main`; Vercel auto-deploys to chess.cjarhodes.com.
7. Confirm the deployment and smoke-test the custom domain.
