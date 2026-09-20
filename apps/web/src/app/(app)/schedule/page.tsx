import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fetchEvents } from "@/lib/calendar/events";
import { monthRange, toMonthKey } from "@/lib/calendar/date";
import { parseSelected, SCHEDULE_FILTER_KEY } from "@/lib/calendar/filter";
import { CalendarView } from "./calendar-view";

export const dynamic = "force-dynamic";

export default async function SchedulePage(props: PageProps<"/schedule">) {
  const session = await requireSession();
  const params = await props.searchParams;

  const month =
    typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month)
      ? params.month
      : toMonthKey(new Date());

  const weekStart = session.family.week_start ?? 0;
  const { fromDate, toDate } = monthRange(month, weekStart);

  const supabase = await createClient();
  const [{ data: members }, { data: calendars }, { data: saved }, events] =
    await Promise.all([
      supabase
        .from("members")
        .select("*")
        .eq("is_active", true)
        .order("created_at"),
      supabase
        .from("calendars")
        .select("*")
        .order("is_default", { ascending: false }),
      // RLS により、返るのは自分の行だけ。
      supabase.from("user_preferences").select("prefs").maybeSingle(),
      fetchEvents(fromDate, toDate),
    ]);

  // 既定のカレンダーが無い状態は、家族の作成時に必ず作るので起きない。
  // 念のため何も無ければメンバー画面へ戻す。
  if (!calendars || calendars.length === 0) redirect("/settings/members");

  // URL が指定していればそれを使い、無ければ前回の状態を引き継ぐ。
  // URL を優先するのは、家族に送ったリンクが送った人の設定で変わらないようにするため。
  const memberIds = (members ?? []).map((m) => m.id);
  const fromUrl = parseSelected(
    typeof params.m === "string" ? params.m : null,
    memberIds,
  );
  const fromSaved = parseSelected(
    typeof saved?.prefs?.[SCHEDULE_FILTER_KEY] === "string"
      ? (saved.prefs[SCHEDULE_FILTER_KEY] as string)
      : null,
    memberIds,
  );
  const selected = fromUrl !== undefined ? fromUrl : (fromSaved ?? null);

  return (
    <CalendarView
      month={month}
      weekStart={weekStart}
      members={members ?? []}
      calendars={calendars}
      events={events}
      selfMemberId={session.member.id}
      selected={selected}
    />
  );
}
