/**
 * CSV の表を、取り込める形に読み替える。
 *
 * ここで決めるのは「この行を入れてよいか」まで。
 * 実際に入れるのは DB の関数（commit_import）の仕事。
 */

import type { EventStatus } from "@/lib/supabase/types";
import { parseCsv } from "./csv";
import { defaultEnd, parseMoment } from "./datetime";

/** 列名。英語と日本語のどちらでも書ける（docs/04-csv-format.md 2.2） */
const COLUMNS = {
  externalKey: ["external_key", "外部キー"],
  title: ["title", "タイトル", "件名", "予定"],
  allDay: ["all_day", "終日"],
  start: ["start", "開始", "開始日時", "日付"],
  end: ["end", "終了", "終了日時"],
  assignees: ["assignees", "担当者", "担当"],
  calendar: ["calendar", "カレンダー"],
  status: ["status", "状態"],
  location: ["location", "場所"],
  description: ["description", "メモ", "備考"],
  color: ["color", "色"],
} as const;

const STATUS_WORDS: Record<string, EventStatus> = {
  confirmed: "confirmed",
  tentative: "tentative",
  cancelled: "cancelled",
  canceled: "cancelled",
  確定: "confirmed",
  仮: "tentative",
  中止: "cancelled",
};

const TRUE_WORDS = ["true", "1", "yes", "y", "はい", "○", "◯"];

export type ImportRow = {
  /** ファイルの中の行番号（1始まり・ヘッダを含む） */
  line: number;
  title: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  endDate: string | null;
  assignees: string[];
  status: EventStatus;
  location: string;
  description: string;
  color: string | null;
  externalKey: string | null;
  /** 取り込めない理由。あれば取り込み対象から外す（FR-I16） */
  problem: string | null;
};

export type ReadResult = {
  rows: ImportRow[];
  /** ヘッダに無かった必須の列 */
  missing: string[];
};

export type Member = { id: string; display_name: string };

/**
 * @param defaultAssignees 画面で一括指定した担当者。
 *   CSV に担当者列があれば、そちらが優先される（docs/04-csv-format.md 2.2）
 */
export function readCsv(
  text: string,
  options: { members: Member[]; defaultAssignees: string[] },
): ReadResult {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], missing: ["タイトル", "開始"] };

  const header = table[0].map((h) => h.trim().toLowerCase());
  const index = (names: readonly string[]) =>
    header.findIndex((h) => names.some((n) => n.toLowerCase() === h));

  const at = {
    externalKey: index(COLUMNS.externalKey),
    title: index(COLUMNS.title),
    allDay: index(COLUMNS.allDay),
    start: index(COLUMNS.start),
    end: index(COLUMNS.end),
    assignees: index(COLUMNS.assignees),
    status: index(COLUMNS.status),
    location: index(COLUMNS.location),
    description: index(COLUMNS.description),
    color: index(COLUMNS.color),
  };

  const missing = [
    at.title < 0 && "タイトル（title）",
    at.start < 0 && "開始（start）",
  ].filter((v): v is string => Boolean(v));
  if (missing.length > 0) return { rows: [], missing };

  const byName = new Map(
    options.members.map((m) => [m.display_name.trim(), m.id]),
  );

  const rows = table
    .slice(1)
    .map((cells, i) =>
      readRow(cells, at, i + 2, byName, options.defaultAssignees),
    );

  return { rows, missing: [] };
}

function readRow(
  cells: string[],
  at: Record<string, number>,
  line: number,
  byName: Map<string, string>,
  defaultAssignees: string[],
): ImportRow {
  const cell = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");

  const title = cell(at.title);
  const startRaw = cell(at.start);
  const endRaw = cell(at.end);

  const row: ImportRow = {
    line,
    title,
    allDay: false,
    startsAt: null,
    endsAt: null,
    startDate: null,
    endDate: null,
    assignees: [],
    status: STATUS_WORDS[cell(at.status).toLowerCase()] ?? "confirmed",
    location: cell(at.location),
    description: cell(at.description),
    color: /^#[0-9a-fA-F]{6}$/.test(cell(at.color)) ? cell(at.color) : null,
    externalKey: cell(at.externalKey) || null,
    problem: null,
  };

  // 担当者。列があればそちらが優先。名前が見つからなければ警告にする
  const names = cell(at.assignees)
    .split(/[;；]/)
    .map((n) => n.trim())
    .filter(Boolean);

  if (names.length > 0) {
    const unknown = names.filter((n) => !byName.has(n));
    if (unknown.length > 0) {
      row.problem = `担当者が見つかりません: ${unknown.join("・")}`;
      return finish(row, title);
    }
    row.assignees = names.map((n) => byName.get(n) as string);
  } else {
    row.assignees = defaultAssignees;
  }

  if (row.assignees.length === 0) {
    row.problem = "担当者が決まっていません";
    return finish(row, title);
  }

  const start = parseMoment(startRaw);
  if (!start) {
    row.problem = startRaw
      ? `開始が読めません: ${startRaw}`
      : "開始がありません";
    return finish(row, title);
  }

  // 終日かどうかは、指定があればそれに従い、無ければ開始の書き方で決める
  const allDayCell = cell(at.allDay).toLowerCase();
  row.allDay =
    allDayCell !== "" ? TRUE_WORDS.includes(allDayCell) : start.kind === "date";

  const end = endRaw ? parseMoment(endRaw) : null;
  if (endRaw && !end) {
    row.problem = `終了が読めません: ${endRaw}`;
    return finish(row, title);
  }

  if (row.allDay) {
    row.startDate = start.kind === "date" ? start.date : start.iso.slice(0, 10);
    row.endDate =
      end === null
        ? row.startDate
        : end.kind === "date"
          ? end.date
          : end.iso.slice(0, 10);

    if (row.endDate < row.startDate) {
      row.problem = "終了日が開始日より前です";
    }
  } else {
    if (start.kind === "date") {
      row.problem = "終日ではないのに、開始に時刻がありません";
      return finish(row, title);
    }
    row.startsAt = start.iso;
    row.endsAt =
      end === null
        ? defaultEnd(start.iso)
        : end.kind === "time"
          ? end.iso
          : defaultEnd(start.iso);

    if (Date.parse(row.endsAt) <= Date.parse(row.startsAt)) {
      row.problem = "終了が開始より後になっていません";
    }
  }

  return finish(row, title);
}

function finish(row: ImportRow, title: string): ImportRow {
  if (!title) row.problem = "タイトルがありません";
  else if (title.length > 200) row.problem = "タイトルが200文字を超えています";
  return row;
}

/** 重複の判定に使う印（FR-I22）。external_key が無ければ内容で見る */
export function duplicateKey(row: {
  externalKey?: string | null;
  external_key?: string | null;
  title: string;
  startsAt?: string | null;
  starts_at?: string | null;
  startDate?: string | null;
  start_date?: string | null;
}): string {
  const key = row.externalKey ?? row.external_key;
  if (key) return `key:${key}`;
  const at = row.startsAt ?? row.starts_at ?? row.startDate ?? row.start_date;
  return `same:${row.title}\u0000${at ?? ""}`;
}
