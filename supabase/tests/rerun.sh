#!/usr/bin/env bash
# 貼り付け用の schema.sql が「何度流しても通る」ことを確かめる。
#
# **これが通らないと、更新のたびに手詰まりになる。**
# Supabase CLI を使わない運用なので、ユーザーは schema.sql を
# SQL Editor に貼って実行する。すでにテーブルがある状態で流し直せないと、
# 「どこまで実行したか」を人が覚えていないと更新できなくなる。
#
# 確かめること:
#   1. 空のDBに流せる
#   2. そのまま2回、3回流してもエラーにならない
#   3. **データが入っているDBに流しても、データが消えない**
#      （前半だけ実行済みの状態からの更新。これが実際に起きた）
#
# 必要なもの: PostgreSQL サーバー（起動済み）と psql
# 使い方: supabase/tests/rerun.sh
set -euo pipefail

DB_NAME="${DB_NAME:-memanager_rerun}"
PSQL=(psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc)

cd "$(dirname "$0")/../.."

cleanup() { dropdb --if-exists "${DB_NAME}" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> 1. 空のデータベースに流す"
cleanup
createdb "${DB_NAME}"
"${PSQL[@]}" -d "${DB_NAME}" -f supabase/tests/00-bootstrap.sql > /dev/null
"${PSQL[@]}" -d "${DB_NAME}" -f supabase/schema.sql > /dev/null
echo "    ok"

echo "==> 2. 同じものを2回、3回流す"
"${PSQL[@]}" -d "${DB_NAME}" -f supabase/schema.sql > /dev/null
"${PSQL[@]}" -d "${DB_NAME}" -f supabase/schema.sql > /dev/null
echo "    ok"

echo "==> 3. 途中まで実行した、データ入りのデータベースに流す"
cleanup
createdb "${DB_NAME}"
"${PSQL[@]}" -d "${DB_NAME}" -f supabase/tests/00-bootstrap.sql > /dev/null

# 家計簿より前の状態を作る（2026年9月19日までのマイグレーション）
for f in supabase/migrations/2026091*.sql; do
  "${PSQL[@]}" -d "${DB_NAME}" -f "$f" > /dev/null
done

# 家族と予定を入れておく。これが消えたら困る
"${PSQL[@]}" -d "${DB_NAME}" > /dev/null <<'SQL'
insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', 'chichi@example.com',
        '{"display_name":"父","family_name":"さかい家"}'::jsonb);
insert into public.members (family_id, display_name)
select id, '母' from public.families;
insert into public.events (family_id, calendar_id, title, all_day, start_date, end_date)
select f.id, c.id, '運動会', true, '2026-10-10', '2026-10-10'
from public.families f join public.calendars c on c.family_id = f.id;
SQL

"${PSQL[@]}" -d "${DB_NAME}" -f supabase/schema.sql > /dev/null

# データが残っているか
assert() {
  local got
  got=$("${PSQL[@]}" -t -A -d "${DB_NAME}" -c "$1")
  if [ "${got}" != "$2" ]; then
    echo "失敗: $3（期待 $2 / 実際 ${got}）"
    exit 1
  fi
  echo "    ok   $3"
}

assert "select count(*) from public.events" "1" "予定が消えていない"
assert "select count(*) from public.members" "2" "メンバーが消えていない"
assert "select name from public.families" "さかい家" "家族の名前が変わっていない"
assert "select count(*) from public.budget_categories" "18" "家計簿の費目が自動で入る"
assert "select count(distinct color) from public.members" "2" "重なっていた色が振り直される"
assert "select color from public.members where display_name = '父'" "#2563eb" \
  "先にいた人の色は変わらない"

echo ""
echo "すべて成功しました（何度でも流し直せます）"
