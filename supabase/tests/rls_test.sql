-- RLS の検証。
--
-- 確かめること:
--   1. 最初の1人で家族・メンバー・既定カレンダーが自動で作られる
--   2. 管理者が用意した枠にしかアカウントが紐付かない
--   3. 別の家族のデータは、IDを直接指定しても取得できない
--   4. 権限のない操作（他人の家族のメンバー登録など）が弾かれる
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

-- 自分の行でも、役割は書き換えられない（更新ポリシーは列まで絞れないので
-- トリガーで塞いでいる）
do $$
begin
  begin
    update public.members set role = 'admin'
    where user_id = '33333333-3333-3333-3333-333333333333';
    raise exception 'FAILED: 自分を管理者に昇格できてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   自分を管理者に昇格できない';
  end;
end
$$;

-- 自分の行を別の家族に付け替えて、よその家のデータを読むこともできない
do $$
begin
  begin
    update public.members
    set family_id = (select v from t_ctx where k = 'family_b')::uuid
    where user_id = '33333333-3333-3333-3333-333333333333';
    raise exception 'FAILED: 自分を別の家族に移せてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   自分を別の家族に移せない';
  end;
end
$$;
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

\echo '--- 5b. Supabase の管理画面から作ったアカウント ---'

-- 管理者が「この人はこのアドレスでログインする」と先に登録しておく。
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
insert into t_ctx
select 'jiro', public.add_offline_member(
  (select v from t_ctx where k = 'family_a')::uuid, 'じろう', 'Jiro@Example.com')::text;
reset role;

select pg_temp.expect(
  (select login_email from public.members
   where id = (select v from t_ctx where k = 'jiro')::uuid) = 'jiro@example.com',
  'メールアドレスは小文字にそろえて登録される'
);

-- Supabase の管理画面には metadata を入れる欄が無いので、
-- メールアドレスとパスワードだけでユーザーが作られる。
insert into auth.users (id, email)
values ('77777777-7777-7777-7777-777777777777', 'jiro@example.com');

select pg_temp.expect(
  (select user_id = '77777777-7777-7777-7777-777777777777'
   from public.members where id = (select v from t_ctx where k = 'jiro')::uuid),
  '登録しておいたメンバーにアカウントが紐付く'
);
select pg_temp.expect(
  (select display_name from public.members
   where user_id = '77777777-7777-7777-7777-777777777777') = 'じろう',
  '表示名は登録しておいたものが残る（メールアドレスから作らない）'
);
select pg_temp.expect(
  (select count(*) from public.members
   where family_id = (select v from t_ctx where k = 'family_a')::uuid) = 4,
  'メンバーは増えない（枠は事前に作った分だけ）'
);

-- 登録していないアドレスでは、管理画面から作ってもアカウントにならない
do $$
begin
  begin
    insert into auth.users (id, email)
    values ('88888888-8888-8888-8888-888888888888', 'nobody@example.com');
    raise exception 'FAILED: 登録していないアドレスでアカウントが作れた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   登録していないアドレスではアカウントを作れない';
  end;
end
$$;

-- 同じアドレスを2人のメンバーに登録できない（どちらに紐付くか決まらなくなる）
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
do $$
begin
  begin
    perform public.add_offline_member(
      (select v from t_ctx where k = 'family_a')::uuid, '重複', 'jiro@example.com');
    raise exception 'FAILED: 同じアドレスを2人に登録できてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   同じメールアドレスは2人に登録できない';
  end;
end
$$;

-- 一般メンバーはメールアドレスを登録できない
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
do $$
begin
  begin
    perform public.set_member_login_email(
      (select v from t_ctx where k = 'child')::uuid, 'sneak@example.com');
    raise exception 'FAILED: 一般メンバーがログイン用のアドレスを登録できた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   一般メンバーはログイン用のアドレスを登録できない';
  end;
end
$$;
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

\echo '--- 11. 画面の設定は本人だけのもの ---'

-- 父が絞り込みを保存する
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
select public.save_preference('schedule.members',
  jsonb_build_array((select v from t_ctx where k = 'haha_member')));
