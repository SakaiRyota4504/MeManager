-- CSV の取り込みと、一括削除。
--
-- **塊で入れて、塊で消す。**（docs/04-csv-format.md 3章）
-- 取り込み1回ぶんを「バッチ」として記録し、日程が変わったときは
-- そのバッチごと消して入れ直す。差分更新の仕組みは作らない。
-- 数百件でも2操作で済み、覚えることが「入れる」と「その回を消す」の2つになる。

-- ---------------------------------------------------------------------------
-- 1. 取り込み1回ぶん
-- ---------------------------------------------------------------------------

create table if not exists public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  name        text not null,
  file_name   text,
  /** どこから取り込んだか。いまは csv だけ。将来 ics が増える */
  source      text not null default 'csv',
  event_count integer not null default 0,
  created_by  uuid references public.members(id),
  created_at  timestamptz not null default now(),
  /** 論理削除。30日は戻せる（FR-I28） */
  deleted_at  timestamptz
);

comment on table public.import_batches is
  '取り込み1回ぶん。この単位でまとめて消す・戻す';

create index if not exists import_batches_family_idx
  on public.import_batches (family_id, created_at desc);

alter table public.import_batches enable row level security;

drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_select on public.import_batches
  for select to authenticated
  using (family_id in (select public.my_family_ids()));

grant select on public.import_batches to authenticated;

-- 書き込みは関数（security definer）からのみ。
-- 予定とバッチが食い違った状態を作らせない。

-- ---------------------------------------------------------------------------
-- 2. 予定に、どこから来たかを持たせる
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists external_key text,
  add column if not exists import_batch_id uuid
    references public.import_batches(id) on delete set null,
  add column if not exists deleted_with_batch boolean not null default false;

comment on column public.events.external_key is
  '取り込み元での識別子。**重複の検出にだけ使う。**更新には使わない';
comment on column public.events.import_batch_id is
  'どの取り込みで入ったか。null なら手で作った予定';
comment on column public.events.deleted_with_batch is
  'まとめて消されたか。戻すときに「この削除で消えたぶん」だけを選ぶために使う';

-- 一意制約にはしない。「重複だと分かったうえでそのまま登録する」
-- を選べるようにしてあるため（FR-I21）。ここを一意にすると、
-- その選択が途中で失敗して全部が巻き戻る。
create index if not exists events_external_key_idx
  on public.events (family_id, external_key)
  where external_key is not null and deleted_at is null;

create index if not exists events_import_batch_idx
  on public.events (import_batch_id)
  where import_batch_id is not null;

-- ---------------------------------------------------------------------------
-- 3. 取り込みの実行
-- ---------------------------------------------------------------------------

