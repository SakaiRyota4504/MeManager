/**
 * 習慣の頻度（docs/08-habit-requirements.md 3.2）。
 *
 * **RRULE だけでは足りない。**
 * 「週3回、曜日は問わない」を RRULE で表すことはできない。
 * かといって回数だけにすると「毎週火曜のゴミ出し」が表せない。
 *
 *   曜日で決める … RRULE（スケジュールと同じ文字列、同じ展開の部品）
 *   回数で決める … 期間（週・月）と回数
 *
 * どちらか片方に寄せると、次のどちらかが壊れる。
 *
 *   回数だけ → 「毎週火曜」が表せない
 *   RRULE だけ → 「週3回走る」が「月水金に走る」になり、
 *                火曜に走った日が未達成のまま残る
 */

import { toRRule, fromRRule, type Weekday } from "@/lib/recurrence/rule";
import { expand } from "@/lib/recurrence/expand";
import { shiftDays } from "@/lib/calendar/date";

export type Period = "week" | "month";

export type Frequency =
  /** 曜日で決める。byWeekday が空なら毎日 */
  | { kind: "schedule"; byWeekday: Weekday[] }
  /** 期間内に何回。曜日は問わない */
  | { kind: "count"; count: number; period: Period };

/** 平日（月〜金） */
export const WEEKDAYS_ONLY: Weekday[] = [1, 2, 3, 4, 5];

export function defaultFrequency(): Frequency {
  return { kind: "schedule", byWeekday: [] };
}

/**
 * 曜日の指定を RRULE にする。
 *
 * 空なら毎日（FREQ=DAILY）。曜日を選んだら FREQ=WEEKLY;BYDAY=…。
 * スケジュールの Recurrence をそのまま通すので、展開も同じ部品で動く。
 */
export function scheduleToRRule(byWeekday: Weekday[]): string {
  if (byWeekday.length === 0) {
    return toRRule({
      freq: "daily",
      interval: 1,
      byWeekday: [],
      end: { kind: "never" },
    });
  }
  return toRRule({
    freq: "weekly",
    interval: 1,
    byWeekday,
    end: { kind: "never" },
  });
}

/** RRULE から曜日の指定に戻す。読めなければ毎日として扱う */
export function rruleToSchedule(rrule: string | null): Weekday[] {
  const rule = fromRRule(rrule);
  if (!rule || rule.freq === "daily") return [];
  return rule.byWeekday;
}

/** 画面に出す言葉 */
export function describeFrequency(frequency: Frequency): string {
  if (frequency.kind === "count") {
    const period = frequency.period === "week" ? "週" : "月";
    return `${period}に${frequency.count}回`;
  }
  if (frequency.byWeekday.length === 0) return "毎日";

  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  const days = [...frequency.byWeekday].sort((a, b) => a - b);
  // 月〜金がそろっていたら「平日」と読む。5つ並べるより短い
  if (days.length === 5 && days.every((d, i) => d === i + 1)) return "平日";
  return `毎週 ${days.map((d) => labels[d]).join("・")}`;
}

/**
 * その期間に「やる日」はどこか。
 *
 * スケジュールと同じ展開の部品を使う（docs/03-roadmap.md Step 5 の約束）。
 * 曜日を数えるだけなら自分で書けるが、そうすると展開の規則が
 * アプリの中で2通りになる。連続日数や達成率も同じ関数から数える。
 *
 * @param from 期間の始め（含む）
 * @param to   期間の終わり（**含む**。呼ぶ側が日付で考えるため）
 */
export function dueDatesBetween(
  frequency: Frequency,
  from: string,
  to: string,
): string[] {
  // 「回数で決める」ものは、どの日でも対象になる。
  // 何回やったかで達成を見るので、日を絞る意味が無い。
  if (frequency.kind === "count") return daysInclusive(from, to);

  const rrule = scheduleToRRule(frequency.byWeekday);
  // 展開の起点は期間の始めにする。習慣に「1回目の日」は無い
  return expand(rrule, from, from, shiftDays(to, 1));
}

/** その日にやる習慣か（FR-H13） */
export function isDueOn(frequency: Frequency, dateKey: string): boolean {
  return dueDatesBetween(frequency, dateKey, dateKey).length > 0;
}

function daysInclusive(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = shiftDays(d, 1)) days.push(d);
  return days;
}
