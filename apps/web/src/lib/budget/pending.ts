/**
 * 「今月まだ入れていない固定費」（FR-B22）。
 *
 * **自動では記録に入れない。**入っていないものを並べ、押したときに初めて記録になる。
 * 自動計上にすると、解約したはずのサブスクが毎月積み上がり、
 * 「実際に使った額」が信じられない数字になる。
 */

import type { RecurringExpense } from "@/lib/supabase/types";
import { occurrenceIn } from "@/lib/budget/recurring";

/** 今月の1回ぶん。入っていれば recorded に日付が入る */
export type Occurrence = {
  recurring: RecurringExpense;
  /** その月に起きる日 */
  date: string;
  /** もう記録にした日。まだなら null */
  recorded: string | null;
};

/**
 * その月に起きる固定費を、記録済みかどうかとあわせて返す。
 *
 * 記録済みの判定は**月**で見る。固定費は月に多くても1回なので、
 * 引き落とし日と実際に入れた日が1日ずれても同じものとして扱える。
 */
export function occurrencesIn(
  list: RecurringExpense[],
  month: string,
  recorded: { recurring_id: string; occurred_on: string }[],
): Occurrence[] {
  const done = new Map(recorded.map((r) => [r.recurring_id, r.occurred_on]));

  return list
    .filter((r) => r.is_active)
    .map((recurring) => {
      const date = occurrenceIn(recurring.rrule, recurring.start_date, month);
      return date
        ? { recurring, date, recorded: done.get(recurring.id) ?? null }
        : null;
    })
    .filter((o): o is Occurrence => o !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** まだ入れていないもの。入力画面に出すのはこれだけ */
export function pendingOnly(list: Occurrence[]): Occurrence[] {
  return list.filter((o) => o.recorded === null);
}

/** まだ入れていないぶんの合計。金額の決まっていないものは数えない */
export function pendingTotal(list: Occurrence[]): {
  amount: number;
  /** 金額が決まっていないものの件数。合計に入っていないことを伝える */
  unknown: number;
} {
  let amount = 0;
  let unknown = 0;
  for (const o of pendingOnly(list)) {
    if (o.recurring.amount === null) unknown += 1;
    else amount += o.recurring.amount;
  }
  return { amount, unknown };
}
