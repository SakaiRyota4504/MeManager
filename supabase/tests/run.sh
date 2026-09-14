#!/usr/bin/env bash
# マイグレーションと RLS を、使い捨ての PostgreSQL 上で検証する。
#
# Supabase CLI（Docker）が使えない環境でも、
# RLS ポリシーの正しさだけは確かめられるようにしてある。
#
# 必要なもの: PostgreSQL サーバー（起動済み）と psql
# 使い方: supabase/tests/run.sh
set -euo pipefail

DB_NAME="${DB_NAME:-memanager_test}"
PSQL=(psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc)

cd "$(dirname "$0")/../.."

echo "==> テスト用データベースを作り直す: ${DB_NAME}"
dropdb --if-exists "${DB_NAME}"
createdb "${DB_NAME}"

echo "==> Supabase 相当の前提を用意する"
"${PSQL[@]}" -d "${DB_NAME}" -f supabase/tests/00-bootstrap.sql

echo "==> マイグレーションを適用する"
for f in supabase/migrations/*.sql; do
  echo "    - $(basename "$f")"
  "${PSQL[@]}" -d "${DB_NAME}" -f "$f"
done

echo "==> RLS を検証する"
"${PSQL[@]}" -d "${DB_NAME}" -f supabase/tests/rls_test.sql

dropdb "${DB_NAME}"
