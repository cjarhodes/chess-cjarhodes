create table public.player_training_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_training_profiles_state_object
    check (jsonb_typeof(state) = 'object'),
  constraint player_training_profiles_state_bounded
    check (octet_length(state::text) <= 131072)
);

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

create trigger player_training_profiles_touch_updated_at
before update on public.player_training_profiles
for each row execute function public.touch_player_training_profile_updated_at();

alter table public.player_training_profiles enable row level security;

create policy "player training profiles select own"
  on public.player_training_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "player training profiles insert own"
  on public.player_training_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "player training profiles update own"
  on public.player_training_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.player_training_profiles from anon;
grant select, insert, update on table public.player_training_profiles to authenticated;

revoke all on function public.touch_player_training_profile_updated_at() from public, anon;
