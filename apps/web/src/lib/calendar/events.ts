import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CalendarEvent } from "@/lib/supabase/types";
import type { EventWithAssignees } from "./model";
import { expandSeries } from "./series";

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
  //
  // 繰り返しの予定は、始まりが期間よりずっと前でも、期間内に回が来る。
  // 終わりはルールの文字列の中にあって SQL では読めないので、
  // 「期間の終わりより前に始まったもの」を全部取り、展開で絞る。
  // 家族で使う数（多くて数十件）ならこれで足りる。
  const { data, error } = await supabase
    .from("events")
    .select("*, event_assignees(member_id), event_exceptions(occurrence_date)")
    .or(
      `and(rrule.is.null,all_day.eq.true,end_date.gte.${fromDate},start_date.lt.${toDate}),` +
        `and(rrule.is.null,all_day.eq.false,ends_at.gte.${fromDate},starts_at.lt.${toDate}),` +
        `and(rrule.not.is.null,all_day.eq.true,start_date.lt.${toDate}),` +
        `and(rrule.not.is.null,all_day.eq.false,starts_at.lt.${toDate})`,
    )
    .order("starts_at", { nullsFirst: true });

  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((row) => {
    const { event_assignees, event_exceptions, ...event } =
      row as CalendarEvent & {
        event_assignees: { member_id: string }[] | null;
        event_exceptions: { occurrence_date: string }[] | null;
      };
    const withAssignees = {
      ...event,
      assignees: (event_assignees ?? []).map((a) => a.member_id),
    };

    if (!event.rrule) return [withAssignees];

    return expandSeries(
      withAssignees,
      (event_exceptions ?? []).map((x) => x.occurrence_date),
      fromDate,
      toDate,
    );
  });
}
