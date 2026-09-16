import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { SignUpForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (!hasSupabaseEnv()) redirect("/");

  // ここでアカウントを作れるのは、まだ家族が1つも無いとき（最初の1人）だけ。
  // 2人目以降は、管理者が /members から登録する。
  const supabase = await createClient();
  const { data: isBootstrap } = await supabase.rpc("is_bootstrap");

  if (!isBootstrap) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm">
          このアプリのアカウントは、家族の管理者が登録します。
        </p>
        <p className="text-sm text-muted">
          管理者にメンバーとして追加してもらうと、
          伝えられたメールアドレスとパスワードでログインできます。
        </p>
        <Link
          href="/login"
          className="inline-block text-sm text-accent underline"
        >
          ログイン画面へ
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted">
        最初のアカウントです。ここで作った人が家族の管理者になり、
        以降のメンバーは管理者が登録します。
      </p>
      <SignUpForm />
    </div>
  );
}
