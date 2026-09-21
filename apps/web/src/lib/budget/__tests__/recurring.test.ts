import { describe, expect, it } from "vitest";

import {
  defaultCycle,
  describeCycle,
  fromRRule,
  LAST_DAY,
  occurrenceIn,
  toRRule,
  type Cycle,
} from "@/lib/budget/recurring";
import { occurrencesIn, pendingOnly, pendingTotal } from "@/lib/budget/pending";
import { nextMonthFirstDay } from "@/lib/budget/month";
import type { RecurringExpense } from "@/lib/supabase/types";

const now = "2026-09-21T09:00:00+09:00";

function recurring(over: Partial<RecurringExpense>): RecurringExpense {
  return {
    id: "r1",
    family_id: "f1",
    name: "家賃",
    amount: 90000,
    category_id: "c1",
    member_id: "m1",
    rrule: "FREQ=MONTHLY;BYMONTHDAY=27",
    start_date: "2026-01-01",
    is_active: true,
    created_by: "m1",
    created_at: now,
    updated_at: now,
    ...over,
  };
}

describe("固定費の繰り返し", () => {
  const cases: [Cycle, string, string][] = [
    [
      { kind: "monthly", day: 27, interval: 1 },
      "FREQ=MONTHLY;BYMONTHDAY=27",
      "毎月 27日",
    ],
    [
      { kind: "monthly", day: LAST_DAY, interval: 1 },
      "FREQ=MONTHLY;BYMONTHDAY=-1",
      "毎月 末日",
    ],
    [
      { kind: "monthly", day: 5, interval: 2 },
      "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=5",
      "2か月ごと 5日",
    ],
    [
      { kind: "yearly", month: 4, day: 1 },
      "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=1",
      "毎年 4月1日",
    ],
  ];

  it.each(cases)("%o ↔ %s", (cycle, rrule, label) => {
    expect(toRRule(cycle)).toBe(rrule);
    expect(fromRRule(rrule)).toEqual(cycle);
    expect(describeCycle(cycle)).toBe(label);
  });

  it("読めないルールは null。画面で作り直させる", () => {
    expect(fromRRule("")).toBeNull();
    expect(fromRRule("FREQ=WEEKLY;BYDAY=TU")).toBeNull();
    expect(fromRRule("FREQ=MONTHLY;BYMONTHDAY=99")).toBeNull();
  });

  it("既定は毎月", () => {
    expect(defaultCycle(27)).toEqual({
      kind: "monthly",
      day: 27,
      interval: 1,
    });
  });
});

describe("その月に起きる日", () => {
  it("毎月◯日", () => {
    expect(
      occurrenceIn("FREQ=MONTHLY;BYMONTHDAY=27", "2026-01-01", "2026-09"),
    ).toBe("2026-09-27");
  });

  it("末日は月によって変わる", () => {
    const rule = "FREQ=MONTHLY;BYMONTHDAY=-1";
    expect(occurrenceIn(rule, "2026-01-01", "2026-09")).toBe("2026-09-30");
    expect(occurrenceIn(rule, "2026-01-01", "2026-02")).toBe("2026-02-28");
    expect(occurrenceIn(rule, "2026-01-01", "2026-01")).toBe("2026-01-31");
  });

  it("31日は、31日のない月には起きない", () => {
    const rule = "FREQ=MONTHLY;BYMONTHDAY=31";
    expect(occurrenceIn(rule, "2026-01-01", "2026-01")).toBe("2026-01-31");
    expect(occurrenceIn(rule, "2026-01-01", "2026-04")).toBeNull();
  });

  it("2か月ごとは、裏の月に起きない", () => {
    const rule = "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=5";
    expect(occurrenceIn(rule, "2026-01-05", "2026-03")).toBe("2026-03-05");
    expect(occurrenceIn(rule, "2026-01-05", "2026-04")).toBeNull();
  });

  it("始めた月より前には起きない", () => {
    const rule = "FREQ=MONTHLY;BYMONTHDAY=27";
    expect(occurrenceIn(rule, "2026-09-01", "2026-08")).toBeNull();
  });

  it("翌月の1日を境にする", () => {
    expect(nextMonthFirstDay("2026-09")).toBe("2026-10-01");
    expect(nextMonthFirstDay("2026-12")).toBe("2027-01-01");
  });
});

describe("今月まだ入れていない固定費", () => {
  const list = [
    recurring({ id: "rent", name: "家賃", amount: 90000 }),
    recurring({
      id: "power",
      name: "電気",
      amount: null,
      rrule: "FREQ=MONTHLY;BYMONTHDAY=10",
    }),
    recurring({
      id: "old",
      name: "解約したサブスク",
      amount: 980,
      is_active: false,
    }),
    recurring({
      id: "tax",
      name: "自動車税",
      amount: 39500,
      rrule: "FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=31",
    }),
  ];

  it("隠した固定費は出さない。解約したものが積み上がらない", () => {
    const all = occurrencesIn(list, "2026-09", []);
    expect(all.map((o) => o.recurring.id)).toEqual(["power", "rent"]);
  });

  it("その月に起きないものは出さない", () => {
    expect(
      occurrencesIn(list, "2026-05", []).map((o) => o.recurring.id),
    ).toContain("tax");
    expect(
      occurrencesIn(list, "2026-09", []).map((o) => o.recurring.id),
    ).not.toContain("tax");
  });

  it("起きる日の順に並ぶ", () => {
    expect(occurrencesIn(list, "2026-09", []).map((o) => o.date)).toEqual([
      "2026-09-10",
      "2026-09-27",
    ]);
  });

  it("もう入れたものには日付が付き、待ち行列から外れる", () => {
    const all = occurrencesIn(list, "2026-09", [
      { recurring_id: "rent", occurred_on: "2026-09-26" },
    ]);
    expect(all.find((o) => o.recurring.id === "rent")?.recorded).toBe(
      "2026-09-26",
    );
    expect(pendingOnly(all).map((o) => o.recurring.id)).toEqual(["power"]);
  });

  it("引き落とし日と入れた日が1日ずれても、同じものとして扱う", () => {
    const all = occurrencesIn(list, "2026-09", [
      { recurring_id: "rent", occurred_on: "2026-09-28" },
    ]);
    expect(pendingOnly(all).map((o) => o.recurring.id)).toEqual(["power"]);
  });

  it("まだのぶんの合計。金額の決まっていないものは数に入れない", () => {
    expect(pendingTotal(occurrencesIn(list, "2026-09", []))).toEqual({
      amount: 90000,
      unknown: 1,
    });
  });
});
