/**
 * CSV の表を、取り込める形に読み替える。
 *
 * ここで決めるのは「この行を入れてよいか」まで。
 * 実際に入れるのは DB の関数（commit_import）の仕事。
 *
 * 列の意味は2段階で決める。
 *   1. 見出しから自動で見分ける（標準形式・Google カレンダーの書き出し）
 *   2. 見分けられなければ、画面で人が指定する（FR-I02）
 */

import type { EventStatus } from "@/lib/supabase/types";
import { parseCsv } from "./csv";
import { combine, defaultEnd, parseMoment, type DateOrder } from "./datetime";

/** 列名。英語・日本語・Google の書き出しのどれでも見分ける */
const COLUMNS = {
  externalKey: ["external_key", "外部キー", "uid"],
  title: ["title", "タイトル", "件名", "予定", "subject"],
  allDay: ["all_day", "終日", "all day event"],
  start: ["start", "開始", "開始日時", "日付", "start date"],
  startTime: ["start_time", "開始時刻", "start time"],
  end: ["end", "終了", "終了日時", "end date"],
  endTime: ["end_time", "終了時刻", "end time"],
  assignees: ["assignees", "担当者", "担当"],
  status: ["status", "状態"],
  location: ["location", "場所"],
  description: ["description", "メモ", "備考"],
  color: ["color", "色"],
} as const;

export type Field = keyof typeof COLUMNS;

/** 画面で並べる順と見出し */
export const FIELDS: { id: Field; label: string; required?: boolean }[] = [
  { id: "title", label: "タイトル", required: true },
  { id: "start", label: "開始（日付）", required: true },
  { id: "startTime", label: "開始（時刻）" },
  { id: "end", label: "終了（日付）" },
  { id: "endTime", label: "終了（時刻）" },
  { id: "allDay", label: "終日" },
  { id: "assignees", label: "担当者" },
  { id: "status", label: "状態" },
  { id: "location", label: "場所" },
  { id: "description", label: "メモ" },
  { id: "color", label: "色" },
  { id: "externalKey", label: "外部キー" },
];

/** どの列がどの項目か。使わない項目は -1 */
export type Mapping = Record<Field, number> & { order: DateOrder };

export type Format = "standard" | "google" | "unknown";

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
  /** 繰り返しルール。.ics にあれば引き継ぐ（FR-I05） */
  rrule: string | null;
  /** 取り込めない理由。あれば取り込み対象から外す（FR-I16） */
  problem: string | null;
};

export type ReadResult = {
  rows: ImportRow[];
  /** 見出しの並び。列の指定画面で使う */
  header: string[];
  mapping: Mapping;
  format: Format;
  /** 指定が足りない項目 */
  missing: string[];
};

export type Member = { id: string; display_name: string };

export function emptyMapping(): Mapping {
  return {
    externalKey: -1,
    title: -1,
    allDay: -1,
    start: -1,
    startTime: -1,
    end: -1,
    endTime: -1,
    assignees: -1,
    status: -1,
    location: -1,
    description: -1,
    color: -1,
    order: "ymd",
  };
}

/** 見出しから、どの列がどの項目かを見分ける（FR-I03） */
export function detectMapping(header: string[]): {
  mapping: Mapping;
  format: Format;
} {
  const lower = header.map((h) => h.trim().toLowerCase());
  const find = (names: readonly string[]) =>
    lower.findIndex((h) => names.some((n) => n.toLowerCase() === h));

  const mapping = emptyMapping();
  for (const field of Object.keys(COLUMNS) as Field[]) {
    mapping[field] = find(COLUMNS[field]);
  }

  // Google カレンダーの書き出しは、日付が「月/日/年」で時刻の列が分かれている
  const google = mapping.title >= 0 && lower.includes("start date");
  if (google) mapping.order = "mdy";

  const format: Format =
    mapping.title >= 0 && mapping.start >= 0
      ? google
        ? "google"
        : "standard"
      : "unknown";

  return { mapping, format };
}

function missingOf(mapping: Mapping): string[] {
  return FIELDS.filter((f) => f.required && mapping[f.id] < 0).map(
    (f) => f.label,
  );
}

/**
 * @param mapping 指定があればそれを使う。無ければ見出しから見分ける
 * @param defaultAssignees 画面で一括指定した担当者。
 *   CSV に担当者列があれば、そちらが優先される
 */
export function readCsv(
  text: string,
  options: {
    members: Member[];
    defaultAssignees: string[];
    mapping?: Mapping | null;
  },
): ReadResult {
  const table = parseCsv(text);
  if (table.length === 0) {
    return {
      rows: [],
      header: [],
      mapping: emptyMapping(),
      format: "unknown",
      missing: ["タイトル", "開始（日付）"],
    };
  }

  const header = table[0];
  const detected = detectMapping(header);
  const mapping = options.mapping ?? detected.mapping;
  const missing = missingOf(mapping);

  if (missing.length > 0) {
    return { rows: [], header, mapping, format: detected.format, missing };
  }

  const byName = new Map(
    options.members.map((m) => [m.display_name.trim(), m.id]),
  );

  const rows = table
    .slice(1)
    .map((cells, i) =>
      readRow(cells, mapping, i + 2, byName, options.defaultAssignees),
    );

  return { rows, header, mapping, format: detected.format, missing: [] };
}

function readRow(
  cells: string[],
  at: Mapping,
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
    rrule: null,
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

  const start = combine(startRaw, cell(at.startTime), at.order);
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

  const endTimeRaw = cell(at.endTime);
  const end =
    endRaw || endTimeRaw
      ? combine(endRaw || startDateOf(start), endTimeRaw, at.order)
      : null;
  if ((endRaw || endTimeRaw) && !end) {
    row.problem = `終了が読めません: ${endRaw || endTimeRaw}`;
    return finish(row, title);
  }

  if (row.allDay) {
    row.startDate = startDateOf(start);
    row.endDate = end === null ? row.startDate : startDateOf(end);

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

function startDateOf(moment: { kind: string; date?: string; iso?: string }) {
  return moment.kind === "date"
    ? (moment.date as string)
    : (moment.iso as string).slice(0, 10);
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

export { parseMoment };
