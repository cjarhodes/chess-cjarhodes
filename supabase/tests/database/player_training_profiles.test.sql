begin;

select plan(12);

select has_table('public', 'player_training_profiles', 'synced player training profile exists');
select has_column('public', 'player_training_profiles', 'state', 'training state is persisted');
select has_pk('public', 'player_training_profiles', 'one training profile exists per account');
select col_is_pk('public', 'player_training_profiles', array['user_id'], 'account id is the primary key');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000021',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'growth-one@example.com', '', now(), now(), now()
), (
  '00000000-0000-0000-0000-000000000022',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'growth-two@example.com', '', now(), now(), now()
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000021","role":"authenticated"}';

select lives_ok(
  $$insert into public.player_training_profiles (user_id, state, client_updated_at)
    values (
      '00000000-0000-0000-0000-000000000021',
      '{"profile":{"rating":1200,"minutes":10},"repertoire":["italian"],"librarySr":{}}', now()
    )$$,
  'authenticated user inserts their own training profile'
);
select is(
  (select count(*)::integer from public.player_training_profiles), 1,
  'owner can read their training profile'
);
select lives_ok(
  $$update public.player_training_profiles
    set state = '{"profile":{"rating":1250,"minutes":20},"repertoire":["italian"],"librarySr":{}}',
        client_updated_at = now()$$,
  'owner can update their training profile'
);
select is(
  (select state #>> '{profile,minutes}' from public.player_training_profiles),
  '20', 'owner sees updated training preferences'
);
select throws_ok(
  $$update public.player_training_profiles set state = '[]'::jsonb$$,
  '23514', null, 'training state must be an object'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000022","role":"authenticated"}';

select is(
  (select count(*)::integer from public.player_training_profiles), 0,
  'another account cannot read the first account profile'
);
select is(
  (select count(*)::integer from public.player_training_profiles
   where user_id = '00000000-0000-0000-0000-000000000021'), 0,
  'explicit filters cannot bypass profile isolation'
);
select throws_ok(
  $$insert into public.player_training_profiles (user_id, state, client_updated_at)
    values ('00000000-0000-0000-0000-000000000021', '{}', now())$$,
  '42501', null, 'another account cannot insert for the first account'
);

select * from finish();

rollback;
