import { describe, expect, it } from "vitest";

import { toIso } from "@/lib/calendar/date";
import { readIcs } from "../ics";
import { zonedToIso } from "../zone";

const read = (text: string, assignees = ["m1"]) =>
  readIcs(text, { members: [], defaultAssignees: assignees });

const wrap = (body: string) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", body, "END:VCALENDAR"].join("\r\n");

describe("時間帯つきの現地時刻", () => {
  it("日本時間", () => {
    expect(zonedToIso("2026-09-19T23:00:00", "Asia/Tokyo")).toBe(
      "2026-09-19T14:00:00.000Z",
    );
  });

  it("夏時間のある地域でも、その時期のずれで計算する", () => {
    // ロンドンは夏（BST・UTC+1）と冬（GMT・UTC+0）でずれが変わる
    expect(zonedToIso("2026-07-01T12:00:00", "Europe/London")).toBe(
      "2026-07-01T11:00:00.000Z",
    );
    expect(zonedToIso("2026-01-01T12:00:00", "Europe/London")).toBe(
      "2026-01-01T12:00:00.000Z",
    );
  });

  it("知らない名前なら null", () => {
    expect(zonedToIso("2026-07-01T12:00:00", "Mars/Olympus")).toBeNull();
  });
});

describe(".ics を読む", () => {
  it("時刻付きの予定（UTC 表記）", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:abc-123",
          "SUMMARY:歯医者",
          "DTSTART:20260919T140000Z",
          "DTEND:20260919T150000Z",
          "LOCATION:さくら歯科",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "歯医者",
      allDay: false,
      startsAt: "2026-09-19T14:00:00.000Z",
      endsAt: "2026-09-19T15:00:00.000Z",
      location: "さくら歯科",
      externalKey: "ics:abc-123",
      assignees: ["m1"],
      problem: null,
    });
  });

  it("TZID 付きは、その時間帯の時刻として読む", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:x",
          "SUMMARY:面談",
          "DTSTART;TZID=Asia/Tokyo:20260919T160000",
          "DTEND;TZID=Asia/Tokyo:20260919T170000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(rows[0].startsAt).toBe(toIso("2026-09-19", "16:00"));
  });

  it("終日は、終わりが「その日を含まない」ので1日戻す", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:y",
          "SUMMARY:旅行",
          "DTSTART;VALUE=DATE:20261012",
          "DTEND;VALUE=DATE:20261015",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(rows[0]).toMatchObject({
      allDay: true,
      startDate: "2026-10-12",
      endDate: "2026-10-14",
    });
  });

  it("1日だけの終日", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "SUMMARY:運動会",
          "DTSTART;VALUE=DATE:20261010",
          "DTEND;VALUE=DATE:20261011",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(rows[0]).toMatchObject({
      startDate: "2026-10-10",
      endDate: "2026-10-10",
    });
  });

  it("折り返された行をつなぐ", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "SUMMARY:とても長いタイトルの予",
          " 定です",
          "DTSTART:20260919T140000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(rows[0].title).toBe("とても長いタイトルの予定です");
  });

  it("エスケープを戻す", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "SUMMARY:面談\\, 三者",
          "DESCRIPTION:1行目\\n2行目",
          "DTSTART:20260919T140000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(rows[0].title).toBe("面談, 三者");
    expect(rows[0].description).toBe("1行目\n2行目");
  });

  it("繰り返しはそのまま引き継ぐ（FR-I05）", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "SUMMARY:ピアノ",
          "DTSTART;TZID=Asia/Tokyo:20260901T160000",
          "RRULE:FREQ=WEEKLY;BYDAY=TU",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(rows[0].rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("状態を読む", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "SUMMARY:延期の試合",
          "DTSTART:20260919T140000Z",
          "STATUS:CANCELLED",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(rows[0].status).toBe("cancelled");
  });

  it("複数の予定を順に読む", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "SUMMARY:A",
          "DTSTART:20260919T140000Z",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "SUMMARY:B",
          "DTSTART:20260920T140000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(rows.map((r) => r.title)).toEqual(["A", "B"]);
  });

  it("読めないものは理由を付けて外す", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "SUMMARY:日付なし",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "DTSTART:20260919T140000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(rows[0].problem).toBe("開始が読めません");
    expect(rows[1].problem).toBe("タイトルがありません");
  });

  it("担当者が決まらなければ外す（.ics には担当者が無い）", () => {
    const rows = read(
      wrap(
        [
          "BEGIN:VEVENT",
          "SUMMARY:A",
          "DTSTART:20260919T140000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      [],
    );
    expect(rows[0].problem).toBe("担当者が決まっていません");
  });
});
