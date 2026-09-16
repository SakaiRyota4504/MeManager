import { describe, expect, it } from "vitest";

import {
  allDayKeys,
  eventDateKey,
  formatMonth,
  monthGridDays,
  monthRange,
  shiftMonth,
  toDateKey,
  toMonthKey,
} from "../date";

describe("月の移動", () => {
  it("年をまたいでも正しく進む", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("表示は日本語の年月になる", () => {
    expect(formatMonth("2026-09")).toBe("2026年9月");
  });
});

describe("月表示の格子", () => {
  it("週の頭にそろえ、7の倍数で埋まる", () => {
    const days = monthGridDays("2026-09", 0);
    expect(days.length % 7).toBe(0);
    expect(days[0].getDay()).toBe(0);
    // 2026年9月1日は火曜なので、前月の8/30から始まる
    expect(toDateKey(days[0])).toBe("2026-08-30");
  });

  it("月曜始まりにもできる", () => {
    const days = monthGridDays("2026-09", 1);
    expect(days[0].getDay()).toBe(1);
  });

  it("1日が週の頭の月でも、前月を余計に足さない", () => {
    // 2026年11月1日は日曜
    const days = monthGridDays("2026-11", 0);
    expect(toDateKey(days[0])).toBe("2026-11-01");
  });

  it("取得期間は格子の最初から最後の翌日まで", () => {
    const { fromDate, toDate } = monthRange("2026-09", 0);
    expect(fromDate).toBe("2026-08-30");
    // 格子の最終日の翌日（排他的）
    expect(toDate > fromDate).toBe(true);
  });
});

describe("終日予定の日付", () => {
  it("開始日から終了日まで、終了日を含めて並ぶ", () => {
    expect(allDayKeys("2026-09-21", "2026-09-23")).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
    ]);
  });

  it("1日だけの予定は1件", () => {
    expect(allDayKeys("2026-09-21", "2026-09-21")).toEqual(["2026-09-21"]);
  });

  it("月をまたいでも続く", () => {
    expect(allDayKeys("2026-08-31", "2026-09-02")).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });
});

describe("時刻付き予定がどの日に入るか", () => {
  it("UTCの深夜は、日本時間では翌日になる", () => {
    // 21:00 UTC = 翌日 06:00 JST（欧州サッカーの深夜キックオフ）
    expect(eventDateKey("2026-09-19T21:00:00Z", "Asia/Tokyo")).toBe(
      "2026-09-20",
    );
  });

  it("日本時間の昼はその日のまま", () => {
    expect(eventDateKey("2026-09-19T03:00:00Z", "Asia/Tokyo")).toBe(
      "2026-09-19",
    );
  });

  it("タイムゾーンが違えば日付も変わる", () => {
    expect(eventDateKey("2026-09-19T21:00:00Z", "Europe/London")).toBe(
      "2026-09-19",
    );
  });
});

describe("日付キー", () => {
  it("1桁の月日は0で埋める", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toMonthKey(new Date(2026, 0, 5))).toBe("2026-01");
  });
});
