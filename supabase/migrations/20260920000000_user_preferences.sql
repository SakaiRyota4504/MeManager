-- 画面の使い方の好み（絞り込みなど）を、人ごとに覚えておく。
--
-- 「自分の予定のみ」にしたまま閉じたら、次に開いたときもそのままにする。
-- 別の端末で開いても同じになるよう、ブラウザではなくDBに置く。
--
-- 中身を jsonb 1列にしているのは、画面の設定が増えるたびに
-- マイグレーションを足したくないため。家計簿や献立の絞り込みも、
-- ここに別の名前で入る。**家族で共有するデータはここに入れない。**
-- あくまで「その人の画面の状態」だけを置く。

create table if not exists public.user_preferences (
  member_id  uuid primary key references public.members(id) on delete cascade,
  family_id  uuid not null references public.families(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.user_preferences.prefs is
  '画面の状態。キーは "schedule.members" のように機能名で始める';

drop trigger if exists set_updated_at on public.user_preferences;
create trigger set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 自分の行だけ
-- ---------------------------------------------------------------------------

alter table public.user_preferences enable row level security;

-- 途中で失敗しても流し直せるよう、作り直せる形で書く。

drop policy if exists user_preferences_select on public.user_preferences;
create policy user_preferences_select on public.user_preferences
  for select to authenticated
  using (member_id = public.my_member_id(family_id));

drop policy if exists user_preferences_insert on public.user_preferences;
create policy user_preferences_insert on public.user_preferences
  for insert to authenticated
  with check (member_id = public.my_member_id(family_id));

drop policy if exists user_preferences_update on public.user_preferences;
create policy user_preferences_update on public.user_preferences
  for update to authenticated
  using (member_id = public.my_member_id(family_id))
  with check (member_id = public.my_member_id(family_id));

drop policy if exists user_preferences_delete on public.user_preferences;
create policy user_preferences_delete on public.user_preferences
  for delete to authenticated
  using (member_id = public.my_member_id(family_id));

grant select, insert, update, delete on public.user_preferences to authenticated;

-- ---------------------------------------------------------------------------
-- 書き込みは1つずつ
-- ---------------------------------------------------------------------------

-- 1つのキーだけを差し替える。他のキーには触らない。
-- 行ごと上書きさせると、別の画面の設定を巻き添えで消してしまう。
create or replace function public.save_preference(key text, value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
begin
  select * into v_member
  from public.members
  where user_id = (select auth.uid()) and is_active
  order by created_at
  limit 1;

  if not found then
    raise exception 'メンバーが見つかりません';
  end if;

  key := nullif(trim(key), '');
  if key is null or key !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' then
    raise exception '設定の名前が正しくありません';
  end if;

  insert into public.user_preferences (member_id, family_id, prefs)
  values (v_member.id, v_member.family_id, jsonb_build_object(key, value))
  on conflict (member_id) do update
    set prefs = user_preferences.prefs || jsonb_build_object(key, value);
end;
$$;

revoke all on function public.save_preference(text, jsonb) from public;
grant execute on function public.save_preference(text, jsonb) to authenticated;
