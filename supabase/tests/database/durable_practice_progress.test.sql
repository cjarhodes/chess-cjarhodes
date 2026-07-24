begin;

select plan(23);

select has_table('public', 'practice_attempts', 'practice attempt history exists');
select has_column('public', 'drill_queue', 'drill_key', 'drills have a stable cross-device key');
select has_column('public', 'drill_queue', 'attempts', 'drills persist attempt totals');
select has_column('public', 'drill_queue', 'correct', 'drills persist correct totals');
select has_function(
  'public',
  'record_practice_attempt',
  array['uuid', 'text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'boolean', 'boolean', 'timestamp with time zone'],
  'practice RPC exists'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'practice-one@example.com',
  '',
  now(),
  now(),
  now()
), (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'practice-two@example.com',
  '',
  now(),
  now(),
  now()
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$
    select public.record_practice_attempt(
      '10000000-0000-0000-0000-000000000001',
      'drill-test',
      null,
      'candidate_moves',
      '8/8/8/8/8/8/4K3/7k w - - 0 1',
      'e2e3',
      'Ke3',
      'Compare candidate moves.',
      true,
      false,
      '2026-07-23T12:00:00Z'
    )
  $$,
  'authenticated user records a correct attempt'
);

select is(
  (select attempts from public.drill_queue where drill_key = 'drill-test'),
  1,
  'first attempt increments total'
);
select is(
  (select correct from public.drill_queue where drill_key = 'drill-test'),
  1,
  'first correct attempt increments correct total'
);
select is(
  (select interval_days from public.drill_queue where drill_key = 'drill-test'),
  1,
  'first correct attempt schedules one day'
);

select lives_ok(
  $$
    select public.record_practice_attempt(
      '10000000-0000-0000-0000-000000000001',
      'drill-test',
      null,
      'candidate_moves',
      '8/8/8/8/8/8/4K3/7k w - - 0 1',
      'e2e3',
      'Ke3',
      'Compare candidate moves.',
      true,
      false,
      '2026-07-23T12:00:00Z'
    )
  $$,
  'replaying the same event is idempotent'
);
select is(
  (select attempts from public.drill_queue where drill_key = 'drill-test'),
  1,
  'duplicate event does not increment total'
);

select lives_ok(
  $$
    select public.record_practice_attempt(
      '10000000-0000-0000-0000-000000000002',
      'drill-test',
      null,
      'candidate_moves',
      '8/8/8/8/8/8/4K3/7k w - - 0 1',
      'e2e3',
      'Ke3',
      'Compare candidate moves.',
      false,
      false,
      '2026-07-24T12:00:00Z'
    )
  $$,
  'incorrect attempt is recorded'
);
select is(
  (select attempts from public.drill_queue where drill_key = 'drill-test'),
  2,
  'incorrect attempt increments total'
);
select is(
  (select reps from public.drill_queue where drill_key = 'drill-test'),
  0,
  'incorrect attempt resets repetitions'
);
select is(
  (select interval_days from public.drill_queue where drill_key = 'drill-test'),
  0,
  'incorrect attempt is immediately due'
);
select is(
  (select count(*)::integer from public.practice_attempts where drill_key = 'drill-test'),
  2,
  'append-only attempt history contains unique events'
);

select lives_ok(
  $$
    select public.record_practice_attempt(
      '10000000-0000-0000-0000-000000000003',
      'drill-test',
      null,
      'candidate_moves',
      '8/8/8/8/8/8/4K3/7k w - - 0 1',
      'e2e3',
      'Ke3',
      'Compare candidate moves.',
      true,
      true,
      '2026-07-22T12:00:00Z'
    )
  $$,
  'an older offline attempt can arrive after newer events'
);
select is(
  (select attempts from public.drill_queue where drill_key = 'drill-test'),
  3,
  'late event is included in the total'
);
select is(
  (select correct from public.drill_queue where drill_key = 'drill-test'),
  2,
  'late correct event is included in the correct total'
);
select is(
  (select last_result from public.drill_queue where drill_key = 'drill-test'),
  'incorrect',
  'late delivery does not replace the chronologically latest result'
);
select is(
  (select last_attempt_at from public.drill_queue where drill_key = 'drill-test'),
  '2026-07-24T12:00:00Z'::timestamptz,
  'late delivery preserves the chronologically latest schedule anchor'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::integer from public.drill_queue where drill_key = 'drill-test'),
  0,
  'another user cannot read drill progress'
);
select is(
  (select count(*)::integer from public.practice_attempts where drill_key = 'drill-test'),
  0,
  'another user cannot read attempt history'
);

select * from finish();

rollback;