reset role;

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
select pg_temp.expect(
  (select prefs -> 'schedule.members' ->> 0 from public.user_preferences)
    = (select v from t_ctx where k = 'haha_member'),
  '保存した設定を読み戻せる'
);

-- 別のキーを保存しても、前のキーは残る
select public.save_preference('schedule.week_start', '1'::jsonb);
select pg_temp.expect(
  (select prefs ? 'schedule.members' and prefs ? 'schedule.week_start'
   from public.user_preferences),
  '別のキーを保存しても、前の設定は消えない'
);

-- 名前が変なキーは弾く（jsonb のキーが自由だと、あとで読めなくなる）
do $$
begin
  begin
    perform public.save_preference('../../etc', '1'::jsonb);
    raise exception 'FAILED: 変な名前の設定が保存できた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   設定の名前は決めた形式だけ受け付ける';
  end;
end
$$;
reset role;

-- 母からは、父の設定は見えない
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
select pg_temp.expect(
  (select count(*) from public.user_preferences) = 0,
  '他の人の画面の設定は見えない（同じ家族でも）'
);

-- 母が保存しても、父の行は増えも減りもしない
select public.save_preference('schedule.members', '[]'::jsonb);
select pg_temp.expect(
  (select count(*) from public.user_preferences) = 1,
  '自分の設定は自分の行にだけ入る'
);
reset role;

select pg_temp.expect(
  (select count(*) from public.user_preferences) = 2,
  '2人ぶんの行がある（RLS を外して見れば）'
);

\echo '--- 12. 繰り返し予定 ---'

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

insert into t_ctx
select 'weekly', public.create_event(jsonb_build_object(
  'calendar_id', (select v from t_ctx where k = 'cal'),
  'title', 'ピアノ教室',
  'all_day', false,
  'starts_at', '2026-09-01T07:00:00Z',   -- JST 16:00
  'ends_at',   '2026-09-01T08:00:00Z',
  'rrule', 'FREQ=WEEKLY;BYDAY=TU',
  'assignees', jsonb_build_array((select v from t_ctx where k = 'child'))
))::text;

select pg_temp.expect(
  (select rrule from public.events
   where id = (select v from t_ctx where k = 'weekly')::uuid) = 'FREQ=WEEKLY;BYDAY=TU',
  '繰り返しルールを付けて登録できる'
);

-- でたらめなルールは弾く
do $$
begin
  begin
    perform public.create_event(jsonb_build_object(
      'calendar_id', (select v from t_ctx where k = 'cal'),
      'title', '変なルール', 'all_day', true,
      'start_date', '2026-09-01', 'end_date', '2026-09-01',
      'rrule', 'DROP TABLE events',
      'assignees', jsonb_build_array((select v from t_ctx where k = 'child'))));
    raise exception 'FAILED: でたらめな繰り返しルールが通った';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   でたらめな繰り返しルールは弾く';
  end;
end
$$;

-- この回だけ削除（FR-R06）。元の予定とルールは残る
select public.delete_event(
  (select v from t_ctx where k = 'weekly')::uuid, 'one', '2026-09-15');

select pg_temp.expect(
  (select count(*) from public.event_exceptions
   where event_id = (select v from t_ctx where k = 'weekly')::uuid
     and occurrence_date = '2026-09-15') = 1,
  'この回だけ削除すると、休む回が1つ記録される'
);
select pg_temp.expect(
  (select deleted_at is null and rrule = 'FREQ=WEEKLY;BYDAY=TU'
   from public.events where id = (select v from t_ctx where k = 'weekly')::uuid),
  '元の予定とルールは変わらない（他の回に影響しない）'
);

-- これ以降を削除（FR-R07）。ルールが前日で打ち切られる
select public.delete_event(
  (select v from t_ctx where k = 'weekly')::uuid, 'following', '2026-10-06');

