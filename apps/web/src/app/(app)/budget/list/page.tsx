import Link from "next/link";

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatYen } from "@/lib/budget/money";
import {
  currentMonth,
  formatMonth,
  isMonthKey,
  shiftMonth,
} from "@/lib/budget/month";
import {
  fetchCategoryStatus,
  fetchMonthTransactions,
} from "@/lib/budget/queries";
import { TransactionList } from "./transaction-list";

export const dynamic = "force-dynamic";

/**
 * 月の記録。
 *
 * どの月を見ているかは URL に持たせる。
 * 「この月を見て」と家族にリンクを送れるようにするため（スケジュールと同じ）。
 */
export default async function BudgetListPage(props: PageProps<"/budget/list">) {
  await requireSession();
  const params = await props.searchParams;
  const month = isMonthKey(params.m) ? params.m : currentMonth();

  const supabase = await createClient();
  const [rows, categories, { data: members }] = await Promise.all([
    fetchMonthTransactions(month),
    fetchCategoryStatus(month),
    supabase
      .from("members")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
  ]);

  const spent = rows
    .filter((t) => t.kind === "expense")
    .reduce((sum, t) => sum + t.amount, 0);
  const income = rows
    .filter((t) => t.kind === "income")
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthLink month={shiftMonth(month, -1)} label="前の月" arrow="‹" />
        <h1 className="text-base font-semibold">{formatMonth(month)}</h1>
        <MonthLink month={shiftMonth(month, 1)} label="次の月" arrow="›" />
        {month !== currentMonth() && (
          <Link href="/budget/list" className="text-xs text-muted underline">
            今月へ
          </Link>
        )}
        <span className="ml-auto text-[13px] tabular-nums">
          支出 <b>{formatYen(spent)}円</b>
          {income > 0 && (
            <span className="ml-2 text-muted">収入 {formatYen(income)}円</span>
          )}
        </span>
      </div>

      <TransactionList
        rows={rows}
        categories={categories}
        members={members ?? []}
      />
    </div>
  );
}

function MonthLink({
  month,
  label,
  arrow,
}: {
  month: string;
  label: string;
  arrow: string;
}) {
  return (
    <Link
      href={`/budget/list?m=${month}`}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-md border border-border text-muted"
    >
      {arrow}
    </Link>
  );
}
