begin;

select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'practice-assisted@example.com',
  '',
  now(),
  now(),
  now()
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000031","role":"authenticated"}';


-- 1: a hinted solve completes the drill but earns no repetition.
select public.record_practice_attempt(
  '20000000-0000-0000-0000-000000000001', 'drill-assisted', null, 'candidate_moves',
  '8/8/8/8/8/8/4K3/7k w - - 0 1', 'e2e3', 'Ke3', 'Compare candidate moves.', true, true, '2026-11-01T12:00:00Z');
select is((select reps from public.drill_queue where drill_key = 'drill-assisted'), 0, 'a hinted solve earns no repetition');
select is((select interval_days from public.drill_queue where drill_key = 'drill-assisted'), 1, 'a hinted solve comes back the next day');
select is((select correct from public.drill_queue where drill_key = 'drill-assisted'), 1, 'a hinted solve still counts as completed');

-- 2 and 3: clean solves build repetitions as before (1 day, then 3 days).
select public.record_practice_attempt(
  '20000000-0000-0000-0000-000000000002', 'drill-assisted', null, 'candidate_moves',
  '8/8/8/8/8/8/4K3/7k w - - 0 1', 'e2e3', 'Ke3', 'Compare candidate moves.', true, false, '2026-11-02T12:00:00Z');
select public.record_practice_attempt(
  '20000000-0000-0000-0000-000000000003', 'drill-assisted', null, 'candidate_moves',
  '8/8/8/8/8/8/4K3/7k w - - 0 1', 'e2e3', 'Ke3', 'Compare candidate moves.', true, false, '2026-11-03T12:00:00Z');
select is((select reps from public.drill_queue where drill_key = 'drill-assisted'), 2, 'clean solves add repetitions');
select is((select interval_days from public.drill_queue where drill_key = 'drill-assisted'), 3, 'the second clean solve waits three days');

-- 4: a later hinted solve keeps the repetitions but brings the drill back tomorrow.
select public.record_practice_attempt(
  '20000000-0000-0000-0000-000000000004', 'drill-assisted', null, 'candidate_moves',
  '8/8/8/8/8/8/4K3/7k w - - 0 1', 'e2e3', 'Ke3', 'Compare candidate moves.', true, true, '2026-11-06T12:00:00Z');
select is((select reps from public.drill_queue where drill_key = 'drill-assisted'), 2, 'a hinted solve keeps earlier repetitions');
select is((select interval_days from public.drill_queue where drill_key = 'drill-assisted'), 1, 'a hinted solve resets the wait to one day');

-- 5: the next clean solve grows from that one-day interval, as the client does
-- (max(4, round(1 × ease))), not from a three-day floor.
select public.record_practice_attempt(
  '20000000-0000-0000-0000-000000000005', 'drill-assisted', null, 'candidate_moves',
  '8/8/8/8/8/8/4K3/7k w - - 0 1', 'e2e3', 'Ke3', 'Compare candidate moves.', true, false, '2026-11-07T12:00:00Z');
select is((select reps from public.drill_queue where drill_key = 'drill-assisted'), 3, 'the clean solve after a hint adds a repetition');
select is((select interval_days from public.drill_queue where drill_key = 'drill-assisted'), 4, 'the next interval follows the client formula');

select * from finish();

rollback;
