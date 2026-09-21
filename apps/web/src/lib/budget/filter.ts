/**
 * 一覧の絞り込み（FR-B45）。
 *
 * 何をどう絞ったかは URL に持たせる。家族にリンクを送れるようにするのと、
 * 戻るボタンで1つ前の絞り込みに戻れるようにするため（スケジュールと同じ考え）。
 */

import type { TransactionView } from "@/lib/budget/queries";

export type Filter = {
  /** 費目。空なら絞らない */
  category: string;
  /** 使った人。空なら絞らない */
  member: string;
  /** メモと費目名にかかる言葉。空なら絞らない */
  text: string;
};

export const EMPTY: Filter = { category: "", member: "", text: "" };

export function parseFilter(params: {
  c?: string | string[];
  p?: string | string[];
  q?: string | string[];
}): Filter {
  const one = (v: string | string[] | undefined) =>
    typeof v === "string" ? v : "";
  return {
    category: one(params.c),
    member: one(params.p),
    text: one(params.q).trim(),
  };
}

export function isFiltering(filter: Filter): boolean {
  return Boolean(filter.category || filter.member || filter.text);
}

/** 絞り込んだ結果。並びは変えない */
export function applyFilter(
  rows: TransactionView[],
  filter: Filter,
): TransactionView[] {
  const needle = filter.text.toLowerCase();
  return rows.filter((row) => {
    if (filter.category && row.category_id !== filter.category) return false;
    // 「指定なし」は "-" で表す。空文字は「絞らない」なので使えない
    if (filter.member) {
      const target = filter.member === "-" ? null : filter.member;
      if (row.member_id !== target) return false;
    }
    if (needle) {
      const haystack = [row.note ?? "", row.budget_categories?.name ?? ""]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** 絞り込みを URL の形にする。空のものは付けない */
export function filterQuery(month: string, filter: Filter): string {
  const params = new URLSearchParams();
  params.set("m", month);
  if (filter.category) params.set("c", filter.category);
  if (filter.member) params.set("p", filter.member);
  if (filter.text) params.set("q", filter.text);
  return `?${params.toString()}`;
}
