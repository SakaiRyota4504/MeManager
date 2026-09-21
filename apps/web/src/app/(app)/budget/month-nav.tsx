import Link from "next/link";

import { currentMonth, formatMonth, shiftMonth } from "@/lib/budget/month";

/**
 * 見ている月。一覧と集計で同じものを使う。
 *
 * どの月を見ているかは URL に持たせる。
 * 「この月を見て」と家族にリンクを送れるようにするため（スケジュールと同じ）。
 */
export function MonthNav({
  month,
  base,
  children,
}: {
  month: string;
  base: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MonthLink href={`${base}?m=${shiftMonth(month, -1)}`} label="前の月">
        ‹
      </MonthLink>
      <h1 className="text-base font-semibold">{formatMonth(month)}</h1>
      <MonthLink href={`${base}?m=${shiftMonth(month, 1)}`} label="次の月">
        ›
      </MonthLink>
      {month !== currentMonth() && (
        <Link href={base} className="text-xs text-muted underline">
          今月へ
        </Link>
      )}
      {children}
    </div>
  );
}

function MonthLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-md border border-border text-muted"
    >
      {children}
    </Link>
  );
}
