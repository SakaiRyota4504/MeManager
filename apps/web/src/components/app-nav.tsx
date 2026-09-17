"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MENU, featureOf, screenOf, type FeatureId } from "@/lib/nav/features";

/**
 * 機能の切り替え。
 *
 * パソコンは上のタブ、スマートフォンは下のバー。
 * 左に縦のメニューを置かないのは、カレンダーの1マスが「画面幅÷7」で決まり、
 * 200px のメニューが予定名の2〜3文字ぶんに当たるため（docs/06-app-shell.md）。
 *
 * 行き先が1つしか無いうちは、どちらも出さない。
 */

const ICONS: Record<FeatureId, React.ReactNode> = {
  schedule: (
    <path d="M7 3v3M17 3v3M3.5 9h17M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5Z" />
  ),
  habits: (
    <>
      <path d="M4 12.5 9 17.5 20 6.5" />
      <path d="M4 6.5 6.5 9" />
    </>
  ),
  budget: (
    <>
      <path d="M3.5 7.5h17v11h-17z" />
      <path d="M3.5 11h17" />
      <circle cx="16.5" cy="15" r="1.4" />
    </>
  ),
  meals: (
    <>
      <path d="M7 3.5v8M4.5 3.5v4a2.5 2.5 0 0 0 5 0v-4" />
      <path d="M16.5 3.5c-1.5 1.5-2 3.5-2 6h4c0-2.5-.5-4.5-2-6Z" />
      <path d="M7 11.5v9M16.5 9.5v11" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.5 1.5M7.5 16.5 6 18M18 18l-1.5-1.5M7.5 7.5 6 6" />
    </>
  ),
};

function Icon({ id }: { id: FeatureId }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-[21px] shrink-0"
    >
      {ICONS[id]}
    </svg>
  );
}

/** 上のタブ（パソコン） */
export function FeatureTabs() {
  const pathname = usePathname();
  if (MENU.length < 2) return null;
  const current = featureOf(pathname);

  return (
    <nav aria-label="機能" className="hidden min-w-0 gap-0.5 md:flex">
      {MENU.map((f) => {
        const on = current?.id === f.id;
        return (
          <Link
            key={f.id}
            href={f.href}
            aria-current={on ? "page" : undefined}
            className={`border-b-2 px-3 pt-3 pb-2.5 text-sm whitespace-nowrap ${
              on
                ? "border-accent font-semibold"
                : "border-transparent text-muted"
            }`}
          >
            {f.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 機能の中の画面。1つしか無い機能では出さない */
export function ScreenTabs() {
  const pathname = usePathname();
  const feature = featureOf(pathname);
  if (!feature || feature.screens.length < 2) return null;
  const current = screenOf(feature, pathname);

  return (
    <nav
      aria-label={`${feature.label}の画面`}
      className="flex gap-3.5 overflow-x-auto border-b border-border bg-surface-2 px-3"
    >
      {feature.screens.map((s) => {
        const on = current?.href === s.href;
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={on ? "page" : undefined}
            className={`border-b-2 py-2 text-xs whitespace-nowrap ${
              on ? "border-foreground" : "border-transparent text-muted"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 下のバー（スマートフォン） */
export function BottomBar() {
  const pathname = usePathname();
  if (MENU.length < 2) return null;
  const current = featureOf(pathname);

  return (
    <nav
      aria-label="機能"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-background md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {MENU.map((f) => {
        const on = current?.id === f.id;
        return (
          <Link
            key={f.id}
            href={f.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10.5px] ${
              on ? "text-accent" : "text-muted"
            }`}
          >
            <Icon id={f.id} />
            {f.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 下のバーに隠れないよう、本文の下に空ける高さ */
export function BottomBarSpacer() {
  if (MENU.length < 2) return null;
  return (
    <div
      aria-hidden
      className="md:hidden"
      style={{ height: "calc(52px + env(safe-area-inset-bottom, 0px))" }}
    />
  );
}
