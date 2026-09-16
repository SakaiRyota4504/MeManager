-- MeManager スキーマ一式
-- supabase/bundle.sh が supabase/migrations/ から生成したもの。
-- Supabase ダッシュボードの SQL Editor に貼り付けて実行する。
-- 手で書き換えない。変更は migrations/ 側に加えて生成し直す。

begin;

-- ===========================================================
-- 20260914000000_create_families_and_members.sql
-- ===========================================================
-- 家族・メンバー・カレンダー・招待の土台を作る。
--
-- 設計の根拠は docs/02-schedule-requirements.md の 6章（データモデル）と 7章（RLS）。
-- 要点:
--   * メンバーはログインアカウントと切り離す。アカウントを持たない子どもも
--     予定の担当者にできる必要があるため（FR-A06）。
--   * 認可はすべて RLS で行う。アプリ側で family_id の絞り込みを忘れても
--     他の家族のデータが見えないようにする（NFR-S03）。

-- ---------------------------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------------------------

create table public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  -- 週の開始曜日。0=日曜。
  week_start  smallint not null default 0 check (week_start between 0 and 6),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.families is 'データを共有する単位';

create table public.members (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families (id) on delete cascade,
  -- ログインアカウント。アカウントを持たないメンバー（幼い子どもなど）は null。
  user_id       uuid references auth.users (id) on delete set null,
  display_name  text not null check (char_length(display_name) between 1 and 50),
  color         text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  role          text not null default 'member' check (role in ('admin', 'member', 'viewer')),
  timezone      text not null default 'Asia/Tokyo',
  -- 家族から外れたあとも、過去の予定の担当者として残すため行は消さない。
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 同じ家族に同じアカウントが二重に入らないようにする。
  -- user_id が null の行は複数あってよい（NULL は一意制約の対象外）。
  unique (family_id, user_id)
);

comment on table public.members is '家族に属する人。ログインアカウントとは独立';
comment on column public.members.user_id is 'null ならアカウント未紐付け。招待を受けた時点で紐付く';

create index members_user_id_idx on public.members (user_id) where user_id is not null;
create index members_family_id_idx on public.members (family_id);

create table public.calendars (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references public.families (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 50),
  color            text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- visibility = 'private' のとき、この所有者だけが見られる。
  owner_member_id  uuid references public.members (id) on delete cascade,
  visibility       text not null default 'family' check (visibility in ('family', 'private')),
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint calendars_private_needs_owner
    check (visibility = 'family' or owner_member_id is not null)
);

comment on table public.calendars is '予定をまとめる入れ物';

create index calendars_family_id_idx on public.calendars (family_id);

