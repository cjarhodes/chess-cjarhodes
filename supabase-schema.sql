-- Supabase schema for account-backed Coach history and insights.
-- Canonical schema reference for the project used by COACH_SUPABASE_CONFIG.
-- New environments should apply the versioned files in supabase/migrations.

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
  drill_key text not null,
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
  attempts integer not null default 0
    check (attempts >= 0),
  correct integer not null default 0
    check (correct >= 0 and correct <= attempts),
  last_result text
    check (last_result is null or last_result in ('incorrect', 'correct', 'assisted')),
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.practice_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  drill_key text not null,
  source_move_id uuid references public.coach_moves(id) on delete set null,
  tag text not null,
  attempted_at timestamptz not null,
  correct boolean not null,
  revealed boolean not null default false,
  result text not null check (result in ('incorrect', 'correct', 'assisted')),
  created_at timestamptz not null default now()
);

create table if not exists public.daily_training_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_key date not null,
  state jsonb not null,
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day_key),
  constraint daily_training_sessions_state_object check (jsonb_typeof(state) = 'object'),
  constraint daily_training_sessions_state_bounded check (octet_length(state::text) <= 32768)
);

create table if not exists public.player_training_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_training_profiles_state_object check (jsonb_typeof(state) = 'object'),
  constraint player_training_profiles_state_bounded check (octet_length(state::text) <= 131072)
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

create unique index if not exists drill_queue_user_key_unique_idx
  on public.drill_queue(user_id, drill_key);

create unique index if not exists drill_queue_source_tag_unique_idx
  on public.drill_queue(source_move_id, tag);

create index if not exists practice_attempts_user_attempted_idx
  on public.practice_attempts(user_id, attempted_at desc);

create index if not exists practice_attempts_user_drill_idx
  on public.practice_attempts(user_id, drill_key, attempted_at desc);

create index if not exists practice_attempts_source_move_idx
  on public.practice_attempts(source_move_id)
  where source_move_id is not null;

create unique index if not exists theory_cards_source_tag_unique_idx
  on public.theory_cards(source_move_id, tag);

create index if not exists theory_cards_user_idx
  on public.theory_cards(user_id);

alter table public.profiles enable row level security;
alter table public.coach_games enable row level security;
alter table public.coach_moves enable row level security;
alter table public.drill_queue enable row level security;
alter table public.practice_attempts enable row level security;
alter table public.daily_training_sessions enable row level security;
alter table public.player_training_profiles enable row level security;
alter table public.theory_cards enable row level security;

drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "coach_games select own" on public.coach_games;
create policy "coach_games select own"
  on public.coach_games for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "coach_games insert own" on public.coach_games;
create policy "coach_games insert own"
  on public.coach_games for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "coach_games update own" on public.coach_games;
create policy "coach_games update own"
  on public.coach_games for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "coach_games delete own" on public.coach_games;
create policy "coach_games delete own"
  on public.coach_games for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "coach_moves select own" on public.coach_moves;
create policy "coach_moves select own"
  on public.coach_moves for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "coach_moves insert own" on public.coach_moves;
create policy "coach_moves insert own"
  on public.coach_moves for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.coach_games g
      where g.id = game_id and g.user_id = (select auth.uid())
    )
  );

drop policy if exists "coach_moves update own" on public.coach_moves;
create policy "coach_moves update own"
  on public.coach_moves for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.coach_games g
      where g.id = game_id and g.user_id = (select auth.uid())
    )
  );

drop policy if exists "coach_moves delete own" on public.coach_moves;
create policy "coach_moves delete own"
  on public.coach_moves for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "drill_queue all own" on public.drill_queue;
