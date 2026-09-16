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

select pg_temp.expect(
  not public.is_bootstrap(),
  '家族ができたら、以後は勝手にアカウントを作れない状態になる'
);

-- 招待なしのサインアップは拒否される
do $$
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values ('99999999-9999-9999-9999-999999999999', 'stranger@example.com',
            '{"display_name": "知らない人"}'::jsonb);
    raise exception 'FAILED: 管理者の登録なしでアカウントが作れてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   管理者が登録していない人はアカウントを作れない';
  end;
end
$$;
select pg_temp.expect(
  (select count(*) from auth.users
   where email = 'stranger@example.com') = 0,
  '拒否されたアカウント作成は auth.users にも残らない'
);

\echo '--- 2. 管理者が登録したメンバーだけがアカウントを持てる ---'

create temporary table t_ctx (k text primary key, v text);
grant select, insert on t_ctx to authenticated;

insert into t_ctx
select 'family_a', (select family_id::text from public.members
                    where user_id = '11111111-1111-1111-1111-111111111111');

-- 父（管理者）がメンバーを用意する
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
insert into t_ctx
select 'haha_member', public.prepare_member_for_account(
  (select v from t_ctx where k = 'family_a')::uuid, '母')::text;
reset role;

select pg_temp.expect(
  (select user_id is null and is_active and display_name = '母'
   from public.members where id = (select v from t_ctx where k = 'haha_member')::uuid),
  '管理者がメンバーを登録できる（アカウントはまだ無い）'
);

-- そのメンバーにアカウントを紐付ける（アプリは管理APIでこれを行う）
insert into auth.users (id, email, raw_user_meta_data)
values ('33333333-3333-3333-3333-333333333333', 'haha@example.com',
        json_build_object('display_name', '母',
                          'member_id', (select v from t_ctx where k = 'haha_member'))::jsonb);

select pg_temp.expect(
  (select user_id = '33333333-3333-3333-3333-333333333333'
   from public.members where id = (select v from t_ctx where k = 'haha_member')::uuid),
  '用意したメンバーにアカウントが紐付く'
);
select pg_temp.expect(
  (select count(*) from public.members
   where family_id = (select v from t_ctx where k = 'family_a')::uuid) = 2,
  'メンバーは増えない（枠は事前に作った分だけ）'
);
select pg_temp.expect(
  (select count(*) from public.families) = 1,
  '新しい家族は作られない'
);

-- 同じメンバーに2つ目のアカウントは紐付かない
do $$
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values ('44444444-4444-4444-4444-444444444444', 'dup@example.com',
            json_build_object('display_name', '重複',
                              'member_id', (select v from t_ctx where k = 'haha_member'))::jsonb);
    raise exception 'FAILED: 同じメンバーに2つ目のアカウントが付いた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   1人のメンバーにアカウントは1つだけ';
  end;
end
$$;

-- 存在しないメンバーを指定しても作れない
do $$
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values ('55555555-5555-5555-5555-555555555555', 'ghost@example.com',
            '{"display_name":"幽霊","member_id":"00000000-0000-0000-0000-000000000000"}'::jsonb);
    raise exception 'FAILED: 存在しないメンバーでアカウントが作れた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   存在しないメンバーではアカウントを作れない';
  end;
end
$$;

-- 一般メンバーはメンバーを登録できない
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
do $$
begin
  begin
    perform public.prepare_member_for_account(
      (select v from t_ctx where k = 'family_a')::uuid, '勝手に追加');
    raise exception 'FAILED: 一般メンバーがメンバーを登録できた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   一般メンバーはメンバーを登録できない';
  end;
end
$$;
reset role;

-- 別の家族のメンバーは登録できない
insert into t_ctx select 'family_b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('22222222-2222-2222-2222-222222222222', 'other@example.com');
alter table auth.users enable trigger on_auth_user_created;
insert into public.families (id, name)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'よその家');
insert into public.members (family_id, user_id, display_name, role)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '22222222-2222-2222-2222-222222222222', '他人', 'admin');

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
do $$
begin
  begin
    perform public.prepare_member_for_account(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '侵入');
    raise exception 'FAILED: 別の家族にメンバーを登録できた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   別の家族にはメンバーを登録できない';
  end;
end
$$;
reset role;

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

\echo '--- 4. 自分の行と他人の行 ---'

-- 自分の表示名は変えられる
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
update public.members set display_name = '母（変更後）'
where user_id = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect(
  (select display_name from public.members
   where user_id = '33333333-3333-3333-3333-333333333333') = '母（変更後）',
  '自分の表示名は変更できる'
);

