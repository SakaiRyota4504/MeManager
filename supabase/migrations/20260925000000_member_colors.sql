-- メンバーの色を、人ごとに違うものにする。
--
-- 予定の色は「最初の担当者の色」で決まる（src/lib/calendar/model.ts）。
-- そのため全員が同じ色だと、カレンダーが一色になって誰の予定か分からない。
--
-- これまで、色は列の既定値（'#2563eb'）に頼っていた。
-- アプリからメンバーを足したときは pick_member_color() が別の色を選ぶが、
-- **Supabase の Table Editor から直接追加すると既定値のまま入る。**
-- 管理者も既定値の青なので、追加した人が全員その青になっていた。
--
-- 直し方は2つ:
--   1. 既定値をやめ、色を入れずに追加したらトリガーで選ぶ。
--      どこから追加しても、空いている色が入るようになる。
--   2. すでに重なっている色を振り直す。

-- ---------------------------------------------------------------------------
-- 1. 自動で選ぶ色を、アプリの見本（src/lib/colors.ts の HUES）にそろえる
-- ---------------------------------------------------------------------------

-- 赤と黄は入れない。「超過」「残りわずか」を表す色として取ってあり、
-- 意味のある色として使い回さない（docs/07-budget-requirements.md 4.4）。
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
        '#2563eb', '#0284c7', '#0891b2', '#0f766e',
        '#16a34a', '#65a30d', '#ea580c', '#db2777',
        '#c026d3', '#7c3aed', '#4f46e5', '#475569'
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

-- ---------------------------------------------------------------------------
-- 2. 色を入れずに追加したら、空いている色を選ぶ
-- ---------------------------------------------------------------------------

-- 既定値を外すのが肝。既定値があると、列を省いた insert は '#2563eb' で
-- 埋まってしまい、「指定しなかった」ことがトリガーから分からない。
alter table public.members alter column color drop default;

create or replace function public.set_member_color()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Table Editor から空欄のまま保存すると、null ではなく空文字で来ることがある
  if new.color is null or btrim(new.color) = '' then
    new.color := public.pick_member_color(new.family_id);
  end if;
  return new;
end;
$$;

-- 列の not null と check より先に動く（BEFORE トリガーはそういう順）ので、
-- 色を入れない insert でも弾かれない。
drop trigger if exists members_set_color on public.members;
create trigger members_set_color
  before insert on public.members
  for each row execute function public.set_member_color();

-- ---------------------------------------------------------------------------
-- 3. すでに重なっている色を振り直す
-- ---------------------------------------------------------------------------

-- 先にいた人の色は変えない。あとから入った人だけを動かす。
-- 自分で色を決め直したあとに、これがもう一度流れても困らないよう、
-- 「重なっているものだけ」を対象にしている。
do $$
declare
  v_member record;
begin
  for v_member in
    select m.id, m.family_id
    from public.members m
    where exists (
      select 1 from public.members o
      where o.family_id = m.family_id
        and o.color = m.color
        and (o.created_at, o.id) < (m.created_at, m.id)
    )
    order by m.family_id, m.created_at, m.id
  loop
    update public.members
    set color = public.pick_member_color(v_member.family_id)
    where id = v_member.id;
  end loop;
end
$$;
