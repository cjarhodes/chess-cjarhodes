create index practice_attempts_source_move_idx
  on public.practice_attempts(source_move_id)
  where source_move_id is not null;

create index theory_cards_user_idx
  on public.theory_cards(user_id);
