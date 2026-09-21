-- 家計簿の土台。費目・記録・予算（docs/07-budget-requirements.md の 5章）。
--
-- 要点:
--   * 金額は integer（円）。支出も収入も**正の数**で持ち、向きは kind で表す。
--     符号で表すと、集計のたびに向きを思い出すことになる（7章 5節）。
--   * 支払方法は持たない。残高を追わないので何の計算にも使われない（3.2）。
--   * 家族の全員が全部の記録を見られる。秘密の支出という考え方は持ち込まない（3.4）。
--   * 書き込みはすべて関数を通す。テーブルへの insert / update は認められていない。
--     費目と記録と予算の整合（費目は同じ家族のものか、など）を1か所で守るため。

-- ---------------------------------------------------------------------------
-- 0. いまの家族。設定の保存（save_preference）と同じ決め方にそろえる
-- ---------------------------------------------------------------------------

create or replace function public.my_family_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.family_id
  from public.members m
  where m.user_id = (select auth.uid()) and m.is_active
  order by m.created_at
  limit 1;
$$;

comment on function public.my_family_id is
  '要求者の家族。複数に属する場合は最初に入った家族';

-- ---------------------------------------------------------------------------
-- 1. 費目
-- ---------------------------------------------------------------------------

create table if not exists public.budget_categories (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 20),
  kind        text not null default 'expense' check (kind in ('expense', 'income')),
  color       text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- 小さいほど先に出る。入力のとき、使う順に並べておけるようにする（FR-B12）
  sort_order  integer not null default 100,
  -- 使わなくなった費目は隠す。過去の記録は残るので行は消さない（FR-B13）
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.budget_categories is '家計簿の費目。階層は作らない（FR-B15）';

create unique index if not exists budget_categories_name_idx
  on public.budget_categories (family_id, kind, name);
create index if not exists budget_categories_family_idx
  on public.budget_categories (family_id, sort_order);

drop trigger if exists budget_categories_set_updated_at on public.budget_categories;
create trigger budget_categories_set_updated_at
  before update on public.budget_categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. 記録
-- ---------------------------------------------------------------------------

