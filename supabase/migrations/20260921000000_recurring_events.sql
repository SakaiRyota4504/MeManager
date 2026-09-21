-- 繰り返し予定。
--
-- 発生を1件ずつ行にすると「毎週月曜・終了なし」が無限行になるので、
-- **1件の予定 + 繰り返しルール**で持ち、必要な期間だけ展開する（10.1 節）。
-- 展開はアプリ側（src/lib/recurrence/）で行い、DB は文字列を預かるだけにする。
--
-- 「今週だけ休み」は元の予定を変えずに、休む回を1行足して表す（10.4 節）。

-- ---------------------------------------------------------------------------
-- 1. 予定に繰り返しルールを持たせる
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists rrule text;

comment on column public.events.rrule is
  'RFC 5545 の RRULE（FREQ=WEEKLY;BYDAY=TU など）。null なら1回きりの予定';

-- 展開が要る予定だけを速く拾えるようにする
create index if not exists events_rrule_idx
  on public.events (family_id)
  where rrule is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. 休む回
-- ---------------------------------------------------------------------------

-- 「この回だけ消す」「この回だけ時間を変える」を、元の予定を壊さずに表す。
-- 時間を変える場合は、この行（休み）＋ その日の単発予定の2つになる。
create table if not exists public.event_exceptions (
  event_id        uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,
  created_at      timestamptz not null default now(),
  primary key (event_id, occurrence_date)
);

comment on table public.event_exceptions is
  '繰り返し予定のうち、出さない回。元の予定とルールはそのまま残す';

