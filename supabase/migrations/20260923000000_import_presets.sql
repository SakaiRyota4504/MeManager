-- 取り込みの設定を、名前を付けて残す（FR-I17）。
--
-- 月1回の休日取り込みは、毎月まったく同じ指定の繰り返しになる。
-- 毎回8項目を選び直すのでは続かないので、
-- 「今月の休日」を選んでファイルを渡すだけで済むようにする。
--
-- 家族で共有する（FR-I18）。取り込む人が替わっても同じ手順になる。

create table if not exists public.import_presets (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  name       text not null,
  /**
   * 取り込みの指定をまとめて持つ。
   * 列の対応・担当者・重複時の動作・文字コードが入る。
   * 中身が増えるたびにマイグレーションを足さずに済むよう jsonb にしてある。
   */
  settings   jsonb not null default '{}'::jsonb,
  created_by uuid references public.members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists import_presets_name_key
  on public.import_presets (family_id, name);

drop trigger if exists set_updated_at on public.import_presets;
create trigger set_updated_at
  before update on public.import_presets
  for each row execute function public.set_updated_at();

alter table public.import_presets enable row level security;

drop policy if exists import_presets_select on public.import_presets;
create policy import_presets_select on public.import_presets
  for select to authenticated
  using (family_id in (select public.my_family_ids()));

drop policy if exists import_presets_write on public.import_presets;
create policy import_presets_write on public.import_presets
  for all to authenticated
  using (family_id in (select public.my_family_ids()))
  with check (family_id in (select public.my_family_ids()));

grant select, insert, update, delete on public.import_presets to authenticated;

-- 同じ名前で保存し直せるようにする。
-- 「今月の休日」を毎月作り直すのではなく、上書きで育てていく使い方を想定する。
create or replace function public.save_import_preset(
  preset_name text,
  settings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
  v_id        uuid;
begin
  select m.family_id into v_family_id
  from public.members m
  where m.user_id = (select auth.uid()) and m.is_active
  order by m.created_at
  limit 1;

  if v_family_id is null then
    raise exception 'メンバーが見つかりません';
  end if;

  preset_name := nullif(trim(preset_name), '');
  if preset_name is null then
    raise exception 'PRESET_NAME_REQUIRED' using hint = '名前を入力してください';
  end if;

  insert into public.import_presets (family_id, name, settings, created_by)
  values (v_family_id, preset_name, settings,
          public.my_member_id(v_family_id))
  on conflict (family_id, name) do update
    set settings = excluded.settings
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_import_preset(text, jsonb) from public;
grant execute on function public.save_import_preset(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 取り込みで、繰り返しルールも引き継げるようにする（FR-I05）
-- ---------------------------------------------------------------------------

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
      timezone, color, status, rrule, external_key, import_batch_id, created_by
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
      public.check_rrule(v_row ->> 'rrule'),
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
