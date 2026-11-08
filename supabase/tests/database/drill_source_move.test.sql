begin;

select plan(6);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'drill-source-one@example.com',
  '',
  now(),
  now(),
  now()
), (
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'drill-source-two@example.com',
  '',
  now(),
  now(),
  now()
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';

insert into public.coach_games (id, user_id, user_side, opponent_level, start_fen)
values (
  '20000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000011',
  'white',
  1200,
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
);
insert into public.coach_moves (
  id, game_id, user_id, ply, pair_num, phase, fen_before, fen_after, user_uci, classification
)
values (
  '30000000-0000-0000-0000-000000000011',
  '20000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000011',
  3, 2, 'opening',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPPKPPP/RNBQ1BNR b kq - 1 2',
  'e1e2',
  'mistake'
);
insert into public.drill_queue (
  user_id, drill_key, source_move_id, tag, fen, best_uci, attempts, correct, reps
)
values (
  '00000000-0000-0000-0000-000000000011',
  'drill-source-test',
  '30000000-0000-0000-0000-000000000011',
  'king_safety',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  'g1f3',
  3, 2, 2
);

select lives_ok(
  $$ delete from public.coach_moves where id = '30000000-0000-0000-0000-000000000011' $$,
  'the owner can take back the move that created a practised drill'
);
select is(
  (select attempts from public.drill_queue where drill_key = 'drill-source-test'),
  3,
  'deleting the source move keeps the drill and its practice progress'
);
select ok(
  (select source_move_id is null from public.drill_queue where drill_key = 'drill-source-test'),
  'the kept drill no longer points at the deleted move'
);
select lives_ok(
  $$ update public.drill_queue set reps = 3 where drill_key = 'drill-source-test' $$,
  'the owner can still update a drill with no source move'
);
select is(
  (select reps from public.drill_queue where drill_key = 'drill-source-test'),
  3,
  'row-level security still lets the owner write a drill with no source move'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000012","role":"authenticated"}';

select is(
  (select count(*)::integer from public.drill_queue where drill_key = 'drill-source-test'),
  0,
  'another account cannot read a drill with no source move'
);

select * from finish();

rollback;
