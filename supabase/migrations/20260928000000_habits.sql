-- 習慣（H1）。docs/08-habit-requirements.md の 5章。
--
-- 予定とは別のデータとして持つ（00-product-vision.md 4.4）。
-- 繰り返し予定として実装すると、カレンダーが未達成の習慣で埋まる。
--
-- 要点:
--   * 頻度は2種類。RRULE だけでは「週3回（曜日は問わない）」が表せない（3.2）
--   * 記録は「やった日」だけ。できなかった日は行が無い（3.3）
--   * 1日1回まで。主キーがそれを担保する（3.4）
--   * 公開範囲を習慣ごとに選ぶ。家計簿と違い、ここは秘密を認める（3.5）

create table if not exists public.habits (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families (id) on delete cascade,
  -- 担当は1人。家族で1つの習慣は作らない（FR-H02）
  member_id     uuid not null references public.members (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 40),
  color         text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),

  -- 'schedule' … 曜日で決める（rrule を使う）
  -- 'count'    … 期間内に何回（target_count と period を使う）
  kind          text not null default 'schedule'
                check (kind in ('schedule', 'count')),
  -- kind = 'schedule' のとき。スケジュールと同じ RRULE
  rrule         text check (char_length(rrule) between 1 and 200),
  -- kind = 'count' のとき
  target_count  integer check (target_count between 1 and 100),
  period        text check (period in ('week', 'month')),

  -- 'private' は作った本人だけ。記録も見えない（3.5）
  visibility    text not null default 'family'
                check (visibility in ('family', 'private')),
  is_active     boolean not null default true,
  created_by    uuid references public.members (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 種類ごとに、必要な列が入っていることを型として保証する
  constraint habits_fields_match_kind check (
    case kind
      when 'schedule' then rrule is not null
                       and target_count is null and period is null
      when 'count'    then target_count is not null and period is not null
                       and rrule is null
    end
  )
);

comment on table public.habits is '続けたいこと。予定とは別に持つ';
comment on column public.habits.kind is
  'schedule=曜日で決める（rrule）/ count=期間内に何回';

create index if not exists habits_family_idx
  on public.habits (family_id) where is_active;
create index if not exists habits_member_idx
  on public.habits (member_id) where is_active;

drop trigger if exists habits_set_updated_at on public.habits;
create trigger habits_set_updated_at
  before update on public.habits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- やった日
-- ---------------------------------------------------------------------------

-- **主キーが (habit_id, done_on) であることが「1日1回」の担保**（3.4）。
-- 1日2回は、行として存在できない。
create table if not exists public.habit_logs (
  habit_id   uuid not null references public.habits (id) on delete cascade,
  done_on    date not null,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (habit_id, done_on)
);

comment on table public.habit_logs is
  'やった日。できなかった日の行は作らない（記録が無い日がそれ）';

create index if not exists habit_logs_date_idx
  on public.habit_logs (done_on, habit_id);

-- ---------------------------------------------------------------------------
-- RLS。公開範囲を見る
-- ---------------------------------------------------------------------------

alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;

-- その習慣を見てよいか。'private' は本人だけ。
-- カレンダーの can_read_calendar と同じ考え方。
create or replace function public.can_read_habit(target_habit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.habits h
    where h.id = target_habit_id
      and h.family_id in (select public.my_family_ids())
      and (h.visibility = 'family'
           or h.member_id = public.my_member_id(h.family_id))
  );
$$;

drop policy if exists habits_select on public.habits;
create policy habits_select on public.habits
  for select to authenticated
  using (
    family_id in (select public.my_family_ids())
    and (visibility = 'family' or member_id = public.my_member_id(family_id))
  );

drop policy if exists habit_logs_select on public.habit_logs;
create policy habit_logs_select on public.habit_logs
  for select to authenticated
  using (public.can_read_habit(habit_id));

-- 書き込みは関数を通す（家計簿と同じ）
grant select on public.habits to authenticated;
grant select on public.habit_logs to authenticated;

-- ---------------------------------------------------------------------------
-- 登録と変更
-- ---------------------------------------------------------------------------

