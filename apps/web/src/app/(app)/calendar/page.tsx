import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fetchEvents } from "@/lib/calendar/events";
import { monthRange, toMonthKey } from "@/lib/calendar/date";
import { CalendarView } from "./calendar-view";

export const dynamic = "force-dynamic";

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const session = await requireSession();
  const params = await props.searchParams;

  const month =
    typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month)
      ? params.month
      : toMonthKey(new Date());

  const weekStart = session.family.week_start ?? 0;
  const { fromDate, toDate } = monthRange(month, weekStart);

  const supabase = await createClient();
  const [{ data: members }, { data: calendars }, events] = await Promise.all([
    supabase
      .from("members")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
    supabase
      .from("calendars")
      .select("*")
      .order("is_default", { ascending: false }),
    fetchEvents(fromDate, toDate),
  ]);

  // 既定のカレンダーが無い状態は、家族の作成時に必ず作るので起きない。
  // 念のため何も無ければメンバー画面へ戻す。
  if (!calendars || calendars.length === 0) redirect("/members");

  return (
    <CalendarView
      month={month}
      weekStart={weekStart}
      members={members ?? []}
      calendars={calendars}
      events={events}
      selfMemberId={session.member.id}
    />
  );
}
