create table public.daily_training_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_key date not null,
  state jsonb not null,
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day_key),
  constraint daily_training_sessions_state_object
    check (jsonb_typeof(state) = 'object'),
  constraint daily_training_sessions_state_bounded
    check (octet_length(state::text) <= 32768)
);

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

create trigger daily_training_sessions_touch_updated_at
before update on public.daily_training_sessions
for each row execute function public.touch_daily_training_session_updated_at();

alter table public.daily_training_sessions enable row level security;

create policy "daily training sessions select own"
  on public.daily_training_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "daily training sessions insert own"
  on public.daily_training_sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "daily training sessions update own"
  on public.daily_training_sessions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.daily_training_sessions from anon;
grant select, insert, update on table public.daily_training_sessions to authenticated;

revoke all on function public.touch_daily_training_session_updated_at() from public, anon;
