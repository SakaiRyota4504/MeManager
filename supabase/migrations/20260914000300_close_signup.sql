-- アカウントの作成を家族の管理者が制御できるようにする。
--
-- それまでは誰でも /signup からアカウントを作れた。
-- 別の家族のデータは RLS で守られるが、知らない人がアカウントを持てること自体が
-- 望ましくないため、次の3層で塞ぐ。
--
--   1. Supabase Auth の公開サインアップを止める（supabase/config.toml）
--   2. アプリは招待を検証したうえで管理APIでユーザーを作る
--   3. このマイグレーション: DBのトリガーで最終的に拒否する
--
-- 3が最後の砦。1と2を迂回されても、招待の無いアカウントは家族を持てない。

-- ---------------------------------------------------------------------------
-- 招待にメールアドレスと取り消しを足す
-- ---------------------------------------------------------------------------

alter table public.invitations
  add column email text,
  add column revoked_at timestamptz;

comment on column public.invitations.email is
  '指定するとこのメールアドレスでしか使えない。リンクが転送されても他人は使えない';
comment on column public.invitations.revoked_at is
  '取り消した日時。使われる前に無効化できる';

-- 有効な招待の条件を1か所にまとめる。
create or replace function public.is_invitation_usable(
  inv public.invitations,
  signup_email text default null
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select inv.accepted_at is null
     and inv.revoked_at is null
     and inv.expires_at > now()
     and (
       inv.email is null
       or (signup_email is not null and lower(inv.email) = lower(signup_email))
     );
$$;

-- ---------------------------------------------------------------------------
-- サインアップの制限
-- ---------------------------------------------------------------------------

-- まだ家族が1つも無い状態か。最初の1人（オーナー）だけは招待なしで作れる。
create or replace function public.is_bootstrap()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.families);
$$;

revoke all on function public.is_bootstrap() from public;
grant execute on function public.is_bootstrap() to anon, authenticated;

-- サインアップ時のトリガーを差し替える。
-- 招待が無く、かつ最初の1人でもない場合は、ユーザーの作成ごと失敗させる。
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
    select * into v_invitation
    from public.invitations
    where token_hash = encode(sha256(v_token::bytea), 'hex');

    if not found or not public.is_invitation_usable(v_invitation, new.email) then
      raise exception 'INVITATION_INVALID'
        using hint = '招待が見つからないか、期限切れ・使用済み・宛先違いです';
    end if;

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

  -- 招待なしで作れるのは、まだ家族が1つも無いときだけ。
  if not public.is_bootstrap() then
    raise exception 'INVITATION_REQUIRED'
      using hint = 'アカウントの作成には招待が必要です';
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

-- ---------------------------------------------------------------------------
-- 招待の発行・下見・取り消し
-- ---------------------------------------------------------------------------

drop function if exists public.create_invitation(uuid, uuid, integer);

create or replace function public.create_invitation(
  target_family_id uuid,
  target_email text default null,
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

  target_email := nullif(trim(target_email), '');
  if target_email is not null and target_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'メールアドレスの形式が正しくありません';
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

  -- gen_random_uuid() 2つで 244bit 相当の乱数。拡張に依存しない。
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.invitations (
    family_id, token_hash, email, member_id, created_by, expires_at
  )
  values (
    target_family_id,
    encode(sha256(v_token::bytea), 'hex'),
    target_email,
    target_member_id,
    public.my_member_id(target_family_id),
    now() + make_interval(days => valid_days)
  );

  return v_token;
end;
$$;

revoke all on function public.create_invitation(uuid, text, uuid, integer) from public;
grant execute on function public.create_invitation(uuid, text, uuid, integer) to authenticated;

-- 招待リンクを開いた人に見せる情報。まだメンバーではないので RLS では読めない。
-- 戻り値の形が変わるため、作り直す。
drop function if exists public.peek_invitation(text);

create function public.peek_invitation(token text)
returns table (family_name text, is_valid boolean, requires_email boolean, email_hint text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.name,
    public.is_invitation_usable(i, i.email),
    i.email is not null,
    -- 宛先は伏せ字にして示す。誰宛てか分かりつつ、全部は漏らさない。
    case when i.email is null then null
         else left(i.email, 2) || '***@' || split_part(i.email, '@', 2)
    end
  from public.invitations i
  join public.families f on f.id = i.family_id
  where i.token_hash = encode(sha256(token::bytea), 'hex');
$$;

revoke all on function public.peek_invitation(text) from public;
grant execute on function public.peek_invitation(text) to anon, authenticated;

create or replace function public.revoke_invitation(invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
begin
  select family_id into v_family_id
  from public.invitations where id = invitation_id;

  if v_family_id is null or not public.is_family_admin(v_family_id) then
    raise exception '招待を取り消す権限がありません';
  end if;

  update public.invitations
  set revoked_at = now()
  where id = invitation_id and accepted_at is null and revoked_at is null;
end;
$$;

revoke all on function public.revoke_invitation(uuid) from public;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ログイン済みユーザーによる招待の受諾
-- ---------------------------------------------------------------------------

create or replace function public.accept_invitation(token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations%rowtype;
  v_user_id    uuid := (select auth.uid());
  v_email      text;
  v_name       text;
  v_member_id  uuid;
begin
  if v_user_id is null then
    raise exception 'ログインが必要です';
  end if;

  select u.email, coalesce(m.display_name, split_part(u.email, '@', 1))
  into v_email, v_name
  from auth.users u
  left join public.members m on m.user_id = u.id
  where u.id = v_user_id
  limit 1;

  select * into v_invitation
  from public.invitations
  where token_hash = encode(sha256(token::bytea), 'hex');

  if not found or not public.is_invitation_usable(v_invitation, v_email) then
    raise exception '招待が見つからないか、期限切れ・使用済み・宛先違いです';
  end if;

  if exists (
    select 1 from public.members m
    where m.family_id = v_invitation.family_id and m.user_id = v_user_id
  ) then
    raise exception 'すでにこの家族のメンバーです';
  end if;

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
