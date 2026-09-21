/**
 * 月と日の見せ方。
 *
 * 月の区切りは1日から末日（docs/07-budget-requirements.md 3.5）。
 * 月キーは "2026-09"、日付キーは "2026-09-21" と、カレンダーと同じ形にそろえる。
 */

import { WEEKDAYS, fromDateKey, todayKey } from "@/lib/calendar/date";

export { formatMonth, shiftMonth, toMonthKey } from "@/lib/calendar/date";

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 日付キーが属する月 */
export function monthOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** 今月 */
export function currentMonth(): string {
  return monthOf(todayKey());
}

/** DB に渡す形。budgets.month はその月の1日で持っている */
export function monthFirstDay(month: string): string {
  return `${month}-01`;
}

/** "9/21（日）"。一覧の日ごとの見出しに使う */
export function formatDay(dateKey: string): string {
  const d = fromDateKey(dateKey);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

/** 入力画面の1行にまとめる短い形。今日なら「9/21（今日）」 */
export function formatDayShort(dateKey: string, today = todayKey()): string {
  const d = fromDateKey(dateKey);
  const suffix = dateKey === today ? "今日" : WEEKDAYS[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}（${suffix}）`;
}