create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  -- RLS の判定で費目への結合を毎回起こさないよう、冗長に持つ
  family_id    uuid not null references public.families (id) on delete cascade,
  occurred_on  date not null,
  -- 円。1円未満は扱わない（3.3）。1億円で頭を打つのは、桁の打ち間違いを止めるため
  amount       integer not null check (amount > 0 and amount <= 100000000),
  kind         text not null check (kind in ('expense', 'income')),
  -- 費目は消せない（隠すだけ）ので、記録から参照が外れることはない
  category_id  uuid not null references public.budget_categories (id) on delete restrict,
  -- 使った人。抜けた人の行は残すため、参照が切れたら null にする
  member_id    uuid references public.members (id) on delete set null,
  note         text check (char_length(note) <= 200),
  created_by   uuid references public.members (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on table public.transactions is '家計簿の記録1件';
comment on column public.transactions.amount is '円。支出も収入も正の数。向きは kind で表す';

create index if not exists transactions_family_date_idx
  on public.transactions (family_id, occurred_on desc) where deleted_at is null;
create index if not exists transactions_category_idx
  on public.transactions (category_id, occurred_on) where deleted_at is null;

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. 予算
-- ---------------------------------------------------------------------------

create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  -- その月の1日。月の区切りは1日〜末日（3.5）
  month       date not null check (extract(day from month) = 1),
  -- null なら「全体の予算」（FR-B34）
  category_id uuid references public.budget_categories (id) on delete cascade,
  amount      integer not null check (amount >= 0 and amount <= 1000000000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.budgets is '費目ごとの月の予算。繰り越しは作らない（FR-B35）';

-- null を含む列は unique 制約では重複を防げないので、2つに分ける
create unique index if not exists budgets_category_idx
  on public.budgets (family_id, month, category_id) where category_id is not null;
create unique index if not exists budgets_total_idx
  on public.budgets (family_id, month) where category_id is null;

drop trigger if exists budgets_set_updated_at on public.budgets;
create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. 最初から入っている費目（FR-B10）
-- ---------------------------------------------------------------------------

-- 色は名前の隣に点として出すので、色だけで見分けさせることはない。
-- そのうえで、上位12色は互いに見分けのつく色相を割り当て、
-- 残り（めったに使わないもの）は灰にしている。
-- **注意・超過の色（黄・赤）は費目に使わない。**状態の色は取っておく（4.4）。
create or replace function public.seed_budget_categories(target_family_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.budget_categories (family_id, name, kind, color, sort_order)
  select target_family_id, d.name, d.kind, d.color, d.ord
  from (values
    ('食費',   'expense', '#2563eb',  10),
    ('日用品', 'expense', '#0891b2',  20),
    ('外食',   'expense', '#ea580c',  30),
    ('交通',   'expense', '#16a34a',  40),
    ('光熱費', 'expense', '#7c3aed',  50),
    ('通信',   'expense', '#db2777',  60),
    ('住居',   'expense', '#0f766e',  70),
    ('医療',   'expense', '#4f46e5',  80),
    ('教育',   'expense', '#c026d3',  90),
    ('被服',   'expense', '#65a30d', 100),
    ('交際',   'expense', '#0284c7', 110),
    ('趣味',   'expense', '#475569', 120),
    ('車',     'expense', '#57534e', 130),
    ('保険',   'expense', '#78716c', 140),
    ('その他', 'expense', '#71717a', 150),
    ('給与',   'income',  '#059669',  10),
    ('賞与',   'income',  '#0d9488',  20),
    ('その他', 'income',  '#52525b',  30)
  ) as d(name, kind, color, ord)
  on conflict do nothing;
$$;

-- 家族ができたら費目を用意する。
-- サインアップの処理（handle_new_user）に書き足さないのは、
-- 家計簿の都合でアカウント作成の処理を触りたくないため。
create or replace function public.seed_budget_categories_on_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_budget_categories(new.id);
  return new;
end;
$$;

drop trigger if exists families_seed_budget_categories on public.families;
create trigger families_seed_budget_categories
  after insert on public.families
  for each row execute function public.seed_budget_categories_on_family();

-- すでにある家族にも入れておく
do $$
declare
  v_family_id uuid;
begin
  for v_family_id in select id from public.families loop
    perform public.seed_budget_categories(v_family_id);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS。読むのは家族の全員、書くのは関数からだけ
-- ---------------------------------------------------------------------------

alter table public.budget_categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

drop policy if exists budget_categories_select on public.budget_categories;
create policy budget_categories_select on public.budget_categories
  for select to authenticated
  using (family_id in (select public.my_family_ids()));

drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions
  for select to authenticated
  using (
    deleted_at is null
    and family_id in (select public.my_family_ids())
  );

drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets
  for select to authenticated
  using (family_id in (select public.my_family_ids()));

-- insert / update / delete は与えない。書き込みは下の関数を通す。
grant select on public.budget_categories to authenticated;
grant select on public.transactions to authenticated;
grant select on public.budgets to authenticated;

-- ---------------------------------------------------------------------------
-- 6. 費目の追加と変更
-- ---------------------------------------------------------------------------

create or replace function public.create_budget_category(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid := public.my_family_id();
  v_name      text := nullif(trim(payload ->> 'name'), '');
  v_kind      text := coalesce(nullif(payload ->> 'kind', ''), 'expense');
  v_color     text := coalesce(nullif(payload ->> 'color', ''), '#71717a');
  v_id        uuid;
begin
  if v_family_id is null then
    raise exception 'MEMBER_REQUIRED' using hint = 'メンバーが見つかりません';
  end if;
  if v_name is null then
    raise exception 'INVALID_CATEGORY' using hint = '費目の名前を入れてください';
  end if;
  if v_kind not in ('expense', 'income') then
    raise exception 'INVALID_CATEGORY' using hint = '費目の種類が正しくありません';
  end if;

  if exists (
    select 1 from public.budget_categories c
    where c.family_id = v_family_id and c.kind = v_kind and c.name = v_name
  ) then
    raise exception 'DUPLICATE_CATEGORY' using hint = '同じ名前の費目があります';
  end if;

  insert into public.budget_categories (family_id, name, kind, color, sort_order)
  values (
    v_family_id, v_name, v_kind, v_color,
    coalesce(
      (payload ->> 'sort_order')::integer,
      (select coalesce(max(c.sort_order), 0) + 10
       from public.budget_categories c
       where c.family_id = v_family_id and c.kind = v_kind)
    )
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_budget_category(jsonb) from public;
grant execute on function public.create_budget_category(jsonb) to authenticated;

-- 変えられるのは見た目と並びと、使うかどうか。
-- 種類（支出・収入）は変えられない。過去の記録の向きが変わってしまうため。
create or replace function public.update_budget_category(
  target_category_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.budget_categories%rowtype;
  v_name     text;
begin
  select * into v_category from public.budget_categories
  where id = target_category_id;

  if not found or v_category.family_id not in (select public.my_family_ids()) then
    raise exception 'CATEGORY_NOT_FOUND' using hint = 'その費目は編集できません';
  end if;

  v_name := coalesce(nullif(trim(coalesce(payload ->> 'name', '')), ''), v_category.name);

  if v_name <> v_category.name and exists (
    select 1 from public.budget_categories c
    where c.family_id = v_category.family_id
      and c.kind = v_category.kind
      and c.name = v_name
  ) then
    raise exception 'DUPLICATE_CATEGORY' using hint = '同じ名前の費目があります';
  end if;

  update public.budget_categories set
    name       = v_name,
    color      = coalesce(nullif(payload ->> 'color', ''), color),
    sort_order = coalesce((payload ->> 'sort_order')::integer, sort_order),
    is_active  = coalesce((payload ->> 'is_active')::boolean, is_active)
  where id = target_category_id;
end;
$$;

revoke all on function public.update_budget_category(uuid, jsonb) from public;
grant execute on function public.update_budget_category(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. 記録の作成・更新・削除
-- ---------------------------------------------------------------------------

create or replace function public.create_transaction(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category    public.budget_categories%rowtype;
  v_category_id uuid := (payload ->> 'category_id')::uuid;
  v_amount      integer;
  v_member_id   uuid := nullif(payload ->> 'member_id', '')::uuid;
  v_occurred_on date;
  v_id          uuid;
begin
  select * into v_category from public.budget_categories where id = v_category_id;

  if not found
     or v_category.family_id not in (select public.my_family_ids()) then
    raise exception 'CATEGORY_NOT_FOUND' using hint = '費目を選んでください';
  end if;

  v_amount := (payload ->> 'amount')::integer;
  if v_amount is null or v_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using hint = '金額を入れてください';
  end if;

  v_occurred_on := coalesce(
    (payload ->> 'occurred_on')::date,
    (now() at time zone 'Asia/Tokyo')::date
  );

  -- 使った人は、同じ家族の在籍メンバーだけ
  if v_member_id is not null and not exists (
    select 1 from public.members m
    where m.id = v_member_id and m.family_id = v_category.family_id and m.is_active
  ) then
    raise exception 'INVALID_MEMBER' using hint = 'その人は選べません';
  end if;

  insert into public.transactions (
    family_id, occurred_on, amount, kind, category_id, member_id, note, created_by
  )
  values (
    v_category.family_id, v_occurred_on, v_amount,
    -- 向きは費目が決める。収入の費目を選んだら収入（FR-B02）
    v_category.kind, v_category_id, v_member_id,
    nullif(trim(coalesce(payload ->> 'note', '')), ''),
    public.my_member_id(v_category.family_id)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_transaction(jsonb) from public;
grant execute on function public.create_transaction(jsonb) to authenticated;

create or replace function public.update_transaction(
  target_transaction_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx          public.transactions%rowtype;
  v_category    public.budget_categories%rowtype;
  v_category_id uuid;
  v_amount      integer;
  v_member_id   uuid;
begin
  select * into v_tx from public.transactions
  where id = target_transaction_id and deleted_at is null;

  if not found or v_tx.family_id not in (select public.my_family_ids()) then
    raise exception 'TRANSACTION_NOT_FOUND' using hint = 'その記録は編集できません';
  end if;

  v_category_id := coalesce((payload ->> 'category_id')::uuid, v_tx.category_id);

  select * into v_category from public.budget_categories where id = v_category_id;
  if not found or v_category.family_id <> v_tx.family_id then
    raise exception 'CATEGORY_NOT_FOUND' using hint = 'その費目は選べません';
  end if;

  v_amount := coalesce((payload ->> 'amount')::integer, v_tx.amount);
  if v_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using hint = '金額を入れてください';
  end if;

  v_member_id := case when payload ? 'member_id'
                      then nullif(payload ->> 'member_id', '')::uuid
                      else v_tx.member_id end;

  if v_member_id is not null and not exists (
    select 1 from public.members m
    where m.id = v_member_id and m.family_id = v_tx.family_id and m.is_active
  ) then
    raise exception 'INVALID_MEMBER' using hint = 'その人は選べません';
  end if;

  update public.transactions set
    occurred_on = coalesce((payload ->> 'occurred_on')::date, occurred_on),
    amount      = v_amount,
    category_id = v_category_id,
    kind        = v_category.kind,
    member_id   = v_member_id,
    note        = case when payload ? 'note'
                       then nullif(trim(coalesce(payload ->> 'note', '')), '')
                       else note end
  where id = target_transaction_id;
end;
$$;

revoke all on function public.update_transaction(uuid, jsonb) from public;
grant execute on function public.update_transaction(uuid, jsonb) to authenticated;

-- 消すときは印を付けるだけ。30日は戻せる（FR-B05）
create or replace function public.delete_transaction(target_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
begin
  select * into v_tx from public.transactions
  where id = target_transaction_id and deleted_at is null;

  if not found or v_tx.family_id not in (select public.my_family_ids()) then
    raise exception 'TRANSACTION_NOT_FOUND' using hint = 'その記録は削除できません';
  end if;

  update public.transactions set deleted_at = now()
  where id = target_transaction_id;
end;
$$;

revoke all on function public.delete_transaction(uuid) from public;
grant execute on function public.delete_transaction(uuid) to authenticated;

create or replace function public.restore_transaction(target_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
begin
  select * into v_tx from public.transactions
  where id = target_transaction_id and deleted_at is not null;

  if not found or v_tx.family_id not in (select public.my_family_ids()) then
    raise exception 'TRANSACTION_NOT_FOUND' using hint = 'その記録は戻せません';
  end if;

  if v_tx.deleted_at < now() - interval '30 days' then
    raise exception 'TOO_OLD' using hint = '削除から30日を過ぎた記録は戻せません';
  end if;

  update public.transactions set deleted_at = null
  where id = target_transaction_id;
end;
$$;

revoke all on function public.restore_transaction(uuid) from public;
grant execute on function public.restore_transaction(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. 予算を決める
-- ---------------------------------------------------------------------------

-- 0 を入れたら行ごと消す。「予算 0円」と「予算を決めていない」は別物で、
-- 前者を残すと、決めていない費目まで常に超過に見える。
create or replace function public.set_budget(
  target_category_id uuid,
  target_month date,
  new_amount integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
  v_month     date;
begin
  if target_category_id is null then
    v_family_id := public.my_family_id();
  else
    select c.family_id into v_family_id
    from public.budget_categories c where c.id = target_category_id;
  end if;

  if v_family_id is null
     or v_family_id not in (select public.my_family_ids()) then
    raise exception 'CATEGORY_NOT_FOUND' using hint = 'その費目には予算を決められません';
  end if;

  v_month := date_trunc('month', coalesce(
    target_month, (now() at time zone 'Asia/Tokyo')::date
  ))::date;

  if new_amount is null or new_amount <= 0 then
    delete from public.budgets
    where family_id = v_family_id
      and month = v_month
      and category_id is not distinct from target_category_id;
    return;
  end if;

  insert into public.budgets (family_id, month, category_id, amount)
  values (v_family_id, v_month, target_category_id, new_amount)
  on conflict do nothing;

  update public.budgets set amount = new_amount
  where family_id = v_family_id
    and month = v_month
    and category_id is not distinct from target_category_id;
end;
$$;

revoke all on function public.set_budget(uuid, date, integer) from public;
grant execute on function public.set_budget(uuid, date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. 費目ごとの「今月の残り」（FR-B31 / FR-B31b）
-- ---------------------------------------------------------------------------

-- 入力画面はこれ1本で足りる。費目・予算・使った額を別々に引いて
-- アプリ側で突き合わせると、月の境目の扱いが2か所に散る。
--
-- security invoker のまま置いてあるので、見えるのは自分の家族のぶんだけ（RLS）。
create or replace function public.budget_status(target_month date default null)
returns table (
  category_id uuid,
  name        text,
  kind        text,
  color       text,
  sort_order  integer,
  is_active   boolean,
  budget      integer,
  used        integer,
  uses        integer
)
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
  select
    c.id, c.name, c.kind, c.color, c.sort_order, c.is_active,
    b.amount,
    coalesce(u.used, 0)::integer,
    coalesce(r.uses, 0)::integer
  from public.budget_categories c
  cross join m
  left join public.budgets b
    on b.category_id = c.id and b.month = m.start
  left join lateral (
    select sum(t.amount) as used
    from public.transactions t
    where t.category_id = c.id
      and t.deleted_at is null
      and t.occurred_on >= m.start
      and t.occurred_on < (m.start + interval '1 month')::date
  ) u on true
  -- よく使う順に並べるための、直近90日の件数（FR-B03）
  left join lateral (
    select count(*) as uses
    from public.transactions t
    where t.category_id = c.id
      and t.deleted_at is null
      and t.occurred_on >= (now() at time zone 'Asia/Tokyo')::date - 90
  ) r on true
  order by c.kind, c.sort_order, c.name;
$$;

revoke all on function public.budget_status(date) from public;
grant execute on function public.budget_status(date) to authenticated;