-- 1回ぶんをまとめて入れる。途中で失敗したら全部入らない。
-- 半分だけ入った状態は、消して入れ直す操作を壊す。
create or replace function public.commit_import(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calendar_id uuid := (payload ->> 'calendar_id')::uuid;
  v_family_id   uuid;
  v_batch_id    uuid;
  v_row         jsonb;
  v_event_id    uuid;
  v_assignees   uuid[];
  v_count       integer := 0;
begin
  select c.family_id into v_family_id
  from public.calendars c where c.id = v_calendar_id;

  if v_family_id is null or v_family_id not in (select public.my_family_ids()) then
    raise exception 'CALENDAR_NOT_FOUND' using hint = 'そのカレンダーには書き込めません';
  end if;

  if jsonb_typeof(payload -> 'rows') <> 'array'
     or jsonb_array_length(payload -> 'rows') = 0 then
    raise exception 'NO_ROWS' using hint = '取り込む行がありません';
  end if;

  insert into public.import_batches (
    family_id, name, file_name, source, created_by
  )
  values (
    v_family_id,
    coalesce(nullif(trim(payload ->> 'name'), ''), '取り込み'),
    nullif(trim(coalesce(payload ->> 'file_name', '')), ''),
    coalesce(nullif(payload ->> 'source', ''), 'csv'),
    public.my_member_id(v_family_id)
  )
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(payload -> 'rows')
  loop
    select array_agg(value::uuid) into v_assignees
    from jsonb_array_elements_text(coalesce(v_row -> 'assignees', '[]'::jsonb));

    perform public.validate_event_input(
      v_family_id, v_calendar_id, v_assignees,
      coalesce((v_row ->> 'all_day')::boolean, false),
      (v_row ->> 'starts_at')::timestamptz,
      (v_row ->> 'ends_at')::timestamptz,
      (v_row ->> 'start_date')::date,
      (v_row ->> 'end_date')::date
    );

    insert into public.events (
      family_id, calendar_id, title, description, location,
      all_day, starts_at, ends_at, start_date, end_date,
      timezone, color, status, external_key, import_batch_id, created_by
    )
    values (
      v_family_id, v_calendar_id,
      trim(v_row ->> 'title'),
      nullif(trim(coalesce(v_row ->> 'description', '')), ''),
      nullif(trim(coalesce(v_row ->> 'location', '')), ''),
      coalesce((v_row ->> 'all_day')::boolean, false),
      (v_row ->> 'starts_at')::timestamptz,
      (v_row ->> 'ends_at')::timestamptz,
      (v_row ->> 'start_date')::date,
      (v_row ->> 'end_date')::date,
      coalesce(nullif(v_row ->> 'timezone', ''), 'Asia/Tokyo'),
      nullif(v_row ->> 'color', ''),
      coalesce(nullif(v_row ->> 'status', ''), 'confirmed'),
      nullif(trim(coalesce(v_row ->> 'external_key', '')), ''),
      v_batch_id,
      public.my_member_id(v_family_id)
    )
    returning id into v_event_id;

    insert into public.event_assignees (event_id, member_id)
    select v_event_id, unnest(v_assignees);

    v_count := v_count + 1;
  end loop;

  update public.import_batches set event_count = v_count where id = v_batch_id;

  return jsonb_build_object('batch_id', v_batch_id, 'count', v_count);
end;
$$;

revoke all on function public.commit_import(jsonb) from public;
grant execute on function public.commit_import(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. バッチごと消す・戻す
-- ---------------------------------------------------------------------------

-- バッチとその回に入った予定をまとめて消す。
-- 消した予定に印を付けておき、戻すときは「この削除で消えたぶん」だけを戻す。
-- 時刻の一致で見分ける手もあるが、同じ取引の中では時刻が同じになるため使えない。
create or replace function public.delete_import_batch(target_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches%rowtype;
  v_at    timestamptz := now();
  v_count integer;
begin
  select * into v_batch from public.import_batches
  where id = target_batch_id and deleted_at is null;

  if not found or v_batch.family_id not in (select public.my_family_ids()) then
    raise exception 'BATCH_NOT_FOUND' using hint = 'その取り込みは削除できません';
  end if;

  update public.events
  set deleted_at = v_at, deleted_with_batch = true
  where import_batch_id = target_batch_id and deleted_at is null;
  get diagnostics v_count = row_count;

  update public.import_batches set deleted_at = v_at where id = target_batch_id;

  return v_count;
end;
$$;

revoke all on function public.delete_import_batch(uuid) from public;
grant execute on function public.delete_import_batch(uuid) to authenticated;

create or replace function public.restore_import_batch(target_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches%rowtype;
  v_count integer;
begin
  select * into v_batch from public.import_batches
  where id = target_batch_id and deleted_at is not null;

  if not found or v_batch.family_id not in (select public.my_family_ids()) then
    raise exception 'BATCH_NOT_FOUND' using hint = 'その取り込みは戻せません';
  end if;

  if v_batch.deleted_at < now() - interval '30 days' then
    raise exception 'TOO_OLD' using hint = '削除から30日を過ぎた取り込みは戻せません';
  end if;

  -- この削除で消えたぶんだけを戻す。
  -- 削除より前に1件ずつ消していた予定は、消えたままにする。
  update public.events
  set deleted_at = null, deleted_with_batch = false
  where import_batch_id = target_batch_id and deleted_with_batch;
  get diagnostics v_count = row_count;

  update public.import_batches set deleted_at = null where id = target_batch_id;

  return v_count;
end;
$$;

revoke all on function public.restore_import_batch(uuid) from public;
grant execute on function public.restore_import_batch(uuid) to authenticated;

-- 1件ずつ戻したときも、まとめて消した印は落としておく。
-- 残っていると、あとでバッチを戻したときに二重に戻そうとする。
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

  update public.events
  set deleted_at = null, deleted_with_batch = false
  where id = target_event_id;
end;
$$;
