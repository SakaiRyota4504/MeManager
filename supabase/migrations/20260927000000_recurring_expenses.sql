-- 固定費（B3）。docs/07-budget-requirements.md の 4.3。
--
-- いちばん大事なのは FR-B22:
--   **自動では記録に入れない。**「今月まだ入れていない固定費」として出し、
--   押したときに初めて記録になる。
--
-- 自動計上にすると、実際には解約していたサブスクが毎月積み上がる。
-- 「予定されている支出」と「実際に使った額」は別物として扱う。
--
-- 繰り返しの指定はスケジュールと同じ RRULE（FR-B21）。
-- 展開もアプリ側の同じ部品（src/lib/recurrence/expand.ts）を使うので、
-- ここには日付を数える処理を置かない。

create table if not exists public.recurring_expenses (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  -- 金額が毎月変わるもの（光熱費）は空にできる（FR-B23）。
  -- 空のものは、押したときに金額を聞く。
  amount      integer check (amount > 0 and amount <= 100000000),
  category_id uuid not null references public.budget_categories (id) on delete restrict,
  member_id   uuid references public.members (id) on delete set null,
  -- RFC 5545 の RRULE。'FREQ=MONTHLY;BYMONTHDAY=27' のような形
  rrule       text not null check (char_length(rrule) between 1 and 200),
  -- 1回目の日付。展開の起点（dtstart）になる
  start_date  date not null,
  -- 解約したものは false にして隠す。過去の記録は残る
  is_active   boolean not null default true,
  created_by  uuid references public.members (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.recurring_expenses is
  '毎月決まって出ていくもの。自動では記録に入れない（FR-B22）';

create index if not exists recurring_expenses_family_idx
  on public.recurring_expenses (family_id) where is_active;

drop trigger if exists recurring_expenses_set_updated_at on public.recurring_expenses;
create trigger recurring_expenses_set_updated_at
  before update on public.recurring_expenses
  for each row execute function public.set_updated_at();

-- どの固定費から入った記録かを残す。
-- 「今月はもう入れたか」を見るのに使う。
alter table public.transactions
  add column if not exists recurring_id uuid
  references public.recurring_expenses (id) on delete set null;

-- 同じ固定費を同じ月に二重に入れられないようにする。
-- 家族の2人が同時に押すことがあるので、画面側の確認だけでは足りない。
-- date_trunc は timestamptz を取る形だと時間帯に左右されるため索引に使えない。
-- date のまま timestamp に寄せて、月の頭を求める。
create unique index if not exists transactions_recurring_month_idx
  on public.transactions (recurring_id, (date_trunc('month', occurred_on::timestamp)))
  where recurring_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- RLS。読むのは家族の全員、書くのは関数からだけ（家計簿の他のテーブルと同じ）
-- ---------------------------------------------------------------------------

alter table public.recurring_expenses enable row level security;

drop policy if exists recurring_expenses_select on public.recurring_expenses;
create policy recurring_expenses_select on public.recurring_expenses
  for select to authenticated
  using (family_id in (select public.my_family_ids()));

grant select on public.recurring_expenses to authenticated;

-- ---------------------------------------------------------------------------
-- 登録と変更
-- ---------------------------------------------------------------------------

create or replace function public.create_recurring_expense(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category    public.budget_categories%rowtype;
  v_category_id uuid := (payload ->> 'category_id')::uuid;
  v_member_id   uuid := nullif(payload ->> 'member_id', '')::uuid;
  v_name        text := nullif(trim(payload ->> 'name'), '');
  v_rrule       text := nullif(trim(payload ->> 'rrule'), '');
  v_amount      integer := (payload ->> 'amount')::integer;
  v_start_date  date;
  v_id          uuid;
begin
  select * into v_category from public.budget_categories where id = v_category_id;

  if not found or v_category.family_id not in (select public.my_family_ids()) then
    raise exception 'CATEGORY_NOT_FOUND' using hint = '費目を選んでください';
  end if;
  -- 収入の費目は選べない。固定費は「出ていくもの」の話
  if v_category.kind <> 'expense' then
    raise exception 'CATEGORY_NOT_FOUND' using hint = '支出の費目を選んでください';
  end if;

  if v_name is null then
    raise exception 'INVALID_RECURRING' using hint = '名前を入れてください';
  end if;
  if v_rrule is null then
    raise exception 'INVALID_RECURRING' using hint = '繰り返しを決めてください';
  end if;
  if v_amount is not null and v_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using hint = '金額を入れてください';
  end if;

  v_start_date := coalesce(
    (payload ->> 'start_date')::date,
    date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date
  );

  if v_member_id is not null and not exists (
    select 1 from public.members m
    where m.id = v_member_id and m.family_id = v_category.family_id and m.is_active
  ) then
    raise exception 'INVALID_MEMBER' using hint = 'その人は選べません';
  end if;

  insert into public.recurring_expenses (
    family_id, name, amount, category_id, member_id, rrule, start_date, created_by
  )
  values (
    v_category.family_id, v_name, v_amount, v_category_id, v_member_id,
    v_rrule, v_start_date, public.my_member_id(v_category.family_id)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_recurring_expense(jsonb) from public;
grant execute on function public.create_recurring_expense(jsonb) to authenticated;

create or replace function public.update_recurring_expense(
  target_recurring_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row         public.recurring_expenses%rowtype;
  v_category_id uuid;
  v_category    public.budget_categories%rowtype;
  v_member_id   uuid;
  v_amount      integer;
begin
  select * into v_row from public.recurring_expenses where id = target_recurring_id;

  if not found or v_row.family_id not in (select public.my_family_ids()) then
    raise exception 'RECURRING_NOT_FOUND' using hint = 'その固定費は編集できません';
  end if;

  v_category_id := coalesce((payload ->> 'category_id')::uuid, v_row.category_id);
  select * into v_category from public.budget_categories where id = v_category_id;
  if not found
     or v_category.family_id <> v_row.family_id
     or v_category.kind <> 'expense' then
    raise exception 'CATEGORY_NOT_FOUND' using hint = 'その費目は選べません';
  end if;

  -- 金額は「空にする」も指定のうちなので、キーの有無で見分ける
  v_amount := case when payload ? 'amount'
                   then nullif(payload ->> 'amount', '')::integer
                   else v_row.amount end;
  if v_amount is not null and v_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using hint = '金額を入れてください';
  end if;

  v_member_id := case when payload ? 'member_id'
                      then nullif(payload ->> 'member_id', '')::uuid
                      else v_row.member_id end;
  if v_member_id is not null and not exists (
    select 1 from public.members m
    where m.id = v_member_id and m.family_id = v_row.family_id and m.is_active
  ) then
    raise exception 'INVALID_MEMBER' using hint = 'その人は選べません';
  end if;

  update public.recurring_expenses set
    name        = coalesce(nullif(trim(coalesce(payload ->> 'name', '')), ''), name),
    amount      = v_amount,
    category_id = v_category_id,
    member_id   = v_member_id,
    rrule       = coalesce(nullif(trim(coalesce(payload ->> 'rrule', '')), ''), rrule),
    start_date  = coalesce((payload ->> 'start_date')::date, start_date),
    is_active   = coalesce((payload ->> 'is_active')::boolean, is_active)
  where id = target_recurring_id;
end;
$$;

revoke all on function public.update_recurring_expense(uuid, jsonb) from public;
grant execute on function public.update_recurring_expense(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 固定費を記録にする（FR-B22）
-- ---------------------------------------------------------------------------

-- 「今月まだ入れていない固定費」の一覧から押したときに呼ぶ。
-- どの回を入れたかは occurred_on が持つので、引数に日付を取る。
create or replace function public.record_recurring(
  target_recurring_id uuid,
  target_date date,
  new_amount integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.recurring_expenses%rowtype;
  v_amount integer;
  v_id     uuid;
begin
  select * into v_row from public.recurring_expenses where id = target_recurring_id;

  if not found
     or not v_row.is_active
     or v_row.family_id not in (select public.my_family_ids()) then
    raise exception 'RECURRING_NOT_FOUND' using hint = 'その固定費は使えません';
  end if;

  -- 画面で入れた額が優先。無ければ登録してある額
  v_amount := coalesce(new_amount, v_row.amount);
  if v_amount is null or v_amount <= 0 then
    raise exception 'AMOUNT_REQUIRED' using hint = '金額を入れてください';
  end if;

  if target_date is null then
    raise exception 'INVALID_PERIOD' using hint = '日付を入れてください';
  end if;

  -- 同じ月にもう入っていれば、ここで止める。
  -- 索引でも防いでいるが、こちらのほうが理由の分かる言葉で返せる。
  if exists (
    select 1 from public.transactions t
    where t.recurring_id = target_recurring_id
      and t.deleted_at is null
      and date_trunc('month', t.occurred_on::timestamp)
          = date_trunc('month', target_date::timestamp)
  ) then
    raise exception 'ALREADY_RECORDED' using hint = 'その月ぶんはもう入っています';
  end if;

  insert into public.transactions (
    family_id, occurred_on, amount, kind, category_id, member_id,
    note, recurring_id, created_by
  )
  values (
    v_row.family_id, target_date, v_amount, 'expense',
    v_row.category_id, v_row.member_id, v_row.name, target_recurring_id,
    public.my_member_id(v_row.family_id)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_recurring(uuid, date, integer) from public;
grant execute on function public.record_recurring(uuid, date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- その月に、どの固定費がもう入っているか
-- ---------------------------------------------------------------------------

-- 繰り返しの展開はアプリ側（src/lib/recurrence/）が行うので、
-- ここは「入っているか」だけを返す。展開の処理を2か所に持たないため。
create or replace function public.recorded_recurring(target_month date default null)
returns table (recurring_id uuid, occurred_on date, amount integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with m as (
    select date_trunc('month', coalesce(
      target_month, (now() at time zone 'Asia/Tokyo')::date
    ))::date as start
  )
  select t.recurring_id, t.occurred_on, t.amount
  from public.transactions t
  cross join m
  where t.recurring_id is not null
    and t.deleted_at is null
    and t.occurred_on >= m.start
    and t.occurred_on < (m.start + interval '1 month')::date;
$$;

revoke all on function public.recorded_recurring(date) from public;
grant execute on function public.recorded_recurring(date) to authenticated;
