-- RLS（Row Level Security）。
--
-- 基本方針: 「その行の family_id が、要求者の所属する家族のいずれかであること」。
-- アプリ側のコードで絞り込みを忘れても、他の家族のデータは返らない。

-- ---------------------------------------------------------------------------
-- 判定用のヘルパー
-- ---------------------------------------------------------------------------

-- 要求者が所属する家族のID一覧。
--
-- security definer にしているのは、members のポリシーからこの関数を呼ぶため。
-- 呼び出し元の RLS を継承すると members → ポリシー → members の無限再帰になる。
create or replace function public.my_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.family_id
  from public.members m
  where m.user_id = (select auth.uid())
    and m.is_active;
$$;

comment on function public.my_family_ids is '要求者が所属する家族のID。RLSポリシーから呼ぶ';

-- 要求者が、その家族の管理者かどうか。
create or replace function public.is_family_admin(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.family_id = target_family_id
      and m.user_id = (select auth.uid())
      and m.is_active
      and m.role = 'admin'
  );
$$;

-- 要求者自身の、その家族でのメンバーID。
create or replace function public.my_member_id(target_family_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.family_id = target_family_id
    and m.user_id = (select auth.uid())
    and m.is_active
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- families
-- ---------------------------------------------------------------------------

alter table public.families enable row level security;

create policy families_select on public.families
  for select to authenticated
  using (id in (select public.my_family_ids()));

create policy families_update on public.families
  for update to authenticated
  using (public.is_family_admin(id))
  with check (public.is_family_admin(id));

-- 家族の作成はサインアップ時のトリガーだけが行う（security definer で RLS を迂回する）。
-- クライアントから直接作らせない。

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------

alter table public.members enable row level security;

create policy members_select on public.members
  for select to authenticated
  using (family_id in (select public.my_family_ids()));

create policy members_insert on public.members
  for insert to authenticated
  with check (public.is_family_admin(family_id));

-- 管理者は全員を、本人は自分の行だけを更新できる。
create policy members_update on public.members
  for update to authenticated
  using (
    public.is_family_admin(family_id)
    or user_id = (select auth.uid())
  )
  with check (
    public.is_family_admin(family_id)
    or user_id = (select auth.uid())
  );

-- 削除はしない。外すときは is_active を false にする（過去の予定の担当者を保つため）。

-- ---------------------------------------------------------------------------
-- calendars
-- ---------------------------------------------------------------------------

alter table public.calendars enable row level security;

create policy calendars_select on public.calendars
  for select to authenticated
  using (
    family_id in (select public.my_family_ids())
    and (
      visibility = 'family'
      or owner_member_id = public.my_member_id(family_id)
    )
  );

create policy calendars_insert on public.calendars
  for insert to authenticated
  with check (family_id in (select public.my_family_ids()));

create policy calendars_update on public.calendars
  for update to authenticated
  using (
    family_id in (select public.my_family_ids())
    and (
      visibility = 'family'
      or owner_member_id = public.my_member_id(family_id)
    )
  )
  with check (family_id in (select public.my_family_ids()));

create policy calendars_delete on public.calendars
  for delete to authenticated
  using (
    family_id in (select public.my_family_ids())
    and not is_default
    and (
      visibility = 'family'
      or owner_member_id = public.my_member_id(family_id)
    )
  );

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------

alter table public.invitations enable row level security;

-- token_hash が見えても平文は復元できないが、一覧できるのは管理者だけにしておく。
create policy invitations_select on public.invitations
  for select to authenticated
  using (public.is_family_admin(family_id));

create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (public.is_family_admin(family_id));

create policy invitations_delete on public.invitations
  for delete to authenticated
  using (public.is_family_admin(family_id));

-- 招待の受諾は accept_invitation() が security definer で行う。
-- 招待される側は、まだその家族のメンバーではないため RLS では通せない。

-- ---------------------------------------------------------------------------
-- テーブルへのアクセス権
-- ---------------------------------------------------------------------------
--
-- RLS は「どの行が見えるか」を決めるだけで、テーブルそのものを触れるかは
-- GRANT が決める。Supabase は public スキーマの新しいテーブルに対して
-- 既定で権限を配るが、何を許しているかが読めないため明示しておく。
--
-- anon（未ログイン）にはどのテーブルへの権限も与えない。
-- 招待リンクの下見だけは peek_invitation()（security definer）で行う。

grant select, update on public.families to authenticated;
grant select, insert, update on public.members to authenticated;
grant select, insert, update, delete on public.calendars to authenticated;
grant select, insert, delete on public.invitations to authenticated;

-- 行の削除は行わない方針なので、families と members に delete は与えない。
