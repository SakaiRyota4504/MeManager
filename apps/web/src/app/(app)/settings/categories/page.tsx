import { requireSession } from "@/lib/auth/session";
import { currentMonth, formatMonth } from "@/lib/budget/month";
import { fetchCategoryStatus } from "@/lib/budget/queries";
import { orderForSettings } from "@/lib/budget/categories";
import { CategoryTable } from "./category-table";
import { AddCategory } from "./add-category";

export const dynamic = "force-dynamic";

/**
 * 費目と、今月の予算。
 *
 * 毎日開く画面ではないので設定の中に置く。
 * 予算を費目と同じ行で決めるのは、この2つを別々の画面に分けると
 * 「予算を決めたのにどの費目だったか分からない」が起きるため。
 */
export default async function CategoriesPage() {
  await requireSession();
  const month = currentMonth();
  const categories = await fetchCategoryStatus(month);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 overflow-y-auto px-5 py-7">
      <section className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-base font-semibold">費目と予算</h1>
          <p className="text-sm text-muted">
            予算は{formatMonth(month)}
            のぶんです。空欄にすると「決めていない」になり、残りは出しません。
          </p>
        </div>

        <CategoryTable
          kind="expense"
          month={month}
          categories={orderForSettings(categories, "expense")}
        />
        <AddCategory kind="expense" />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">収入の費目</h2>
        <CategoryTable
          kind="income"
          month={month}
          categories={orderForSettings(categories, "income")}
        />
        <AddCategory kind="income" />
      </section>
    </div>
  );
}
