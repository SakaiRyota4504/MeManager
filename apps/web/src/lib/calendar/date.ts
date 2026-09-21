/**
 * カレンダーの日付計算。
 *
 * 終日予定は日付（YYYY-MM-DD）のまま扱い、Date に変換しない。
 * タイムゾーンをまたいだときに日付がずれるのを避けるため（NFR-D02）。
 */

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** カレンダーの見せ方 */
export type View = "month" | "week" | "day" | "list";

export const VIEWS: { id: View; label: string }[] = [
  { id: "month", label: "月" },
  { id: "week", label: "週" },
  { id: "day", label: "日" },
  { id: "list", label: "一覧" },
];

export function isView(value: unknown): value is View {
  return VIEWS.some((v) => v.id === value);
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

/** ローカル時刻の Date を YYYY-MM-DD にする */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 今日。**サーバーでも同じ日付になる**ようにする。
 *
 * toDateKey(new Date()) だと動いている場所の時間帯で決まるので、
 * サーバー（UTC）では朝9時まで前日のカレンダーが開いてしまう。
 */
export function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: APP_TIME_ZONE,
  }).format(new Date());
}

/** YYYY-MM-DD をその日の 0:00（ローカル）にする */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function shiftDays(key: string, delta: number): string {
  const d = fromDateKey(key);
  return toDateKey(
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta),
  );
}

/** その日を含む週の7日。週の開始曜日にそろえる */
export function weekDays(key: string, weekStart = 0): Date[] {
  const d = fromDateKey(key);
  const offset = (d.getDay() - weekStart + 7) % 7;
  return Array.from(
    { length: 7 },
    (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset + i),
  );
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

/** 表示に必要な予定を取る期間。toDate は含まない */
export function rangeFor(
  view: View,
  date: string,
  weekStart = 0,
): { fromDate: string; toDate: string } {
  if (view === "week") {
    const days = weekDays(date, weekStart);
    return {
      fromDate: toDateKey(days[0]),
      toDate: shiftDays(toDateKey(days[6]), 1),
    };
  }
  if (view === "day") {
    return { fromDate: date, toDate: shiftDays(date, 1) };
  }
  // 月表示と一覧は、その月の格子ぶん（前後の週を含む）
  return monthRange(date.slice(0, 7), weekStart);
}

/** 前後に動かす。動く幅は見せ方で変わる */
export function shiftView(view: View, date: string, delta: number): string {
  if (view === "week") return shiftDays(date, delta * 7);
  if (view === "day") return shiftDays(date, delta);
  // 月をまたぐと日が消えることがある（1/31 の翌月など）ので、月初にそろえる
  return `${shiftMonth(date.slice(0, 7), delta)}-01`;
}

/** 画面の見出し */
export function formatRange(view: View, date: string, weekStart = 0): string {
  if (view === "day") {
    const d = fromDateKey(date);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${
      WEEKDAYS[d.getDay()]
    }）`;
  }
  if (view === "week") {
    const days = weekDays(date, weekStart);
    const from = days[0];
    const to = days[6];
    const head = `${from.getFullYear()}年${from.getMonth() + 1}月${from.getDate()}日`;
    const tail =
      from.getMonth() === to.getMonth()
        ? `${to.getDate()}日`
        : `${to.getMonth() + 1}月${to.getDate()}日`;
    return `${head}〜${tail}`;
  }
  return formatMonth(date.slice(0, 7));
}
