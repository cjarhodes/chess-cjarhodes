-- OOTD (ootd.cjarhodes.com) shared this Supabase project briefly in November
-- 2026 and has moved to its own sign-in and storage. Chess never used the
-- objects 20261105222014_ootd_accounts.sql created; that migration stays for
-- history and this one removes what it left: two empty tables, the save
-- function and the private photo bucket with its two storage policies.
--
-- Nothing with data behind it is deleted here. If a table still has rows, or
-- the bucket still holds files or unfinished uploads, the migration stops.
-- Storage files must be removed through the Storage API (dashboard, or
-- supabase.storage.from('ootd-photos').remove): deleting their rows in SQL
-- would leave the files orphaned in the storage backend.
do $$
begin
  if to_regclass('public.ootd_wardrobes') is not null
     and exists (select 1 from public.ootd_wardrobes) then
    raise exception 'public.ootd_wardrobes still has rows; move them to OOTD''s own project before dropping it.';
  end if;
  if to_regclass('public.ootd_wardrobe_history') is not null
     and exists (select 1 from public.ootd_wardrobe_history) then
    raise exception 'public.ootd_wardrobe_history still has rows; move them to OOTD''s own project before dropping it.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'ootd-photos') then
    raise exception 'The ootd-photos bucket still holds files. Empty it through the Storage API, then run this migration again.';
  end if;
  if to_regclass('storage.s3_multipart_uploads') is not null then
    if exists (select 1 from storage.s3_multipart_uploads where bucket_id = 'ootd-photos') then
      raise exception 'The ootd-photos bucket has unfinished uploads. Abort them through the Storage API, then run this migration again.';
    end if;
  end if;
end;
$$;

-- Photo bucket: its policies on storage.objects first, then the bucket row.
drop policy if exists "ootd-photos: read own" on storage.objects;
drop policy if exists "ootd-photos: add own" on storage.objects;

do $$
begin
  -- Supabase Storage refuses direct deletes from its tables unless the
  -- transaction opts in; the bucket is empty, so no files are orphaned.
  perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
  -- Newer Storage versions keep folder prefixes per bucket (metadata only).
  if to_regclass('storage.prefixes') is not null then
    execute 'delete from storage.prefixes where bucket_id = $1' using 'ootd-photos';
  end if;
  delete from storage.buckets where id = 'ootd-photos';
end;
$$;

-- The save function, then the tables (their RLS policies go with them).
drop function if exists public.ootd_save_wardrobe(jsonb, bigint, boolean);
drop table if exists public.ootd_wardrobe_history;
drop table if exists public.ootd_wardrobes;
