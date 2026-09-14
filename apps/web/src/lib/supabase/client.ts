import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/types";
import { getSupabaseEnv } from "@/lib/supabase/env";

/** ブラウザ（クライアントコンポーネント）から使う Supabase クライアント。 */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
