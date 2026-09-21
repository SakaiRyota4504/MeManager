/**
 * 費目の並べ方。
 *
 * 入力画面はプルダウンを開かせない（FR-B03）。
 * 代わりにボタンを並べるので、**よく使うものが先に来ていないと意味がない。**
 * 並び順（sort_order）は自分で決められるが、そこを手で整える人はいない前提で、
 * 直近の使用回数を先に見る。
 */

import type { CategoryStatus, CategoryKind } from "@/lib/supabase/types";

/** 入力画面で最初から見えている数。これを超えたぶんは「ほかの費目」に隠す */
export const VISIBLE_CHIPS = 8;

/** 使う費目だけを、よく使う順に並べる */
export function orderForInput(
  list: CategoryStatus[],
  kind: CategoryKind,
): CategoryStatus[] {
  return list
    .filter((c) => c.kind === kind && c.is_active)
    .sort(
      (a, b) =>
        b.uses - a.uses ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name, "ja"),
    );
}

/** 設定画面の並び。こちらは決めた順のまま出す（隠した費目も含む） */
export function orderForSettings(
  list: CategoryStatus[],
  kind: CategoryKind,
): CategoryStatus[] {
  return list
    .filter((c) => c.kind === kind)
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ja"),
    );
}

/** 並べ替えで、隣と順番を入れ替えたときの sort_order を求める */
export function swappedOrder(
  list: CategoryStatus[],
  categoryId: string,
  direction: -1 | 1,
): { id: string; sort_order: number }[] | null {
  const index = list.findIndex((c) => c.category_id === categoryId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return null;

  const a = list[index];
  const b = list[target];
  // 同じ値が並んでいると入れ替えても動かないので、位置から振り直す
  if (a.sort_order === b.sort_order) {
    return list.map((c, i) => ({
      id: c.category_id,
      sort_order: (i === index ? target : i === target ? index : i) * 10 + 10,
    }));
  }
  return [
    { id: a.category_id, sort_order: b.sort_order },
    { id: b.category_id, sort_order: a.sort_order },
  ];
}
