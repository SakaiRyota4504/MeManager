-- RLS の検証。
--
-- 確かめること:
--   1. サインアップで家族・メンバー・既定カレンダーが自動で作られる
--   2. 招待リンクから参加すると、招待元の家族のメンバーになる
--   3. 別の家族のデータは、IDを直接指定しても取得できない
--   4. 権限のない操作（他人の家族の招待発行など）が弾かれる
--
-- 実行: supabase/tests/run.sh

\set ON_ERROR_STOP on
set client_min_messages to notice;

create or replace function pg_temp.expect(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice '  ok   %', description;
  else
    raise exception 'FAILED: %', description;
  end if;
end;
$$;

-- 要求者を切り替える。
create or replace function pg_temp.login_as(target_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', target_user_id)::text, false);
  execute 'set local role authenticated';
end;
$$;

-- 検証結果は NOTICE（標準エラー）に出す。
-- クエリの戻り値は読む必要がないので捨てる。
\o /dev/null

-- ===========================================================================
begin;

\echo '--- 1. サインアップで家族が作られる ---'

insert into auth.users (id, email, raw_user_meta_data)
values (
  '11111111-1111-1111-1111-111111111111',
  'chichi@example.com',
  '{"display_name": "父", "family_name": "さかい家"}'::jsonb
);

select pg_temp.expect(
  (select count(*) from public.families where name = 'さかい家') = 1,
  '家族が1つ作られる'
);
select pg_temp.expect(
  (select role from public.members
   where user_id = '11111111-1111-1111-1111-111111111111') = 'admin',
  '作成者が管理者になる'
);
select pg_temp.expect(
  (select count(*) from public.calendars c
   join public.members m on m.family_id = c.family_id
   where m.user_id = '11111111-1111-1111-1111-111111111111'
     and c.name = '家族共有' and c.is_default) = 1,
  '既定カレンダー「家族共有」が作られる'
);

-- 別の家族も作っておく（漏れの検証用）
insert into auth.users (id, email, raw_user_meta_data)
values (
  '22222222-2222-2222-2222-222222222222',
  'other@example.com',
  '{"display_name": "他人", "family_name": "よその家"}'::jsonb
);

\echo '--- 2. 招待リンクから参加できる ---'

-- ロールを切り替えても読めるようにしておく（テスト用の値の受け渡しに使う）。
create temporary table t_ctx (k text primary key, v text);
grant select, insert on t_ctx to authenticated;

insert into t_ctx
select 'family_a', (select family_id::text from public.members
                    where user_id = '11111111-1111-1111-1111-111111111111');
insert into t_ctx
select 'family_b', (select family_id::text from public.members
                    where user_id = '22222222-2222-2222-2222-222222222222');

-- 父として招待を発行する
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
insert into t_ctx
select 'token', public.create_invitation((select v from t_ctx where k = 'family_a')::uuid);
reset role;

select pg_temp.expect(
  (select length(v) from t_ctx where k = 'token') = 64,
  '招待トークンは64文字（244bit相当の乱数）'
);
select pg_temp.expect(
  (select count(*) from public.invitations
   where token_hash = (select v from t_ctx where k = 'token')) = 0,
  'トークンの平文はDBに保存されない'
);

-- 招待の下見（未ログインでも家族名が見える）
select pg_temp.expect(
  (select family_name from public.peek_invitation((select v from t_ctx where k = 'token'))) = 'さかい家'
  and (select is_valid from public.peek_invitation((select v from t_ctx where k = 'token'))),
  '招待リンクから家族名を確認できる'
);

-- 招待トークン付きでサインアップ
insert into auth.users (id, email, raw_user_meta_data)
values (
  '33333333-3333-3333-3333-333333333333',
  'haha@example.com',
  json_build_object('display_name', '母',
                    'invitation_token', (select v from t_ctx where k = 'token'))::jsonb
);

select pg_temp.expect(
  (select family_id::text from public.members
   where user_id = '33333333-3333-3333-3333-333333333333')
  = (select v from t_ctx where k = 'family_a'),
  '招待された人は招待元の家族に入る（新しい家族は作られない）'
);
select pg_temp.expect(
  (select count(*) from public.families) = 2,
  '家族は2つのまま'
);
select pg_temp.expect(
  (select role from public.members
   where user_id = '33333333-3333-3333-3333-333333333333') = 'member',
  '招待された人は一般メンバー'
);
select pg_temp.expect(
  (select accepted_at is not null from public.invitations
   where family_id = (select v from t_ctx where k = 'family_a')::uuid),
  '招待は使用済みになる'
);

-- 同じトークンは二度使えない
insert into auth.users (id, email, raw_user_meta_data)
values (
  '44444444-4444-4444-4444-444444444444',
  'again@example.com',
  json_build_object('display_name', '再利用',
                    'invitation_token', (select v from t_ctx where k = 'token'))::jsonb
);
select pg_temp.expect(
  (select family_id::text from public.members
   where user_id = '44444444-4444-4444-4444-444444444444')
  <> (select v from t_ctx where k = 'family_a'),
  '使用済みトークンでは参加できない（自分の家族が作られる）'
);

select pg_temp.expect(
  (select count(distinct color) from public.members
   where family_id = (select v from t_ctx where k = 'family_a')::uuid) = 2,
  '家族内でメンバーの色が重ならない'
);

\echo '--- 3. 別の家族のデータは見えない ---'

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

select pg_temp.expect(
  (select count(*) from public.families) = 1,
  '自分の家族しか見えない'
);
select pg_temp.expect(
  (select count(*) from public.families
   where id = (select v from t_ctx where k = 'family_b')::uuid) = 0,
  'IDを直接指定しても、別の家族は取得できない'
);
select pg_temp.expect(
  (select count(*) from public.members) = 2,
  '自分の家族のメンバーだけが見える（父と母）'
);
select pg_temp.expect(
  (select count(*) from public.calendars
   where family_id = (select v from t_ctx where k = 'family_b')::uuid) = 0,
  '別の家族のカレンダーは見えない'
);

\echo '--- 4. 権限のない操作が弾かれる ---'

-- 別の家族の招待を発行しようとする
do $$
declare v_other uuid;
begin
  select v::uuid into v_other from t_ctx where k = 'family_b';
  begin
    perform public.create_invitation(v_other);
    raise exception 'FAILED: 別の家族の招待を発行できてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   別の家族の招待は発行できない';
  end;
end
$$;

-- 一般メンバーは招待を発行できない
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
do $$
declare v_mine uuid;
begin
  select v::uuid into v_mine from t_ctx where k = 'family_a';
  begin
    perform public.create_invitation(v_mine);
    raise exception 'FAILED: 一般メンバーが招待を発行できてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   一般メンバーは招待を発行できない';
  end;
end
$$;

-- 自分の表示名は変えられる
update public.members set display_name = '母（変更後）'
where user_id = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect(
  (select display_name from public.members
   where user_id = '33333333-3333-3333-3333-333333333333') = '母（変更後）',
  '自分の表示名は変更できる'
);

-- 他人の役割は変えられない（管理者でないため更新が0件になる）
with updated as (
  update public.members set role = 'admin'
  where user_id = '11111111-1111-1111-1111-111111111111'
  returning 1
)
select pg_temp.expect(
  (select count(*) from updated) = 0,
  '一般メンバーは他人の行を更新できない'
);

reset role;
rollback;

\echo ''
\echo 'すべて成功しました'
