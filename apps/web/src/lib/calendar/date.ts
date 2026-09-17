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

/**
 * このアプリが扱う時間帯。表示も入力もここに固定する。
 *
 * 端末の設定に合わせない。旅行先で入力した予定が家族には別の時刻に
 * 見える、という事故を避けるため。
 */
export const APP_TIME_ZONE = "Asia/Tokyo";

/** 夏時間が無いので固定の値で足りる。時間帯を変えるならここも見直す */
const APP_UTC_OFFSET = "+09:00";

/**
 * 入力欄の「日付」と「時刻」を、ISO（UTC）の文字列にする。
 *
 * `new Date("2026-09-17T09:00")` は**動いている場所の時間帯**で解釈される。
 * 保存の処理はサーバー（UTC）で動くので、そのままだと9時間ずれる。
 * 時間帯を明示して取り違えを断つ。
 */
export function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00${APP_UTC_OFFSET}`).toISOString();
}

/** 時刻付き予定の表示。26:00 のような24時以降は翌日の時刻に直す */
export function formatTime(iso: string, timeZone = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

/** 時刻付き予定が、表示上どの日付に属するか */
export function eventDateKey(iso: string, timeZone = APP_TIME_ZONE): string {
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
