begin;

select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000041',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'pasted-game-one@example.com',
  '',
  now(),
  now(),
  now()
), (
  '00000000-0000-0000-0000-000000000042',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'pasted-game-two@example.com',
  '',
  now(),
  now(),
  now()
);

select has_column('public', 'coach_games', 'client_game_key', 'coach_games has a client_game_key column');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}';

-- The client's write: insert ... on conflict (user_id, client_game_key) do nothing
-- (supabase-js upsert with ignoreDuplicates), pasted twice.
insert into public.coach_games (user_id, user_side, opponent_level, start_fen, client_game_key)
values ('00000000-0000-0000-0000-000000000041', 'white', 1200,
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'pgn-wabc123')
on conflict (user_id, client_game_key) do nothing;

select is(
  (select count(*)::integer from public.coach_games where client_game_key = 'pgn-wabc123'),
  1,
  'the first paste adds one game row'
);

select lives_ok(
  $$ insert into public.coach_games (user_id, user_side, opponent_level, start_fen, client_game_key)
     values ('00000000-0000-0000-0000-000000000041', 'white', 1200,
       'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'pgn-wabc123')
     on conflict (user_id, client_game_key) do nothing $$,
  'pasting the same game again is accepted'
);

select is(
  (select count(*)::integer from public.coach_games where client_game_key = 'pgn-wabc123'),
  1,
  'a second paste of the same game does not create a second row'
);

select throws_ok(
  $$ insert into public.coach_games (user_id, user_side, opponent_level, start_fen, client_game_key)
     values ('00000000-0000-0000-0000-000000000041', 'white', 1200,
       'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'pgn-wabc123') $$,
  '23505',
  null,
  'a plain insert with a key the account already holds is rejected'
);

-- Games without a key (live Coach games) are never collapsed.
insert into public.coach_games (user_id, user_side, opponent_level, start_fen)
values ('00000000-0000-0000-0000-000000000041', 'white', 1200, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
       ('00000000-0000-0000-0000-000000000041', 'white', 1200, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

select is(
  (select count(*)::integer from public.coach_games where client_game_key is null),
  2,
  'games without a client key are each kept'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000042","role":"authenticated"}';

select is(
  (select count(*)::integer from public.coach_games where client_game_key = 'pgn-wabc123'),
  0,
  'another account cannot read the first account pasted game'
);

insert into public.coach_games (user_id, user_side, opponent_level, start_fen, client_game_key)
values ('00000000-0000-0000-0000-000000000042', 'white', 1200,
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'pgn-wabc123')
on conflict (user_id, client_game_key) do nothing;

select is(
  (select count(*)::integer from public.coach_games where client_game_key = 'pgn-wabc123'),
  1,
  'another account pasting the same game gets its own row'
);

select throws_ok(
  $$ insert into public.coach_games (user_id, user_side, opponent_level, start_fen, client_game_key)
     values ('00000000-0000-0000-0000-000000000041', 'white', 1200,
       'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'pgn-wother')
     on conflict (user_id, client_game_key) do nothing $$,
  '42501',
  null,
  'another account cannot insert a keyed game for the first account'
);

reset role;

select is(
  (select count(*)::integer from public.coach_games where client_game_key = 'pgn-wabc123'),
  2,
  'the same pasted game is stored once per account'
);

select * from finish();

rollback;
