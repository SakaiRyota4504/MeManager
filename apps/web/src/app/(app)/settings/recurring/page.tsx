import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { currentMonth } from "@/lib/budget/month";
import { fetchCategoryStatus, fetchRecurring } from "@/lib/budget/queries";
import { RecurringList } from "./recurring-list";

export const dynamic = "force-dynamic";

/**
 * 固定費（docs/07-budget-requirements.md 4.3）。
 *
 * ここは登録するだけ。**記録にするのは入力画面**で、
 * 「今月まだ入れていない固定費」を押したとき（FR-B22）。
 */
export default async function RecurringPage() {
  await requireSession();

  const supabase = await createClient();
  const [items, categories, { data: members }] = await Promise.all([
    fetchRecurring(),
    fetchCategoryStatus(currentMonth()),
    supabase
      .from("members")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto px-5 py-7">
      <div className="space-y-1">
        <h1 className="text-base font-semibold">固定費</h1>
        {/* 日本語は改行がそのまま空白になるので、1つの文字列にまとめて渡す */}
        <p className="text-sm text-muted">
          {"家賃やサブスクのように、毎月決まって出ていくものを登録します。"}
        </p>
        <p className="text-sm text-muted">
          {
            "登録しても勝手には記録に入りません。入力の画面に「今月まだ入れていない固定費」として出るので、引き落としを確かめてから押してください。"
          }
        </p>
      </div>

      <RecurringList
        items={items}
        categories={categories}
        members={members ?? []}
      />
    </div>
  );
}
