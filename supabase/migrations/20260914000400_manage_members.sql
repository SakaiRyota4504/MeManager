-- メンバーの増減を管理者が制御できるようにする。
--
-- 行は消さない。過去の予定の担当者として残す必要があるため、
-- 外すときは is_active を false にする。
-- my_family_ids() が is_active で絞っているので、false にした時点で
-- その人からはデータが一切見えなくなる。

-- ---------------------------------------------------------------------------
-- アカウントを持たないメンバーの追加
-- ---------------------------------------------------------------------------

-- 幼い子どもなど、ログインしない家族を担当者として登録するため（FR-A06）。
create or replace function public.add_offline_member(
  target_family_id uuid,
  name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
begin
  if not public.is_family_admin(target_family_id) then
    raise exception 'メンバーを追加する権限がありません';
  end if;

  name := nullif(trim(name), '');
  if name is null then
    raise exception '表示名を入力してください';
  end if;

  insert into public.members (family_id, user_id, display_name, color, role)
  values (
    target_family_id, null, name,
    public.pick_member_color(target_family_id), 'member'
  )
  returning id into v_member_id;

  return v_member_id;
end;
$$;

revoke all on function public.add_offline_member(uuid, text) from public;
grant execute on function public.add_offline_member(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- メンバーを外す / 戻す
-- ---------------------------------------------------------------------------

create or replace function public.deactivate_member(target_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
begin
  select * into v_member from public.members where id = target_member_id;

  if not found or not public.is_family_admin(v_member.family_id) then
    raise exception 'メンバーを外す権限がありません';
  end if;

  if v_member.user_id = (select auth.uid()) then
    raise exception '自分自身は外せません';
  end if;

  -- 管理者が0人になると、以後だれも操作できなくなる。
  if v_member.role = 'admin' and (
    select count(*) from public.members m
    where m.family_id = v_member.family_id and m.role = 'admin' and m.is_active
  ) <= 1 then
    raise exception '管理者が1人しかいないため外せません';
  end if;

  update public.members set is_active = false where id = target_member_id;

  -- 未使用の招待が残っていると、外した相手が入り直せてしまう。
  update public.invitations
  set revoked_at = now()
  where member_id = target_member_id and accepted_at is null and revoked_at is null;
end;
$$;

revoke all on function public.deactivate_member(uuid) from public;
grant execute on function public.deactivate_member(uuid) to authenticated;

create or replace function public.reactivate_member(target_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
begin
  select family_id into v_family_id from public.members where id = target_member_id;

  if v_family_id is null or not public.is_family_admin(v_family_id) then
    raise exception 'メンバーを戻す権限がありません';
  end if;

  update public.members set is_active = true where id = target_member_id;
end;
$$;

revoke all on function public.reactivate_member(uuid) from public;
grant execute on function public.reactivate_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 役割の変更
-- ---------------------------------------------------------------------------

create or replace function public.set_member_role(
  target_member_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
begin
  if new_role not in ('admin', 'member', 'viewer') then
    raise exception '役割の指定が正しくありません';
  end if;

  select * into v_member from public.members where id = target_member_id;

  if not found or not public.is_family_admin(v_member.family_id) then
    raise exception '役割を変更する権限がありません';
  end if;

  if v_member.role = 'admin' and new_role <> 'admin' and (
    select count(*) from public.members m
    where m.family_id = v_member.family_id and m.role = 'admin' and m.is_active
  ) <= 1 then
    raise exception '管理者が1人しかいないため変更できません';
  end if;

  update public.members set role = new_role where id = target_member_id;
end;
$$;

revoke all on function public.set_member_role(uuid, text) from public;
grant execute on function public.set_member_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 外したメンバーも一覧できるようにする
-- ---------------------------------------------------------------------------

-- my_family_ids() は is_active で絞るが、members の SELECT ポリシーは
-- 「自分の家族の行かどうか」だけを見ているので、外したメンバーも一覧に出る。
-- 画面側で is_active を見て「外したメンバー」として分けて表示する。

-- 非アクティブなメンバーに紐づく招待は、下見の段階で無効に見せる。
create or replace function public.is_invitation_usable(
  inv public.invitations,
  signup_email text default null
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select inv.accepted_at is null
     and inv.revoked_at is null
     and inv.expires_at > now()
     and (
       inv.email is null
       or (signup_email is not null and lower(inv.email) = lower(signup_email))
     )
     and (
       inv.member_id is null
       or exists (
         select 1 from public.members m
         where m.id = inv.member_id and m.is_active
       )
     );
$$;
