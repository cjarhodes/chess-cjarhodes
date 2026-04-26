-- Supabase schema for account-backed Coach history and insights.
-- Run this in the Supabase SQL editor for the project used by
-- window.COACH_SUPABASE_CONFIG in coach-config.js.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coach_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  result text,
  end_reason text,
  user_side text not null check (user_side in ('white', 'black')),
  opponent_level integer not null check (opponent_level between 400 and 3000),
  start_fen text not null,
  final_fen text,
  pgn text,
  opening_name text,
  moves_count integer not null default 0,
  accuracy integer check (accuracy is null or (accuracy between 0 and 100)),
  acpl integer,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coach_moves (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.coach_games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  played_at timestamptz not null default now(),
  ply integer not null,
  pair_num integer not null,
  phase text not null check (phase in ('opening', 'middlegame', 'endgame')),
  fen_before text not null,
  fen_after text not null,
  user_uci text not null,
  user_san text,
  best_uci text,
  best_san text,
  classification text not null check (classification in ('best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'unknown')),
  centipawn_loss integer not null default 0,
  rank integer,
  tags text[] not null default '{}'::text[],
  explanation text,
  pv_san text[] not null default '{}'::text[],
  top_alternatives jsonb not null default '[]'::jsonb,
  eval_before jsonb,
  eval_after jsonb,
  opening_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, ply)
);

create table if not exists public.drill_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_move_id uuid references public.coach_moves(id) on delete cascade,
  tag text not null,
  fen text not null,
  best_uci text,
  best_san text,
  prompt text,
  due_at timestamptz not null default now(),
  interval_days integer not null default 1,
  ease numeric not null default 2.5,
  reps integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.theory_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_move_id uuid references public.coach_moves(id) on delete set null,
  tag text not null,
  title text not null,
  body text not null,
  retained boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_games_user_started_idx
  on public.coach_games(user_id, started_at desc);

create index if not exists coach_moves_user_played_idx
  on public.coach_moves(user_id, played_at desc);

create index if not exists coach_moves_user_tags_idx
  on public.coach_moves using gin(tags);

create index if not exists drill_queue_user_due_idx
  on public.drill_queue(user_id, due_at asc);

create unique index if not exists drill_queue_source_tag_unique_idx
  on public.drill_queue(source_move_id, tag);

create unique index if not exists theory_cards_source_tag_unique_idx
  on public.theory_cards(source_move_id, tag);

alter table public.profiles enable row level security;
alter table public.coach_games enable row level security;
alter table public.coach_moves enable row level security;
alter table public.drill_queue enable row level security;
alter table public.theory_cards enable row level security;

drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "coach_games select own" on public.coach_games;
create policy "coach_games select own"
  on public.coach_games for select
  using (user_id = auth.uid());

drop policy if exists "coach_games insert own" on public.coach_games;
create policy "coach_games insert own"
  on public.coach_games for insert
  with check (user_id = auth.uid());

drop policy if exists "coach_games update own" on public.coach_games;
create policy "coach_games update own"
  on public.coach_games for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "coach_games delete own" on public.coach_games;
create policy "coach_games delete own"
  on public.coach_games for delete
  using (user_id = auth.uid());

drop policy if exists "coach_moves select own" on public.coach_moves;
create policy "coach_moves select own"
  on public.coach_moves for select
  using (user_id = auth.uid());

drop policy if exists "coach_moves insert own" on public.coach_moves;
create policy "coach_moves insert own"
  on public.coach_moves for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.coach_games g
      where g.id = game_id and g.user_id = auth.uid()
    )
  );

drop policy if exists "coach_moves update own" on public.coach_moves;
create policy "coach_moves update own"
  on public.coach_moves for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.coach_games g
      where g.id = game_id and g.user_id = auth.uid()
    )
  );

drop policy if exists "coach_moves delete own" on public.coach_moves;
create policy "coach_moves delete own"
  on public.coach_moves for delete
  using (user_id = auth.uid());

drop policy if exists "drill_queue all own" on public.drill_queue;
create policy "drill_queue all own"
  on public.drill_queue for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "theory_cards all own" on public.theory_cards;
create policy "theory_cards all own"
  on public.theory_cards for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace view public.coach_insight_summary
with (security_invoker = true)
as
select
  user_id,
  tag,
  count(*) as occurrence_count,
  sum(case classification
        when 'blunder' then 3
        when 'mistake' then 2
        when 'inaccuracy' then 1
        else 0
      end) as weighted_score,
  max(played_at) as last_seen_at,
  avg(centipawn_loss)::integer as avg_centipawn_loss
from public.coach_moves
cross join unnest(tags) as tag
where classification in ('inaccuracy', 'mistake', 'blunder')
group by user_id, tag;
