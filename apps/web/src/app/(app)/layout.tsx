import Link from "next/link";

import { requireSession } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();

  return (
    <>
      <header className="border-b border-border">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href="/calendar" className="font-semibold">
              MeManager
            </Link>
            <nav className="flex gap-3 text-sm">
              <Link href="/calendar" className="text-muted hover:underline">
                カレンダー
              </Link>
              <Link href="/members" className="text-muted hover:underline">
                メンバー
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">
              {session.family.name}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-full"
                style={{ backgroundColor: session.member.color }}
              />
              {session.member.display_name}
            </span>
            <form action={signOut}>
              <button type="submit" className="text-muted underline">
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>
      {/* 左右の余白は画面ごとに決める。
          カレンダーは端まで使い、それ以外は読みやすい幅で中央に寄せる。 */}
      <div className="w-full flex-1">{children}</div>
    </>
  );
}
