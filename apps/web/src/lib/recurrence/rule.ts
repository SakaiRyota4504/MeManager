/**
 * 繰り返しのルール。
 *
 * **予定のことは何も知らない。**「ルールと開始日を渡すと日付の一覧が返る」
 * だけの部品にしてある。習慣管理の「平日だけ」「週3回」も、
 * 同じものを使う（docs/00-product-vision.md 4.4）。
 *
 * 保存の形は RFC 5545 の RRULE（FR-R08）。
 * 画面で扱いやすいように、ここで構造体と文字列を行き来させる。
 */

export type Freq = "daily" | "weekly" | "monthly" | "yearly";

/** 0=日曜 … 6=土曜。JavaScript の getDay() と同じ並び */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RecurrenceEnd =
  | { kind: "never" }
  /** その日まで（その日を含む） */
  | { kind: "until"; date: string }
  | { kind: "count"; count: number };

export type Recurrence = {
  freq: Freq;
  /** 何回おきか。1 なら毎回 */
  interval: number;
  /** 毎週のとき、どの曜日か。空なら開始日の曜日 */
  byWeekday: Weekday[];
  end: RecurrenceEnd;
};

const FREQ_TO_RRULE: Record<Freq, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

const RRULE_TO_FREQ: Record<string, Freq> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

/** RRULE の曜日は日曜始まりではない */
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export function defaultRecurrence(): Recurrence {
  return { freq: "weekly", interval: 1, byWeekday: [], end: { kind: "never" } };
}

/** 構造体から RRULE の文字列へ */
export function toRRule(rule: Recurrence): string {
  const parts = [`FREQ=${FREQ_TO_RRULE[rule.freq]}`];

  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);

  if (rule.freq === "weekly" && rule.byWeekday.length > 0) {
    const days = [...rule.byWeekday]
      .sort((a, b) => a - b)
      .map((d) => DAY_CODES[d]);
    parts.push(`BYDAY=${days.join(",")}`);
  }

  if (rule.end.kind === "count") {
    parts.push(`COUNT=${rule.end.count}`);
  } else if (rule.end.kind === "until") {
    // UNTIL はその瞬間を含む。展開は 0:00 の点で行うので、
    // 終了日の 0:00 を渡せばその日まで入る。
    parts.push(`UNTIL=${rule.end.date.replaceAll("-", "")}T000000Z`);
  }

  return parts.join(";");
}

/** RRULE の文字列から構造体へ。読めない形なら null */
export function fromRRule(text: string | null | undefined): Recurrence | null {
  if (!text) return null;

  const map = new Map<string, string>();
  for (const part of text.trim().toUpperCase().split(";")) {
    const [key, value] = part.split("=");
    if (key && value) map.set(key, value);
  }

  const freq = RRULE_TO_FREQ[map.get("FREQ") ?? ""];
  if (!freq) return null;

  const interval = Number(map.get("INTERVAL") ?? 1);
  const byWeekday = (map.get("BYDAY") ?? "")
    .split(",")
    .map((code) => DAY_CODES.indexOf(code.trim() as (typeof DAY_CODES)[number]))
    .filter((d): d is Weekday => d >= 0);

  let end: RecurrenceEnd = { kind: "never" };
  const count = map.get("COUNT");
  const until = map.get("UNTIL");
  if (count && Number(count) > 0) {
    end = { kind: "count", count: Number(count) };
  } else if (until && /^\d{8}/.test(until)) {
    end = {
      kind: "until",
      date: `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`,
    };
  }

  return {
    freq,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    byWeekday,
    end,
  };
}

/** 画面に出す言葉。「毎週 火・木」のように読める形にする */
export function describeRecurrence(
  rule: Recurrence,
  startDate: string,
): string {
  const every =
    rule.interval > 1
      ? {
          daily: `${rule.interval}日おき`,
          weekly: `${rule.interval}週おき`,
          monthly: `${rule.interval}か月おき`,
          yearly: `${rule.interval}年おき`,
        }[rule.freq]
      : { daily: "毎日", weekly: "毎週", monthly: "毎月", yearly: "毎年" }[
          rule.freq
        ];

  let what = every;

  if (rule.freq === "weekly") {
    const days =
      rule.byWeekday.length > 0
        ? rule.byWeekday
        : [new Date(`${startDate}T00:00:00`).getDay()];
    what += ` ${[...days]
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS[d])
      .join("・")}`;
  } else if (rule.freq === "monthly") {
    what += ` ${Number(startDate.slice(8, 10))}日`;
  } else if (rule.freq === "yearly") {
    what += ` ${Number(startDate.slice(5, 7))}月${Number(startDate.slice(8, 10))}日`;
  }

  if (rule.end.kind === "count") return `${what}（${rule.end.count}回）`;
  if (rule.end.kind === "until") {
    const [, m, d] = rule.end.date.split("-");
    return `${what}（${Number(m)}月${Number(d)}日まで）`;
  }
  return what;
}
