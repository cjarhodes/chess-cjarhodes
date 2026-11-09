-- A drill's practice progress outlives the move that created it. Taking back
-- that move, or the same mistake repeated in a later game, must not delete
-- attempts and schedule built up across games. The client deletes only drills
-- never practised (attempts = 0) with their move; the database keeps the rest
-- with no source move. RLS on drill_queue already accepts a null
-- source_move_id while still requiring user_id = auth.uid().
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.drill_queue'::regclass
      and c.contype = 'f'
      and a.attname = 'source_move_id'
  loop
    execute pg_catalog.format('alter table public.drill_queue drop constraint %I', v_constraint);
  end loop;
end;
$$;

alter table public.drill_queue
  add constraint drill_queue_source_move_id_fkey
  foreign key (source_move_id) references public.coach_moves(id) on delete set null;
