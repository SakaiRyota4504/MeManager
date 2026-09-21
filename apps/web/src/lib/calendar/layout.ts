/**
 * 週表示・日表示で、時刻付きの予定を置く場所を決める。
 *
 * 画面の都合（px）はここに持ち込まない。
 * 「1日の高さを 1 としたときの、上からの位置と高さ」だけを返す。
 */

import { toIso } from "./date";
import type { EventWithAssignees } from "./model";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 短い予定でも、これだけの高さは取る（15分） */
const MIN_MS = 15 * 60 * 1000;

export type TimedBox = {
  event: EventWithAssignees;
  /** 0〜1。1日の高さに対する位置 */
  top: number;
  height: number;
  /** 横に何本並ぶか（重なっている数）と、そのうちの何本目か */
  lane: number;
  lanes: number;
  /** 前の日から続いている／次の日へ続く */
  fromBefore: boolean;
  toAfter: boolean;
};

/**
 * その日に置く時刻付きの予定を並べる。
 *
 * 重なっている予定は横に並べる。「A と B が重なり、B と C が重なるが
 * A と C は重ならない」場合、3つを同じかたまりとして扱い、
 * A と C は同じ列に入れる（縦に並んで見える）。
 */
export function layoutDay(
  events: EventWithAssignees[],
  dayKey: string,
): TimedBox[] {
  const dayStart = Date.parse(toIso(dayKey, "00:00"));
  const dayEnd = dayStart + DAY_MS;

  const items = events
    .filter((e) => !e.all_day && e.starts_at && e.ends_at)
    .map((e) => ({
      event: e,
      rawStart: Date.parse(e.starts_at as string),
      rawEnd: Date.parse(e.ends_at as string),
    }))
    // その日にかかるものだけ。**短い予定の下限を足す前に絞る。**
    // 先に下限を足すと、前日の予定が「その日の 0:00〜0:15」に化けて出る。
    .filter((x) => x.rawEnd > dayStart && x.rawStart < dayEnd)
    .map((x) => {
      const start = Math.max(x.rawStart, dayStart);
      const end = Math.max(Math.min(x.rawEnd, dayEnd), start + MIN_MS);
      return {
        event: x.event,
        start,
        end,
        fromBefore: x.rawStart < dayStart,
        toAfter: x.rawEnd > dayEnd,
      };
    })
    // 早い順。同時刻なら長いほうを左に（短い予定が裏に隠れにくい）
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const boxes: TimedBox[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[lane] = item.end;
      }
      return { item, lane };
    });

    for (const { item, lane } of assigned) {
      boxes.push({
        event: item.event,
        top: (item.start - dayStart) / DAY_MS,
        height: (item.end - item.start) / DAY_MS,
        lane,
        lanes: laneEnds.length,
        fromBefore: item.fromBefore,
        toAfter: item.toAfter,
      });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of items) {
    if (cluster.length > 0 && item.start >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();

  return boxes;
}

/** 分を "HH:MM" にする。24時をまたいだら 23:59 で止める */
export function toTimeString(minutes: number): string {
  const m = Math.max(0, Math.min(Math.round(minutes), 24 * 60 - 1));
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 刻みにそろえる（既定は15分） */
export function snapMinutes(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step;
}
