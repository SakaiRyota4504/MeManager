import type { CalendarEvent, Member } from "@/lib/supabase/types";
import { allDayKeys, eventDateKey } from "./date";

export type EventWithAssignees = CalendarEvent & { assignees: string[] };

/** 日付ごとに予定をまとめる。複数日にまたがる終日予定は各日に出す。 */
export function groupByDate(
  events: EventWithAssignees[],
): Map<string, EventWithAssignees[]> {
  const map = new Map<string, EventWithAssignees[]>();

  const push = (key: string, event: EventWithAssignees) => {
    const list = map.get(key);
    if (list) list.push(event);
    else map.set(key, [event]);
  };

  for (const event of events) {
    if (event.all_day && event.start_date && event.end_date) {
      for (const key of allDayKeys(event.start_date, event.end_date)) {
        push(key, event);
      }
    } else if (event.starts_at) {
      push(eventDateKey(event.starts_at, event.timezone), event);
    }
  }

  // 終日を先に、そのあと開始時刻の順
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return (a.starts_at ?? "").localeCompare(b.starts_at ?? "");
    });
  }
  return map;
}

/** 予定の表示色。指定がなければ担当者、いなければカレンダーの色を使う */
export function eventColor(
  event: EventWithAssignees,
  members: Member[],
  calendarColor: string,
): string {
  if (event.color) return event.color;
  const first = members.find((m) => event.assignees.includes(m.id));
  return first?.color ?? calendarColor;
}