select pg_temp.expect(
  (select rrule from public.events
   where id = (select v from t_ctx where k = 'weekly')::uuid)
    = 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261005T000000Z',
  'これ以降を削除すると、前日までで終わるルールになる'
);
select pg_temp.expect(
  (select deleted_at is null from public.events
   where id = (select v from t_ctx where k = 'weekly')::uuid),
  'これ以降を削除しても、予定そのものは消えない'
);

-- 1回目より前を指定した「これ以降」は、まるごと削除になる
insert into t_ctx
select 'weekly2', public.create_event(jsonb_build_object(
  'calendar_id', (select v from t_ctx where k = 'cal'),
  'title', '体操教室', 'all_day', true,
  'start_date', '2026-09-07', 'end_date', '2026-09-07',
  'rrule', 'FREQ=WEEKLY',
  'assignees', jsonb_build_array((select v from t_ctx where k = 'child'))
))::text;

select public.delete_event(
  (select v from t_ctx where k = 'weekly2')::uuid, 'following', '2026-09-07');
-- 消えた予定は RLS で見えなくなるので、件数で確かめる
select pg_temp.expect(
  (select count(*) from public.events
   where id = (select v from t_ctx where k = 'weekly2')::uuid) = 0,
  '1回目から「これ以降」を消すと、予定ごと消える'
);

-- この回だけ編集（FR-R05）。休みが1つ増え、その日の単発予定ができる
insert into t_ctx
select 'weekly3', public.create_event(jsonb_build_object(
  'calendar_id', (select v from t_ctx where k = 'cal'),
  'title', 'スイミング', 'all_day', true,
  'start_date', '2026-09-03', 'end_date', '2026-09-03',
  'rrule', 'FREQ=WEEKLY',
  'assignees', jsonb_build_array((select v from t_ctx where k = 'child'))
))::text;

select public.update_event(
  (select v from t_ctx where k = 'weekly3')::uuid,
  jsonb_build_object(
    'calendar_id', (select v from t_ctx where k = 'cal'),
    'title', 'スイミング（振替）', 'all_day', true,
    'start_date', '2026-09-18', 'end_date', '2026-09-18',
    'assignees', jsonb_build_array((select v from t_ctx where k = 'child'))),
  'one', '2026-09-17');

select pg_temp.expect(
  (select count(*) from public.event_exceptions
   where event_id = (select v from t_ctx where k = 'weekly3')::uuid
     and occurrence_date = '2026-09-17') = 1,
  'この回だけ編集すると、元の回は休みになる'
);
select pg_temp.expect(
  (select count(*) from public.events
   where title = 'スイミング（振替）' and rrule is null
     and start_date = '2026-09-18') = 1,
  '振替ぶんは、繰り返しの付かない単発の予定として入る'
);
select pg_temp.expect(
  (select rrule from public.events
   where id = (select v from t_ctx where k = 'weekly3')::uuid) = 'FREQ=WEEKLY',
  '元の繰り返しはそのまま残る'
);
reset role;

-- 別の家族からは、休む回も見えない
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
select pg_temp.expect(
  (select count(*) from public.event_exceptions) = 0,
  '別の家族からは、休む回も見えない'
);
reset role;

\echo '--- 13. 取り込みと一括削除 ---'

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

insert into t_ctx
select 'batch', (public.commit_import(jsonb_build_object(
  'calendar_id', (select v from t_ctx where k = 'cal'),
  'name', '9月の休日',
  'file_name', 'holidays.csv',
  'rows', jsonb_build_array(
    jsonb_build_object('title', '休み', 'all_day', true,
      'start_date', '2026-10-03', 'end_date', '2026-10-03',
      'external_key', 'h:1',
      'assignees', jsonb_build_array((select v from t_ctx where k = 'child'))),
    jsonb_build_object('title', '休み', 'all_day', true,
      'start_date', '2026-10-04', 'end_date', '2026-10-04',
      'external_key', 'h:2',
      'assignees', jsonb_build_array((select v from t_ctx where k = 'child'))),
    jsonb_build_object('title', '午前のみ', 'all_day', false,
      'starts_at', '2026-10-09T00:00:00Z', 'ends_at', '2026-10-09T03:00:00Z',
      'external_key', 'h:3',
      'assignees', jsonb_build_array((select v from t_ctx where k = 'child')))
  )
)) ->> 'batch_id');

