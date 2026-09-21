import type { Member } from "@/lib/supabase/types";
import { formatYen } from "@/lib/budget/money";
import { formatDayShort } from "@/lib/budget/month";
import type { TransactionView } from "@/lib/budget/queries";
import { Dot } from "./parts";

/**
 * 直前に入れたもの。
 *
 * 入力の隣に置くのは、同じ買い物を二重に入れていないか、
 * 保存したあとすぐ確かめられるようにするため。
 */
export function RecentList({
  rows,
  members,
  today,
}: {
  rows: TransactionView[];
  members: Member[];
  today: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        まだ記録がありません。金額を入れて費目を押すと保存できます。
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {rows.map((t) => {
        const member = members.find((m) => m.id === t.member_id);
        return (
          <li
            key={t.id}
            className="flex min-w-0 items-center gap-2.5 border-t border-border py-2"
          >
            <Dot color={t.budget_categories?.color ?? "#71717a"} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {t.note || t.budget_categories?.name || "記録"}
              </span>
              <span className="block text-[11.5px] text-muted">
                {formatDayShort(t.occurred_on, today)} ・{" "}
                {t.budget_categories?.name ?? "—"}
                {member ? ` ・ ${member.display_name}` : ""}
              </span>
            </span>
            <span
              className={`font-semibold whitespace-nowrap tabular-nums ${
                t.kind === "income" ? "text-ok" : ""
              }`}
            >
              {t.kind === "income" ? "+" : ""}
              {formatYen(t.amount)}円
            </span>
          </li>
        );
      })}
    </ul>
  );
}
