import { createClient } from "@/lib/supabase/server";

export type ConnectionResult = {
  ok: boolean;
  message?: string;
};

/**
 * Supabase に届いているかを確認する。
 *
 * テーブルがまだ無い段階でも判定できるよう、Auth のセッション取得で確かめる。
 * 未ログインでもエラーにならず、通信できていれば成功が返る。
 */
export async function checkDatabaseConnection(): Promise<ConnectionResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.getSession();

    if (error) {
      return { ok: false, message: error.message };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "接続に失敗しました",
    };
  }
}
