/**
 * 習慣の見せ方をまとめる。
 *
 * DB の行（Habit）と、画面が要る形（今日やるか／やったか／続いているか）を
 * ここで行き来させる。画面の中で数えごとをしないようにするため。
 */

import type { Habit, HabitLog, Member } from "@/lib/supabase/types";
import { shiftDays, todayKey } from "@/lib/calendar/date";
import {
  dueDatesBetween,
  isDueOn,
  rruleToSchedule,
  type Frequency,
  type Period,
} from "@/lib/habit/frequency";

/** DB の行から頻度を読む */
export function frequencyOf(habit: Habit): Frequency {
  return habit.kind === "count"
    ? {
        kind: "count",
        count: habit.target_count ?? 1,
        period: (habit.period ?? "week") as Period,
      }
    : { kind: "schedule", byWeekday: rruleToSchedule(habit.rrule) };
}

/** 今日の一覧に出す1件 */
export type TodayItem = {
  habit: Habit;
  member: Member | undefined;
  /** もう押したか */
  done: boolean;
  /** 「回数で決める」もののみ。この期間にあと何回やるか */
  remaining: number | null;
  /** 期間内にやった回数。回数で決めるもののみ */
  progress: { done: number; target: number } | null;
};

/** その期間の区切り。週は家族の設定した開始曜日にそろえる */
export function periodRange(
  period: Period,
  dateKey: string,
  weekStart = 0,
): { from: string; to: string } {
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (period === "month") {
    const first = `${dateKey.slice(0, 7)}-01`;
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
    return { from: first, to: last };
  }
  const offset = (d.getUTCDay() - weekStart + 7) % 7;
  const from = shiftDays(dateKey, -offset);
  return { from, to: shiftDays(from, 6) };
}

/**
 * 今日やることを組み立てる（FR-H10 / FR-H13）。
 *
 * 出さないもの:
 *   * やめた習慣
 *   * 曜日で決めていて、今日が対象でないもの
 *   * 回数で決めていて、**もう期間の回数に届いているもの**
 *     （届いたあとも出し続けると、毎日ずっと残って邪魔になる）
 *
 * ただし今日すでに押したものは、取り消せるように出したままにする。
 */
export function todayList(
  habits: Habit[],
  logs: HabitLog[],
  members: Member[],
  date = todayKey(),
  weekStart = 0,
): TodayItem[] {
  const byHabit = new Map<string, Set<string>>();
  for (const log of logs) {
    const set = byHabit.get(log.habit_id) ?? new Set<string>();
    set.add(log.done_on);
    byHabit.set(log.habit_id, set);
  }

  const items: TodayItem[] = [];

  for (const habit of habits) {
    if (!habit.is_active) continue;

    const frequency = frequencyOf(habit);
    const days = byHabit.get(habit.id) ?? new Set<string>();
    const done = days.has(date);

    if (frequency.kind === "schedule") {
      if (!isDueOn(frequency, date)) continue;
      items.push({
        habit,
        member: members.find((m) => m.id === habit.member_id),
        done,
        remaining: null,
        progress: null,
      });
      continue;
    }

    const { from, to } = periodRange(frequency.period, date, weekStart);
    let count = 0;
    for (const day of days) {
      if (day >= from && day <= to) count += 1;
    }
    const remaining = Math.max(0, frequency.count - count);

    // 届いたものは出さない。ただし今日押したぶんは取り消せるよう残す
    if (remaining === 0 && !done) continue;

    items.push({
      habit,
      member: members.find((m) => m.id === habit.member_id),
      done,
      remaining,
      progress: { done: count, target: frequency.count },
    });
  }

  return items;
}

/**
 * 自分のぶんを先に、家族のぶんをその下に（FR-H12）。
 * 同じ人の中では、押していないものを先に出す。
 */
export function sortToday(
  items: TodayItem[],
  selfMemberId: string,
): TodayItem[] {
  return [...items].sort(
    (a, b) =>
      Number(b.habit.member_id === selfMemberId) -
        Number(a.habit.member_id === selfMemberId) ||
      Number(a.done) - Number(b.done) ||
      a.habit.name.localeCompare(b.habit.name, "ja"),
  );
}

/**
 * 連続している日数（FR-H20）。
 *
 * **「やる日」だけを数える。**毎週火曜の習慣を、火曜にやり続けているなら
 * 連続は途切れていない。日を空けずに数えると、週1の習慣はいつも「1」になる。
 *
 * 今日がまだ来ていない（今日やる日なのに押していない）場合は、
 * 今日を含めずに数える。夜になる前に「途切れた」と出すのは違う。
 */
export function streak(
  habit: Habit,
  logs: HabitLog[],
  date = todayKey(),
  weekStart = 0,
): number {
  const done = new Set(
    logs.filter((l) => l.habit_id === habit.id).map((l) => l.done_on),
  );
  if (done.size === 0) return 0;

  const frequency = frequencyOf(habit);

  if (frequency.kind === "count") {
    // 回数で決めるものは「連続した期間の数」で数える。
    // 日で数えると、週3回の習慣がいつも1〜2で止まる
    let count = 0;
    let cursor = date;
    for (let guard = 0; guard < 520; guard += 1) {
      const { from, to } = periodRange(frequency.period, cursor, weekStart);
      let inPeriod = 0;
      for (const day of done) {
        if (day >= from && day <= to) inPeriod += 1;
      }
      if (inPeriod >= frequency.count) {
        count += 1;
      } else if (from > date || to < date) {
        // 過ぎた期間で届いていないなら、そこで途切れている
        break;
      }
      cursor = shiftDays(from, -1);
      if (cursor < earliest(done)) break;
    }
    return count;
  }

  // 「やる日」をさかのぼり、押していない日に当たったら止める
  const dueDays = dueDatesBetween(frequency, earliest(done), date).reverse();
  let count = 0;
  for (const day of dueDays) {
    if (done.has(day)) {
      count += 1;
      continue;
    }
    // 今日まだ押していないだけなら、途切れ扱いにしない
    if (day === date) continue;
    break;
  }
  return count;
}

function earliest(days: Set<string>): string {
  let min = "9999-12-31";
  for (const day of days) if (day < min) min = day;
  return min;
}

/** 直近 n 日の達成率（FR-H21）。やる日のうち、やった日の割合 */
export function achievement(
  habit: Habit,
  logs: HabitLog[],
  days = 28,
  date = todayKey(),
): { done: number; due: number; rate: number } {
  const frequency = frequencyOf(habit);
  const from = shiftDays(date, -(days - 1));
  const due = dueDatesBetween(frequency, from, date);
  const doneDays = new Set(
    logs.filter((l) => l.habit_id === habit.id).map((l) => l.done_on),
  );

  if (frequency.kind === "count") {
    // 回数で決めるものは、期間あたりの回数で見る。
    // 「どの日でもよい」ので、やる日の数で割ると必ず低く出る
    const target = Math.round(
      (frequency.count * days) / (frequency.period === "week" ? 7 : 30),
    );
    const done = [...doneDays].filter((d) => d >= from && d <= date).length;
    return {
      done,
      due: Math.max(1, target),
      rate: Math.min(1, done / Math.max(1, target)),
    };
  }

  const done = due.filter((d) => doneDays.has(d)).length;
  return {
    done,
    due: due.length,
    rate: due.length === 0 ? 0 : done / due.length,
  };
}
