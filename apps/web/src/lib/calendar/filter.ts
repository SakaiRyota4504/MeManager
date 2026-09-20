/**
 * 担当者による絞り込み。
 *
 * 状態は「選んでいるメンバーのID」だけで表す。
 * 「自分の予定のみ」も、自分1人を選んだ状態として扱う（別の仕組みにしない）。
 *
 * URL と保存済みの設定で同じ文字列を使う。形が2つあると、
 * どちらかの解釈を直し忘れる。
 */

import type { EventWithAssignees } from "./model";

/** 選んでいるメンバー。null は「全員」（絞り込んでいない） */
export type Selected = string[] | null;

/** 「全員」を表す文字列。空文字と区別するために言葉にしてある */
export const ALL = "all";

/** user_preferences に入れるときの名前 */
export const SCHEDULE_FILTER_KEY = "schedule.members";

/**
 * URL や保存済みの文字列を読む。
 * 指定が無ければ undefined を返す（「全員」とは区別する）。
 */
export function parseSelected(
  raw: string | null | undefined,
  memberIds: string[],
): Selected | undefined {
  if (raw == null) return undefined;
  const value = raw.trim();
  if (value === "") return undefined;
  if (value === ALL) return null;

  // 家族から外れた人のIDは落とす。
  // 落とした結果0人になったら、予定が1つも出ない状態になるので全員に戻す。
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => memberIds.includes(id));

  return ids.length > 0 ? ids : null;
}

export function serializeSelected(selected: Selected): string {
  return selected === null ? ALL : selected.join(",");
}

export function isFiltered(selected: Selected): boolean {
  return selected !== null;
}

/** 選んだ人が担当している予定だけを残す */
export function filterEvents(
  events: EventWithAssignees[],
  selected: Selected,
): EventWithAssignees[] {
  if (selected === null) return events;
  const set = new Set(selected);
  return events.filter((e) => e.assignees.some((id) => set.has(id)));
}

/** 押すたびに1人を出し入れする。全員を外したら「全員」に戻す */
export function toggleMember(
  selected: Selected,
  memberId: string,
  memberIds: string[],
): Selected {
  // 絞り込んでいない状態から1人を外す＝その人以外を選ぶ
  const current = selected ?? memberIds;
  const next = current.includes(memberId)
    ? current.filter((id) => id !== memberId)
    : [...current, memberId];

  if (next.length === 0) return null;
  if (next.length === memberIds.length) return null;
  return next;
}

/** ボタンに出す言葉 */
export function filterLabel(
  selected: Selected,
  members: { id: string; display_name: string }[],
  selfMemberId: string,
): string {
  if (selected === null) return "全員";
  if (selected.length === 1) {
    if (selected[0] === selfMemberId) return "自分のみ";
    const name = members.find((m) => m.id === selected[0])?.display_name;
    return name ? `${name} のみ` : "1人のみ";
  }
  return `${selected.length}人のみ`;
}

/** 「自分の予定のみ」の状態か */
export function isSelfOnly(selected: Selected, selfMemberId: string): boolean {
  return (
    selected !== null && selected.length === 1 && selected[0] === selfMemberId
  );
}
