-- サインアップと招待の受諾。
--
-- どちらも複数テーブルにまたがるため、アプリ側で手順を分けず
-- データベース側で1トランザクションにまとめる。
-- 途中で失敗して「家族はあるがメンバーがいない」状態を作らないため。

-- ---------------------------------------------------------------------------
-- メンバーの色
-- ---------------------------------------------------------------------------

-- 家族の中で色が重ならないよう、まだ使われていない色を順に割り当てる。
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
        '#2563eb', '#db2777', '#16a34a', '#ea580c',
        '#7c3aed', '#0891b2', '#ca8a04', '#dc2626'
      ]) as c
      where c not in (
        select m.color from public.members m where m.family_id = target_family_id
      )
      limit 1
    ),
    '#2563eb'
  );
$$;

-- ---------------------------------------------------------------------------
-- サインアップ
-- ---------------------------------------------------------------------------

-- auth.users に行が入ったときに、家族・メンバー・既定カレンダーを作る。
--
-- 招待リンク経由の場合は新しい家族を作らず、招待元の家族に参加させる。
-- サインアップ時のメタデータでどちらかを判断する。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name  text;
  v_family_name   text;
  v_token         text;
  v_token_hash    text;
  v_invitation    public.invitations%rowtype;
  v_family_id     uuid;
  v_member_id     uuid;
begin
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    split_part(new.email, '@', 1)
  );
  v_token := nullif(trim(new.raw_user_meta_data ->> 'invitation_token'), '');

  if v_token is not null then
    v_token_hash := encode(sha256(v_token::bytea), 'hex');

    select * into v_invitation
    from public.invitations
    where token_hash = v_token_hash
      and accepted_at is null
      and expires_at > now();

    if found then
      -- 招待に紐づくメンバーが用意されていればそれを使い、無ければ作る。
      if v_invitation.member_id is not null then
        update public.members
        set user_id = new.id,
            display_name = v_display_name,
            is_active = true
        where id = v_invitation.member_id
        returning id into v_member_id;
      end if;

      if v_member_id is null then
        insert into public.members (family_id, user_id, display_name, color, role)
        values (
          v_invitation.family_id,
          new.id,
          v_display_name,
          public.pick_member_color(v_invitation.family_id),
          'member'
        )
        returning id into v_member_id;
      end if;

      update public.invitations
      set accepted_at = now()
      where id = v_invitation.id;

      return new;
    end if;

    -- 招待が無効（期限切れ・使用済み・存在しない）なら、
    -- サインアップ自体は成功させ、自分の家族を作る側にまわす。
  end if;

  v_family_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'family_name'), ''),
    v_display_name || ' の家族'
  );

  insert into public.families (name)
  values (v_family_name)
  returning id into v_family_id;

  insert into public.members (family_id, user_id, display_name, color, role)
  values (v_family_id, new.id, v_display_name, public.pick_member_color(v_family_id), 'admin')
  returning id into v_member_id;

  insert into public.calendars (family_id, name, color, is_default)
  values (v_family_id, '家族共有', '#2563eb', true);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 招待の発行
-- ---------------------------------------------------------------------------

-- 招待を作り、平文のトークンを返す。平文はここでしか手に入らない。
create or replace function public.create_invitation(
  target_family_id uuid,
  target_member_id uuid default null,
  valid_days integer default 7
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.is_family_admin(target_family_id) then
    raise exception '招待を発行する権限がありません';
  end if;

  if valid_days < 1 or valid_days > 30 then
    raise exception '有効期限は1日以上30日以内で指定してください';
  end if;

  if target_member_id is not null then
    if not exists (
      select 1 from public.members m
      where m.id = target_member_id
        and m.family_id = target_family_id
        and m.user_id is null
    ) then
      raise exception '指定されたメンバーに招待を紐付けられません';
    end if;
  end if;

  -- 128bit 以上の乱数（NFR-S06）。
  -- gen_random_uuid() は PostgreSQL 本体の機能なので拡張に依存しない。
  -- v4 UUID 2つで 244bit 相当の乱数になる。
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.invitations (
    family_id, token_hash, member_id, created_by, expires_at
  )
  values (
    target_family_id,
    encode(sha256(v_token::bytea), 'hex'),
    target_member_id,
    public.my_member_id(target_family_id),
    now() + make_interval(days => valid_days)
  );

  return v_token;
end;
$$;

revoke all on function public.create_invitation(uuid, uuid, integer) from public;
grant execute on function public.create_invitation(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 招待の下見
-- ---------------------------------------------------------------------------

-- 招待リンクを開いたときに「どの家族への招待か」を表示するための関数。
-- まだその家族のメンバーではないので、RLS では読めない。
create or replace function public.peek_invitation(token text)
returns table (family_name text, is_valid boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select f.name, (i.accepted_at is null and i.expires_at > now())
  from public.invitations i
  join public.families f on f.id = i.family_id
  where i.token_hash = encode(sha256(token::bytea), 'hex');
$$;

revoke all on function public.peek_invitation(text) from public;
grant execute on function public.peek_invitation(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ログイン済みユーザーによる招待の受諾
-- ---------------------------------------------------------------------------

-- すでにアカウントを持っている人が、別の家族の招待を受ける場合。
create or replace function public.accept_invitation(token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations%rowtype;
  v_user_id    uuid := (select auth.uid());
  v_name       text;
  v_member_id  uuid;
begin
  if v_user_id is null then
    raise exception 'ログインが必要です';
  end if;

  select * into v_invitation
  from public.invitations
  where token_hash = encode(sha256(token::bytea), 'hex')
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception '招待が見つからないか、期限が切れています';
  end if;

  if exists (
    select 1 from public.members m
    where m.family_id = v_invitation.family_id and m.user_id = v_user_id
  ) then
    raise exception 'すでにこの家族のメンバーです';
  end if;

  select coalesce(m.display_name, split_part(u.email, '@', 1))
  into v_name
  from auth.users u
  left join public.members m on m.user_id = u.id
  where u.id = v_user_id
  limit 1;

  if v_invitation.member_id is not null then
    update public.members
    set user_id = v_user_id, is_active = true
    where id = v_invitation.member_id
    returning id into v_member_id;
  end if;

  if v_member_id is null then
    insert into public.members (family_id, user_id, display_name, color, role)
    values (
      v_invitation.family_id,
      v_user_id,
      v_name,
      public.pick_member_color(v_invitation.family_id),
      'member'
    )
    returning id into v_member_id;
  end if;

  update public.invitations set accepted_at = now() where id = v_invitation.id;

  return v_invitation.family_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
