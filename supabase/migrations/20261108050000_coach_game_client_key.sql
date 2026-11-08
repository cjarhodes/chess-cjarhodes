-- A game pasted into Coach (the PGN inbox) has a content id on the client,
-- pgn-<side><hash> of its start position and moves. Before this, every paste
-- of the same game inserted another coach_games row, so the account listed
-- the game once per paste. The client now writes that id as client_game_key
-- with insert ... on conflict do nothing, and reuses the existing row.
--
-- The index is a plain unique index, not a partial one: PostgREST's
-- on_conflict cannot name an index predicate, and Postgres only infers a
-- partial index from ON CONFLICT when the predicate is given. Nulls are
-- distinct in a unique index, so games without a key (live Coach games and
-- every earlier row) are unaffected. RLS is unchanged: rows are still
-- insertable, readable and updatable only by their owner.
alter table public.coach_games
  add column if not exists client_game_key text
  check (client_game_key is null or char_length(client_game_key) between 1 and 120);

create unique index if not exists coach_games_user_client_key_unique_idx
  on public.coach_games(user_id, client_game_key);
