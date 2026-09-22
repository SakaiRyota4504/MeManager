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

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  -- 週の開始曜日。0=日曜。
  week_start  smallint not null default 0 check (week_start between 0 and 6),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.families is 'データを共有する単位';

create table if not exists public.members (
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

create index if not exists members_user_id_idx on public.members (user_id) where user_id is not null;
create index if not exists members_family_id_idx on public.members (family_id);

create table if not exists public.calendars (
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

create index if not exists calendars_family_id_idx on public.calendars (family_id);

-- 家族ごとに既定のカレンダーは1つだけ。
create unique index if not exists calendars_one_default_per_family
  on public.calendars (family_id) where is_default;

create table if not exists public.invitations (
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

create index if not exists invitations_family_id_idx on public.invitations (family_id);

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

drop trigger if exists families_set_updated_at on public.families;
create trigger families_set_updated_at
  before update on public.families
  for each row execute function public.set_updated_at();

drop trigger if exists members_set_updated_at on public.members;
create trigger members_set_updated_at
  before update on public.members
  for each row execute function public.set_updated_at();

drop trigger if exists calendars_set_updated_at on public.calendars;
create trigger calendars_set_updated_at
  before update on public.calendars
  for each row execute function public.set_updated_at();
