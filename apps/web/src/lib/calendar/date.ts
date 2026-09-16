/**
 * カレンダーの日付計算。
 *
 * 終日予定は日付（YYYY-MM-DD）のまま扱い、Date に変換しない。
 * タイムゾーンをまたいだときに日付がずれるのを避けるため（NFR-D02）。
 */

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** ローカル時刻の Date を YYYY-MM-DD にする */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

/** "2026-09" のような月キーから、その月の1日を作る */
export function monthStart(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1);
}

export function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const d = monthStart(month);
  return toMonthKey(new Date(d.getFullYear(), d.getMonth() + delta, 1));
}

export function formatMonth(month: string): string {
  const d = monthStart(month);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/**
 * 月表示の格子に並べる日付。
 * 週の開始曜日にそろえ、月末の週まで埋める（5週または6週）。
 */
export function monthGridDays(month: string, weekStart = 0): Date[] {
  const first = monthStart(month);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const total = Math.ceil((offset + last.getDate()) / 7) * 7;

  return Array.from(
    { length: total },
    (_, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

/** 月表示で取得すべき期間（前後の週を含む） */
export function monthRange(month: string, weekStart = 0) {
  const days = monthGridDays(month, weekStart);
  const from = days[0];
  const to = new Date(days[days.length - 1]);
  to.setDate(to.getDate() + 1);
  return { fromDate: toDateKey(from), toDate: toDateKey(to) };
}

/** 時刻付き予定の表示。26:00 のような24時以降は翌日の時刻に直す */
export function formatTime(iso: string, timeZone = "Asia/Tokyo"): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

/** 時刻付き予定が、表示上どの日付に属するか */
export function eventDateKey(iso: string, timeZone = "Asia/Tokyo"): string {
  // en-CA は YYYY-MM-DD 形式を返す
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** 終日予定が占める日付を、開始日から終了日まで並べる */
export function allDayKeys(startDate: string, endDate: string): string[] {
  const keys: string[] = [];
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  let guard = 0;
  while (toDateKey(cursor) <= endDate && guard++ < 400) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}