select pg_temp.expect(
  (select event_count from public.import_batches
   where id = (select v from t_ctx where k = 'batch')::uuid) = 3,
  '3件がまとめて入り、件数が記録される'
);
select pg_temp.expect(
  (select count(*) from public.events
   where import_batch_id = (select v from t_ctx where k = 'batch')::uuid) = 3,
  '入った予定に、どの取り込みかが残る'
);
select pg_temp.expect(
  (select count(*) from public.event_assignees ea
   join public.events e on e.id = ea.event_id
   where e.import_batch_id = (select v from t_ctx where k = 'batch')::uuid) = 3,
  '担当者も一緒に入る'
);

-- 担当者のいない行は、1行でも混ざっていたら全部入らない
do $$
begin
  begin
    perform public.commit_import(jsonb_build_object(
      'calendar_id', (select v from t_ctx where k = 'cal'),
      'name', 'だめな取り込み',
      'rows', jsonb_build_array(
        jsonb_build_object('title', 'よい行', 'all_day', true,
          'start_date', '2026-11-01', 'end_date', '2026-11-01',
          'assignees', jsonb_build_array((select v from t_ctx where k = 'child'))),
        jsonb_build_object('title', '担当者なし', 'all_day', true,
          'start_date', '2026-11-02', 'end_date', '2026-11-02',
          'assignees', '[]'::jsonb))));
    raise exception 'FAILED: 担当者のない行が入ってしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   担当者のない行が混ざると、1件も入らない';
  end;
end
$$;
select pg_temp.expect(
  (select count(*) from public.events where title = 'よい行') = 0,
  '途中まで入った状態は残らない'
);

-- 先に1件だけ手で消しておく。まとめて戻したときに巻き添えで復活しないこと
-- （同じ取引の中なので、時刻の一致では見分けられない。印で見分けている）
select public.delete_event(
  (select id from public.events
   where import_batch_id = (select v from t_ctx where k = 'batch')::uuid
     and external_key = 'h:2'));

-- 塊で消す
select pg_temp.expect(
  public.delete_import_batch((select v from t_ctx where k = 'batch')::uuid) = 2,
  'まとめて消すと、残っていた2件が消える'
);
select pg_temp.expect(
  (select count(*) from public.events
   where import_batch_id = (select v from t_ctx where k = 'batch')::uuid) = 0,
  'その回に入った予定は見えなくなる'
);

-- 塊で戻す
select pg_temp.expect(
  public.restore_import_batch((select v from t_ctx where k = 'batch')::uuid) = 2,
  '戻すと、まとめて消した2件だけが戻る'
);
select pg_temp.expect(
  (select count(*) from public.events
   where import_batch_id = (select v from t_ctx where k = 'batch')::uuid
     and external_key = 'h:2') = 0,
  '先に1件ずつ消していた予定は、巻き添えで戻らない'
);
reset role;

-- 別の家族からは、取り込み履歴も見えない
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
select pg_temp.expect(
  (select count(*) from public.import_batches) = 0,
  '別の家族からは取り込み履歴が見えない'
);
do $$
begin
  begin
    perform public.delete_import_batch(
      (select v from t_ctx where k = 'batch')::uuid);
    raise exception 'FAILED: 別の家族の取り込みを消せてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   別の家族の取り込みは消せない';
  end;
end
$$;
reset role;

\echo '--- 14. 取り込みの設定（プリセット） ---'

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

insert into t_ctx
select 'preset', public.save_import_preset('今月の休日', jsonb_build_object(
  'assignees', jsonb_build_array((select v from t_ctx where k = 'child')),
  'duplicates', 'skip'))::text;

select pg_temp.expect(
  (select settings ->> 'duplicates' from public.import_presets
   where id = (select v from t_ctx where k = 'preset')::uuid) = 'skip',
  '取り込みの設定に名前を付けて残せる'
);

