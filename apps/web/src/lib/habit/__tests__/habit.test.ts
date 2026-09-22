import { describe, expect, it } from "vitest";

import {
  defaultFrequency,
  describeFrequency,
  dueDatesBetween,
  isDueOn,
  rruleToSchedule,
  scheduleToRRule,
  WEEKDAYS_ONLY,
  type Frequency,
} from "@/lib/habit/frequency";
import {
  achievement,
  frequencyOf,
  periodRange,
  sortToday,
  streak,
  todayList,
} from "@/lib/habit/model";
import type { Habit, HabitLog, Member } from "@/lib/supabase/types";

const now = "2026-09-21T09:00:00+09:00";

function habit(over: Partial<Habit>): Habit {
  return {
    id: "h1",
    family_id: "f1",
    member_id: "m1",
    name: "歯みがき",
    color: "#2563eb",
    kind: "schedule",
    rrule: "FREQ=DAILY",
    target_count: null,
    period: null,
    visibility: "family",
    is_active: true,
    created_by: "m1",
    created_at: now,
    updated_at: now,
    ...over,
  };
}

function log(habit_id: string, done_on: string): HabitLog {
  return { habit_id, done_on, created_by: "m1", created_at: now };
}

function member(id: string, name: string): Member {
  return {
    id,
    family_id: "f1",
    user_id: null,
    display_name: name,
    color: "#2563eb",
    role: "member",
    timezone: "Asia/Tokyo",
    is_active: true,
    login_email: null,
    created_at: now,
    updated_at: now,
  };
}

const members = [member("m1", "父"), member("m2", "たろう")];

describe("頻度", () => {
  it("毎日は FREQ=DAILY。曜日を選ぶと FREQ=WEEKLY", () => {
    expect(scheduleToRRule([])).toBe("FREQ=DAILY");
    expect(scheduleToRRule([1, 3, 5])).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });

  it("RRULE から曜日に戻せる", () => {
    expect(rruleToSchedule("FREQ=DAILY")).toEqual([]);
    expect(rruleToSchedule("FREQ=WEEKLY;BYDAY=TU,TH")).toEqual([2, 4]);
    expect(rruleToSchedule(null)).toEqual([]);
  });

  it("言葉にする。平日がそろっていたら「平日」と読む", () => {
    expect(describeFrequency({ kind: "schedule", byWeekday: [] })).toBe("毎日");
    expect(
      describeFrequency({ kind: "schedule", byWeekday: WEEKDAYS_ONLY }),
    ).toBe("平日");
    expect(describeFrequency({ kind: "schedule", byWeekday: [2, 4] })).toBe(
      "毎週 火・木",
    );
    expect(describeFrequency({ kind: "count", count: 3, period: "week" })).toBe(
      "週に3回",
    );
    expect(
      describeFrequency({ kind: "count", count: 10, period: "month" }),
    ).toBe("月に10回");
  });

  it("既定は毎日", () => {
    expect(defaultFrequency()).toEqual({ kind: "schedule", byWeekday: [] });
  });
});

describe("やる日", () => {
  // 2026-09-21 は月曜
  it("毎日ならどの日も対象", () => {
    const f: Frequency = { kind: "schedule", byWeekday: [] };
    expect(isDueOn(f, "2026-09-21")).toBe(true);
    expect(isDueOn(f, "2026-09-27")).toBe(true);
  });

  it("曜日を選ぶと、その曜日だけ", () => {
    const f: Frequency = { kind: "schedule", byWeekday: [2] }; // 火曜
    expect(isDueOn(f, "2026-09-22")).toBe(true);
    expect(isDueOn(f, "2026-09-21")).toBe(false);
  });

  it("平日は土日に出ない", () => {
    const f: Frequency = { kind: "schedule", byWeekday: WEEKDAYS_ONLY };
    expect(isDueOn(f, "2026-09-25")).toBe(true); // 金
    expect(isDueOn(f, "2026-09-26")).toBe(false); // 土
    expect(isDueOn(f, "2026-09-27")).toBe(false); // 日
  });

  it("回数で決めるものは、どの日でも対象になる", () => {
    const f: Frequency = { kind: "count", count: 3, period: "week" };
    expect(isDueOn(f, "2026-09-26")).toBe(true);
    expect(dueDatesBetween(f, "2026-09-21", "2026-09-23")).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
    ]);
  });

  it("期間の展開は、始めと終わりを含む", () => {
    const f: Frequency = { kind: "schedule", byWeekday: [1] }; // 月曜
    expect(dueDatesBetween(f, "2026-09-21", "2026-10-05")).toEqual([
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
    ]);
  });
});

