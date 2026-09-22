-- 予定（events）と担当者（event_assignees）。
--
-- 設計の根拠は docs/02-schedule-requirements.md の 6章。要点:
--   * 終日予定は date 型、時刻付きは timestamptz 型と、列を分ける。
--     終日をタイムゾーン付きで持つと、旅行先で日付が1日ずれる。
--   * 担当者は1人以上を必須にする（FR-E06）。
--     子テーブルなので NOT NULL では表現できず、関数とトリガーで守る。
--
-- 繰り返し（rrule）は Step 5、取り込み（external_key）は Step 6 で足す。

create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  -- RLS の判定で calendars への結合を毎回起こさないよう、冗長に持つ。
  family_id     uuid not null references public.families (id) on delete cascade,
  calendar_id   uuid not null references public.calendars (id) on delete cascade,

  title         text not null check (char_length(title) between 1 and 200),
  description   text check (char_length(description) <= 2000),
  location      text check (char_length(location) <= 200),

  all_day       boolean not null default false,
  -- 時刻付きのときに使う。終了は排他的（その時刻を含まない）。
  starts_at     timestamptz,
  ends_at       timestamptz,
  -- 終日のときに使う。終了は包含的（その日を含む）。
  start_date    date,
  end_date      date,
  timezone      text not null default 'Asia/Tokyo',

  color         text check (color ~ '^#[0-9a-fA-F]{6}$'),
  status        text not null default 'confirmed'
                check (status in ('confirmed', 'tentative', 'cancelled')),

  created_by    uuid references public.members (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- 終日と時刻付きで、必要な列が入っていることを型として保証する
  constraint events_dates_match_all_day check (
    case when all_day
      then start_date is not null and end_date is not null
           and starts_at is null and ends_at is null
           and end_date >= start_date
      else starts_at is not null and ends_at is not null
           and start_date is null and end_date is null
           and ends_at > starts_at
    end
  )
);

comment on table public.events is '1件の予定';
comment on column public.events.ends_at is '排他的。この時刻は含まない';
comment on column public.events.end_date is '包含的。この日を含む';

create index if not exists events_family_starts_idx
  on public.events (family_id, starts_at) where deleted_at is null;
create index if not exists events_family_dates_idx
  on public.events (family_id, start_date) where deleted_at is null;
create index if not exists events_calendar_idx on public.events (calendar_id);

create table if not exists public.event_assignees (
  event_id  uuid not null references public.events (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  primary key (event_id, member_id)
);

comment on table public.event_assignees is 'その予定が誰の予定か。1件につき1人以上';

-- 「このメンバーの予定」を引くための索引
create index if not exists event_assignees_member_idx on public.event_assignees (member_id, event_id);

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 担当者は1人以上（FR-E06）
-- ---------------------------------------------------------------------------

-- 最後の1人が消えるのを止める。
-- 予定そのものを消すとき（cascade）は素通りさせる。
create or replace function public.prevent_last_assignee_removal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.events e where e.id = old.event_id)
     and not exists (
       select 1 from public.event_assignees a
       where a.event_id = old.event_id and a.member_id <> old.member_id
     )
  then
    raise exception 'NO_ASSIGNEE'
      using hint = '予定には担当者が1人以上必要です';
  end if;
  return old;
end;
$$;

drop trigger if exists event_assignees_keep_one on public.event_assignees;
create trigger event_assignees_keep_one
  before delete on public.event_assignees
  for each row execute function public.prevent_last_assignee_removal();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;
alter table public.event_assignees enable row level security;

-- 閲覧できるカレンダーかどうか。非公開カレンダーは所有者だけ。
create or replace function public.can_read_calendar(target_calendar_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.calendars c
    where c.id = target_calendar_id
      and c.family_id in (select public.my_family_ids())
      and (c.visibility = 'family'
           or c.owner_member_id = public.my_member_id(c.family_id))
  );
$$;

drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated
  using (
    deleted_at is null
    and family_id in (select public.my_family_ids())
    and public.can_read_calendar(calendar_id)
  );

drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated
  with check (
    family_id in (select public.my_family_ids())
    and public.can_read_calendar(calendar_id)
  );

drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated
  using (
    family_id in (select public.my_family_ids())
    and public.can_read_calendar(calendar_id)
  )
  with check (
    family_id in (select public.my_family_ids())
    and public.can_read_calendar(calendar_id)
  );

-- 物理削除はしない。消すときは deleted_at を入れる。

drop policy if exists event_assignees_select on public.event_assignees;
create policy event_assignees_select on public.event_assignees
  for select to authenticated
  using (
    exists (select 1 from public.events e
            where e.id = event_id
              and e.deleted_at is null
              and e.family_id in (select public.my_family_ids())
              and public.can_read_calendar(e.calendar_id))
  );

drop policy if exists event_assignees_write on public.event_assignees;
create policy event_assignees_write on public.event_assignees
  for all to authenticated
  using (
    exists (select 1 from public.events e
            where e.id = event_id
              and e.family_id in (select public.my_family_ids())
              and public.can_read_calendar(e.calendar_id))
  )
  with check (
    exists (select 1 from public.events e
            where e.id = event_id
              and e.family_id in (select public.my_family_ids())
              and public.can_read_calendar(e.calendar_id))
  );

grant select, insert, update on public.events to authenticated;
grant select, insert, update, delete on public.event_assignees to authenticated;
