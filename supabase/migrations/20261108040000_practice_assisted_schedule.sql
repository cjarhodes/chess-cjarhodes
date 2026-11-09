-- A solve helped by a hint or the shown answer completes the drill but is
-- not recall, so it earns no repetition and comes back the next day, as the
-- client schedules it (src/coach/practice.js recordPracticeAttempt). Before
-- this, three hinted solves counted as three repetitions and stretched the
-- interval to about a week.
--
-- The interval after a clean repetition now follows the client formula too:
-- the previous interval (or 3 days when there is none) times the ease, at
-- least 4 days. Due dates stay timestamps here; the client re-anchors them
-- to its own local midnight when it merges the row, since the server does
-- not know the user's time zone.
create or replace function public.record_practice_attempt(
  p_event_id uuid,
  p_drill_key text,
  p_source_move_id uuid,
  p_tag text,
  p_fen text,
  p_best_uci text,
  p_best_san text,
  p_prompt text,
  p_correct boolean,
  p_revealed boolean,
  p_attempted_at timestamptz
)
returns public.drill_queue
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_inserted integer := 0;
  v_drill public.drill_queue;
  v_drill_exists boolean := false;
  v_attempt record;
  v_attempts integer := 0;
  v_correct integer := 0;
  v_result text;
  v_reps integer := 0;
  v_ease numeric := 2.5;
  v_interval integer := 0;
  v_due_at timestamptz;
  v_last_result text;
  v_last_attempt_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_event_id is null or coalesce(p_drill_key, '') = '' or
     coalesce(p_tag, '') = '' or coalesce(p_fen, '') = '' or
     coalesce(p_best_uci, '') = '' or p_attempted_at is null then
    raise exception 'Practice attempt payload is incomplete';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_drill_key, 0)
  );

  if p_source_move_id is not null then
    update public.drill_queue d
    set drill_key = p_drill_key
    where d.user_id = v_user_id
      and d.source_move_id = p_source_move_id
      and d.tag = p_tag
      and d.drill_key like 'legacy-%'
      and not exists (
        select 1
        from public.drill_queue keyed
        where keyed.user_id = v_user_id and keyed.drill_key = p_drill_key
      );
  end if;

  v_result := case
    when not p_correct then 'incorrect'
    when p_revealed then 'assisted'
    else 'correct'
  end;

  insert into public.practice_attempts (
    id, user_id, drill_key, source_move_id, tag, attempted_at,
    correct, revealed, result
  )
  values (
    p_event_id, v_user_id, p_drill_key, p_source_move_id, p_tag,
    p_attempted_at, p_correct, p_revealed, v_result
  )
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
    into v_drill
    from public.drill_queue
    where user_id = v_user_id and drill_key = p_drill_key;
    if not found then
      raise exception 'Attempt exists without its drill progress row';
    end if;
    return v_drill;
  end if;

  select *
  into v_drill
  from public.drill_queue
  where user_id = v_user_id and drill_key = p_drill_key
  for update;
  v_drill_exists := found;

  -- Events may arrive late from another browser or after an offline session.
  -- Replaying the immutable history keeps the schedule independent of network
  -- arrival order while the event-id guard above keeps retries idempotent.
  for v_attempt in
    select correct, revealed, result, attempted_at
    from public.practice_attempts
    where user_id = v_user_id and drill_key = p_drill_key
    order by attempted_at asc, id asc
  loop
    v_attempts := v_attempts + 1;
    if v_attempt.correct and v_attempt.revealed then
      -- Completed with help: counted as completed, but no repetition.
      v_correct := v_correct + 1;
      v_ease := greatest(1.3, v_ease - 0.05);
      v_interval := 1;
    elsif v_attempt.correct then
      v_correct := v_correct + 1;
      v_reps := v_reps + 1;
      v_ease := greatest(1.3, v_ease + 0.08);
      v_interval := case
        when v_reps <= 1 then 1
        when v_reps = 2 then 3
        else greatest(4, round(coalesce(nullif(v_interval, 0), 3) * v_ease)::integer)
      end;
    else
      v_reps := 0;
      v_ease := greatest(1.3, v_ease - 0.2);
      v_interval := 0;
    end if;
    v_due_at := v_attempt.attempted_at + (v_interval * interval '1 day');
    v_last_result := v_attempt.result;
    v_last_attempt_at := v_attempt.attempted_at;
  end loop;

  if v_drill_exists then
    update public.drill_queue
    set
      source_move_id = coalesce(p_source_move_id, source_move_id),
      tag = p_tag,
      fen = p_fen,
      best_uci = p_best_uci,
      best_san = p_best_san,
      prompt = p_prompt,
      due_at = v_due_at,
      interval_days = v_interval,
      ease = v_ease,
      reps = v_reps,
      attempts = v_attempts,
      correct = v_correct,
      last_result = v_last_result,
      last_attempt_at = v_last_attempt_at,
      updated_at = now()
    where id = v_drill.id
    returning * into v_drill;
  else
    insert into public.drill_queue (
      user_id, drill_key, source_move_id, tag, fen, best_uci, best_san,
      prompt, due_at, interval_days, ease, reps, attempts, correct,
      last_result, last_attempt_at, updated_at
    )
    values (
      v_user_id, p_drill_key, p_source_move_id, p_tag, p_fen, p_best_uci,
      p_best_san, p_prompt, v_due_at,
      v_interval, v_ease, v_reps, v_attempts, v_correct,
      v_last_result, v_last_attempt_at, now()
    )
    returning * into v_drill;
  end if;

  return v_drill;
end;
$$;

revoke all on function public.record_practice_attempt(
  uuid, text, uuid, text, text, text, text, text, boolean, boolean, timestamptz
) from public, anon;
grant execute on function public.record_practice_attempt(
  uuid, text, uuid, text, text, text, text, text, boolean, boolean, timestamptz
) to authenticated;
