type SupabaseEnv = {
  url: string;
  anonKey: string;
};

/**
 * Supabase の接続情報を環境変数から読む。
 *
 * 未設定のまま起動すると、原因の分かりにくいエラーが実行時まで出ないため、
 * ここで明示的に落として .env.local の設定を促す。
 */
export function getSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]
      .filter(Boolean)
      .join(", ");

    throw new Error(
      `Supabase の環境変数が設定されていません: ${missing}\n` +
        `.env.example を .env.local にコピーして値を入れてください。`,
    );
  }

  return { url, anonKey };
}

/** 環境変数が揃っているかだけを調べる（例外を投げない）。 */
export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
