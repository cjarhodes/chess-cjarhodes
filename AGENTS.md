# chess-cjarhodes

Static single-page chess training app served at https://chess.cjarhodes.com.

## Stack
- Static `index.html` + `app.js` (no build step or package manager)
- Client-side only — chessboard.js, chess.js, jQuery, Supabase JS, and Stockfish are vendored locally
- Lichess Opening Explorer API for Explore mode (user supplies their own Lichess Personal Access Token, stored in localStorage)
- Optional Supabase account sync; Coach remains fully usable in local-only mode

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
3. Run `scripts/verify-browser.sh` for the repeatable Library, Coach, practice-loop, 390px mobile, and stale-engine smoke coverage.
4. For schema changes, add a Supabase migration and run a local reset or linked `supabase db push`.
5. Commit and push to `main`; Vercel auto-deploys to chess.cjarhodes.com.
6. Confirm the deployment and smoke-test the custom domain.
