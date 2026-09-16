-- 予定の作成・更新・削除。
--
-- 予定と担当者は別テーブルなので、アプリ側で2回に分けて書き込むと
-- 「担当者のいない予定」が一瞬でも生まれる。ここで1トランザクションにまとめ、
-- 担当者0人の予定が存在しえないようにする（FR-E06）。

-- 入力の共通チェック。問題があれば例外を投げる。
create or replace function public.validate_event_input(
  target_family_id uuid,
  target_calendar_id uuid,
  assignees uuid[],
  all_day boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.can_read_calendar(target_calendar_id) then
    raise exception 'CALENDAR_NOT_FOUND'
      using hint = 'そのカレンダーには書き込めません';
  end if;

  if not exists (
    select 1 from public.calendars c
    where c.id = target_calendar_id and c.family_id = target_family_id
  ) then
    raise exception 'CALENDAR_NOT_FOUND'
      using hint = 'カレンダーと家族が一致しません';
  end if;

  if assignees is null or array_length(assignees, 1) is null then
    raise exception 'NO_ASSIGNEE'
      using hint = '担当者を1人以上選んでください';
  end if;

  -- 担当者が全員、同じ家族の在籍メンバーであること
  if exists (
    select 1 from unnest(assignees) as a(id)
    where not exists (
      select 1 from public.members m
      where m.id = a.id and m.family_id = target_family_id and m.is_active
    )
  ) then
    raise exception 'INVALID_ASSIGNEE'
      using hint = '担当者に指定できない人が含まれています';
  end if;

  if all_day then
    if start_date is null or end_date is null then
      raise exception 'INVALID_PERIOD' using hint = '日付を入力してください';
    end if;
    if end_date < start_date then
      raise exception 'INVALID_PERIOD' using hint = '終了日は開始日以降にしてください';
    end if;
  else
    if starts_at is null or ends_at is null then
      raise exception 'INVALID_PERIOD' using hint = '開始と終了の時刻を入力してください';
    end if;
    if ends_at <= starts_at then
      raise exception 'INVALID_PERIOD' using hint = '終了は開始より後にしてください';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 作成
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
    timezone, color, status, created_by
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

-- ---------------------------------------------------------------------------
-- 更新
-- ---------------------------------------------------------------------------

create or replace function public.update_event(target_event_id uuid, payload jsonb)
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
    status      = coalesce(nullif(payload ->> 'status', ''), status)
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

revoke all on function public.update_event(uuid, jsonb) from public;
grant execute on function public.update_event(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 削除と復元（論理削除。30日は戻せる / NFR-D04）
-- ---------------------------------------------------------------------------

create or replace function public.delete_event(target_event_id uuid)
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

  update public.events set deleted_at = now() where id = target_event_id;
end;
$$;

revoke all on function public.delete_event(uuid) from public;
grant execute on function public.delete_event(uuid) to authenticated;

create or replace function public.restore_event(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
begin
  select * into v_event from public.events
  where id = target_event_id and deleted_at is not null;

  if not found
     or v_event.family_id not in (select public.my_family_ids())
     or not public.can_read_calendar(v_event.calendar_id) then
    raise exception 'EVENT_NOT_FOUND' using hint = 'その予定は戻せません';
  end if;

  if v_event.deleted_at < now() - interval '30 days' then
    raise exception 'TOO_OLD' using hint = '削除から30日を過ぎた予定は戻せません';
  end if;

  update public.events set deleted_at = null where id = target_event_id;
end;
$$;

revoke all on function public.restore_event(uuid) from public;
grant execute on function public.restore_event(uuid) to authenticated;
