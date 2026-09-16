-- 招待の仕組みをやめ、管理者がメンバーを直接登録する形にする。
--
-- それまでは「管理者が招待リンクを発行 → 受け取った人がアカウントを作る」
-- という2者の手順だった。家族だけで使うアプリにはこれが重い。
--   * リンクの受け渡し・期限・取り消しという概念を覚える必要がある
--   * リンクが漏れると、こちらが用意していない枠にアカウントが増える
--
-- 新しい形:
--   管理者がメンバーを登録する。ログインさせたい相手には、
--   そのとき同時にメールアドレスとパスワードも決める。
--   **こちらが作ったレコード以外にアカウントは生まれない。**

-- ---------------------------------------------------------------------------
-- 招待まわりを落とす
-- ---------------------------------------------------------------------------

drop function if exists public.accept_invitation(text);
drop function if exists public.peek_invitation(text);
drop function if exists public.revoke_invitation(uuid);
drop function if exists public.create_invitation(uuid, text, uuid, integer);
drop function if exists public.is_invitation_usable(public.invitations, text);
drop table if exists public.invitations;

-- ---------------------------------------------------------------------------
-- アカウントを付けられるメンバーを用意する
-- ---------------------------------------------------------------------------

-- 管理者が呼ぶ。アカウントを紐付ける先のメンバーIDを返す。
--   target_member_id を渡す  → 既存のメンバー（アカウント未設定）に付ける
--   渡さない                 → 新しいメンバーを作って、そこに付ける
--
-- 実際のユーザー作成は Auth の管理APIでしか行えないので、
-- アプリはこの関数で「付けてよい相手か」を確かめてから createUser を呼ぶ。
create or replace function public.prepare_member_for_account(
  target_family_id uuid,
  name text default null,
  target_member_id uuid default null
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
    raise exception 'メンバーを登録する権限がありません';
  end if;

  if target_member_id is not null then
    select m.id into v_member_id
    from public.members m
    where m.id = target_member_id
      and m.family_id = target_family_id
      and m.user_id is null      -- すでにアカウントがある人には付け直せない
      and m.is_active;

    if v_member_id is null then
      raise exception 'このメンバーにはログインを設定できません';
    end if;

    if name is not null and trim(name) <> '' then
      update public.members set display_name = trim(name) where id = v_member_id;
    end if;

    return v_member_id;
  end if;

  name := nullif(trim(name), '');
  if name is null then
    raise exception '表示名を入力してください';
  end if;

  insert into public.members (family_id, user_id, display_name, color, role)
  values (target_family_id, null, name,
          public.pick_member_color(target_family_id), 'member')
  returning id into v_member_id;

  return v_member_id;
end;
$$;

revoke all on function public.prepare_member_for_account(uuid, text, uuid) from public;
grant execute on function public.prepare_member_for_account(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- サインアップ時の処理を差し替える
-- ---------------------------------------------------------------------------

-- アカウントが作られてよいのは次の2つだけ。
--   1. まだ家族が1つも無いとき（最初の1人。ここで家族が作られる）
--   2. 管理者が用意したメンバーに紐付けるとき（metadata の member_id）
-- それ以外はユーザーの作成ごと失敗させる。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_family_name  text;
  v_member_id    uuid;
  v_family_id    uuid;
begin
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    split_part(new.email, '@', 1)
  );

  v_member_id := nullif(trim(new.raw_user_meta_data ->> 'member_id'), '')::uuid;

  if v_member_id is not null then
    update public.members
    set user_id = new.id,
        display_name = v_display_name,
        is_active = true
    where id = v_member_id
      and user_id is null          -- 二重に紐付けない
      and is_active;

    if not found then
      raise exception 'MEMBER_NOT_AVAILABLE'
        using hint = '指定されたメンバーにはログインを設定できません';
    end if;

    return new;
  end if;

  if not public.is_bootstrap() then
    raise exception 'MEMBER_REQUIRED'
      using hint = 'アカウントは家族の管理者が登録します';
  end if;

  v_family_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'family_name'), ''),
    v_display_name || ' の家族'
  );

  insert into public.families (name)
  values (v_family_name)
  returning id into v_family_id;

  insert into public.members (family_id, user_id, display_name, color, role)
  values (v_family_id, new.id, v_display_name,
          public.pick_member_color(v_family_id), 'admin');

  insert into public.calendars (family_id, name, color, is_default)
  values (v_family_id, '家族共有', '#2563eb', true);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- メンバーを外す処理から、招待の取り消しを落とす
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
end;
$$;