create policy "drill_queue all own"
  on public.drill_queue for all to authenticated
  using (
    user_id = (select auth.uid())
    and (
      source_move_id is null
      or exists (
        select 1 from public.coach_moves m
        where m.id = source_move_id and m.user_id = (select auth.uid())
      )
    )
  )
  with check (
    user_id = (select auth.uid())
    and (
      source_move_id is null
      or exists (
        select 1 from public.coach_moves m
        where m.id = source_move_id and m.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "practice_attempts select own" on public.practice_attempts;
create policy "practice_attempts select own"
  on public.practice_attempts for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "practice_attempts insert own" on public.practice_attempts;
create policy "practice_attempts insert own"
  on public.practice_attempts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      source_move_id is null
      or exists (
        select 1 from public.coach_moves m
        where m.id = source_move_id and m.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "daily training sessions select own" on public.daily_training_sessions;
create policy "daily training sessions select own"
  on public.daily_training_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "daily training sessions insert own" on public.daily_training_sessions;
create policy "daily training sessions insert own"
  on public.daily_training_sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "daily training sessions update own" on public.daily_training_sessions;
create policy "daily training sessions update own"
  on public.daily_training_sessions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "player training profiles select own" on public.player_training_profiles;
create policy "player training profiles select own"
  on public.player_training_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "player training profiles insert own" on public.player_training_profiles;
create policy "player training profiles insert own"
  on public.player_training_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "player training profiles update own" on public.player_training_profiles;
create policy "player training profiles update own"
  on public.player_training_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "theory_cards all own" on public.theory_cards;
create policy "theory_cards all own"
  on public.theory_cards for all to authenticated
  using (
    user_id = (select auth.uid())
    and (
      source_move_id is null
      or exists (
        select 1 from public.coach_moves m
        where m.id = source_move_id and m.user_id = (select auth.uid())
      )
    )
  )
  with check (
    user_id = (select auth.uid())
    and (
      source_move_id is null
      or exists (
        select 1 from public.coach_moves m
        where m.id = source_move_id and m.user_id = (select auth.uid())
      )
    )
  );

create or replace function public.record_practice_attempt(
  p_event_id uuid,
  p_drill_key text,
  p_source_move_id uuid,
  p_tag text,
  p_fen text,
  p_best_uci text,
  p_best_san text,
  p_prompt text,
  p_correct boolean,
  p_revealed boolean,
  p_attempted_at timestamptz
)
returns public.drill_queue
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_inserted integer := 0;
  v_drill public.drill_queue;
  v_drill_exists boolean := false;
  v_attempt record;
  v_attempts integer := 0;
  v_correct integer := 0;
  v_result text;
  v_reps integer := 0;
  v_ease numeric := 2.5;
  v_interval integer := 0;
  v_due_at timestamptz;
  v_last_result text;
  v_last_attempt_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_event_id is null or coalesce(p_drill_key, '') = '' or
     coalesce(p_tag, '') = '' or coalesce(p_fen, '') = '' or
     coalesce(p_best_uci, '') = '' or p_attempted_at is null then
    raise exception 'Practice attempt payload is incomplete';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_drill_key, 0)
  );

  if p_source_move_id is not null then
    update public.drill_queue d
    set drill_key = p_drill_key
    where d.user_id = v_user_id
      and d.source_move_id = p_source_move_id
      and d.tag = p_tag
      and d.drill_key like 'legacy-%'
      and not exists (
        select 1
        from public.drill_queue keyed
        where keyed.user_id = v_user_id and keyed.drill_key = p_drill_key
      );
  end if;

  v_result := case
    when not p_correct then 'incorrect'
    when p_revealed then 'assisted'
    else 'correct'
  end;

  insert into public.practice_attempts (
    id, user_id, drill_key, source_move_id, tag, attempted_at,
    correct, revealed, result
  )
  values (
    p_event_id, v_user_id, p_drill_key, p_source_move_id, p_tag,
    p_attempted_at, p_correct, p_revealed, v_result
  )
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
    into v_drill
    from public.drill_queue
    where user_id = v_user_id and drill_key = p_drill_key;
    if not found then
      raise exception 'Attempt exists without its drill progress row';
    end if;
    return v_drill;
  end if;

  select *
  into v_drill
  from public.drill_queue
  where user_id = v_user_id and drill_key = p_drill_key
  for update;
  v_drill_exists := found;

  -- Events may arrive late from another browser or after an offline session.
  -- Replaying the immutable history keeps the schedule independent of network
  -- arrival order while the event-id guard above keeps retries idempotent.
  for v_attempt in
    select correct, revealed, result, attempted_at
    from public.practice_attempts
    where user_id = v_user_id and drill_key = p_drill_key
    order by attempted_at asc, id asc
  loop
    v_attempts := v_attempts + 1;
    if v_attempt.correct then
      v_correct := v_correct + 1;
      v_reps := v_reps + 1;
      v_ease := greatest(
        1.3,
        v_ease + case when v_attempt.revealed then -0.05 else 0.08 end
      );
      v_interval := case
        when v_reps <= 1 then 1
        when v_reps = 2 then 3
        else greatest(4, round(greatest(v_interval, 3) * v_ease)::integer)
      end;
    else
      v_reps := 0;
      v_ease := greatest(1.3, v_ease - 0.2);
      v_interval := 0;
    end if;
    v_due_at := v_attempt.attempted_at + (v_interval * interval '1 day');
    v_last_result := v_attempt.result;
    v_last_attempt_at := v_attempt.attempted_at;
  end loop;

  if v_drill_exists then
    update public.drill_queue
    set
      source_move_id = coalesce(p_source_move_id, source_move_id),
      tag = p_tag,
      fen = p_fen,
      best_uci = p_best_uci,
      best_san = p_best_san,
      prompt = p_prompt,
      due_at = v_due_at,
      interval_days = v_interval,
      ease = v_ease,
      reps = v_reps,
      attempts = v_attempts,
      correct = v_correct,
      last_result = v_last_result,
      last_attempt_at = v_last_attempt_at,
      updated_at = now()
    where id = v_drill.id
    returning * into v_drill;
  else
    insert into public.drill_queue (
      user_id, drill_key, source_move_id, tag, fen, best_uci, best_san,
      prompt, due_at, interval_days, ease, reps, attempts, correct,
      last_result, last_attempt_at, updated_at
    )
    values (
      v_user_id, p_drill_key, p_source_move_id, p_tag, p_fen, p_best_uci,
      p_best_san, p_prompt, v_due_at,
      v_interval, v_ease, v_reps, v_attempts, v_correct,
      v_last_result, v_last_attempt_at, now()
    )
    returning * into v_drill;
  end if;

  return v_drill;
end;
$$;

create or replace function public.touch_daily_training_session_updated_at()
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

drop trigger if exists daily_training_sessions_touch_updated_at on public.daily_training_sessions;
create trigger daily_training_sessions_touch_updated_at
before update on public.daily_training_sessions
for each row execute function public.touch_daily_training_session_updated_at();

create or replace function public.touch_player_training_profile_updated_at()
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

drop trigger if exists player_training_profiles_touch_updated_at on public.player_training_profiles;
create trigger player_training_profiles_touch_updated_at
before update on public.player_training_profiles
for each row execute function public.touch_player_training_profile_updated_at();

create schema if not exists private;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

revoke all on function private.handle_new_user() from public, anon, authenticated;
drop function if exists public.handle_new_user();

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

-- The browser uses only the authenticated Data API role. Keep anonymous
-- visitors out of every account table even if a policy is changed later.
revoke all on table public.profiles, public.coach_games, public.coach_moves,
  public.drill_queue, public.practice_attempts, public.daily_training_sessions,
  public.player_training_profiles, public.theory_cards from anon;
grant usage on schema public to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.coach_games,
  public.coach_moves, public.drill_queue, public.theory_cards to authenticated;
grant select, insert on table public.practice_attempts to authenticated;
grant select, insert, update on table public.daily_training_sessions to authenticated;
grant select, insert, update on table public.player_training_profiles to authenticated;
grant select on table public.coach_insight_summary to authenticated;
revoke all on table public.coach_insight_summary from anon;
revoke all on function public.record_practice_attempt(
  uuid, text, uuid, text, text, text, text, text, boolean, boolean, timestamptz
) from public, anon;
grant execute on function public.record_practice_attempt(
  uuid, text, uuid, text, text, text, text, text, boolean, boolean, timestamptz
) to authenticated;
revoke all on function public.touch_daily_training_session_updated_at() from public, anon;
revoke all on function public.touch_player_training_profile_updated_at() from public, anon;