-- 同じ名前で保存し直すと、上書きになる（毎月作り直さない）
select public.save_import_preset('今月の休日', jsonb_build_object(
  'assignees', jsonb_build_array((select v from t_ctx where k = 'child')),
  'duplicates', 'add'));

select pg_temp.expect(
  (select count(*) from public.import_presets where name = '今月の休日') = 1
  and (select settings ->> 'duplicates' from public.import_presets
       where name = '今月の休日') = 'add',
  '同じ名前で保存し直すと上書きになる'
);

-- 名前が空のものは作れない
do $$
begin
  begin
    perform public.save_import_preset('   ', '{}'::jsonb);
    raise exception 'FAILED: 名前なしの設定が保存できた';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   名前のない設定は保存できない';
  end;
end
$$;
reset role;

-- 家族の中では共有される（FR-I18）。別の家族からは見えない
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
select pg_temp.expect(
  (select count(*) from public.import_presets) = 1,
  '同じ家族の他のメンバーからも見える'
);
reset role;

select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
select pg_temp.expect(
  (select count(*) from public.import_presets) = 0,
  '別の家族からは見えない'
);
reset role;

-- 取り込みで繰り返しルールを引き継げる（.ics 用・FR-I05）
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
select public.commit_import(jsonb_build_object(
  'calendar_id', (select v from t_ctx where k = 'cal'),
  'name', 'ics の取り込み',
  'source', 'ics',
  'rows', jsonb_build_array(jsonb_build_object(
    'title', 'ピアノ（ics）', 'all_day', true,
    'start_date', '2026-11-03', 'end_date', '2026-11-03',
    'rrule', 'FREQ=WEEKLY;BYDAY=TU',
    'assignees', jsonb_build_array((select v from t_ctx where k = 'child'))))));

select pg_temp.expect(
  (select rrule from public.events where title = 'ピアノ（ics）')
    = 'FREQ=WEEKLY;BYDAY=TU',
  '取り込んだ予定にも繰り返しルールが入る'
);
reset role;

-- ===========================================================================
\echo '--- 15. 家計簿（費目・記録・予算） ---'

-- 家族ができたときに費目が用意される（FR-B10）
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
select pg_temp.expect(
  (select count(*) from public.budget_categories where kind = 'expense') >= 10
  and (select count(*) from public.budget_categories where kind = 'income') >= 3,
  '家族ができると、最初から使える費目が入っている'
);

select pg_temp.expect(
  not exists (
    select 1 from public.budget_categories
    where lower(color) in ('#dc2626', '#ca8a04')
  ),
  '注意・超過の色は費目に使われていない'
);

insert into t_ctx
select 'cat_food', (select id::text from public.budget_categories
                    where name = '食費' and kind = 'expense');
insert into t_ctx
select 'cat_pay', (select id::text from public.budget_categories
                   where name = '給与' and kind = 'income');

-- 記録を入れる。金額と費目だけで通る（FR-B03 / AC-B02）
insert into t_ctx
select 'tx1', public.create_transaction(jsonb_build_object(
  'amount', 4280,
  'category_id', (select v from t_ctx where k = 'cat_food')))::text;

select pg_temp.expect(
  (select amount from public.transactions
   where id = (select v from t_ctx where k = 'tx1')::uuid) = 4280,
  '金額と費目だけで記録できる'
);
select pg_temp.expect(
  (select occurred_on from public.transactions
   where id = (select v from t_ctx where k = 'tx1')::uuid)
    = (now() at time zone 'Asia/Tokyo')::date,
  '日付を渡さなければ、日本時間の今日になる（FR-B04）'
);
select pg_temp.expect(
  (select kind from public.transactions
   where id = (select v from t_ctx where k = 'tx1')::uuid) = 'expense',
  '向きは費目が決める。支出の費目なら支出'
);

-- 収入の費目を選べば収入になる（FR-B02）
select public.create_transaction(jsonb_build_object(
  'amount', 420000,
  'occurred_on', (now() at time zone 'Asia/Tokyo')::date,
  'category_id', (select v from t_ctx where k = 'cat_pay')));

