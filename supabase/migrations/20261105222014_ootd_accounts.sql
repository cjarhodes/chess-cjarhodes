-- OOTD (ootd.cjarhodes.com, github.com/cjarhodes/Clothing) shares this Supabase
-- project. Its source of truth is that repository; this copy keeps the
-- migration history here in step with the database. Chess never reads these.

-- OOTD accounts: one wardrobe per signed-in person, rolling history, and a
-- private photo bucket. Everything is prefixed ootd_ so it can share a
-- Supabase project with other apps. Nothing here deletes data: history is a
-- ring of 30 slots, and photos are never overwritten.

-- The current wardrobe. Written only through ootd_save_wardrobe().
create table public.ootd_wardrobes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  version bigint not null default 1,
  pieces integer not null default 0,
  snapshots bigint not null default 0,
  saved_at timestamptz not null default now()
);
alter table public.ootd_wardrobes enable row level security;
create policy "ootd_wardrobes: read own" on public.ootd_wardrobes
  for select to authenticated using ((select auth.uid()) = user_id);

-- The wardrobe as it was before each hour's first change: 30 slots per
-- person, reused in turn, so the newest 30 are always kept.
create table public.ootd_wardrobe_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  slot smallint not null check (slot between 0 and 29),
  state jsonb not null,
  pieces integer not null,
  saved_at timestamptz not null,
  primary key (user_id, slot)
);
alter table public.ootd_wardrobe_history enable row level security;
create policy "ootd_wardrobe_history: read own" on public.ootd_wardrobe_history
  for select to authenticated using ((select auth.uid()) = user_id);

-- Save the signed-in person's wardrobe.
--   p_expected_version: the version this device last saw (null for the first save).
--   p_force: overwrite even if another device saved since, or the save shrinks it.
-- Errors: OD409 another device saved first; OD410 would shrink to empty or under
-- half without p_force; OD413 too large; OD422 not a wardrobe. DETAIL carries
-- the stored piece count for OD409 and OD410.
create or replace function public.ootd_save_wardrobe(p_state jsonb, p_expected_version bigint, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cur public.ootd_wardrobes%rowtype;
  v_pieces integer;
  v_now timestamptz := clock_timestamp();
  v_snapshots bigint;
begin
  if v_uid is null then
    raise exception 'Sign in to save a wardrobe.' using errcode = '28000';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object' or jsonb_typeof(p_state -> 'items') is distinct from 'array' then
    raise exception 'That isn''t a wardrobe.' using errcode = 'OD422';
  end if;
  if pg_column_size(p_state) > 2000000 then
    raise exception 'That wardrobe is too large to save in one go.' using errcode = 'OD413';
  end if;
  v_pieces := jsonb_array_length(p_state -> 'items');
  if v_pieces > 1000 then
    raise exception 'A wardrobe can hold up to 1,000 pieces.' using errcode = 'OD413';
  end if;

  select * into v_cur from public.ootd_wardrobes w where w.user_id = v_uid for update;

  if not found then
    insert into public.ootd_wardrobes (user_id, state, version, pieces, saved_at)
    values (v_uid, p_state, 1, v_pieces, v_now);
    return jsonb_build_object('version', 1, 'saved_at', v_now, 'pieces', v_pieces);
  end if;

  if not p_force and p_expected_version is distinct from v_cur.version then
    raise exception 'Your wardrobe changed on another device.' using errcode = 'OD409', detail = v_cur.pieces::text;
  end if;
  if not p_force and v_cur.pieces > 0 and (v_pieces = 0 or v_pieces * 2 < v_cur.pieces) then
    raise exception 'That would remove most of your saved wardrobe.' using errcode = 'OD410', detail = v_cur.pieces::text;
  end if;

  v_snapshots := v_cur.snapshots;
  -- Keep the version being replaced when this is the first change this hour,
  -- and always when the save was forced.
  if p_force or date_trunc('hour', v_cur.saved_at) <> date_trunc('hour', v_now) then
    insert into public.ootd_wardrobe_history (user_id, slot, state, pieces, saved_at)
    values (v_uid, (v_snapshots % 30)::smallint, v_cur.state, v_cur.pieces, v_cur.saved_at)
    on conflict (user_id, slot) do update
      set state = excluded.state, pieces = excluded.pieces, saved_at = excluded.saved_at;
    v_snapshots := v_snapshots + 1;
  end if;

  update public.ootd_wardrobes w
  set state = p_state, version = v_cur.version + 1, pieces = v_pieces, snapshots = v_snapshots, saved_at = v_now
  where w.user_id = v_uid;
  return jsonb_build_object('version', v_cur.version + 1, 'saved_at', v_now, 'pieces', v_pieces);
end;
$$;
revoke all on function public.ootd_save_wardrobe(jsonb, bigint, boolean) from public, anon;
grant execute on function public.ootd_save_wardrobe(jsonb, bigint, boolean) to authenticated;

-- Photos: private, at <user id>/<sha256 of the bytes>. No update or delete
-- policies, so a stored photo can't be replaced or removed from the app.
-- Up to 600 photos of up to 3 MB each per person.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ootd-photos', 'ootd-photos', false, 3145728, array['image/png', 'image/jpeg', 'image/webp']);

create policy "ootd-photos: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'ootd-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "ootd-photos: add own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ootd-photos'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}$'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (
      select count(*) from storage.objects o
      where o.bucket_id = 'ootd-photos' and (storage.foldername(o.name))[1] = (select auth.uid())::text
    ) < 600
  );
