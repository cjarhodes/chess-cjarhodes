begin;

select plan(12);

select has_table('public', 'daily_training_sessions', 'daily training session history exists');
select has_column('public', 'daily_training_sessions', 'state', 'session state is persisted');
select has_pk('public', 'daily_training_sessions', 'session rows have a primary key');
select col_is_pk(
  'public', 'daily_training_sessions', array['user_id', 'day_key'],
  'one session exists per account and local day'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'daily-one@example.com', '', now(), now(), now()
), (
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'daily-two@example.com', '', now(), now(), now()
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';

select lives_ok(
  $$insert into public.daily_training_sessions (user_id, day_key, state, client_updated_at)
    values (
      '00000000-0000-0000-0000-000000000011', '2026-08-16',
      '{"phase":"drills","completedUnits":1,"drillIds":["drill-a"]}', now()
    )$$,
  'authenticated user inserts their own session'
);
select is(
  (select count(*)::integer from public.daily_training_sessions), 1,
  'owner can read their session'
);
select lives_ok(
  $$update public.daily_training_sessions
    set state = '{"phase":"moves","completedUnits":2,"drillIds":["drill-a","drill-b"]}',
        client_updated_at = now()
    where day_key = '2026-08-16'$$,
  'owner can update their session'
);
select is(
  (select state ->> 'phase' from public.daily_training_sessions where day_key = '2026-08-16'),
  'moves', 'owner sees updated progress'
);
select throws_ok(
  $$insert into public.daily_training_sessions (user_id, day_key, state, client_updated_at)
    values ('00000000-0000-0000-0000-000000000011', '2026-08-15', '[]', now())$$,
  '23514', null, 'session state must be an object'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000012","role":"authenticated"}';

select is(
  (select count(*)::integer from public.daily_training_sessions), 0,
  'another account cannot read the first account session'
);
select is(
  (select count(*)::integer from public.daily_training_sessions where day_key = '2026-08-16'), 0,
  'explicit filters cannot bypass account isolation'
);
select throws_ok(
  $$insert into public.daily_training_sessions (user_id, day_key, state, client_updated_at)
    values (
      '00000000-0000-0000-0000-000000000011', '2026-08-14',
      '{"phase":"moves"}', now()
    )$$,
  '42501', null, 'another account cannot insert for the first account'
);

select * from finish();

rollback;
