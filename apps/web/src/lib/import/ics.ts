/**
 * .ics（iCalendar）を読む（FR-I01）。
 *
 * Google カレンダー・Outlook の書き出しが対象。
 * 読むのは VEVENT の中の、予定として必要な項目だけ。
 * 招待・出欠・添付・アラームは読まない（このアプリに置き場が無い）。
 *
 * 時間帯は TZID の名前（Asia/Tokyo など）で解釈する。
 * ファイルの中の VTIMEZONE に書かれた切り替え規則は読まない。
 * 名前が IANA の形であれば、規則は端末側が持っているもので足りる。
 */

import type { EventStatus } from "@/lib/supabase/types";
import { APP_TIME_ZONE } from "@/lib/calendar/date";
import { shiftDays } from "@/lib/calendar/date";
import type { ImportRow, Member } from "./rows";
import { zonedToIso } from "./zone";

type Line = { name: string; params: Record<string, string>; value: string };

const STATUS: Record<string, EventStatus> = {
  CONFIRMED: "confirmed",
  TENTATIVE: "tentative",
  CANCELLED: "cancelled",
};

/** 折り返された行をつなぐ。続きの行は空白かタブで始まる */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

function parseLine(raw: string): Line | null {
  const colon = raw.indexOf(":");
  if (colon < 0) return null;

  const left = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  const [name, ...rest] = left.split(";");

  const params: Record<string, string> = {};
  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      params[part.slice(0, eq).toUpperCase()] = part
        .slice(eq + 1)
        .replace(/^"|"$/g, "");
    }
  }
  return { name: name.toUpperCase(), params, value };
}

/** \n \, \; \\ を元に戻す */
function unescape(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\;/g, ";")
    .replace(/\\\\/g, "\\");
}

type Stamp = { kind: "date"; date: string } | { kind: "time"; iso: string };

/** DTSTART / DTEND の値を読む */
function parseStamp(line: Line): Stamp | null {
  const value = line.value.trim();

  // 20261010（日付だけ）
  if (line.params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    return m ? { kind: "date", date: `${m[1]}-${m[2]}-${m[3]}` } : null;
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const local = `${y}-${mo}-${d}T${h}:${mi}:${s}`;

  if (z === "Z") return { kind: "time", iso: `${local}.000Z` };

  const zone = line.params.TZID || APP_TIME_ZONE;
  const iso = zonedToIso(local, zone) ?? zonedToIso(local, APP_TIME_ZONE);
  return iso ? { kind: "time", iso } : null;
}

/**
 * .ics を、CSV と同じ形の行に読み替える。
 *
 * @param defaultAssignees 画面で一括指定した担当者。
 *   .ics には担当者の概念が無いので、必ずこちらが使われる
 */
export function readIcs(
  text: string,
  options: { members: Member[]; defaultAssignees: string[] },
): ImportRow[] {
  const rows: ImportRow[] = [];
  let current: Record<string, Line> | null = null;
  let startLine = 0;

  unfold(text).forEach((raw, i) => {
    const line = parseLine(raw);
    if (!line) return;

    if (line.name === "BEGIN" && line.value.trim().toUpperCase() === "VEVENT") {
      current = {};
      startLine = i + 1;
      return;
    }
    if (line.name === "END" && line.value.trim().toUpperCase() === "VEVENT") {
      if (current)
        rows.push(toRow(current, startLine, options.defaultAssignees));
      current = null;
      return;
    }
    if (current) current[line.name] = line;
  });

  return rows;
}

function toRow(
  fields: Record<string, Line>,
  line: number,
  defaultAssignees: string[],
): ImportRow {
  const title = fields.SUMMARY ? unescape(fields.SUMMARY.value).trim() : "";
  const uid = fields.UID?.value.trim();

  const row: ImportRow = {
    line,
    title,
    allDay: false,
    startsAt: null,
    endsAt: null,
    startDate: null,
    endDate: null,
    assignees: defaultAssignees,
    status:
      STATUS[fields.STATUS?.value.trim().toUpperCase() ?? ""] ?? "confirmed",
    location: fields.LOCATION ? unescape(fields.LOCATION.value).trim() : "",
    description: fields.DESCRIPTION
      ? unescape(fields.DESCRIPTION.value).trim()
      : "",
    color: null,
    externalKey: uid ? `ics:${uid}` : null,
    rrule: fields.RRULE ? fields.RRULE.value.trim().toUpperCase() : null,
    problem: null,
  };

  if (!title) {
    row.problem = "タイトルがありません";
    return row;
  }
  if (row.assignees.length === 0) {
    row.problem = "担当者が決まっていません";
    return row;
  }

  const start = fields.DTSTART ? parseStamp(fields.DTSTART) : null;
  if (!start) {
    row.problem = "開始が読めません";
    return row;
  }
  const end = fields.DTEND ? parseStamp(fields.DTEND) : null;

  if (start.kind === "date") {
    row.allDay = true;
    row.startDate = start.date;
    // .ics の終わりは「その日を含まない」。1日戻して最終日にする
    row.endDate =
      end && end.kind === "date" ? shiftDays(end.date, -1) : start.date;
    if (row.endDate < row.startDate) row.endDate = row.startDate;
  } else {
    row.startsAt = start.iso;
    row.endsAt =
      end && end.kind === "time"
        ? end.iso
        : new Date(Date.parse(start.iso) + 60 * 60 * 1000).toISOString();
    if (Date.parse(row.endsAt) <= Date.parse(row.startsAt)) {
      row.problem = "終了が開始より後になっていません";
    }
  }

  return row;
}
