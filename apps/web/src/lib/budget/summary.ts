/**
 * 月の集計（docs/07-budget-requirements.md 4.5）。
 *
 * 記録そのものは一覧を出すときに引いているので、集計はその配列から作る。
 * DB 側で足し合わせないのは、同じ月を2回引かずに済ませるため。
 * 12か月の推移だけは件数が多いので、DB 側（budget_trend）で足している。
 */

import type {
  CategoryStatus,
  Member,
  CategoryKind,
} from "@/lib/supabase/types";
import type { TransactionView } from "@/lib/budget/queries";

/** 内訳の1行。費目ごとにも、人ごとにも同じ形を使う */
export type Slice = {
  id: string;
  label: string;
  color: string;
  amount: number;
  /** その月の支出に占める割合（0〜1）。支出が0なら0 */
  share: number;
  /** 費目ごとの行だけ。決めていなければ null */
  budget: number | null;
};

/** 内訳に出てこない人・費目に使う色。色としての意味は持たせない */
const UNKNOWN_COLOR = "#71717a";

export type Totals = { expense: number; income: number; net: number };

export function totals(rows: TransactionView[]): Totals {
  let expense = 0;
  let income = 0;
  for (const row of rows) {
    if (row.kind === "income") income += row.amount;
    else expense += row.amount;
  }
  return { expense, income, net: income - expense };
}

function toSlices(
  sums: Map<string, number>,
  total: number,
  meta: (id: string) => { label: string; color: string; budget: number | null },
): Slice[] {
  return [...sums.entries()]
    .map(([id, amount]) => ({
      id,
      amount,
      share: total > 0 ? amount / total : 0,
      ...meta(id),
    }))
    .sort(
      (a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "ja"),
    );
}

/**
 * 費目ごとの内訳（FR-B41）。
 *
 * 予算を決めてあって、まだ1円も使っていない費目も出す。
 * 「使っていない」と「予算そのものが無い」は別で、前者は残りを見たい。
 */
export function byCategory(
  rows: TransactionView[],
  categories: CategoryStatus[],
  kind: CategoryKind = "expense",
): Slice[] {
  const target = rows.filter((r) => r.kind === kind);
  const total = target.reduce((sum, r) => sum + r.amount, 0);

  const sums = new Map<string, number>();
  for (const row of target) {
    sums.set(row.category_id, (sums.get(row.category_id) ?? 0) + row.amount);
  }
  if (kind === "expense") {
    for (const c of categories) {
      if (c.kind === kind && c.budget !== null && !sums.has(c.category_id)) {
        sums.set(c.category_id, 0);
      }
    }
  }

  return toSlices(sums, total, (id) => {
    const c = categories.find((x) => x.category_id === id);
    return {
      label: c?.name ?? "（消えた費目）",
      color: c?.color ?? UNKNOWN_COLOR,
      budget: c?.budget ?? null,
    };
  });
}

/** 使った人ごとの内訳（FR-B43）。支出だけを見る */
export function byMember(rows: TransactionView[], members: Member[]): Slice[] {
  const target = rows.filter((r) => r.kind === "expense");
  const total = target.reduce((sum, r) => sum + r.amount, 0);

  const sums = new Map<string, number>();
  for (const row of target) {
    const key = row.member_id ?? "";
    sums.set(key, (sums.get(key) ?? 0) + row.amount);
  }

  return toSlices(sums, total, (id) => {
    const m = members.find((x) => x.id === id);
    return {
      label: m?.display_name ?? "指定なし",
      color: m?.color ?? UNKNOWN_COLOR,
      budget: null,
    };
  });
}

/**
 * 前の月からどれだけ変わったか（FR-B42）。
 *
 * 前の月が0のときは割合を出さない。0から増えた分は必ず「∞%増」になり、
 * 数字として意味を持たないため。
 */
export function change(
  current: number,
  previous: number,
): { diff: number; ratio: number | null } {
  return {
    diff: current - previous,
    ratio: previous > 0 ? (current - previous) / previous : null,
  };
}

/** 「12%増」「3%減」。変わっていなければ null */
export function changeLabel(ratio: number | null): string | null {
  if (ratio === null) return null;
  const percent = Math.round(ratio * 100);
  if (percent === 0) return null;
  return percent > 0 ? `${percent}%増` : `${-percent}%減`;
}
