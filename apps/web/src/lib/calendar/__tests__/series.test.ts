import { describe, expect, it } from "vitest";

import { toIso } from "../date";
import type { EventWithAssignees } from "../model";
import { expandSeries, seriesStart } from "../series";

const base = {
  id: "e1",
  timezone: "Asia/Tokyo",
  assignees: ["m1"],
  rrule: "FREQ=WEEKLY;BYDAY=TU",
} as unknown as EventWithAssignees;

function allDay(start: string, end = start, rrule = base.rrule) {
  return {
    ...base,
    rrule,
    all_day: true,
    start_date: start,
    end_date: end,
    starts_at: null,
    ends_at: null,
  } as EventWithAssignees;
}

function timed(date: string, from: string, to: string, rrule = base.rrule) {
  return {
    ...base,
    rrule,
    all_day: false,
    start_date: null,
    end_date: null,
    starts_at: toIso(date, from),
    ends_at: toIso(date, to),
  } as EventWithAssignees;
}

describe("繰り返しを1回ぶんずつに開く", () => {
  it("終日の予定を毎週ぶん出す", () => {
    const out = expandSeries(
      allDay("2026-09-01"),
      [],
      "2026-09-01",
      "2026-10-01",
    );
    expect(out.map((e) => e.start_date)).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
    expect(out.every((e) => e.occurrence === e.start_date)).toBe(true);
  });

  it("元の予定のIDは変わらない（どの回も同じ予定のもの）", () => {
    const out = expandSeries(
      allDay("2026-09-01"),
      [],
      "2026-09-01",
      "2026-10-01",
    );
    expect(new Set(out.map((e) => e.id))).toEqual(new Set(["e1"]));
  });

  it("休む回は出さない", () => {
    const out = expandSeries(
      allDay("2026-09-01"),
      ["2026-09-15"],
      "2026-09-01",
      "2026-10-01",
    );
    expect(out.map((e) => e.start_date)).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-22",
      "2026-09-29",
    ]);
  });

  it("何日にまたがるかは、どの回でも変わらない", () => {
    // 2日間の終日予定
    const out = expandSeries(
      allDay("2026-09-01", "2026-09-02"),
      [],
      "2026-09-01",
      "2026-09-20",
    );
    expect(out.map((e) => [e.start_date, e.end_date])).toEqual([
      ["2026-09-01", "2026-09-02"],
      ["2026-09-08", "2026-09-09"],
      ["2026-09-15", "2026-09-16"],
    ]);
  });

  it("時刻付きは、時刻と長さを保ったままずれる", () => {
    const out = expandSeries(
      timed("2026-09-01", "16:00", "17:30"),
      [],
      "2026-09-01",
      "2026-09-20",
    );
    expect(out.map((e) => e.starts_at)).toEqual([
      toIso("2026-09-01", "16:00"),
      toIso("2026-09-08", "16:00"),
      toIso("2026-09-15", "16:00"),
    ]);
    expect(out.map((e) => e.ends_at)).toEqual([
      toIso("2026-09-01", "17:30"),
      toIso("2026-09-08", "17:30"),
      toIso("2026-09-15", "17:30"),
    ]);
  });

  it("日をまたぐ時刻付きの予定も、長さを保つ", () => {
    const e = timed("2026-09-01", "22:00", "23:00");
    e.ends_at = toIso("2026-09-02", "02:00");
    const out = expandSeries(e, [], "2026-09-01", "2026-09-16");
    expect(out.map((x) => x.ends_at)).toEqual([
      toIso("2026-09-02", "02:00"),
      toIso("2026-09-09", "02:00"),
      toIso("2026-09-16", "02:00"),
    ]);
  });

  it("繰り返しでない予定は、そのまま1件", () => {
    const one = allDay("2026-09-01", "2026-09-01", null as unknown as string);
    expect(expandSeries(one, [], "2026-09-01", "2026-10-01")).toEqual([one]);
  });

  it("始まりの日は、終日なら日付、時刻付きなら時間帯ごとの日付", () => {
    expect(seriesStart(allDay("2026-09-01"))).toBe("2026-09-01");
    // JST 0:30 は UTC では前日。時間帯を見ないと1日ずれる
    expect(seriesStart(timed("2026-09-01", "00:30", "01:30"))).toBe(
      "2026-09-01",
    );
  });
});
