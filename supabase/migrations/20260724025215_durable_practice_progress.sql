alter table public.drill_queue
  add column drill_key text,
  add column attempts integer not null default 0,
  add column correct integer not null default 0,
  add column last_result text,
  add column last_attempt_at timestamptz;

update public.drill_queue
set drill_key = 'legacy-' || id::text
where drill_key is null;

alter table public.drill_queue
  alter column drill_key set not null,
  add constraint drill_queue_attempts_nonnegative check (attempts >= 0),
  add constraint drill_queue_correct_valid check (correct >= 0 and correct <= attempts),
  add constraint drill_queue_last_result_valid check (
    last_result is null or last_result in ('incorrect', 'correct', 'assisted')
  );

create unique index drill_queue_user_key_unique_idx
  on public.drill_queue(user_id, drill_key);

create table public.practice_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  drill_key text not null,
  source_move_id uuid references public.coach_moves(id) on delete set null,
  tag text not null,
  attempted_at timestamptz not null,
  correct boolean not null,
  revealed boolean not null default false,
  result text not null check (result in ('incorrect', 'correct', 'assisted')),
  created_at timestamptz not null default now()
);

create index practice_attempts_user_attempted_idx
  on public.practice_attempts(user_id, attempted_at desc);
create index practice_attempts_user_drill_idx
  on public.practice_attempts(user_id, drill_key, attempted_at desc);

alter table public.practice_attempts enable row level security;

create policy "practice_attempts select own"
  on public.practice_attempts for select to authenticated
  using (user_id = (select auth.uid()));

create policy "practice_attempts insert own"
  on public.practice_attempts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      source_move_id is null
      or exists (
        select 1 from public.coach_moves m
        where m.id = source_move_id and m.user_id = (select auth.uid())
      )
    )
  );

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
    if v_attempt.correct then
      v_correct := v_correct + 1;
      v_reps := v_reps + 1;
      v_ease := greatest(
        1.3,
        v_ease + case when v_attempt.revealed then -0.05 else 0.08 end
      );
      v_interval := case
        when v_reps <= 1 then 1
        when v_reps = 2 then 3
        else greatest(4, round(greatest(v_interval, 3) * v_ease)::integer)
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

revoke all on table public.practice_attempts from anon;
grant select, insert on table public.practice_attempts to authenticated;

revoke all on function public.record_practice_attempt(
  uuid, text, uuid, text, text, text, text, text, boolean, boolean, timestamptz
) from public, anon;
grant execute on function public.record_practice_attempt(
  uuid, text, uuid, text, text, text, text, text, boolean, boolean, timestamptz
) to authenticated;