-- 予定の持ち主の家族を返す。ポリシーから events を直接見ると、
-- events 側のポリシーが二重にかかって読みにくくなる。
create or replace function public.event_family_id(target_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select family_id from public.events where id = target_event_id;
$$;

revoke all on function public.event_family_id(uuid) from public;
grant execute on function public.event_family_id(uuid) to authenticated;

alter table public.event_exceptions enable row level security;

drop policy if exists event_exceptions_select on public.event_exceptions;
create policy event_exceptions_select on public.event_exceptions
  for select to authenticated
  using (public.event_family_id(event_id) in (select public.my_family_ids()));

drop policy if exists event_exceptions_write on public.event_exceptions;
create policy event_exceptions_write on public.event_exceptions
  for all to authenticated
  using (public.event_family_id(event_id) in (select public.my_family_ids()))
  with check (public.event_family_id(event_id) in (select public.my_family_ids()));

grant select, insert, delete on public.event_exceptions to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ルールの確かめ方と、日付の取り出し
-- ---------------------------------------------------------------------------

-- 中身までは見ない。展開するのはアプリ側なので、ここは形だけ確かめる。
create or replace function public.check_rrule(rrule text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  rrule := nullif(trim(coalesce(rrule, '')), '');
  if rrule is null then
    return null;
  end if;
  if rrule !~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)([;A-Z0-9=,+-]*)$' then
    raise exception 'INVALID_RRULE' using hint = '繰り返しの指定が正しくありません';
  end if;
  return upper(rrule);
end;
$$;

-- 予定の「1回目の日付」。終日なら日付、時刻付きならその時間帯での日付。
create or replace function public.event_start_date(e public.events)
returns date
language sql
immutable
set search_path = ''
as $$
  select case when e.all_day then e.start_date
              else (e.starts_at at time zone e.timezone)::date end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 作成・更新・削除を、繰り返しに対応させる
-- ---------------------------------------------------------------------------

create or replace function public.create_event(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id   uuid;
  v_assignees   uuid[];
  v_all_day     boolean := coalesce((payload ->> 'all_day')::boolean, false);
  v_starts_at   timestamptz := (payload ->> 'starts_at')::timestamptz;
  v_ends_at     timestamptz := (payload ->> 'ends_at')::timestamptz;
  v_start_date  date := (payload ->> 'start_date')::date;
  v_end_date    date := (payload ->> 'end_date')::date;
  v_calendar_id uuid := (payload ->> 'calendar_id')::uuid;
  v_rrule       text := public.check_rrule(payload ->> 'rrule');
  v_event_id    uuid;
begin
  select c.family_id into v_family_id
  from public.calendars c where c.id = v_calendar_id;

  if v_family_id is null or v_family_id not in (select public.my_family_ids()) then
    raise exception 'CALENDAR_NOT_FOUND' using hint = 'そのカレンダーには書き込めません';
  end if;

  select array_agg(value::uuid) into v_assignees
  from jsonb_array_elements_text(coalesce(payload -> 'assignees', '[]'::jsonb));

  perform public.validate_event_input(
    v_family_id, v_calendar_id, v_assignees,
    v_all_day, v_starts_at, v_ends_at, v_start_date, v_end_date
  );

  insert into public.events (
    family_id, calendar_id, title, description, location,
    all_day, starts_at, ends_at, start_date, end_date,
    timezone, color, status, rrule, created_by
  )
  values (
    v_family_id, v_calendar_id,
    trim(payload ->> 'title'),
    nullif(trim(coalesce(payload ->> 'description', '')), ''),
    nullif(trim(coalesce(payload ->> 'location', '')), ''),
    v_all_day, v_starts_at, v_ends_at, v_start_date, v_end_date,
    coalesce(nullif(payload ->> 'timezone', ''), 'Asia/Tokyo'),
    nullif(payload ->> 'color', ''),
    coalesce(nullif(payload ->> 'status', ''), 'confirmed'),
    v_rrule,
    public.my_member_id(v_family_id)
  )
  returning id into v_event_id;

  insert into public.event_assignees (event_id, member_id)
  select v_event_id, unnest(v_assignees);

  return v_event_id;
end;
$$;

revoke all on function public.create_event(jsonb) from public;
grant execute on function public.create_event(jsonb) to authenticated;

-- 繰り返しを「その回以降」で打ち切る。
-- 元のルールから終了条件を外し、前日までにする。
create or replace function public.truncate_rrule(rrule text, occurrence date)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both ';' from
           regexp_replace(rrule, '(^|;)(UNTIL|COUNT)=[^;]*', '', 'g'))
         || ';UNTIL=' || to_char(occurrence - 1, 'YYYYMMDD') || 'T000000Z';
$$;

-- ---------------------------------------------------------------------------
-- 更新。scope で「この回だけ / これ以降 / すべて」を選ぶ（FR-R07）
-- ---------------------------------------------------------------------------

drop function if exists public.update_event(uuid, jsonb);

create or replace function public.update_event(
  target_event_id uuid,
  payload jsonb,
  scope text default 'all',
  occurrence date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event       public.events%rowtype;
  v_assignees   uuid[];
  v_calendar_id uuid;
  v_all_day     boolean;
  v_starts_at   timestamptz;
  v_ends_at     timestamptz;
  v_start_date  date;
  v_end_date    date;
begin
  select * into v_event from public.events
  where id = target_event_id and deleted_at is null;

  if not found
     or v_event.family_id not in (select public.my_family_ids())
     or not public.can_read_calendar(v_event.calendar_id) then
    raise exception 'EVENT_NOT_FOUND' using hint = 'その予定は編集できません';
  end if;

  -- 繰り返しでなければ、範囲の指定は意味がない
  if v_event.rrule is null or occurrence is null then
    scope := 'all';
  end if;

  -- 1回目以降すべて＝元の予定そのもの
  if scope = 'following'
     and occurrence <= public.event_start_date(v_event) then
    scope := 'all';
  end if;

  if scope = 'one' then
    -- その回を休みにして、その日ぶんを単発の予定として作り直す
    insert into public.event_exceptions (event_id, occurrence_date)
    values (target_event_id, occurrence)
    on conflict do nothing;

    perform public.create_event(payload - 'rrule');
    return;
  end if;

  if scope = 'following' then
    -- 元を前日で打ち切り、その回から新しい繰り返しとして作る
    update public.events
    set rrule = public.truncate_rrule(v_event.rrule, occurrence)
    where id = target_event_id;

    perform public.create_event(payload);
    return;
  end if;

  -- 指定のあった項目だけ差し替える
  v_calendar_id := coalesce((payload ->> 'calendar_id')::uuid, v_event.calendar_id);
  v_all_day     := coalesce((payload ->> 'all_day')::boolean, v_event.all_day);
  v_starts_at   := case when v_all_day then null
                        else coalesce((payload ->> 'starts_at')::timestamptz, v_event.starts_at) end;
  v_ends_at     := case when v_all_day then null
                        else coalesce((payload ->> 'ends_at')::timestamptz, v_event.ends_at) end;
  v_start_date  := case when v_all_day
                        then coalesce((payload ->> 'start_date')::date, v_event.start_date) end;
  v_end_date    := case when v_all_day
                        then coalesce((payload ->> 'end_date')::date, v_event.end_date) end;

  if payload ? 'assignees' then
    select array_agg(value::uuid) into v_assignees
    from jsonb_array_elements_text(payload -> 'assignees');
  else
    select array_agg(member_id) into v_assignees
    from public.event_assignees where event_id = target_event_id;
  end if;

  perform public.validate_event_input(
    v_event.family_id, v_calendar_id, v_assignees,
    v_all_day, v_starts_at, v_ends_at, v_start_date, v_end_date
  );

  update public.events set
    calendar_id = v_calendar_id,
    title       = coalesce(nullif(trim(coalesce(payload ->> 'title', '')), ''), title),
    description = case when payload ? 'description'
                       then nullif(trim(coalesce(payload ->> 'description', '')), '')
                       else description end,
    location    = case when payload ? 'location'
                       then nullif(trim(coalesce(payload ->> 'location', '')), '')
                       else location end,
    all_day     = v_all_day,
    starts_at   = v_starts_at,
    ends_at     = v_ends_at,
    start_date  = v_start_date,
    end_date    = v_end_date,
    color       = case when payload ? 'color'
                       then nullif(payload ->> 'color', '') else color end,
    status      = coalesce(nullif(payload ->> 'status', ''), status),
    rrule       = case when payload ? 'rrule'
                       then public.check_rrule(payload ->> 'rrule')
                       else rrule end
  where id = target_event_id;

  if payload ? 'assignees' then
    -- 入れ替えの途中で「0人」になるが、トリガーは削除の直前しか見ないため、
    -- 先に足してから余分を消す順にする。
    insert into public.event_assignees (event_id, member_id)
    select target_event_id, unnest(v_assignees)
    on conflict do nothing;

    delete from public.event_assignees
    where event_id = target_event_id and member_id <> all (v_assignees);
  end if;
end;
$$;

revoke all on function public.update_event(uuid, jsonb, text, date) from public;
grant execute on function public.update_event(uuid, jsonb, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 削除。こちらも scope を取る
-- ---------------------------------------------------------------------------

drop function if exists public.delete_event(uuid);

create or replace function public.delete_event(
  target_event_id uuid,
  scope text default 'all',
  occurrence date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
begin
  select * into v_event from public.events
  where id = target_event_id and deleted_at is null;

  if not found
     or v_event.family_id not in (select public.my_family_ids())
     or not public.can_read_calendar(v_event.calendar_id) then
    raise exception 'EVENT_NOT_FOUND' using hint = 'その予定は削除できません';
  end if;

  if v_event.rrule is null or occurrence is null then
    scope := 'all';
  end if;

  if scope = 'following'
     and occurrence <= public.event_start_date(v_event) then
    scope := 'all';
  end if;

  if scope = 'one' then
    insert into public.event_exceptions (event_id, occurrence_date)
    values (target_event_id, occurrence)
    on conflict do nothing;
    return;
  end if;

  if scope = 'following' then
    update public.events
    set rrule = public.truncate_rrule(v_event.rrule, occurrence)
    where id = target_event_id;
    return;
  end if;

  update public.events set deleted_at = now() where id = target_event_id;
end;
$$;

revoke all on function public.delete_event(uuid, text, date) from public;
grant execute on function public.delete_event(uuid, text, date) to authenticated;
