import { describe, expect, it } from "vitest";

import { expand } from "../expand";
import {
  describeRecurrence,
  fromRRule,
  toRRule,
  type Recurrence,
} from "../rule";

const weekly: Recurrence = {
  freq: "weekly",
  interval: 1,
  byWeekday: [2],
  end: { kind: "never" },
};

describe("ルールの読み書き", () => {
  it("毎週火曜", () => {
    expect(toRRule(weekly)).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(fromRRule("FREQ=WEEKLY;BYDAY=TU")).toEqual(weekly);
  });

  it("曜日は複数選べる。並びは曜日順にそろえる", () => {
    const rule = { ...weekly, byWeekday: [4, 2] as Recurrence["byWeekday"] };
    expect(toRRule(rule)).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
  });

  it("間隔を指定できる（FR-R02）", () => {
    const rule = { ...weekly, interval: 2 };
    expect(toRRule(rule)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU");
    expect(fromRRule(toRRule(rule))).toEqual(rule);
  });

  it("終了は「回数」でも「日付」でも書ける（FR-R03）", () => {
    const byCount = { ...weekly, end: { kind: "count", count: 10 } as const };
    expect(toRRule(byCount)).toBe("FREQ=WEEKLY;BYDAY=TU;COUNT=10");
    expect(fromRRule(toRRule(byCount))).toEqual(byCount);

    const byDate = {
      ...weekly,
      end: { kind: "until", date: "2026-12-31" } as const,
    };
    expect(toRRule(byDate)).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T000000Z");
    expect(fromRRule(toRRule(byDate))).toEqual(byDate);
  });

  it("読めない文字列は null（画面で「繰り返しなし」として扱う）", () => {
    expect(fromRRule("")).toBeNull();
    expect(fromRRule(null)).toBeNull();
    expect(fromRRule("なんか変な文字列")).toBeNull();
  });
});

describe("言葉にする", () => {
  it("読んで分かる形にする", () => {
    expect(describeRecurrence(weekly, "2026-09-01")).toBe("毎週 火");
    expect(
      describeRecurrence(
        { ...weekly, byWeekday: [2, 4] as Recurrence["byWeekday"] },
        "2026-09-01",
      ),
    ).toBe("毎週 火・木");
    expect(describeRecurrence({ ...weekly, interval: 2 }, "2026-09-01")).toBe(
      "2週おき 火",
    );
    expect(
      describeRecurrence(
        { freq: "monthly", interval: 1, byWeekday: [], end: { kind: "never" } },
        "2026-09-15",
      ),
    ).toBe("毎月 15日");
    expect(
      describeRecurrence(
        { freq: "yearly", interval: 1, byWeekday: [], end: { kind: "never" } },
        "2026-09-15",
      ),
    ).toBe("毎年 9月15日");
  });

  it("曜日を選んでいなければ、開始日の曜日で言う", () => {
    // 2026-09-01 は火曜
    expect(describeRecurrence({ ...weekly, byWeekday: [] }, "2026-09-01")).toBe(
      "毎週 火",
    );
  });

  it("終了条件も言葉にする", () => {
    expect(
      describeRecurrence(
        { ...weekly, end: { kind: "count", count: 5 } },
        "2026-09-01",
      ),
    ).toBe("毎週 火（5回）");
    expect(
      describeRecurrence(
        { ...weekly, end: { kind: "until", date: "2026-12-31" } },
        "2026-09-01",
      ),
    ).toBe("毎週 火（12月31日まで）");
  });
});

describe("展開", () => {
  it("毎週火曜を1か月ぶん", () => {
    expect(
      expand("FREQ=WEEKLY;BYDAY=TU", "2026-09-01", "2026-09-01", "2026-10-01"),
    ).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
  });

  it("期間の終わりは含まない", () => {
    expect(
      expand("FREQ=DAILY", "2026-09-01", "2026-09-01", "2026-09-04"),
    ).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("開始より前の期間を聞かれても、何も返さない", () => {
    expect(
      expand("FREQ=DAILY", "2026-09-10", "2026-09-01", "2026-09-05"),
    ).toEqual([]);
  });

  it("期間の途中から聞いても、正しい日が返る", () => {
    expect(
      expand("FREQ=WEEKLY;BYDAY=TU", "2026-09-01", "2026-09-20", "2026-10-01"),
    ).toEqual(["2026-09-22", "2026-09-29"]);
  });

  it("回数で終わる", () => {
    expect(
      expand(
        "FREQ=WEEKLY;BYDAY=TU;COUNT=3",
        "2026-09-01",
        "2026-09-01",
        "2026-12-01",
      ),
    ).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
  });

  it("日付で終わる。その日は含む", () => {
    expect(
      expand(
        "FREQ=WEEKLY;BYDAY=TU;UNTIL=20260915T000000Z",
        "2026-09-01",
        "2026-09-01",
        "2026-12-01",
      ),
    ).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
  });

  it("平日だけ（習慣管理でも使う形）", () => {
    expect(
      expand(
        "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        "2026-09-19",
        "2026-09-19",
        "2026-09-27",
      ),
    ).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);
  });

  it("毎月。月末の無い月は飛ばす（3月31日の次は5月31日）", () => {
    expect(
      expand("FREQ=MONTHLY", "2026-03-31", "2026-03-01", "2026-07-01"),
    ).toEqual(["2026-03-31", "2026-05-31"]);
  });

  it("毎年", () => {
    expect(
      expand("FREQ=YEARLY", "2026-09-19", "2026-01-01", "2029-01-01"),
    ).toEqual(["2026-09-19", "2027-09-19", "2028-09-19"]);
  });

  it("2週おき", () => {
    expect(
      expand(
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU",
        "2026-09-01",
        "2026-09-01",
        "2026-10-01",
      ),
    ).toEqual(["2026-09-01", "2026-09-15", "2026-09-29"]);
  });

  it("読めないルールは、1回きりの予定として扱う", () => {
    expect(
      expand("でたらめ", "2026-09-10", "2026-09-01", "2026-10-01"),
    ).toEqual(["2026-09-10"]);
    expect(
      expand("でたらめ", "2026-08-10", "2026-09-01", "2026-10-01"),
    ).toEqual([]);
  });

  it("終了の無い毎日でも、返る数に上限がある", () => {
    const days = expand("FREQ=DAILY", "2020-01-01", "2020-01-01", "2030-01-01");
    expect(days.length).toBeLessThanOrEqual(400);
  });
});
