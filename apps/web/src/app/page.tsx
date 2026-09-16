import Link from "next/link";
import { redirect } from "next/navigation";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { checkDatabaseConnection } from "@/lib/supabase/health";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const configured = hasSupabaseEnv();

  if (configured) {
    const session = await getSession();
    if (session) redirect("/calendar");
  }

  const connection = configured ? await checkDatabaseConnection() : null;
  const connected = connection?.ok ?? false;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">MeManager</h1>
        <p className="text-sm text-muted">家族で共有する、暮らしの管理</p>
      </header>

      {connected ? (
        <div className="flex gap-3">
          <Link
            href="/login"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            ログイン
          </Link>
          <Link
            href="/signup"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium"
          >
            アカウントを作る
          </Link>
        </div>
      ) : (
        <section className="space-y-4 rounded-lg border border-border p-5">
          <h2 className="text-sm font-semibold">セットアップの状態</h2>
          <dl className="space-y-3 text-sm">
            <StatusRow
              label="環境変数"
              ok={configured}
              okText="設定済み"
              ngText=".env.local が未設定です"
            />
            <StatusRow
              label="Supabase への接続"
              ok={connected}
              okText="接続できました"
              ngText={
                configured
                  ? (connection?.message ?? "接続できません")
                  : "環境変数の設定待ち"
              }
            />
          </dl>
          <div className="space-y-2 border-t border-dashed pt-4 text-sm text-muted">
            <p className="font-medium text-foreground">次にやること</p>
            <ol className="list-inside list-decimal space-y-1">
              <li>
                <code className="text-xs">supabase start</code>{" "}
                でローカル環境を起動する
              </li>
              <li>
                表示された URL と anon key を{" "}
                <code className="text-xs">.env.local</code> に書く
              </li>
              <li>
                <code className="text-xs">supabase db reset</code>{" "}
                でマイグレーションを適用する
              </li>
              <li>開発サーバーを再起動する</li>
            </ol>
          </div>
        </section>
      )}
    </main>
  );
}

function StatusRow({
  label,
  ok,
  okText,
  ngText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  ngText: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="flex items-center gap-2 text-right">
        <span
          aria-hidden
          className={`inline-block size-2 shrink-0 rounded-full ${
            ok ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
        <span>{ok ? okText : ngText}</span>
      </dd>
    </div>
  );
}
