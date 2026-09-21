import { describe, expect, it } from "vitest";

import {
  formatRange,
  rangeFor,
  shiftDays,
  shiftView,
  toDateKey,
  weekDays,
} from "../date";

describe("週の組み立て", () => {
  it("日曜始まりでその週の7日を返す", () => {
    const days = weekDays("2026-09-21", 0).map(toDateKey);
    expect(days[0]).toBe("2026-09-20");
    expect(days[6]).toBe("2026-09-26");
  });

  it("月曜始まりにもできる", () => {
    const days = weekDays("2026-09-21", 1).map(toDateKey);
    expect(days[0]).toBe("2026-09-21");
    expect(days[6]).toBe("2026-09-27");
  });

  it("月をまたいでも続けて並ぶ", () => {
    const days = weekDays("2026-10-01", 0).map(toDateKey);
    expect(days[0]).toBe("2026-09-27");
    expect(days[6]).toBe("2026-10-03");
  });
});

describe("日付の移動", () => {
  it("月をまたいで進む・戻る", () => {
    expect(shiftDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("見せ方によって動く幅が変わる", () => {
    expect(shiftView("day", "2026-09-21", 1)).toBe("2026-09-22");
    expect(shiftView("week", "2026-09-21", 1)).toBe("2026-09-28");
    expect(shiftView("week", "2026-09-21", -1)).toBe("2026-09-14");
    expect(shiftView("month", "2026-09-21", 1)).toBe("2026-10-01");
  });

  it("月の移動で日が消えない（1/31 の翌月は 2/31 にならない）", () => {
    expect(shiftView("month", "2026-01-31", 1)).toBe("2026-02-01");
  });
});

describe("取得する期間", () => {
  it("日表示はその日だけ", () => {
    expect(rangeFor("day", "2026-09-21")).toEqual({
      fromDate: "2026-09-21",
      toDate: "2026-09-22",
    });
  });

  it("週表示はその週。終わりは含まない", () => {
    expect(rangeFor("week", "2026-09-21", 0)).toEqual({
      fromDate: "2026-09-20",
      toDate: "2026-09-27",
    });
  });

  it("月表示は前後の週まで含む（格子に出る日ぶん）", () => {
    const { fromDate, toDate } = rangeFor("month", "2026-09-21", 0);
    expect(fromDate <= "2026-09-01").toBe(true);
    expect(toDate > "2026-09-30").toBe(true);
  });
});

describe("見出し", () => {
  it("見せ方ごとに言い方を変える", () => {
    expect(formatRange("month", "2026-09-21")).toBe("2026年9月");
    expect(formatRange("day", "2026-09-21")).toBe("2026年9月21日（月）");
    expect(formatRange("week", "2026-09-21", 0)).toBe("2026年9月20日〜26日");
  });

  it("週が月をまたぐときは、終わりにも月を付ける", () => {
    expect(formatRange("week", "2026-10-01", 0)).toBe("2026年9月27日〜10月3日");
  });
});