-- 種類ごとに要る列が違うので、入力の整合はここで見る。
create or replace function public.validate_habit_input(
  kind text,
  rrule text,
  target_count integer,
  period text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if kind = 'schedule' then
    if rrule is null or btrim(rrule) = '' then
      raise exception 'INVALID_HABIT' using hint = '繰り返しを決めてください';
    end if;
  elsif kind = 'count' then
    if target_count is null or target_count < 1 then
      raise exception 'INVALID_HABIT' using hint = '回数を決めてください';
    end if;
    if period not in ('week', 'month') then
      raise exception 'INVALID_HABIT' using hint = '期間を決めてください';
    end if;
  else
    raise exception 'INVALID_HABIT' using hint = '頻度の種類が正しくありません';
  end if;
end;
$$;

create or replace function public.create_habit(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member      public.members%rowtype;
  v_member_id   uuid := nullif(payload ->> 'member_id', '')::uuid;
  v_family_id   uuid := public.my_family_id();
  v_name        text := nullif(trim(payload ->> 'name'), '');
  v_kind        text := coalesce(nullif(payload ->> 'kind', ''), 'schedule');
  v_rrule       text := nullif(trim(coalesce(payload ->> 'rrule', '')), '');
  v_count       integer := (payload ->> 'target_count')::integer;
  v_period      text := nullif(payload ->> 'period', '');
  v_visibility  text := coalesce(nullif(payload ->> 'visibility', ''), 'family');
  v_id          uuid;
begin
  if v_family_id is null then
    raise exception 'MEMBER_REQUIRED' using hint = 'メンバーが見つかりません';
  end if;
  if v_name is null then
    raise exception 'INVALID_HABIT' using hint = '名前を入れてください';
  end if;
  if v_visibility not in ('family', 'private') then
    raise exception 'INVALID_HABIT' using hint = '公開範囲が正しくありません';
  end if;

  -- 担当は、同じ家族の在籍メンバーだけ。省略したら自分
  v_member_id := coalesce(v_member_id, public.my_member_id(v_family_id));
  select * into v_member from public.members
  where id = v_member_id and family_id = v_family_id and is_active;

  if not found then
    raise exception 'INVALID_MEMBER' using hint = 'その人は選べません';
  end if;

  -- 「自分だけ」は、自分の習慣にしか付けられない。
  -- 他人の習慣を隠すと、本人から見えなくなってしまう。
  if v_visibility = 'private'
     and v_member_id is distinct from public.my_member_id(v_family_id) then
    raise exception 'INVALID_HABIT'
      using hint = '「自分だけ」は自分の習慣にだけ付けられます';
  end if;

  if v_kind = 'schedule' then
    v_count := null;
    v_period := null;
  else
    v_rrule := null;
  end if;

  perform public.validate_habit_input(v_kind, v_rrule, v_count, v_period);

  insert into public.habits (
    family_id, member_id, name, color, kind, rrule,
    target_count, period, visibility, created_by
  )
  values (
    v_family_id, v_member_id, v_name,
    coalesce(nullif(payload ->> 'color', ''), v_member.color),
    v_kind, v_rrule, v_count, v_period, v_visibility,
    public.my_member_id(v_family_id)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_habit(jsonb) from public;
grant execute on function public.create_habit(jsonb) to authenticated;

create or replace function public.update_habit(
  target_habit_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_habit      public.habits%rowtype;
  v_kind       text;
  v_rrule      text;
  v_count      integer;
  v_period     text;
  v_member_id  uuid;
  v_visibility text;
begin
  select * into v_habit from public.habits where id = target_habit_id;

  if not found
     or v_habit.family_id not in (select public.my_family_ids())
     or not public.can_read_habit(target_habit_id) then
    raise exception 'HABIT_NOT_FOUND' using hint = 'その習慣は編集できません';
  end if;

  v_kind := coalesce(nullif(payload ->> 'kind', ''), v_habit.kind);
  v_visibility := coalesce(nullif(payload ->> 'visibility', ''), v_habit.visibility);
  v_member_id := coalesce(nullif(payload ->> 'member_id', '')::uuid, v_habit.member_id);

  if v_visibility not in ('family', 'private') then
    raise exception 'INVALID_HABIT' using hint = '公開範囲が正しくありません';
  end if;

  if not exists (
    select 1 from public.members m
    where m.id = v_member_id and m.family_id = v_habit.family_id and m.is_active
  ) then
    raise exception 'INVALID_MEMBER' using hint = 'その人は選べません';
  end if;

  if v_visibility = 'private'
     and v_member_id is distinct from public.my_member_id(v_habit.family_id) then
    raise exception 'INVALID_HABIT'
      using hint = '「自分だけ」は自分の習慣にだけ付けられます';
  end if;

  -- 種類が変わったら、使わない列は消す。
  -- 残すと「週3回なのに rrule が入っている」行ができる。
  if v_kind = 'schedule' then
    v_rrule := coalesce(
      nullif(trim(coalesce(payload ->> 'rrule', '')), ''),
      case when v_habit.kind = 'schedule' then v_habit.rrule end
    );
    v_count := null;
    v_period := null;
  else
    v_rrule := null;
    v_count := coalesce(
      (payload ->> 'target_count')::integer,
      case when v_habit.kind = 'count' then v_habit.target_count end
    );
    v_period := coalesce(
      nullif(payload ->> 'period', ''),
      case when v_habit.kind = 'count' then v_habit.period end
    );
  end if;

  perform public.validate_habit_input(v_kind, v_rrule, v_count, v_period);

  update public.habits set
    member_id    = v_member_id,
    name         = coalesce(nullif(trim(coalesce(payload ->> 'name', '')), ''), name),
    color        = coalesce(nullif(payload ->> 'color', ''), color),
    kind         = v_kind,
    rrule        = v_rrule,
    target_count = v_count,
    period       = v_period,
    visibility   = v_visibility,
    is_active    = coalesce((payload ->> 'is_active')::boolean, is_active)
  where id = target_habit_id;
end;
$$;

revoke all on function public.update_habit(uuid, jsonb) from public;
grant execute on function public.update_habit(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 押す・取り消す（FR-H11 / FR-H14）
-- ---------------------------------------------------------------------------

-- もう一度押すと取り消せるので、1つの関数で両方を扱う。
-- 戻り値は「押したあとの状態」。true ならやった日として残っている。
create or replace function public.toggle_habit_log(
  target_habit_id uuid,
  target_date date default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_habit public.habits%rowtype;
  v_date  date;
begin
  select * into v_habit from public.habits where id = target_habit_id;

  if not found
     or not v_habit.is_active
     or v_habit.family_id not in (select public.my_family_ids())
     or not public.can_read_habit(target_habit_id) then
    raise exception 'HABIT_NOT_FOUND' using hint = 'その習慣は使えません';
  end if;

  v_date := coalesce(target_date, (now() at time zone 'Asia/Tokyo')::date);

  -- 未来は押せない（3.6）。まだ起きていないことを記録できると、
  -- 記録そのものの意味が無くなる。
  if v_date > (now() at time zone 'Asia/Tokyo')::date then
    raise exception 'FUTURE_DATE' using hint = 'これからの日はまだ押せません';
  end if;

  delete from public.habit_logs
  where habit_id = target_habit_id and done_on = v_date;

  if found then
    return false;
  end if;

  insert into public.habit_logs (habit_id, done_on, created_by)
  values (target_habit_id, v_date,
          public.my_member_id(v_habit.family_id));

  return true;
end;
$$;

revoke all on function public.toggle_habit_log(uuid, date) from public;
grant execute on function public.toggle_habit_log(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 記録の取り出し
-- ---------------------------------------------------------------------------

-- 期間内の記録。展開（どの日にやる予定か）はアプリ側が行うので、
-- ここは「やった日」を返すだけ。展開の処理を2か所に持たない。
create or replace function public.habit_logs_between(
  from_date date,
  to_date date
)
returns table (habit_id uuid, done_on date)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.habit_id, l.done_on
  from public.habit_logs l
  where l.done_on >= from_date
    and l.done_on <= to_date
  order by l.done_on;
$$;

revoke all on function public.habit_logs_between(date, date) from public;
grant execute on function public.habit_logs_between(date, date) to authenticated;