select pg_temp.expect(
  (select count(*) from public.transactions
   where kind = 'income' and amount = 420000) = 1,
  '収入の費目を選ぶと収入として入る'
);

-- 金額は正の整数だけ（3.3 / 5章）
do $$
begin
  begin
    perform public.create_transaction(jsonb_build_object(
      'amount', -100,
      'category_id', (select v from t_ctx where k = 'cat_food')));
    raise exception 'FAILED: マイナスの金額が入ってしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   マイナスの金額は入らない（向きは kind で表す）';
  end;
end
$$;

-- 予算を決めて、残りを見る（FR-B30 / FR-B31）
select public.set_budget(
  (select v from t_ctx where k = 'cat_food')::uuid, null, 70000);

select pg_temp.expect(
  (select budget from public.budget_status(null)
   where category_id = (select v from t_ctx where k = 'cat_food')::uuid) = 70000
  and (select used from public.budget_status(null)
       where category_id = (select v from t_ctx where k = 'cat_food')::uuid) = 4280,
  '費目ごとの予算と、その月に使った額が引ける'
);

-- 0円にすると「決めていない」に戻る。予算0と未設定を区別するため
select public.set_budget(
  (select v from t_ctx where k = 'cat_food')::uuid, null, 0);
select pg_temp.expect(
  (select budget from public.budget_status(null)
   where category_id = (select v from t_ctx where k = 'cat_food')::uuid) is null,
  '予算を0にすると、決めていない状態に戻る'
);
select public.set_budget(
  (select v from t_ctx where k = 'cat_food')::uuid, null, 70000);

-- 先月の記録は今月の残りに混ざらない（3.5）
select public.create_transaction(jsonb_build_object(
  'amount', 9999,
  'occurred_on', (date_trunc('month', (now() at time zone 'Asia/Tokyo')::date)
                  - interval '1 day')::date,
  'category_id', (select v from t_ctx where k = 'cat_food')));

select pg_temp.expect(
  (select used from public.budget_status(null)
   where category_id = (select v from t_ctx where k = 'cat_food')::uuid) = 4280,
  '先月の記録は今月の「使った額」に入らない'
);

-- 消したら残りに入らない。30日は戻せる（FR-B05）
select public.delete_transaction((select v from t_ctx where k = 'tx1')::uuid);
select pg_temp.expect(
  (select used from public.budget_status(null)
   where category_id = (select v from t_ctx where k = 'cat_food')::uuid) = 0,
  '消した記録は、使った額から外れる'
);
select public.restore_transaction((select v from t_ctx where k = 'tx1')::uuid);
select pg_temp.expect(
  (select used from public.budget_status(null)
   where category_id = (select v from t_ctx where k = 'cat_food')::uuid) = 4280,
  '戻すと、また使った額に入る'
);

-- テーブルに直接は書けない。書き込みは関数を通す
do $$
begin
  begin
    insert into public.transactions
      (family_id, occurred_on, amount, kind, category_id)
    values ((select v from t_ctx where k = 'family_a')::uuid,
            current_date, 100, 'expense',
            (select v from t_ctx where k = 'cat_food')::uuid);
    raise exception 'FAILED: テーブルに直接書き込めてしまった';
  exception
    when insufficient_privilege then
      raise notice '  ok   記録はテーブルに直接書き込めない';
  end;
end
$$;

-- 費目は隠せるが消えない（FR-B13）
select public.update_budget_category(
  (select v from t_ctx where k = 'cat_food')::uuid,
  '{"is_active": false}'::jsonb);
select pg_temp.expect(
  (select not is_active from public.budget_categories
   where id = (select v from t_ctx where k = 'cat_food')::uuid)
  and (select count(*) from public.transactions
       where category_id = (select v from t_ctx where k = 'cat_food')::uuid
         and deleted_at is null) = 2,
  '隠した費目でも、それまでの記録は残る'
);
select public.update_budget_category(
  (select v from t_ctx where k = 'cat_food')::uuid,
  '{"is_active": true}'::jsonb);

