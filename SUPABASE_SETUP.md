# Supabase setup for durable Coach progress

Coach works locally without Supabase. To enable account-backed games, mistakes,
practice attempts, adaptive sessions, player preferences, personal repertoire,
Library spaced-repetition schedules, trends, and theory cards:

1. Create a dedicated Supabase project for Chess. Do not reuse another app's
   project.
2. Link this checkout and apply all versioned migrations:
   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```
   For a local Docker-backed check first, run:
   ```sh
   supabase start
   supabase db reset
   supabase test db
   ```
   `supabase-schema.sql` is the readable canonical reference; versioned
   migrations remain the deployment workflow.
3. In Authentication -> URL Configuration, set:
   - Site URL: `https://chess.cjarhodes.com`
   - Redirect URL: `https://chess.cjarhodes.com/?view=coach`
   - Optional local redirect: `http://127.0.0.1:4173/index.html?view=coach`
4. Optional, for code-based sign-in. Supabase's built-in email service only
   sends its default templates, so the Magic Link template is read-only until
   one of these is in place: custom SMTP (Authentication -> Emails -> SMTP
   Settings, any provider such as Resend or Postmark), a Pro plan, or a Send
   Email auth hook. Once editing is unlocked, open Authentication -> Emails ->
   Magic link or OTP, paste `supabase/templates/magic_link.html` as the body,
   set the subject to "Your Chess Coach sign-in link and code", and save. The
   template includes `{{ .Token }}`, the 6-digit code that lets sign-in finish
   in the browser tab that requested it. Then set `emailCodeEnabled: true` in
   `coach-config.js`; until that flag is on, the app hides the code field and
   sign-in works by link only.
5. Copy the project URL and publishable key into `coach-config.js`. Existing
   projects may use the legacy anon public key instead.
6. Commit and push. Vercel will deploy `main` automatically.
7. Smoke test:
   - Open Coach, send a sign-in link, and sign in once by clicking the link
     and once by typing the emailed code into the original tab.
   - Finish a game with a review mistake.
   - Complete at least two practice drills, including one incorrect attempt.
   - Reload the page and verify the attempts, schedule, and 7-day trend remain.
   - Sign in on a second browser and verify the same progress appears.
   - Confirm rows exist in `coach_games`, `coach_moves`, `drill_queue`,
     `practice_attempts`, `daily_training_sessions`,
     `player_training_profiles`, and `theory_cards`.

Practice storage is scoped by account in the browser. Anonymous practice is
moved into the account on sign-in, and it is only removed from the anonymous
scope after that account-scoped write succeeds. Offline events retain stable
IDs; retries are idempotent, and the database replays each drill's history by
attempt time so a late event from another device cannot rewind its schedule.
The player training profile uses field-aware reconciliation: the newest profile
and repertoire choices win, while Library opening records merge individually so
progress made on either device is retained.

Only a publishable or legacy anon public key belongs in `coach-config.js`. Do
not put secret keys, service-role keys, database passwords, or access tokens in
this repo.

Before deploying account sync, review the project's Authentication settings.
Disable open signups unless public account creation is intentional, and keep the
RLS policies in `supabase-schema.sql` in place for every client-writable table.
The migrations explicitly grant the authenticated Data API role only the
required table and RPC access, keep anonymous visitors out of account data, and
keep the `SECURITY DEFINER` signup trigger in a private schema with an empty
search path. Practice updates go through `record_practice_attempt`, which writes
the immutable attempt event and advances its drill schedule in one transaction.