describe("期間の区切り", () => {
  it("週は開始曜日にそろえる", () => {
    // 日曜始まり
    expect(periodRange("week", "2026-09-23", 0)).toEqual({
      from: "2026-09-20",
      to: "2026-09-26",
    });
    // 月曜始まり
    expect(periodRange("week", "2026-09-23", 1)).toEqual({
      from: "2026-09-21",
      to: "2026-09-27",
    });
  });

  it("月は1日から末日", () => {
    expect(periodRange("month", "2026-09-23")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(periodRange("month", "2026-02-10")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });
});

describe("DB の行から頻度を読む", () => {
  it("曜日で決めるもの", () => {
    expect(frequencyOf(habit({ rrule: "FREQ=WEEKLY;BYDAY=WE" }))).toEqual({
      kind: "schedule",
      byWeekday: [3],
    });
  });

  it("回数で決めるもの", () => {
    expect(
      frequencyOf(
        habit({ kind: "count", rrule: null, target_count: 3, period: "week" }),
      ),
    ).toEqual({ kind: "count", count: 3, period: "week" });
  });
});

describe("今日の一覧", () => {
  const today = "2026-09-21"; // 月曜

  it("やめた習慣は出さない", () => {
    const list = todayList([habit({ is_active: false })], [], members, today);
    expect(list).toHaveLength(0);
  });

  it("今日が対象でない曜日の習慣は出さない", () => {
    const list = todayList(
      [habit({ rrule: "FREQ=WEEKLY;BYDAY=TU" })],
      [],
      members,
      today,
    );
    expect(list).toHaveLength(0);
  });

  it("押したかどうかが付く", () => {
    const list = todayList([habit({})], [log("h1", today)], members, today);
    expect(list[0].done).toBe(true);
  });

  it("担当の人が引ける", () => {
    const list = todayList([habit({ member_id: "m2" })], [], members, today);
    expect(list[0].member?.display_name).toBe("たろう");
  });

  const running = habit({
    id: "run",
    name: "走る",
    kind: "count",
    rrule: null,
    target_count: 3,
    period: "week",
  });

  it("回数で決めるものは、残りと進みが付く", () => {
    const list = todayList(
      [running],
      [log("run", "2026-09-20")],
      members,
      today,
      0,
    );
    expect(list[0].remaining).toBe(2);
    expect(list[0].progress).toEqual({ done: 1, target: 3 });
  });

  it("回数に届いたら出さない。毎日残って邪魔になるのを避ける", () => {
    const logs = ["2026-09-20", "2026-09-21", "2026-09-22"].map((d) =>
      log("run", d),
    );
    // 今日（9/21）は押しているので、取り消せるよう残る
    expect(todayList([running], logs, members, today, 0)).toHaveLength(1);
    // 今日のぶんを押していなければ、届いているので出さない
    const others = ["2026-09-20", "2026-09-22", "2026-09-23"].map((d) =>
      log("run", d),
    );
    expect(todayList([running], others, members, today, 0)).toHaveLength(0);
  });

  it("先週の記録は今週の回数に入らない", () => {
    const list = todayList(
      [running],
      [log("run", "2026-09-19")], // 前の週（日曜始まりなら 9/13〜9/19）
      members,
      today,
      0,
    );
    expect(list[0].progress).toEqual({ done: 0, target: 3 });
  });
});

describe("並び", () => {
  it("自分のぶんが先。同じ人なら、押していないものが先", () => {
    const items = todayList(
      [
        habit({ id: "a", name: "あ", member_id: "m2" }),
        habit({ id: "b", name: "い", member_id: "m1" }),
        habit({ id: "c", name: "う", member_id: "m1" }),
      ],
      [log("b", "2026-09-21")],
      members,
      "2026-09-21",
    );
    expect(sortToday(items, "m1").map((i) => i.habit.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
});

describe("連続日数", () => {
  const today = "2026-09-21";

  it("記録が無ければ0", () => {
    expect(streak(habit({}), [], today)).toBe(0);
  });

  it("毎日の習慣は、日を続けて数える", () => {
    const logs = ["2026-09-19", "2026-09-20", "2026-09-21"].map((d) =>
      log("h1", d),
    );
    expect(streak(habit({}), logs, today)).toBe(3);
  });

  it("今日まだ押していなくても、途切れたことにしない", () => {
    const logs = ["2026-09-19", "2026-09-20"].map((d) => log("h1", d));
    expect(streak(habit({}), logs, today)).toBe(2);
  });

  it("途中が抜けたら、そこで止まる", () => {
    const logs = ["2026-09-17", "2026-09-19", "2026-09-20"].map((d) =>
      log("h1", d),
    );
    expect(streak(habit({}), logs, today)).toBe(2);
  });

  it("**週1回の習慣でも、やる日だけを数える**", () => {
    // 毎週月曜。9/7・9/14・9/21 と続けている
    const weekly = habit({ rrule: "FREQ=WEEKLY;BYDAY=MO" });
    const logs = ["2026-09-07", "2026-09-14", "2026-09-21"].map((d) =>
      log("h1", d),
    );
    expect(streak(weekly, logs, today)).toBe(3);
  });

  it("回数で決めるものは、届いた期間の数で数える", () => {
    const running = habit({
      kind: "count",
      rrule: null,
      target_count: 2,
      period: "week",
    });
    // 今週（9/20〜9/26）に2回、前の週（9/13〜9/19）に2回
    const logs = ["2026-09-20", "2026-09-21", "2026-09-15", "2026-09-17"].map(
      (d) => log("h1", d),
    );
    expect(streak(running, logs, today, 0)).toBe(2);
  });
});

describe("達成率", () => {
  const today = "2026-09-21";

  it("やる日のうち、やった日の割合", () => {
    const logs = ["2026-09-19", "2026-09-20", "2026-09-21"].map((d) =>
      log("h1", d),
    );
    const result = achievement(habit({}), logs, 7, today);
    expect(result).toEqual({ done: 3, due: 7, rate: 3 / 7 });
  });

  it("週1回の習慣は、やる日だけで割る", () => {
    const weekly = habit({ rrule: "FREQ=WEEKLY;BYDAY=MO" });
    const logs = ["2026-09-14", "2026-09-21"].map((d) => log("h1", d));
    // 直近14日（9/8〜9/21）の月曜は 9/14 と 9/21 の2日
    expect(achievement(weekly, logs, 14, today)).toEqual({
      done: 2,
      due: 2,
      rate: 1,
    });
  });

  it("記録が無ければ0", () => {
    expect(achievement(habit({}), [], 7, today).rate).toBe(0);
  });

  it("回数で決めるものは、期間あたりの回数で見る", () => {
    const running = habit({
      kind: "count",
      rrule: null,
      target_count: 3,
      period: "week",
    });
    // 直近7日で3回 → 目標も3回なので100%
    const logs = ["2026-09-19", "2026-09-20", "2026-09-21"].map((d) =>
      log("h1", d),
    );
    expect(achievement(running, logs, 7, today).rate).toBe(1);
  });
});
