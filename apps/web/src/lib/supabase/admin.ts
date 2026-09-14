import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * サービスロールキーを使う管理用クライアント。
 *
 * このキーは RLS を迂回し、すべてのデータを操作できる。
 * 使ってよいのは、公開サインアップを止めた代わりに
 * 招待を検証してからユーザーを作る処理だけ。
 *
 * "server-only" を読み込んでいるので、
 * クライアントコンポーネントから import するとビルドが失敗する。
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY が設定されていません。" +
        "アカウントの作成にはこの鍵が必要です（.env.example を参照）。",
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
