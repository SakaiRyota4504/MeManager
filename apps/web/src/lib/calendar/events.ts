import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CalendarEvent } from "@/lib/supabase/types";
import type { EventWithAssignees } from "./model";

/**
 * 期間内の予定を取る。
 *
 * family_id の条件は書かない。RLS が行を絞るので、
 * 書き忘れても他の家族の予定は返らない。
 */
export async function fetchEvents(
  fromDate: string,
  toDate: string,
): Promise<EventWithAssignees[]> {
  const supabase = await createClient();

  // 終日は date、時刻付きは timestamptz と列が違うので、条件も分ける。
  const { data, error } = await supabase
    .from("events")
    .select("*, event_assignees(member_id)")
    .or(
      `and(all_day.eq.true,end_date.gte.${fromDate},start_date.lt.${toDate}),` +
        `and(all_day.eq.false,ends_at.gte.${fromDate},starts_at.lt.${toDate})`,
    )
    .order("starts_at", { nullsFirst: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const { event_assignees, ...event } = row as CalendarEvent & {
      event_assignees: { member_id: string }[] | null;
    };
    return {
      ...event,
      assignees: (event_assignees ?? []).map((a) => a.member_id),
    };
  });
}
