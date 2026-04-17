# chess-cjarhodes

Static single-page chess opening library served at https://chess.cjarhodes.com.

## Stack
- Single `index.html` (no build step, no package manager, no dependencies)
- Client-side only — uses chessboard.js + chess.js from CDN
- Lichess Opening Explorer API for Explore mode (user supplies their own Lichess Personal Access Token, stored in localStorage)

## Hosting
- **Vercel project:** `chess-cjarhodes` (id `prj_7fJJMCT2DC4fM8bQWBLSYddSFM0c`)
- **Vercel team:** `rhodescja-2073's projects` (id `team_N6suE1gwG2qZvUqM4VZ6BBpr`)
- **Custom domain:** chess.cjarhodes.com
- **Auto-deploy:** push to `main` → Vercel builds & deploys within ~30s

## Local preview
This is a pure static page — open `index.html` directly in a browser, or serve the folder with any static server. In Claude Code, use `preview_start` to spin up a dev server for verification.

## Workflow
1. Edit `index.html`
2. Verify locally via `preview_start` + `preview_snapshot`/`preview_screenshot`
3. Commit to `main`
4. Push — Vercel auto-deploys to chess.cjarhodes.com
5. Confirm deployment success via the Vercel MCP (`list_deployments`)
