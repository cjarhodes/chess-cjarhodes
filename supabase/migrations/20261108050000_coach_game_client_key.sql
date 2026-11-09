-- Every Coach game has a local id on the client: a pasted game (the PGN
-- inbox) a content id, pgn-<side><hash> of its start position and moves; a
-- live game a random id. Before this, every paste of the same game inserted
-- another coach_games row, and a retried insert could add a second row for
-- one live game. The client now writes the local id as client_game_key with
-- insert ... on conflict do nothing, and reuses the existing row.
--
-- The index is a plain unique index, not a partial one: PostgREST's
-- on_conflict cannot name an index predicate, and Postgres only infers a
-- partial index from ON CONFLICT when the predicate is given. Nulls are
-- distinct in a unique index, so rows without a key (every row written
-- before this migration) are unaffected. RLS is unchanged: rows are still
-- insertable, readable and updatable only by their owner.
alter table public.coach_games
  add column if not exists client_game_key text
  check (client_game_key is null or char_length(client_game_key) between 1 and 120);

create unique index if not exists coach_games_user_client_key_unique_idx
  on public.coach_games(user_id, client_game_key);
