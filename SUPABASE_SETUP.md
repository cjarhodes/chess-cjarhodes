# Supabase setup for Coach history

Coach works locally without Supabase. To enable account-backed games, mistakes,
practice queue items, and theory cards:

1. Create a Supabase project.
2. Link this checkout and apply the versioned migration:
   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```
   For a local Docker-backed check first, run `supabase start` and
   `supabase db reset`. `supabase-schema.sql` is a readable schema reference,
   not the deployment workflow.
3. In Authentication -> URL Configuration, set:
   - Site URL: `https://chess.cjarhodes.com`
   - Redirect URL: `https://chess.cjarhodes.com/?view=coach`
   - Optional local redirect: `http://127.0.0.1:4173/index.html?view=coach`
4. Copy the project URL and publishable key into `coach-config.js`. Existing
   projects may use the legacy anon public key instead.
5. Commit and push. Vercel will deploy `main` automatically.
6. Smoke test: open Coach, send a magic link, play a few moves, then verify
   rows appear in `coach_games`, `coach_moves`, `drill_queue`, and
   `theory_cards`.

Only a publishable or legacy anon public key belongs in `coach-config.js`. Do
not put secret keys, service-role keys, database passwords, or access tokens in
this repo.

Before deploying account sync, review the project's Authentication settings.
Disable open signups unless public account creation is intentional, and keep the
RLS policies in `supabase-schema.sql` in place for every client-writable table.
The migration also limits Data API grants to authenticated users and keeps the
`SECURITY DEFINER` signup trigger in a private schema with an empty search path.