-- 他人の役割は変えられない
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

\echo '--- 5. 管理者がメンバーを増減できる ---'

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

-- アカウントを持たないメンバーを足せる
insert into t_ctx
select 'child', public.add_offline_member(
  (select v from t_ctx where k = 'family_a')::uuid, 'たろう')::text;
select pg_temp.expect(
  (select user_id is null and is_active from public.members
   where id = (select v from t_ctx where k = 'child')::uuid),
  'アカウントを持たないメンバーを追加できる'
);

-- あとからログインを設定できる
insert into t_ctx
select 'child_ready', public.prepare_member_for_account(
  (select v from t_ctx where k = 'family_a')::uuid, null,
  (select v from t_ctx where k = 'child')::uuid)::text;
reset role;
insert into auth.users (id, email, raw_user_meta_data)
values ('66666666-6666-6666-6666-666666666666', 'taro@example.com',
        json_build_object('display_name', 'たろう',
                          'member_id', (select v from t_ctx where k = 'child'))::jsonb);
select pg_temp.expect(
  (select user_id = '66666666-6666-6666-6666-666666666666' from public.members
   where id = (select v from t_ctx where k = 'child')::uuid),
  'あとからログインを設定できる（新しい行は作られない）'
);

-- メンバーを外すと、その人からはデータが見えなくなる
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
select public.deactivate_member((select v from t_ctx where k = 'haha_member')::uuid);
reset role;

select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
select pg_temp.expect(
  (select count(*) from public.families) = 0,
  '外されたメンバーからは家族が見えなくなる'
);
select pg_temp.expect(
  (select count(*) from public.members) = 0,
  '外されたメンバーからはメンバー一覧も見えなくなる'
);
reset role;

-- 管理者が自分ひとりのときは、自分を外せない
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
do $$
declare v_me uuid;
begin
  select id into v_me from public.members
  where user_id = '11111111-1111-1111-1111-111111111111';
  begin
    perform public.deactivate_member(v_me);
    raise exception 'FAILED: 自分自身を外せてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   自分自身は外せない';
  end;
end
$$;

-- 外したメンバーは戻せる
select public.reactivate_member((select v from t_ctx where k = 'haha_member')::uuid);
reset role;
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
select pg_temp.expect(
  (select count(*) from public.families) = 1,
  '戻したメンバーからは再び家族が見える'
);

reset role;

\echo '--- 6. 予定の登録 ---'

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

insert into t_ctx
select 'cal', (select id::text from public.calendars where is_default limit 1);
insert into t_ctx
select 'chichi', (select id::text from public.members
                  where user_id = '11111111-1111-1111-1111-111111111111');

-- 時刻付きの予定
insert into t_ctx
select 'ev1', public.create_event(jsonb_build_object(
  'calendar_id', (select v from t_ctx where k = 'cal'),
  'title', 'ピアノ教室',
  'starts_at', '2026-09-15T07:00:00Z',
  'ends_at',   '2026-09-15T08:00:00Z',
  'location', '市民センター',
  'assignees', jsonb_build_array((select v from t_ctx where k = 'child'))
))::text;

select pg_temp.expect(
  (select title = 'ピアノ教室' and not all_day and status = 'confirmed'
   from public.events where id = (select v from t_ctx where k = 'ev1')::uuid),
  '時刻付きの予定を作れる'
);
select pg_temp.expect(
  (select count(*) from public.event_assignees
   where event_id = (select v from t_ctx where k = 'ev1')::uuid) = 1,
  '担当者が紐付く'
);

-- 終日の予定
insert into t_ctx
select 'ev2', public.create_event(jsonb_build_object(
  'calendar_id', (select v from t_ctx where k = 'cal'),
  'title', '家族旅行',
  'all_day', true,
  'start_date', '2026-09-21',
  'end_date',   '2026-09-23',
  'assignees', jsonb_build_array((select v from t_ctx where k = 'chichi'),
                                 (select v from t_ctx where k = 'child'))
))::text;

select pg_temp.expect(
  (select all_day and starts_at is null and start_date = '2026-09-21'
   from public.events where id = (select v from t_ctx where k = 'ev2')::uuid),
  '終日の予定は日付だけで持つ（タイムゾーン変換の対象外）'
);

\echo '--- 7. 担当者は1人以上（FR-E06） ---'

