-- The game archive (game-archive.js: the latest Coach games and imported
-- games, with their reviews) lived only in the browser. Safari can clear a
-- site's storage after a week without a visit, so a signed-in player could
-- lose the list even though their games and insights were synced. Each
-- archived game is now one row, keyed by the archive's own game id.
--
-- A game removed from the archive keeps its row as a tombstone (game null,
-- deleted_at set), so another browser that still holds a copy drops it
-- instead of uploading it again. Rows are readable, insertable and
-- updatable only by their owner; nothing deletes them from the client.
create table public.coach_archive_games (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key text not null,
  game jsonb,
  played_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_key),
  constraint coach_archive_games_key_length
    check (char_length(game_key) between 1 and 120),
  constraint coach_archive_games_game_object
    check (game is null or jsonb_typeof(game) = 'object'),
  constraint coach_archive_games_game_bounded
    check (game is null or octet_length(game::text) <= 131072),
  constraint coach_archive_games_tombstone
    check ((game is null) = (deleted_at is not null))
);

create index coach_archive_games_user_played_idx
  on public.coach_archive_games(user_id, played_at desc);

create or replace function public.touch_coach_archive_game_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger coach_archive_games_touch_updated_at
before update on public.coach_archive_games
for each row execute function public.touch_coach_archive_game_updated_at();

alter table public.coach_archive_games enable row level security;

create policy "coach archive games select own"
  on public.coach_archive_games for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "coach archive games insert own"
  on public.coach_archive_games for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "coach archive games update own"
  on public.coach_archive_games for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.coach_archive_games from anon;
grant select, insert, update on table public.coach_archive_games to authenticated;

revoke all on function public.touch_coach_archive_game_updated_at() from public, anon;
