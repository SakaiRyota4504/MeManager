#!/usr/bin/env bash
# マイグレーションを1つのSQLファイルにまとめる。
#
# Supabase CLI（と Docker）を使わずに、ダッシュボードの SQL Editor に
# 貼り付けて実行するためのもの。
#
# 使い方: supabase/bundle.sh > schema.sql
set -euo pipefail

cd "$(dirname "$0")/.."

echo "-- MeManager スキーマ一式"
echo "-- supabase/bundle.sh が supabase/migrations/ から生成したもの。"
echo "-- Supabase ダッシュボードの SQL Editor に貼り付けて実行する。"
echo "-- 手で書き換えない。変更は migrations/ 側に加えて生成し直す。"
echo "--"
echo "-- 生成日時: $(date -u '+%Y-%m-%d %H:%M UTC')"
echo ""
echo "begin;"
echo ""

for f in supabase/migrations/*.sql; do
  echo "-- ==========================================================="
  echo "-- $(basename "$f")"
  echo "-- ==========================================================="
  cat "$f"
  echo ""
done

echo "commit;"