-- 同じ名前の費目は作れない
do $$
begin
  begin
    perform public.create_budget_category('{"name": "食費"}'::jsonb);
    raise exception 'FAILED: 同じ名前の費目が作れてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   同じ名前の費目は作れない';
  end;
end
$$;
reset role;

-- 家族の中では共有される。別の家族からは見えない（3.4 / AC-B06）
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
select pg_temp.expect(
  (select count(*) from public.transactions where amount = 4280) = 1,
  '同じ家族の他のメンバーからも記録が見える'
);
reset role;

select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
select pg_temp.expect(
  (select count(*) from public.transactions) = 0
  and (select count(*) from public.budgets) = 0,
  '別の家族からは、記録も予算も見えない'
);
select pg_temp.expect(
  (select count(*) from public.budget_status(null)
   where category_id = (select v from t_ctx where k = 'cat_food')::uuid) = 0,
  '別の家族の費目は budget_status にも出てこない'
);

-- 別の家族の費目には記録も予算も付けられない
do $$
begin
  begin
    perform public.create_transaction(jsonb_build_object(
      'amount', 100,
      'category_id', (select v from t_ctx where k = 'cat_food')));
    raise exception 'FAILED: 別の家族の費目に記録できてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   別の家族の費目には記録できない';
  end;
end
$$;

do $$
begin
  begin
    perform public.set_budget(
      (select v from t_ctx where k = 'cat_food')::uuid, null, 50000);
    raise exception 'FAILED: 別の家族の予算を決められてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   別の家族の費目には予算を決められない';
  end;
end
$$;

do $$
begin
  begin
    perform public.delete_transaction((select v from t_ctx where k = 'tx1')::uuid);
    raise exception 'FAILED: 別の家族の記録を消せてしまった';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAILED%' then raise; end if;
      raise notice '  ok   別の家族の記録は消せない';
  end;
end
$$;
reset role;

-- ===========================================================================
\echo '--- 16. メンバーの色 ---'

-- Supabase の Table Editor からの追加を模す（RLS を通らない直接の insert）。
-- 色の列を省いても、既定値の青ではなく空いている色が入ること。
insert into public.members (family_id, display_name)
values ((select v from t_ctx where k = 'family_a')::uuid, 'いろは');

select pg_temp.expect(
  (select color from public.members where display_name = 'いろは') <> '#2563eb',
  '色を入れずに足しても、管理者と同じ色にはならない'
);

-- 空欄（空文字）でもよい
insert into public.members (family_id, display_name, color)
values ((select v from t_ctx where k = 'family_a')::uuid, 'にほへ', '');

select pg_temp.expect(
  (select color from public.members where display_name = 'にほへ')
    ~ '^#[0-9a-f]{6}$',
  '色を空欄にして足しても、ちゃんとした色が入る'
);

select pg_temp.expect(
  (select count(distinct color) from public.members
   where family_id = (select v from t_ctx where k = 'family_a')::uuid)
  = (select count(*) from public.members
     where family_id = (select v from t_ctx where k = 'family_a')::uuid),
  '同じ家族の中で、色が重なっていない'
);

select pg_temp.expect(
  not exists (
    select 1 from public.members
    where lower(color) in ('#dc2626', '#ca8a04')
  ),
  '注意・超過の色は、人の色としても割り当てられない'
);

-- 本人が自分の色を変えられる
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
update public.members set color = '#c026d3'
where user_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.expect(
  (select color from public.members
   where user_id = '11111111-1111-1111-1111-111111111111') = '#c026d3',
  '自分の色は自分で変えられる'
);
reset role;

-- 管理者でない人は、他人の色を変えられない
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
update public.members set color = '#16a34a'
where user_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.expect(
  (select color from public.members
   where user_id = '11111111-1111-1111-1111-111111111111') = '#c026d3',
  '管理者でない人は、他人の色を変えられない'
);
reset role;

rollback;

\echo ''
\echo 'すべて成功しました'
