import { describe, expect, it } from "vitest";

import { toIso } from "@/lib/calendar/date";
import { parseCsv } from "../csv";
import { parseMoment } from "../datetime";
import { decodeFile } from "../encoding";
import { detectMapping, duplicateKey, emptyMapping, readCsv } from "../rows";

const MEMBERS = [
  { id: "m1", display_name: "父" },
  { id: "m2", display_name: "母" },
  { id: "m3", display_name: "たろう" },
];

const read = (text: string, defaults: string[] = ["m1"]) =>
  readCsv(text, { members: MEMBERS, defaultAssignees: defaults });

describe("CSV を表にする", () => {
  it("素直な形", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("CRLF でも読める", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("BOM を落とす（Excel から出した UTF-8）", () => {
    expect(parseCsv("﻿a,b\n1,2")[0]).toEqual(["a", "b"]);
  });

  it("引用符の中のカンマ・改行・引用符", () => {
    expect(parseCsv('a,b\n"1,5","二\n行"\n')).toEqual([
      ["a", "b"],
      ["1,5", "二\n行"],
    ]);
    expect(parseCsv('a\n"引用符 "" 入り"')).toEqual([["a"], ['引用符 " 入り']]);
  });

  it("空行は読み飛ばす。最後の改行が無くても読める", () => {
    expect(parseCsv("a\n\n1")).toEqual([["a"], ["1"]]);
  });

  it("空の値は空文字のまま残す", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
});

describe("日時を読む", () => {
  it("日付だけ", () => {
    expect(parseMoment("2026-09-19")).toEqual({
      kind: "date",
      date: "2026-09-19",
    });
    expect(parseMoment("2026/9/19")).toEqual({
      kind: "date",
      date: "2026-09-19",
    });
  });

  it("時間帯の指定が無ければ日本時間として読む", () => {
    expect(parseMoment("2026-09-19 23:00")).toEqual({
      kind: "time",
      iso: toIso("2026-09-19", "23:00"),
    });
  });

  it("Z 付き・+09:00 付き", () => {
    expect(parseMoment("2026-09-19T14:00:00Z")).toEqual({
      kind: "time",
      iso: "2026-09-19T14:00:00.000Z",
    });
    // 日本時間の23:00 は UTC の14:00
    expect(parseMoment("2026-09-19T23:00:00+09:00")).toEqual({
      kind: "time",
      iso: "2026-09-19T14:00:00.000Z",
    });
  });

  it("存在しない日付は読まない", () => {
    expect(parseMoment("2026-02-30")).toBeNull();
    expect(parseMoment("2026-13-01")).toBeNull();
    expect(parseMoment("2026-09-19 25:00")).toBeNull();
  });

  it("読めない文字列", () => {
    expect(parseMoment("")).toBeNull();
    expect(parseMoment("来週の火曜")).toBeNull();
  });
});

describe("行を読み替える", () => {
  it("手で書いた形（日本語の列名）", () => {
    const { rows } = read(
      "タイトル,開始,終了,担当者,場所,状態\n" +
        "ピアノ教室,2026-09-15 16:00,2026-09-15 17:00,たろう,市民センター,確定\n",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      line: 2,
      title: "ピアノ教室",
      allDay: false,
      startsAt: toIso("2026-09-15", "16:00"),
      endsAt: toIso("2026-09-15", "17:00"),
      assignees: ["m3"],
      location: "市民センター",
      status: "confirmed",
      problem: null,
    });
  });

  it("担当者は「；」区切りで複数", () => {
    const { rows } = read(
      "タイトル,開始,担当者\n運動会,2026-10-10,父;母;たろう\n",
    );
    expect(rows[0].assignees).toEqual(["m1", "m2", "m3"]);
  });

  it("担当者の列が無ければ、画面で指定したものを使う", () => {
    const { rows } = read("タイトル,開始\n休み,2026-10-03\n", ["m2"]);
    expect(rows[0].assignees).toEqual(["m2"]);
  });

  it("担当者が決まらない行は取り込まない（FR-E06）", () => {
    const { rows } = read("タイトル,開始\n休み,2026-10-03\n", []);
    expect(rows[0].problem).toBe("担当者が決まっていません");
  });

  it("知らない名前は警告にする", () => {
    const { rows } = read("タイトル,開始,担当者\n塾,2026-10-03,じろう\n");
    expect(rows[0].problem).toContain("じろう");
  });

  it("開始が日付だけなら終日として扱う", () => {
    const { rows } = read("タイトル,開始\n休み,2026-10-03\n");
    expect(rows[0]).toMatchObject({
      allDay: true,
      startDate: "2026-10-03",
      endDate: "2026-10-03",
      startsAt: null,
    });
  });

  it("終日で期間があるときは、終了の日まで入る", () => {
    const { rows } = read("タイトル,開始,終了\n旅行,2026-10-12,2026-10-14\n");
    expect(rows[0]).toMatchObject({
      allDay: true,
      startDate: "2026-10-12",
      endDate: "2026-10-14",
    });
  });

  it("終了を省いたら1時間後", () => {
    const { rows } = read("タイトル,開始\n面談,2026-10-03 14:00\n");
    expect(rows[0].endsAt).toBe(toIso("2026-10-03", "15:00"));
  });

  it("標準形式（football-data から作ったもの）", () => {
    const { rows } = read(
      "external_key,title,all_day,start,end,status,location,description\n" +
        "football-data:match:497181,アーセナル vs リヴァプール,false,2026-09-19T14:00:00Z,2026-09-19T16:00:00Z,confirmed,Emirates Stadium,プレミアリーグ 第5節\n" +
        "football-data:match:497205,シティ vs チェルシー,true,2026-10-03,2026-10-03,tentative,,第7節（時刻未定）\n",
    );
    expect(rows[0]).toMatchObject({
      externalKey: "football-data:match:497181",
      title: "アーセナル vs リヴァプール",
      allDay: false,
      startsAt: "2026-09-19T14:00:00.000Z",
      endsAt: "2026-09-19T16:00:00.000Z",
      status: "confirmed",
      assignees: ["m1"],
      problem: null,
    });
    expect(rows[1]).toMatchObject({
      allDay: true,
      startDate: "2026-10-03",
      status: "tentative",
      problem: null,
    });
  });

  it("読めない日付の行は、理由を付けて外す（FR-I16）", () => {
    const { rows } = read("タイトル,開始\n謎,来週\n");
    expect(rows[0].problem).toContain("開始が読めません");
  });

  it("終わりが始まりより前の行も外す", () => {
    const { rows } = read(
      "タイトル,開始,終了\n逆,2026-10-03 15:00,2026-10-03 14:00\n",
    );
    expect(rows[0].problem).toBe("終了が開始より後になっていません");
  });

  it("必須の列が無ければ、行は読まずに何が足りないかを返す", () => {
    const result = read("名前,場所\n父,家\n");
    expect(result.rows).toHaveLength(0);
    expect(result.missing).toEqual(["タイトル", "開始（日付）"]);
    expect(result.format).toBe("unknown");
    expect(result.header).toEqual(["名前", "場所"]);
  });

  it("余分な列は無視する", () => {
    const { rows } = read("タイトル,開始,得点,備考\n試合,2026-10-03,2-1,雨\n");
    expect(rows[0].problem).toBeNull();
    expect(rows[0].description).toBe("雨");
  });
});

describe("重複の見分け方", () => {
  it("external_key があればそれで見る", () => {
    expect(duplicateKey({ externalKey: "a", title: "x" })).toBe("key:a");
    expect(duplicateKey({ external_key: "a", title: "y" })).toBe("key:a");
  });

  it("無ければ、タイトルと開始で見る", () => {
    const fromCsv = duplicateKey({
      externalKey: null,
      title: "運動会",
      startDate: "2026-10-10",
    });
    const fromDb = duplicateKey({
      external_key: null,
      title: "運動会",
      start_date: "2026-10-10",
    });
    expect(fromCsv).toBe(fromDb);
  });

  it("同じ日でもタイトルが違えば別のもの", () => {
    expect(duplicateKey({ title: "A", startDate: "2026-10-10" })).not.toBe(
      duplicateKey({ title: "B", startDate: "2026-10-10" }),
    );
  });
});

describe("列の見分けと、手で指定する場合", () => {
  it("標準形式は自動で見分ける", () => {
    const { format, mapping } = detectMapping([
      "external_key",
      "title",
      "start",
      "end",
    ]);
    expect(format).toBe("standard");
    expect(mapping.title).toBe(1);
    expect(mapping.order).toBe("ymd");
  });

  it("日本語の見出しも標準形式として見分ける", () => {
    expect(detectMapping(["タイトル", "開始", "担当者"]).format).toBe(
      "standard",
    );
  });

  it("Google カレンダーの書き出しを見分ける（FR-I03）", () => {
    const { format, mapping } = detectMapping([
      "Subject",
      "Start Date",
      "Start Time",
      "End Date",
      "End Time",
      "All Day Event",
      "Description",
      "Location",
    ]);
    expect(format).toBe("google");
    // 日付が「月/日/年」の並びになる
    expect(mapping.order).toBe("mdy");
    expect(mapping.startTime).toBe(2);
  });

  it("Google の書き出しを実際に読む（月/日/年 と 4:00 PM）", () => {
    const { rows } = read(
      "Subject,Start Date,Start Time,End Date,End Time,All Day Event,Location\n" +
        "参観日,09/19/2026,1:30 PM,09/19/2026,3:00 PM,False,小学校\n" +
        "運動会,10/10/2026,,10/10/2026,,True,校庭\n",
    );
    expect(rows[0]).toMatchObject({
      title: "参観日",
      allDay: false,
      startsAt: toIso("2026-09-19", "13:30"),
      endsAt: toIso("2026-09-19", "15:00"),
      location: "小学校",
      problem: null,
    });
    expect(rows[1]).toMatchObject({
      allDay: true,
      startDate: "2026-10-10",
      endDate: "2026-10-10",
      problem: null,
    });
  });

  it("見出しで分からないときは、列を指定すれば読める（FR-I02）", () => {
    const text = "名前,いつから,どこで\n塾,2026-10-03 17:00,駅前\n";
    const auto = read(text);
    expect(auto.format).toBe("unknown");
    expect(auto.rows).toHaveLength(0);

    const mapping = { ...emptyMapping(), title: 0, start: 1, location: 2 };
    const manual = readCsv(text, {
      members: MEMBERS,
      defaultAssignees: ["m1"],
      mapping,
    });
    expect(manual.rows[0]).toMatchObject({
      title: "塾",
      startsAt: toIso("2026-10-03", "17:00"),
      location: "駅前",
      problem: null,
    });
  });
});

describe("文字コードを決める", () => {
  const bytes = (...values: number[]) => new Uint8Array(values).buffer;

  it("UTF-8 はそのまま読む", () => {
    const utf8 = new TextEncoder().encode("タイトル,開始").buffer;
    expect(decodeFile(utf8)).toMatchObject({
      text: "タイトル,開始",
      used: "utf-8",
    });
  });

  it("UTF-8 として筋が通らなければ Shift_JIS として読む", () => {
    // 「休み」の Shift_JIS
    const sjis = bytes(0x8b, 0x78, 0x82, 0xdd);
    const result = decodeFile(sjis);
    expect(result.used).toBe("shift_jis");
    expect(result.text).toBe("休み");
  });

  it("文字コードを手で指定できる", () => {
    const sjis = bytes(0x8b, 0x78, 0x82, 0xdd);
    expect(decodeFile(sjis, "shift_jis").text).toBe("休み");
    // UTF-8 と言い切れば、読めない文字は置き換わる
    expect(decodeFile(sjis, "utf-8").text).not.toBe("休み");
  });
});
