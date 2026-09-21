-- サインアップ画面をやめ、アカウントの作成口を「管理者の手元」だけにする。
--
-- それまでの入口は2つあった。
--   1. /signup の画面（最初の1人だけ。家族ができた後は閉じる）
--   2. アプリのメンバー画面（管理者がメールアドレスとパスワードを決める）
--
-- 1を無くす。ログイン画面からアカウントは作れない。
-- そのぶん、**Supabase の管理画面から直接ユーザーを作っても使える**ようにする。
--
-- 新しい入口:
--   a. まだ家族が無いとき   … Supabase で作った1人目が管理者になる（従来どおり）
--   b. メンバー画面から     … metadata の member_id で紐付く（従来どおり）
--   c. Supabase の管理画面から … **先に登録しておいたメールアドレス**と一致した
--                              メンバーに紐付く（このマイグレーションで追加）
--
-- c があっても「こちらが用意していない枠にアカウントが増えない」性質は変わらない。
-- 枠（メンバーの行とメールアドレス）を先に作るのは管理者だけで、
-- 一致する枠が無いユーザーの作成は、今までどおり失敗させる。

-- ---------------------------------------------------------------------------
-- 1. ログインに使うメールアドレスをメンバーに持たせる
-- ---------------------------------------------------------------------------

alter table public.members
  add column if not exists login_email text;

comment on column public.members.login_email is
  'この人がログインに使うメールアドレス。Supabase 側で同じアドレスのユーザーを作ると、この行に紐付く';

-- 1つのアドレスが2人のメンバーを指すと、どちらに紐付けるか決まらなくなる。
create unique index if not exists members_login_email_key
  on public.members (lower(login_email))
  where login_email is not null;

-- 管理者が「この人はこのアドレスでログインする」と決める。
-- アカウントを作るのは Supabase 側なので、ここで登録するのは枠だけ。
create or replace function public.set_member_login_email(
  target_member_id uuid,
  email text
)
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
    raise exception 'メンバーを変更する権限がありません';
  end if;

  if v_member.user_id is not null then
    raise exception 'すでにログインできる人のメールアドレスは、ここでは変えられません';
  end if;

  email := lower(nullif(trim(email), ''));
  if email is not null
     and email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'メールアドレスの形式が正しくありません';
  end if;

  if email is not null and exists (
    select 1 from public.members m
    where lower(m.login_email) = email and m.id <> target_member_id
  ) then
    raise exception 'このメールアドレスは別のメンバーに登録されています';
  end if;

  update public.members set login_email = email where id = target_member_id;
end;
$$;

revoke all on function public.set_member_login_email(uuid, text) from public;
grant execute on function public.set_member_login_email(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. メンバーの追加でも、同時にメールアドレスを登録できるようにする
-- ---------------------------------------------------------------------------

-- 引数が増えるので、古い形は落としてから作り直す。
drop function if exists public.add_offline_member(uuid, text);

-- create or replace にしてあるのは、途中で失敗したときに
-- そのまま流し直せるようにするため（このファイルは全体がそうなっている）。
create or replace function public.add_offline_member(
  target_family_id uuid,
  name text,
  login_email text default null
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

  if nullif(trim(login_email), '') is not null then
    perform public.set_member_login_email(v_member_id, login_email);
  end if;

  return v_member_id;
end;
$$;

revoke all on function public.add_offline_member(uuid, text, text) from public;
grant execute on function public.add_offline_member(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. サインアップ時の処理
-- ---------------------------------------------------------------------------

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
  v_email        text := lower(trim(new.email));
begin
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    split_part(new.email, '@', 1)
  );

  -- (b) アプリのメンバー画面から。相手は metadata で指定される。
  v_member_id := nullif(trim(new.raw_user_meta_data ->> 'member_id'), '')::uuid;

  if v_member_id is not null then
    update public.members
    set user_id = new.id,
        display_name = v_display_name,
        login_email = v_email,
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

  -- (c) Supabase の管理画面から。
  --     管理者が先に登録したアドレスと一致する枠があれば、そこに入る。
  --     表示名は登録済みのものを使う（管理画面からは名前を渡せないため）。
  update public.members
  set user_id = new.id,
      login_email = v_email
  where lower(login_email) = v_email
    and user_id is null
    and is_active
  returning id into v_member_id;

  if v_member_id is not null then
    return new;
  end if;

  -- (a) まだ家族が1つも無いときの1人目。ここで家族ができる。
  if not public.is_bootstrap() then
    raise exception 'MEMBER_REQUIRED'
      using hint = 'このメールアドレスは、どのメンバーにも登録されていません';
  end if;

  v_family_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'family_name'), ''),
    v_display_name || ' の家族'
  );

  insert into public.families (name)
  values (v_family_name)
  returning id into v_family_id;

  insert into public.members (family_id, user_id, display_name, login_email, color, role)
  values (v_family_id, new.id, v_display_name, v_email,
          public.pick_member_color(v_family_id), 'admin');

  insert into public.calendars (family_id, name, color, is_default)
  values (v_family_id, '家族共有', '#2563eb', true);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. メンバー行の更新で、変えてよい列を絞る
-- ---------------------------------------------------------------------------

-- members の更新ポリシーは「管理者、または自分の行」を許している。
-- 列までは絞れないので、本人が role を admin に書き換えたり、
-- family_id を別の家族に付け替えて他人のデータを読んだりできてしまう。
-- 表示名を自分で直せるようにするのに合わせ、ここを塞ぐ。
create or replace function public.guard_member_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.family_id is distinct from old.family_id then
    raise exception 'メンバーの所属は変更できません';
  end if;

  -- サインアップのトリガーなど、ログイン状態を持たない処理は素通しする。
  if (select auth.uid()) is null then
    return new;
  end if;

  if public.is_family_admin(old.family_id) then
    return new;
  end if;

  -- 本人による更新。変えてよいのは見た目に関する列だけ。
  if new.user_id     is distinct from old.user_id
     or new.role     is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.login_email is distinct from old.login_email then
    raise exception '自分で変更できるのは表示名と色だけです';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_member_update on public.members;
create trigger guard_member_update
  before update on public.members
  for each row execute function public.guard_member_update();
