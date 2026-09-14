import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/types";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * サーバー（Server Component / Route Handler / Server Action）から使う Supabase クライアント。
 *
 * Next.js 16 では cookies() が非同期なので、この関数も非同期になる。
 */
export async function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からは Cookie を書けない。
          // セッションの更新は proxy.ts が行うので、ここは無視してよい。
        }
      },
    },
  });
}