do $$
begin
  begin
    perform public.create_event(jsonb_build_object(
      'calendar_id', (select v from t_ctx where k = 'cal'),
      'title', '担当者なし',
      'starts_at', '2026-09-16T01:00:00Z',
      'ends_at',   '2026-09-16T02:00:00Z',
      'assignees', '[]'::jsonb));
    raise exception 'FAILED: 担当者なしで予定が作れた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   担当者なしでは予定を作れない';
  end;
end
$$;

-- 更新で担当者を空にもできない
do $$
begin
  begin
    perform public.update_event((select v from t_ctx where k = 'ev1')::uuid,
      jsonb_build_object('assignees', '[]'::jsonb));
    raise exception 'FAILED: 更新で担当者を空にできた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   更新でも担当者を空にできない';
  end;
end
$$;

-- テーブルを直接叩いても最後の1人は消せない
do $$
begin
  begin
    delete from public.event_assignees
    where event_id = (select v from t_ctx where k = 'ev1')::uuid;
    raise exception 'FAILED: 最後の担当者を直接消せた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   最後の担当者はテーブルから直接も消せない';
  end;
end
$$;

-- 他の家族のメンバーは担当者にできない
do $$
declare v_other uuid;
begin
  select id into v_other from public.members
  where family_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid limit 1;
  begin
    perform public.create_event(jsonb_build_object(
      'calendar_id', (select v from t_ctx where k = 'cal'),
      'title', 'よその人',
      'starts_at', '2026-09-16T01:00:00Z',
      'ends_at',   '2026-09-16T02:00:00Z',
      'assignees', jsonb_build_array(v_other)));
    raise exception 'FAILED: 他の家族のメンバーを担当者にできた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   他の家族のメンバーは担当者にできない';
  end;
end
$$;

\echo '--- 8. 期間の整合性 ---'

do $$
begin
  begin
    perform public.create_event(jsonb_build_object(
      'calendar_id', (select v from t_ctx where k = 'cal'),
      'title', '逆転',
      'starts_at', '2026-09-16T05:00:00Z',
      'ends_at',   '2026-09-16T04:00:00Z',
      'assignees', jsonb_build_array((select v from t_ctx where k = 'chichi'))));
    raise exception 'FAILED: 終了が開始より前でも作れた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   終了が開始より前の予定は作れない';
  end;
end
$$;

\echo '--- 9. 予定の更新と削除 ---'

select public.update_event((select v from t_ctx where k = 'ev1')::uuid,
  jsonb_build_object('title', 'ピアノ教室（発表会）', 'status', 'tentative'));
select pg_temp.expect(
  (select title = 'ピアノ教室（発表会）' and status = 'tentative'
   from public.events where id = (select v from t_ctx where k = 'ev1')::uuid),
  '予定を更新できる'
);

-- 担当者の入れ替え（途中で0人にならない）
select public.update_event((select v from t_ctx where k = 'ev1')::uuid,
  jsonb_build_object('assignees',
    jsonb_build_array((select v from t_ctx where k = 'chichi'))));
select pg_temp.expect(
  (select array_agg(member_id::text) = array[(select v from t_ctx where k = 'chichi')]
   from public.event_assignees where event_id = (select v from t_ctx where k = 'ev1')::uuid),
  '担当者を入れ替えられる'
);

select public.delete_event((select v from t_ctx where k = 'ev1')::uuid);
select pg_temp.expect(
  (select count(*) from public.events
   where id = (select v from t_ctx where k = 'ev1')::uuid) = 0,
  '削除した予定は見えなくなる（論理削除）'
);
select public.restore_event((select v from t_ctx where k = 'ev1')::uuid);
select pg_temp.expect(
  (select count(*) from public.events
   where id = (select v from t_ctx where k = 'ev1')::uuid) = 1,
  '削除した予定を戻せる'
);

\echo '--- 10. 予定も家族をまたいで見えない ---'

reset role;
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
select pg_temp.expect(
  (select count(*) from public.events) = 0,
  '別の家族の予定は見えない'
);
select pg_temp.expect(
  (select count(*) from public.event_assignees) = 0,
  '別の家族の担当者も見えない'
);
do $$
begin
  begin
    perform public.update_event((select v from t_ctx where k = 'ev1')::uuid,
      jsonb_build_object('title', '乗っ取り'));
    raise exception 'FAILED: 別の家族の予定を更新できた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   別の家族の予定はIDを指定しても更新できない';
  end;
end
$$;

reset role;
rollback;

\echo ''
\echo 'すべて成功しました'