-- 家族ごとに既定のカレンダーは1つだけ。
create unique index calendars_one_default_per_family
  on public.calendars (family_id) where is_default;

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  -- トークンは平文で保存しない。発行時に一度だけ表示する。
  token_hash  text not null unique,
  -- 既存のアカウント未紐付けメンバーに紐付ける場合に指定する。
  member_id   uuid references public.members (id) on delete cascade,
  created_by  uuid references public.members (id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.invitations is '家族への招待リンク';
comment on column public.invitations.token_hash is 'sha256 のハッシュ。平文は発行時のみ表示する';

create index invitations_family_id_idx on public.invitations (family_id);

-- ---------------------------------------------------------------------------
-- updated_at の自動更新
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger families_set_updated_at
  before update on public.families
  for each row execute function public.set_updated_at();

create trigger members_set_updated_at
  before update on public.members
  for each row execute function public.set_updated_at();

create trigger calendars_set_updated_at
  before update on public.calendars
  for each row execute function public.set_updated_at();

-- ===========================================================
-- 20260914000100_rls_policies.sql
-- ===========================================================
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

-- ===========================================================
-- 20260914000200_signup_and_invitations.sql
-- ===========================================================
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

-- ===========================================================
-- 20260914000300_close_signup.sql
-- ===========================================================
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

-- ===========================================================
-- 20260914000400_manage_members.sql
-- ===========================================================
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

-- ===========================================================
-- 20260916000000_remove_invitations.sql
-- ===========================================================
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

-- ===========================================================
-- 20260916000100_create_events.sql
-- ===========================================================
-- 予定（events）と担当者（event_assignees）。
--
-- 設計の根拠は docs/02-schedule-requirements.md の 6章。要点:
--   * 終日予定は date 型、時刻付きは timestamptz 型と、列を分ける。
--     終日をタイムゾーン付きで持つと、旅行先で日付が1日ずれる。
--   * 担当者は1人以上を必須にする（FR-E06）。
--     子テーブルなので NOT NULL では表現できず、関数とトリガーで守る。
--
-- 繰り返し（rrule）は Step 5、取り込み（external_key）は Step 6 で足す。

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  -- RLS の判定で calendars への結合を毎回起こさないよう、冗長に持つ。
  family_id     uuid not null references public.families (id) on delete cascade,
  calendar_id   uuid not null references public.calendars (id) on delete cascade,

  title         text not null check (char_length(title) between 1 and 200),
  description   text check (char_length(description) <= 2000),
  location      text check (char_length(location) <= 200),

  all_day       boolean not null default false,
  -- 時刻付きのときに使う。終了は排他的（その時刻を含まない）。
  starts_at     timestamptz,
  ends_at       timestamptz,
  -- 終日のときに使う。終了は包含的（その日を含む）。
  start_date    date,
  end_date      date,
  timezone      text not null default 'Asia/Tokyo',

  color         text check (color ~ '^#[0-9a-fA-F]{6}$'),
  status        text not null default 'confirmed'
                check (status in ('confirmed', 'tentative', 'cancelled')),

  created_by    uuid references public.members (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- 終日と時刻付きで、必要な列が入っていることを型として保証する
  constraint events_dates_match_all_day check (
    case when all_day
      then start_date is not null and end_date is not null
           and starts_at is null and ends_at is null
           and end_date >= start_date
      else starts_at is not null and ends_at is not null
           and start_date is null and end_date is null
           and ends_at > starts_at
    end
  )
);

comment on table public.events is '1件の予定';
comment on column public.events.ends_at is '排他的。この時刻は含まない';
comment on column public.events.end_date is '包含的。この日を含む';

create index events_family_starts_idx
  on public.events (family_id, starts_at) where deleted_at is null;
create index events_family_dates_idx
  on public.events (family_id, start_date) where deleted_at is null;
create index events_calendar_idx on public.events (calendar_id);

create table public.event_assignees (
  event_id  uuid not null references public.events (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  primary key (event_id, member_id)
);

comment on table public.event_assignees is 'その予定が誰の予定か。1件につき1人以上';

-- 「このメンバーの予定」を引くための索引
create index event_assignees_member_idx on public.event_assignees (member_id, event_id);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 担当者は1人以上（FR-E06）
-- ---------------------------------------------------------------------------

-- 最後の1人が消えるのを止める。
-- 予定そのものを消すとき（cascade）は素通りさせる。
create or replace function public.prevent_last_assignee_removal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.events e where e.id = old.event_id)
     and not exists (
       select 1 from public.event_assignees a
       where a.event_id = old.event_id and a.member_id <> old.member_id
     )
  then
    raise exception 'NO_ASSIGNEE'
      using hint = '予定には担当者が1人以上必要です';
  end if;
  return old;
end;
$$;

create trigger event_assignees_keep_one
  before delete on public.event_assignees
  for each row execute function public.prevent_last_assignee_removal();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;
alter table public.event_assignees enable row level security;

-- 閲覧できるカレンダーかどうか。非公開カレンダーは所有者だけ。
create or replace function public.can_read_calendar(target_calendar_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.calendars c
    where c.id = target_calendar_id
      and c.family_id in (select public.my_family_ids())
      and (c.visibility = 'family'
           or c.owner_member_id = public.my_member_id(c.family_id))
  );
$$;

create policy events_select on public.events
  for select to authenticated
  using (
    deleted_at is null
    and family_id in (select public.my_family_ids())
    and public.can_read_calendar(calendar_id)
  );

create policy events_insert on public.events
  for insert to authenticated
  with check (
    family_id in (select public.my_family_ids())
    and public.can_read_calendar(calendar_id)
  );

create policy events_update on public.events
  for update to authenticated
  using (
    family_id in (select public.my_family_ids())
    and public.can_read_calendar(calendar_id)
  )
  with check (
    family_id in (select public.my_family_ids())
    and public.can_read_calendar(calendar_id)
  );

-- 物理削除はしない。消すときは deleted_at を入れる。

create policy event_assignees_select on public.event_assignees
  for select to authenticated
  using (
    exists (select 1 from public.events e
            where e.id = event_id
              and e.deleted_at is null
              and e.family_id in (select public.my_family_ids())
              and public.can_read_calendar(e.calendar_id))
  );

create policy event_assignees_write on public.event_assignees
  for all to authenticated
  using (
    exists (select 1 from public.events e
            where e.id = event_id
              and e.family_id in (select public.my_family_ids())
              and public.can_read_calendar(e.calendar_id))
  )
  with check (
    exists (select 1 from public.events e
            where e.id = event_id
              and e.family_id in (select public.my_family_ids())
              and public.can_read_calendar(e.calendar_id))
  );

grant select, insert, update on public.events to authenticated;
grant select, insert, update, delete on public.event_assignees to authenticated;

-- ===========================================================
-- 20260916000200_event_functions.sql
-- ===========================================================
-- 予定の作成・更新・削除。
--
-- 予定と担当者は別テーブルなので、アプリ側で2回に分けて書き込むと
-- 「担当者のいない予定」が一瞬でも生まれる。ここで1トランザクションにまとめ、
-- 担当者0人の予定が存在しえないようにする（FR-E06）。

-- 入力の共通チェック。問題があれば例外を投げる。
create or replace function public.validate_event_input(
  target_family_id uuid,
  target_calendar_id uuid,
  assignees uuid[],
  all_day boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.can_read_calendar(target_calendar_id) then
    raise exception 'CALENDAR_NOT_FOUND'
      using hint = 'そのカレンダーには書き込めません';
  end if;

  if not exists (
    select 1 from public.calendars c
    where c.id = target_calendar_id and c.family_id = target_family_id
  ) then
    raise exception 'CALENDAR_NOT_FOUND'
      using hint = 'カレンダーと家族が一致しません';
  end if;

  if assignees is null or array_length(assignees, 1) is null then
    raise exception 'NO_ASSIGNEE'
      using hint = '担当者を1人以上選んでください';
  end if;

  -- 担当者が全員、同じ家族の在籍メンバーであること
  if exists (
    select 1 from unnest(assignees) as a(id)
    where not exists (
      select 1 from public.members m
      where m.id = a.id and m.family_id = target_family_id and m.is_active
    )
  ) then
    raise exception 'INVALID_ASSIGNEE'
      using hint = '担当者に指定できない人が含まれています';
  end if;

  if all_day then
    if start_date is null or end_date is null then
      raise exception 'INVALID_PERIOD' using hint = '日付を入力してください';
    end if;
    if end_date < start_date then
      raise exception 'INVALID_PERIOD' using hint = '終了日は開始日以降にしてください';
    end if;
  else
    if starts_at is null or ends_at is null then
      raise exception 'INVALID_PERIOD' using hint = '開始と終了の時刻を入力してください';
    end if;
    if ends_at <= starts_at then
      raise exception 'INVALID_PERIOD' using hint = '終了は開始より後にしてください';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 作成
-- ---------------------------------------------------------------------------

create or replace function public.create_event(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id   uuid;
  v_assignees   uuid[];
  v_all_day     boolean := coalesce((payload ->> 'all_day')::boolean, false);
  v_starts_at   timestamptz := (payload ->> 'starts_at')::timestamptz;
  v_ends_at     timestamptz := (payload ->> 'ends_at')::timestamptz;
  v_start_date  date := (payload ->> 'start_date')::date;
  v_end_date    date := (payload ->> 'end_date')::date;
  v_calendar_id uuid := (payload ->> 'calendar_id')::uuid;
  v_event_id    uuid;
begin
  select c.family_id into v_family_id
  from public.calendars c where c.id = v_calendar_id;

  if v_family_id is null or v_family_id not in (select public.my_family_ids()) then
    raise exception 'CALENDAR_NOT_FOUND' using hint = 'そのカレンダーには書き込めません';
  end if;

  select array_agg(value::uuid) into v_assignees
  from jsonb_array_elements_text(coalesce(payload -> 'assignees', '[]'::jsonb));

  perform public.validate_event_input(
    v_family_id, v_calendar_id, v_assignees,
    v_all_day, v_starts_at, v_ends_at, v_start_date, v_end_date
  );

  insert into public.events (
    family_id, calendar_id, title, description, location,
    all_day, starts_at, ends_at, start_date, end_date,
    timezone, color, status, created_by
  )
  values (
    v_family_id, v_calendar_id,
    trim(payload ->> 'title'),
    nullif(trim(coalesce(payload ->> 'description', '')), ''),
    nullif(trim(coalesce(payload ->> 'location', '')), ''),
    v_all_day, v_starts_at, v_ends_at, v_start_date, v_end_date,
    coalesce(nullif(payload ->> 'timezone', ''), 'Asia/Tokyo'),
    nullif(payload ->> 'color', ''),
    coalesce(nullif(payload ->> 'status', ''), 'confirmed'),
    public.my_member_id(v_family_id)
  )
  returning id into v_event_id;

  insert into public.event_assignees (event_id, member_id)
  select v_event_id, unnest(v_assignees);

  return v_event_id;
end;
$$;

revoke all on function public.create_event(jsonb) from public;
grant execute on function public.create_event(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 更新
-- ---------------------------------------------------------------------------

create or replace function public.update_event(target_event_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event       public.events%rowtype;
  v_assignees   uuid[];
  v_calendar_id uuid;
  v_all_day     boolean;
  v_starts_at   timestamptz;
  v_ends_at     timestamptz;
  v_start_date  date;
  v_end_date    date;
begin
  select * into v_event from public.events
  where id = target_event_id and deleted_at is null;

  if not found
     or v_event.family_id not in (select public.my_family_ids())
     or not public.can_read_calendar(v_event.calendar_id) then
    raise exception 'EVENT_NOT_FOUND' using hint = 'その予定は編集できません';
  end if;

  -- 指定のあった項目だけ差し替える
  v_calendar_id := coalesce((payload ->> 'calendar_id')::uuid, v_event.calendar_id);
  v_all_day     := coalesce((payload ->> 'all_day')::boolean, v_event.all_day);
  v_starts_at   := case when v_all_day then null
                        else coalesce((payload ->> 'starts_at')::timestamptz, v_event.starts_at) end;
  v_ends_at     := case when v_all_day then null
                        else coalesce((payload ->> 'ends_at')::timestamptz, v_event.ends_at) end;
  v_start_date  := case when v_all_day
                        then coalesce((payload ->> 'start_date')::date, v_event.start_date) end;
  v_end_date    := case when v_all_day
                        then coalesce((payload ->> 'end_date')::date, v_event.end_date) end;

  if payload ? 'assignees' then
    select array_agg(value::uuid) into v_assignees
    from jsonb_array_elements_text(payload -> 'assignees');
  else
    select array_agg(member_id) into v_assignees
    from public.event_assignees where event_id = target_event_id;
  end if;

  perform public.validate_event_input(
    v_event.family_id, v_calendar_id, v_assignees,
    v_all_day, v_starts_at, v_ends_at, v_start_date, v_end_date
  );

  update public.events set
    calendar_id = v_calendar_id,
    title       = coalesce(nullif(trim(coalesce(payload ->> 'title', '')), ''), title),
    description = case when payload ? 'description'
                       then nullif(trim(coalesce(payload ->> 'description', '')), '')
                       else description end,
    location    = case when payload ? 'location'
                       then nullif(trim(coalesce(payload ->> 'location', '')), '')
                       else location end,
    all_day     = v_all_day,
    starts_at   = v_starts_at,
    ends_at     = v_ends_at,
    start_date  = v_start_date,
    end_date    = v_end_date,
    color       = case when payload ? 'color'
                       then nullif(payload ->> 'color', '') else color end,
    status      = coalesce(nullif(payload ->> 'status', ''), status)
  where id = target_event_id;

  if payload ? 'assignees' then
    -- 入れ替えの途中で「0人」になるが、トリガーは削除の直前しか見ないため、
    -- 先に足してから余分を消す順にする。
    insert into public.event_assignees (event_id, member_id)
    select target_event_id, unnest(v_assignees)
    on conflict do nothing;

    delete from public.event_assignees
    where event_id = target_event_id and member_id <> all (v_assignees);
  end if;
end;
$$;

revoke all on function public.update_event(uuid, jsonb) from public;
grant execute on function public.update_event(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 削除と復元（論理削除。30日は戻せる / NFR-D04）
-- ---------------------------------------------------------------------------

create or replace function public.delete_event(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
begin
  select * into v_event from public.events
  where id = target_event_id and deleted_at is null;

  if not found
     or v_event.family_id not in (select public.my_family_ids())
     or not public.can_read_calendar(v_event.calendar_id) then
    raise exception 'EVENT_NOT_FOUND' using hint = 'その予定は削除できません';
  end if;

  update public.events set deleted_at = now() where id = target_event_id;
end;
$$;

revoke all on function public.delete_event(uuid) from public;
grant execute on function public.delete_event(uuid) to authenticated;

create or replace function public.restore_event(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
begin
  select * into v_event from public.events
  where id = target_event_id and deleted_at is not null;

  if not found
     or v_event.family_id not in (select public.my_family_ids())
     or not public.can_read_calendar(v_event.calendar_id) then
    raise exception 'EVENT_NOT_FOUND' using hint = 'その予定は戻せません';
  end if;

  if v_event.deleted_at < now() - interval '30 days' then
    raise exception 'TOO_OLD' using hint = '削除から30日を過ぎた予定は戻せません';
  end if;

  update public.events set deleted_at = null where id = target_event_id;
end;
$$;

revoke all on function public.restore_event(uuid) from public;
grant execute on function public.restore_event(uuid) to authenticated;

-- ===========================================================
-- 20260916000300_accounts_without_signup.sql
-- ===========================================================
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

drop function if exists public.add_offline_member(uuid, text);

create function public.add_offline_member(
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

commit;
