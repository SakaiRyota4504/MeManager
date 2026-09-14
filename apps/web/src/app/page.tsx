import { hasSupabaseEnv } from "@/lib/supabase/env";
import { checkDatabaseConnection } from "@/lib/supabase/health";

export const dynamic = "force-dynamic";

export default async function Home() {
  const configured = hasSupabaseEnv();
  const connection = configured ? await checkDatabaseConnection() : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">MeManager</h1>
        <p className="text-sm text-muted">家族で共有する、暮らしの管理</p>
      </header>

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
            ok={connection?.ok ?? false}
            okText="接続できました"
            ngText={
              configured
                ? (connection?.message ?? "接続できません")
                : "環境変数の設定待ち"
            }
          />
        </dl>
      </section>

      {!configured && (
        <section className="space-y-2 rounded-lg border border-dashed border-border p-5 text-sm text-muted">
          <p className="font-medium text-foreground">次にやること</p>
          <ol className="list-inside list-decimal space-y-1">
            <li>
              <code className="text-xs">supabase start</code>{" "}
              でローカル環境を起動する
            </li>
            <li>
              表示された URL と anon key を{" "}
              <code className="text-xs">.env.local</code> に書く （
              <code className="text-xs">.env.example</code> を参照）
            </li>
            <li>開発サーバーを再起動する</li>
          </ol>
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
