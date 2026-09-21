import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatYen, level, remaining } from "@/lib/budget/money";
import {
  currentMonth,
  formatMonth,
  isMonthKey,
  shiftMonth,
} from "@/lib/budget/month";
import {
  fetchCategoryStatus,
  fetchMonthTransactions,
  fetchTotalBudget,
  fetchTrend,
} from "@/lib/budget/queries";
import { byCategory, byMember, totals } from "@/lib/budget/summary";
import { MonthNav } from "../month-nav";
import { LevelPill, Meter } from "../parts";
import { Breakdown } from "./breakdown";
import { Tiles } from "./tiles";
import { TrendChart } from "./trend-chart";

export const dynamic = "force-dynamic";

/**
 * 月の集計（docs/07-budget-requirements.md 4.5）。
 *
 * 「今月あとどれくらい使えるか」を知るための画面。
 * 分析の道具ではないので、絞り込みも並べ替えも置かない。
 */
export default async function BudgetSummaryPage(
  props: PageProps<"/budget/summary">,
) {
  await requireSession();
  const params = await props.searchParams;
  const month = isMonthKey(params.m) ? params.m : currentMonth();

  const supabase = await createClient();
  const [rows, categories, trend, totalBudget, { data: members }] =
    await Promise.all([
      fetchMonthTransactions(month),
      fetchCategoryStatus(month),
      fetchTrend(month, 12),
      fetchTotalBudget(month),
      supabase
        .from("members")
        .select("*")
        .eq("is_active", true)
        .order("created_at"),
    ]);

  const sum = totals(rows);
  const previous =
    trend.find((p) => p.month.slice(0, 7) === shiftMonth(month, -1))?.expense ??
    0;

  const categorySlices = byCategory(rows, categories, "expense");
  const memberSlices = byMember(rows, members ?? []);
  const incomeSlices = byCategory(rows, categories, "income");

  const totalLevel = level(sum.expense, totalBudget);
  const totalRest = remaining(sum.expense, totalBudget);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-4">
      <MonthNav month={month} base="/budget/summary" />

      <Tiles
        expense={sum.expense}
        income={sum.income}
        previousExpense={previous}
      />

      {/* 費目を決めない全体の予算（FR-B34）。決めていなければ出さない */}
      {totalBudget !== null && (
        <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <span className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span>ひと月の予算</span>
            <span className="text-muted tabular-nums">
              {formatYen(sum.expense)} / {formatYen(totalBudget)}円
            </span>
            <LevelPill level={totalLevel} />
            <span
              className={`ml-auto font-bold tabular-nums ${
                totalLevel === "over"
                  ? "text-over"
                  : totalLevel === "warn"
                    ? "text-warn"
                    : ""
              }`}
            >
              {totalRest >= 0
                ? `残り ${formatYen(totalRest)}円`
                : `${formatYen(-totalRest)}円 超過`}
            </span>
          </span>
          <Meter used={sum.expense} budget={totalBudget} level={totalLevel} />
        </section>
      )}

      <section className="flex flex-col gap-2.5">
        <h2 className="text-sm font-semibold">費目ごと</h2>
        <Breakdown slices={categorySlices} total={sum.expense} withBudget />
      </section>

      {memberSlices.length > 1 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-sm font-semibold">使った人ごと</h2>
          <Breakdown slices={memberSlices} total={sum.expense} />
        </section>
      )}

      {incomeSlices.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-sm font-semibold">収入の内訳</h2>
          <Breakdown slices={incomeSlices} total={sum.income} />
        </section>
      )}

      <section className="flex flex-col gap-2.5">
        <h2 className="text-sm font-semibold">{formatMonth(month)}までの1年</h2>
        <TrendChart points={trend} month={month} />
      </section>
    </div>
  );
}
