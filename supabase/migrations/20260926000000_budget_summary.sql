-- 集計と予算（B2）。docs/07-budget-requirements.md の 4.4 と 4.5。
--
-- ここで足すのは3つ:
--   1. 人の色の並びを、確かめた並びに直す（20260925 の続き）
--   2. 予算は「指定が無ければ前の月と同じ」にする（FR-B33）
--   3. 12か月の推移を1回で引けるようにする（FR-B44）

-- ---------------------------------------------------------------------------
-- 1. 人の色の並び
-- ---------------------------------------------------------------------------

-- 20260925 で入れた並びは、隣り合う色が見分けられない組み合わせだった
-- （#0284c7 と #0891b2、#4f46e5 と #7c3aed が、ほとんど同じ色に見える）。
-- 目で選ばず、見分けられるかを計算で確かめて並べ直したものがこれ。
-- src/lib/colors.ts の HUES と同じ並びで、あちらに検証の結果が書いてある。
--
-- 先頭から配るので、4人までの家族は確実に見分けられる色になる。
create or replace function public.pick_member_color(target_family_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select c
      from unnest(array[
        '#2563eb', '#0891b2', '#65a30d', '#db2777', '#4f46e5',
        '#ea580c', '#c026d3', '#16a34a', '#0284c7', '#7c3aed'
      ]) with ordinality as t(c, ord)
      where c not in (
        select m.color from public.members m where m.family_id = target_family_id
      )
      order by t.ord
      limit 1
    ),
    '#2563eb'
  );
$$;

comment on function public.pick_member_color is
  'その家族でまだ使われていない色。src/lib/colors.ts の HUES と同じ並び';

-- 20260925 で配ったばかりの、見分けのつかない色を配り直す。
-- 自分で選んだ色は動かしたくないので、**新しい並びに無い色だけ**を対象にする。
do $$
declare
  v_member record;
begin
  for v_member in
    select m.id, m.family_id
    from public.members m
    where m.color not in (
      '#2563eb', '#0891b2', '#65a30d', '#db2777', '#4f46e5',
      '#ea580c', '#c026d3', '#16a34a', '#0284c7', '#7c3aed'
    )
    order by m.family_id, m.created_at, m.id
  loop
    update public.members
    set color = public.pick_member_color(v_member.family_id)
    where id = v_member.id;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. 予算は、指定が無ければ前の月と同じ（FR-B33）
-- ---------------------------------------------------------------------------

-- 毎月おなじ額を入れ直させない。その月に決めた額が無ければ、
-- **それ以前でいちばん新しい月の額**を使う。
--
-- 行を月ごとに複製しないのは、あとから「4月の予算を直す」としたときに
-- 5月以降にコピーされた行が取り残されるため。引くときに遡るほうが、
-- 「決めたのは1回だけ」という形が保てる。
create or replace function public.effective_budget(
  target_category_id uuid,
  target_month date
)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select b.amount
  from public.budgets b
  where b.category_id is not distinct from target_category_id
    and b.month <= target_month
  order by b.month desc
  limit 1;
$$;

comment on function public.effective_budget is
  'その月に効いている予算。決めていなければ、それ以前の最後に決めた額';

revoke all on function public.effective_budget(uuid, date) from public;
grant execute on function public.effective_budget(uuid, date) to authenticated;

-- budget_status を、遡って引く形に置き換える。
-- 返す列は変わらないので、入力画面はそのまま動く。
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
    public.effective_budget(c.id, m.start),
    coalesce(u.used, 0)::integer,
    coalesce(r.uses, 0)::integer
  from public.budget_categories c
  cross join m
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

-- 費目を決めない「全体の予算」（FR-B34）。
-- 費目ごとの合計とは別に持つ。費目の予算を足し合わせた額と、
-- 「ひと月にいくらまで」は別の決めごとなので、一致させない。
create or replace function public.total_budget(target_month date default null)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select public.effective_budget(null, date_trunc('month', coalesce(
    target_month, (now() at time zone 'Asia/Tokyo')::date
  ))::date);
$$;

revoke all on function public.total_budget(date) from public;
grant execute on function public.total_budget(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 月ごとの推移（FR-B44）
-- ---------------------------------------------------------------------------

-- 12か月ぶんの記録をアプリに送って足し合わせると、2,000件が行き来する。
-- 月ごとの合計だけを返す。
create or replace function public.budget_trend(
  target_month date default null,
  months integer default 12
)
returns table (
  month   date,
  expense integer,
  income  integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with m as (
    select
      date_trunc('month', coalesce(
        target_month, (now() at time zone 'Asia/Tokyo')::date
      ))::date as last_month,
      least(greatest(coalesce(months, 12), 1), 36) as span
  ),
  span as (
    select generate_series(
      (m.last_month - ((m.span - 1) || ' months')::interval)::date,
      m.last_month,
      interval '1 month'
    )::date as month
    from m
  )
  select
    s.month,
    coalesce(sum(t.amount) filter (where t.kind = 'expense'), 0)::integer,
    coalesce(sum(t.amount) filter (where t.kind = 'income'), 0)::integer
  from span s
  left join public.transactions t
    on t.deleted_at is null
   and t.occurred_on >= s.month
   and t.occurred_on < (s.month + interval '1 month')::date
  group by s.month
  order by s.month;
$$;

revoke all on function public.budget_trend(date, integer) from public;
grant execute on function public.budget_trend(date, integer) to authenticated;
