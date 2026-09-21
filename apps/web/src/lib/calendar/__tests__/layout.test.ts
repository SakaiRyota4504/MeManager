import { describe, expect, it } from "vitest";

import { toIso } from "../date";
import { layoutDay, snapMinutes, toTimeString } from "../layout";
import type { EventWithAssignees } from "../model";

const DAY = "2026-09-21";

function ev(id: string, start: string, end: string): EventWithAssignees {
  return {
    id,
    all_day: false,
    starts_at: toIso(DAY, start),
    ends_at: toIso(DAY, end),
    timezone: "Asia/Tokyo",
    assignees: [],
  } as unknown as EventWithAssignees;
}

/** 0〜1 の値を「その日の分」に戻す */
const minutes = (ratio: number) => Math.round(ratio * 24 * 60);

describe("時刻付き予定の置き場所", () => {
  it("開始時刻と長さが位置になる", () => {
    const [box] = layoutDay([ev("a", "09:00", "10:30")], DAY);
    expect(minutes(box.top)).toBe(9 * 60);
    expect(minutes(box.height)).toBe(90);
    expect(box.lanes).toBe(1);
  });

  it("重ならない予定は、どれも横幅いっぱい", () => {
    const boxes = layoutDay(
      [ev("a", "09:00", "10:00"), ev("b", "10:00", "11:00")],
      DAY,
    );
    expect(boxes.map((b) => b.lanes)).toEqual([1, 1]);
    expect(boxes.map((b) => b.lane)).toEqual([0, 0]);
  });

  it("重なる予定は横に並ぶ", () => {
    const boxes = layoutDay(
      [ev("a", "09:00", "11:00"), ev("b", "10:00", "12:00")],
      DAY,
    );
    expect(boxes.map((b) => b.lanes)).toEqual([2, 2]);
    expect(boxes.map((b) => b.lane)).toEqual([0, 1]);
  });

  it("A-B と B-C が重なるとき、A と C は同じ列に入る", () => {
    const boxes = layoutDay(
      [
        ev("a", "09:00", "10:30"),
        ev("b", "10:00", "11:30"),
        ev("c", "11:00", "12:00"),
      ],
      DAY,
    );
    expect(boxes.map((b) => b.lanes)).toEqual([2, 2, 2]);
    expect(boxes.map((b) => b.lane)).toEqual([0, 1, 0]);
  });

  it("短い予定にも最低限の高さを与える（線になって押せなくなるのを防ぐ）", () => {
    const [box] = layoutDay([ev("a", "09:00", "09:05")], DAY);
    expect(minutes(box.height)).toBe(15);
  });

  it("前の日から続く予定は、その日の頭から出す", () => {
    const e = ev("a", "09:00", "10:00");
    e.starts_at = toIso("2026-09-20", "22:00");
    const [box] = layoutDay([e], DAY);
    expect(box.top).toBe(0);
    expect(box.fromBefore).toBe(true);
    expect(minutes(box.height)).toBe(10 * 60);
  });

  it("次の日へ続く予定は、その日の終わりで止める", () => {
    const e = ev("a", "22:00", "23:00");
    e.ends_at = toIso("2026-09-22", "02:00");
    const [box] = layoutDay([e], DAY);
    expect(box.toAfter).toBe(true);
    expect(minutes(box.top) + minutes(box.height)).toBe(24 * 60);
  });

  it("終日予定と、その日にかからない予定は出さない", () => {
    const allDay = ev("a", "09:00", "10:00");
    allDay.all_day = true;
    const other = ev("b", "09:00", "10:00");
    other.starts_at = toIso("2026-09-25", "09:00");
    other.ends_at = toIso("2026-09-25", "10:00");
    expect(layoutDay([allDay, other], DAY)).toHaveLength(0);
  });
});

describe("時刻の丸め", () => {
  it("15分刻みにそろえる", () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(521)).toBe(525);
  });

  it("分を HH:MM にする", () => {
    expect(toTimeString(0)).toBe("00:00");
    expect(toTimeString(9 * 60 + 30)).toBe("09:30");
    expect(toTimeString(24 * 60)).toBe("23:59");
    expect(toTimeString(-30)).toBe("00:00");
  });
});

describe("その日にかからない予定", () => {
  it("前日の短い予定が、翌日の頭に化けて出ない", () => {
    const e = ev("a", "09:00", "09:10");
    e.starts_at = toIso("2026-09-20", "09:00");
    e.ends_at = toIso("2026-09-20", "09:10");
    expect(layoutDay([e], DAY)).toHaveLength(0);
  });

  it("日をまたぐ予定は、両方の日に出る", () => {
    const e = ev("a", "22:00", "23:00");
    e.ends_at = toIso("2026-09-22", "02:00");
    expect(layoutDay([e], DAY)).toHaveLength(1);
    expect(layoutDay([e], "2026-09-22")).toHaveLength(1);
    expect(layoutDay([e], "2026-09-23")).toHaveLength(0);
  });
});
