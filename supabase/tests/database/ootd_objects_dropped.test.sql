begin;

select plan(6);

-- OOTD's leftovers from 20261105222014_ootd_accounts.sql are gone
-- (20261108060000_drop_ootd_objects.sql).
select hasnt_table('public', 'ootd_wardrobes', 'the OOTD wardrobe table is dropped');
select hasnt_table('public', 'ootd_wardrobe_history', 'the OOTD wardrobe history table is dropped');
select hasnt_function('public', 'ootd_save_wardrobe', array['jsonb', 'bigint', 'boolean'], 'the OOTD save function is dropped');
select is(
  (select count(*)::integer from storage.buckets where id = 'ootd-photos'),
  0,
  'the OOTD photo bucket is removed'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'ootd-photos:%'),
  0,
  'the OOTD photo bucket policies are removed'
);
select is(
  (select count(*)::integer from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'ootd\_%'),
  0,
  'no OOTD functions remain in public'
);

select * from finish();

rollback;
