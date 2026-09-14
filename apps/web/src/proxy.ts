import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * リクエストのたびに Supabase のセッションを更新する。
 *
 * Server Component は Cookie を書き換えられないため、
 * 期限が近づいたトークンの差し替えはここで行う必要がある。
 *
 * Next.js 16 で middleware.ts は proxy.ts に改名された。
 * 関数名も proxy でなければならない。
 */
export async function proxy(request: NextRequest) {
  // 環境変数が未設定のうちは何もしない（セットアップ前でも画面は開けるように）。
  if (!hasSupabaseEnv()) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() を呼ぶことでトークンが更新される。呼ばないと期限切れに気づけない。
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * 静的ファイルと画像最適化を除いた全パス。
     * セッション更新が不要なリクエストで Supabase を叩かないようにする。
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
