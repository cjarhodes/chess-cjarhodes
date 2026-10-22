-- Each browser keeps its own checkpoint. Continuing elsewhere creates a copy;
-- it never changes the source browser's game or checkpoint.
create table public.coach_checkpoints (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 1 and 128),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 262144),
  constraint checkpoint_owner_matches check ((snapshot->>'owner' = 'user:' || user_id::text and snapshot->>'v' = '1') is true),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index coach_checkpoints_recent on public.coach_checkpoints (user_id, updated_at desc);

create function public.touch_coach_checkpoint()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;
create trigger coach_checkpoints_touch before update on public.coach_checkpoints
for each row execute function public.touch_coach_checkpoint();

alter table public.coach_checkpoints enable row level security;
create policy "checkpoints select own" on public.coach_checkpoints
for select to authenticated using ((select auth.uid()) = user_id);
create policy "checkpoints insert own" on public.coach_checkpoints
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "checkpoints update own" on public.coach_checkpoints
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
revoke all on public.coach_checkpoints from anon;
grant select, insert, update on public.coach_checkpoints to authenticated;
revoke all on function public.touch_coach_checkpoint() from public, anon;
