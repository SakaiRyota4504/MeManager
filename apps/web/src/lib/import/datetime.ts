/**
 * CSV に書かれた日時を読む。
 *
 * 書式は docs/04-csv-format.md 2.3 に合わせる。
 * 時間帯の指定が無いものは **日本時間として読む**。
 * 読めないものは null を返し、呼び出し側が「警告」として弾く（FR-I16）。
 */

import { APP_TIME_ZONE, toIso } from "@/lib/calendar/date";

export type Moment =
  /** 日付だけ。終日の予定に使う */
  | { kind: "date"; date: string }
  /** 時刻まである。ISO（UTC）で持つ */
  | { kind: "time"; iso: string };

const DATE_ONLY = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const DATE_TIME =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function pad(value: string | number, size = 2): string {
  return String(value).padStart(size, "0");
}

export function parseMoment(raw: string): Moment | null {
  const value = raw.trim();
  if (value === "") return null;

  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = `${y}-${pad(m)}-${pad(d)}`;
    return isRealDate(date) ? { kind: "date", date } : null;
  }

  // 時間帯の指定が無い書き方。手で書くときのために残してある
  const dateTime = DATE_TIME.exec(value);
  if (dateTime) {
    const [, y, m, d, h, min] = dateTime;
    const date = `${y}-${pad(m)}-${pad(d)}`;
    if (!isRealDate(date)) return null;
    if (Number(h) > 23 || Number(min) > 59) return null;
    return { kind: "time", iso: toIso(date, `${pad(h)}:${min}`) };
  }

  // Z 付き / +09:00 付き。ここは Date に任せる
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(
      value,
    )
  ) {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) return null;
    return { kind: "time", iso: new Date(ms).toISOString() };
  }

  return null;
}

/** 2026-02-30 のような、形は合っているが存在しない日付を弾く */
function isRealDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/** 終日でない予定で、終了が省略されたときの既定（開始の1時間後） */
export function defaultEnd(startIso: string): string {
  return new Date(Date.parse(startIso) + 60 * 60 * 1000).toISOString();
}

export { APP_TIME_ZONE };
