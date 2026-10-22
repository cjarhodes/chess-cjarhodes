-- Transactional fixture: no auth user, checkpoint, or training data survives.
begin;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'continuity-a@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'continuity-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
insert into public.coach_checkpoints (user_id, device_id, snapshot) values
  ('11111111-1111-4111-8111-111111111111', 'fixture-browser-a', '{"v":1,"owner":"user:11111111-1111-4111-8111-111111111111"}');
do $$ begin
  if (select count(*) from public.coach_checkpoints) <> 1 then raise exception 'Owner cannot read checkpoint'; end if;
  begin
    insert into public.coach_checkpoints(user_id,device_id,snapshot) values
      ('22222222-2222-4222-8222-222222222222','wrong-owner','{"v":1,"owner":"user:22222222-2222-4222-8222-222222222222"}');
    raise exception 'Cross-owner insert was allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.coach_checkpoints set user_id = '22222222-2222-4222-8222-222222222222',
      snapshot = '{"v":1,"owner":"user:22222222-2222-4222-8222-222222222222"}' where device_id='fixture-browser-a';
    raise exception 'Cross-owner reassignment was allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.coach_checkpoints set snapshot='{}' where device_id='fixture-browser-a';
    raise exception 'Missing snapshot owner was allowed';
  exception when check_violation then null; end;
  begin
    update public.coach_checkpoints set snapshot=jsonb_build_object('v',1,'owner','user:11111111-1111-4111-8111-111111111111','oversized',repeat('x',262145)) where device_id='fixture-browser-a';
    raise exception 'Oversized checkpoint was allowed';
  exception when check_violation then null; end;
end $$;
update public.coach_checkpoints set snapshot=snapshot || '{"savedAt":1}' where device_id='fixture-browser-a' and revision=1;
do $$ begin
  if (select revision from public.coach_checkpoints where device_id='fixture-browser-a') <> 2 then raise exception 'Server revision did not advance'; end if;
end $$;
update public.coach_checkpoints set snapshot=snapshot || '{"savedAt":2}' where device_id='fixture-browser-a' and revision=1;
do $$ begin
  if (select snapshot->>'savedAt' from public.coach_checkpoints where device_id='fixture-browser-a') <> '1' then raise exception 'Stale write overwrote checkpoint'; end if;
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$ begin
  if exists(select 1 from public.coach_checkpoints) then raise exception 'Another account read private checkpoint'; end if;
end $$;
update public.coach_checkpoints set snapshot='{"v":1,"owner":"user:22222222-2222-4222-8222-222222222222"}' where device_id='fixture-browser-a';
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.coach_checkpoints;
    raise exception 'Anonymous checkpoint access was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'Account checkpoint owner isolation, bounds and revision checks passed; all fixtures rolled back.' as verification;
