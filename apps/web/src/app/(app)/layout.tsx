import Link from "next/link";

import { requireSession } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";
import { HOME } from "@/lib/nav/features";
import {
  BottomBar,
  BottomBarSpacer,
  FeatureTabs,
  ScreenTabs,
} from "@/components/app-nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();

  return (
    <>
      <header className="flex w-full items-center gap-4 border-b border-border px-4">
        <Link href={HOME} className="shrink-0 py-3 font-semibold">
          MeManager
        </Link>

        <FeatureTabs />

        <div className="ml-auto flex shrink-0 items-center gap-3 py-3 text-xs text-muted">
          <span className="hidden sm:inline">{session.family.name}</span>
          <span className="flex items-center gap-1.5 text-foreground">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: session.member.color }}
            />
            {session.member.display_name}
          </span>
          <form action={signOut}>
            <button type="submit" className="underline">
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <ScreenTabs />

      {/* 左右の余白は画面ごとに決める。
          カレンダーは端まで使い、それ以外は読みやすい幅で中央に寄せる。 */}
      <div className="w-full flex-1">{children}</div>

      <BottomBarSpacer />
      <BottomBar />
    </>
  );
}
