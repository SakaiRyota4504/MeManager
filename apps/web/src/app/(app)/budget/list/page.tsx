import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatYen } from "@/lib/budget/money";
import { currentMonth, isMonthKey } from "@/lib/budget/month";
import { applyFilter, isFiltering, parseFilter } from "@/lib/budget/filter";
import {
  fetchCategoryStatus,
  fetchMonthTransactions,
} from "@/lib/budget/queries";
import { totals } from "@/lib/budget/summary";
import { MonthNav } from "../month-nav";
import { FilterBar } from "./filter-bar";
import { TransactionList } from "./transaction-list";

export const dynamic = "force-dynamic";

/** 月の記録。押すと直せる */
export default async function BudgetListPage(props: PageProps<"/budget/list">) {
  await requireSession();
  const params = await props.searchParams;
  const month = isMonthKey(params.m) ? params.m : currentMonth();
  const filter = parseFilter(params);

  const supabase = await createClient();
  const [all, categories, { data: members }] = await Promise.all([
    fetchMonthTransactions(month),
    fetchCategoryStatus(month),
    supabase
      .from("members")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
  ]);

  const rows = applyFilter(all, filter);
  const sum = totals(rows);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
      <MonthNav month={month} base="/budget/list">
        <span className="ml-auto text-[13px] tabular-nums">
          支出 <b>{formatYen(sum.expense)}円</b>
          {sum.income > 0 && (
            <span className="ml-2 text-muted">
              収入 {formatYen(sum.income)}円
            </span>
          )}
        </span>
      </MonthNav>

      <FilterBar
        month={month}
        filter={filter}
        categories={categories}
        members={members ?? []}
      />

      {isFiltering(filter) && (
        <p className="text-xs text-muted">
          {`${all.length}件のうち ${rows.length}件`}
        </p>
      )}

      <TransactionList
        rows={rows}
        categories={categories}
        members={members ?? []}
      />
    </div>
  );
}
