import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { todayKey } from "@/lib/calendar/date";
import { currentMonth, formatMonth } from "@/lib/budget/month";
import {
  fetchCategoryStatus,
  fetchDefaultMemberId,
  fetchRecentTransactions,
  fetchRecordedRecurring,
  fetchRecurring,
} from "@/lib/budget/queries";
import { occurrencesIn } from "@/lib/budget/pending";
import { formatYen } from "@/lib/budget/money";
import { EntryForm } from "./entry-form";
import { PendingRecurring } from "./pending-recurring";
import { RecentList } from "./recent-list";

export const dynamic = "force-dynamic";

/**
 * 家計簿の入力。機能を開いたとき最初に出る画面。
 *
 * レジを出た直後のスマートフォンで開くのが主な使い方なので、
 * 集計ではなく入力を先に出す（docs/07-budget-requirements.md 6章）。
 */
export default async function BudgetPage() {
  const session = await requireSession();
  const today = todayKey();
  const month = currentMonth();

  const supabase = await createClient();
  const [
    categories,
    { data: members },
    recent,
    defaultMemberId,
    recurring,
    recorded,
  ] = await Promise.all([
    fetchCategoryStatus(month),
    supabase
      .from("members")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
    fetchRecentTransactions(5),
    fetchDefaultMemberId(session.member.id),
    fetchRecurring(),
    fetchRecordedRecurring(month),
  ]);

  const occurrences = occurrencesIn(recurring, month, recorded);

  const spent = categories
    .filter((c) => c.kind === "expense")
    .reduce((sum, c) => sum + c.used, 0);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-5 lg:grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start lg:gap-8">
      <EntryForm
        categories={categories}
        members={members ?? []}
        today={today}
        defaultMemberId={defaultMemberId}
      />

      <div className="flex flex-col gap-4">
        <PendingRecurring
          occurrences={occurrences}
          categories={categories}
          today={today}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">
            {formatMonth(month)}は {formatYen(spent)}円 使いました
          </span>
          <RecentList rows={recent} members={members ?? []} today={today} />
        </div>
      </div>
    </div>
  );
}
