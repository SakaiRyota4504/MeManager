/**
 * 固定費の繰り返し（FR-B21）。
 *
 * 保存の形はスケジュールと同じ RRULE で、展開も同じ部品
 * （src/lib/recurrence/expand.ts）を使う。
 *
 * ただし**画面で聞くことは違う。**予定は「毎週 火・木」を聞くが、
 * 固定費で要るのは「毎月27日」「毎月末日」「毎年4月1日」の3つだけ。
 * 予定側の Recurrence をそのまま使うと、曜日や回数など、
 * 固定費では意味のない選択肢まで出てくる。
 */

import { expand } from "@/lib/recurrence/expand";
import { monthFirstDay, nextMonthFirstDay } from "@/lib/budget/month";

/** 末日を表す。RRULE の BYMONTHDAY=-1 に対応する */
export const LAST_DAY = "last";

export type Cycle =
  /** 毎月◯日。interval が2なら2か月ごと */
  | { kind: "monthly"; day: number | typeof LAST_DAY; interval: number }
  /** 毎年◯月◯日 */
  | { kind: "yearly"; month: number; day: number };

export function defaultCycle(day = 27): Cycle {
  return { kind: "monthly", day, interval: 1 };
}

function dayCode(day: number | typeof LAST_DAY): number {
  return day === LAST_DAY ? -1 : day;
}

export function toRRule(cycle: Cycle): string {
  if (cycle.kind === "yearly") {
    return `FREQ=YEARLY;BYMONTH=${cycle.month};BYMONTHDAY=${cycle.day}`;
  }
  const parts = ["FREQ=MONTHLY"];
  if (cycle.interval > 1) parts.push(`INTERVAL=${cycle.interval}`);
  parts.push(`BYMONTHDAY=${dayCode(cycle.day)}`);
  return parts.join(";");
}

export function fromRRule(text: string | null | undefined): Cycle | null {
  if (!text) return null;

  const map = new Map<string, string>();
  for (const part of text.trim().toUpperCase().split(";")) {
    const [key, value] = part.split("=");
    if (key && value) map.set(key, value);
  }

  const monthDay = Number(map.get("BYMONTHDAY"));
  if (!Number.isInteger(monthDay)) return null;

  if (map.get("FREQ") === "YEARLY") {
    const month = Number(map.get("BYMONTH"));
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    if (monthDay < 1 || monthDay > 31) return null;
    return { kind: "yearly", month, day: monthDay };
  }

  if (map.get("FREQ") !== "MONTHLY") return null;
  if (monthDay !== -1 && (monthDay < 1 || monthDay > 31)) return null;

  const interval = Number(map.get("INTERVAL") ?? 1);
  return {
    kind: "monthly",
    day: monthDay === -1 ? LAST_DAY : monthDay,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
  };
}

/** 画面に出す言葉 */
export function describeCycle(cycle: Cycle): string {
  if (cycle.kind === "yearly") {
    return `毎年 ${cycle.month}月${cycle.day}日`;
  }
  const day = cycle.day === LAST_DAY ? "末日" : `${cycle.day}日`;
  return cycle.interval > 1
    ? `${cycle.interval}か月ごと ${day}`
    : `毎月 ${day}`;
}

/**
 * その月に起きる回。
 *
 * 固定費の繰り返しは月に多くても1回なので、配列ではなく1つ返す。
 * 起きない月（2か月ごとの裏の月、毎年のもの）は null。
 */
export function occurrenceIn(
  rrule: string,
  startDate: string,
  month: string,
): string | null {
  return (
    expand(
      rrule,
      startDate,
      monthFirstDay(month),
      nextMonthFirstDay(month),
    )[0] ?? null
  );
}
