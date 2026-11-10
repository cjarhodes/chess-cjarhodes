begin;

select plan(11);

select has_table('public', 'coach_archive_games', 'synced game archive exists');
select col_is_pk('public', 'coach_archive_games', array['user_id', 'game_key'], 'one row per archived game per account');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000041',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'archive-one@example.com', '', now(), now(), now()
), (
  '00000000-0000-0000-0000-000000000042',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'archive-two@example.com', '', now(), now(), now()
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}';

select lives_ok(
  $$insert into public.coach_archive_games (user_id, game_key, game, played_at)
    values ('00000000-0000-0000-0000-000000000041', 'g1', '{"id":"g1","pgn":"1. e4 e5"}', now())$$,
  'owner archives a game'
);
select lives_ok(
  $$insert into public.coach_archive_games (user_id, game_key, game, played_at)
    values ('00000000-0000-0000-0000-000000000041', 'g1', '{"id":"g1","pgn":"1. e4 e5 2. Nf3"}', now())
    on conflict (user_id, game_key) do update set game = excluded.game$$,
  'archiving the same game again updates its row'
);
select is(
  (select count(*)::integer from public.coach_archive_games), 1,
  'the same game is stored once'
);
select lives_ok(
  $$update public.coach_archive_games set game = null, deleted_at = now() where game_key = 'g1'$$,
  'owner removes a game, leaving a tombstone'
);
select throws_ok(
  $$update public.coach_archive_games set deleted_at = null where game_key = 'g1'$$,
  '23514', null, 'a row is either a game or a tombstone'
);
select throws_ok(
  $$insert into public.coach_archive_games (user_id, game_key, game, played_at)
    values ('00000000-0000-0000-0000-000000000041', 'g2', '[]', now())$$,
  '23514', null, 'an archived game must be an object'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000042","role":"authenticated"}';

select is(
  (select count(*)::integer from public.coach_archive_games), 0,
  'another account cannot read the first account archive'
);
select throws_ok(
  $$insert into public.coach_archive_games (user_id, game_key, game, played_at)
    values ('00000000-0000-0000-0000-000000000041', 'g3', '{}', now())$$,
  '42501', null, 'another account cannot insert into the first account archive'
);
select throws_ok(
  $$delete from public.coach_archive_games$$,
  '42501', null, 'archive rows cannot be deleted from the client'
);

select * from finish();

rollback;
