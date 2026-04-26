# Supabase setup for Coach history

Coach works locally without Supabase. To enable account-backed games, mistakes,
practice queue items, and theory cards:

1. Create a Supabase project.
2. Open the Supabase SQL editor and run `supabase-schema.sql`.
3. In Authentication -> URL Configuration, set:
   - Site URL: `https://chess.cjarhodes.com`
   - Redirect URL: `https://chess.cjarhodes.com/?view=coach`
   - Optional local redirect: `http://127.0.0.1:4173/index.html?view=coach`
4. Copy the project URL and anon public key into `coach-config.js`.
5. Commit and push. Vercel will deploy `main` automatically.
6. Smoke test: open Coach, send a magic link, play a few moves, then verify
   rows appear in `coach_games`, `coach_moves`, `drill_queue`, and
   `theory_cards`.

Only the anon public key belongs in `coach-config.js`. Do not put service-role
keys or database passwords in this repo.
