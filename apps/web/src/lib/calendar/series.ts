/**
 * 繰り返し予定を、1回ぶんずつの予定に開く。
 *
 * 「いつ起きるか」は src/lib/recurrence/ が決める。ここはその日付を受けて、
 * 予定の形（終日か時刻付きか、長さはどれだけか）に当てはめるだけ。
 * 日付の計算と予定の都合を混ぜないためにファイルを分けている。
 */

import {
  daysBetween,
  eventDateKey,
  formatTime,
  shiftDays,
  toIso,
} from "./date";
import type { EventWithAssignees } from "./model";
import { expand } from "@/lib/recurrence/expand";

/** 繰り返しの元になる予定が、何日から始まるか */
export function seriesStart(event: EventWithAssignees): string {
  return event.all_day
    ? (event.start_date ?? "")
    : eventDateKey(event.starts_at as string, event.timezone);
}

/**
 * 期間内の回を並べる。
 *
 * @param skips 出さない回（「今週は休み」）の日付
 * @param to    期間の終わり。**含まない**
 */
export function expandSeries(
  event: EventWithAssignees,
  skips: string[],
  from: string,
  to: string,
): EventWithAssignees[] {
  if (!event.rrule) return [event];

  const start = seriesStart(event);
  if (!start) return [event];

  const skipped = new Set(skips);

  return expand(event.rrule, start, from, to)
    .filter((date) => !skipped.has(date))
    .map((date) => occurrenceOn(event, start, date));
}

/** 元の予定を、その日にずらした1回ぶんにする */
function occurrenceOn(
  event: EventWithAssignees,
  start: string,
  date: string,
): EventWithAssignees {
  if (event.all_day) {
    // 何日にまたがるかは変えずに、丸ごとずらす
    const length = daysBetween(
      event.start_date ?? start,
      event.end_date ?? event.start_date ?? start,
    );
    return {
      ...event,
      occurrence: date,
      start_date: date,
      end_date: shiftDays(date, length),
    };
  }

  // 時刻はそのまま。長さも変えない。
  // 日数ではなくミリ秒で足すのは、日をまたぐ予定を崩さないため。
  const time = formatTime(event.starts_at as string, event.timezone);
  const duration =
    Date.parse(event.ends_at as string) - Date.parse(event.starts_at as string);
  const startsAt = toIso(date, time);

  return {
    ...event,
    occurrence: date,
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + duration).toISOString(),
  };
}
