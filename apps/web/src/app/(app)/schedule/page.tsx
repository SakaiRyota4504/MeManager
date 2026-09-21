import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fetchEvents } from "@/lib/calendar/events";
import { isView, rangeFor, todayKey } from "@/lib/calendar/date";
import {
  HIDE_CANCELLED_KEY,
  parseSelected,
  SCHEDULE_FILTER_KEY,
} from "@/lib/calendar/filter";
import { CalendarView } from "./calendar-view";

export const dynamic = "force-dynamic";

export default async function SchedulePage(props: PageProps<"/schedule">) {
  const session = await requireSession();
  const params = await props.searchParams;

  // 見せ方と、どこを見ているか。どちらも URL に持たせる。
  // 「この週を見て」と家族にリンクを送れるようにするため。
  const view = isView(params.view) ? params.view : "month";
  const date =
    typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : todayKey();

  const weekStart = session.family.week_start ?? 0;
  const { fromDate, toDate } = rangeFor(view, date, weekStart);

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

  // 中止した予定を隠すか。URL に指定があればそちらを優先する
  const hideCancelled =
    typeof params.c === "string"
      ? params.c === "0"
      : saved?.prefs?.[HIDE_CANCELLED_KEY] === true;

  return (
    <CalendarView
      view={view}
      date={date}
      weekStart={weekStart}
      members={members ?? []}
      calendars={calendars}
      events={events}
      selfMemberId={session.member.id}
      selected={selected}
      hideCancelled={hideCancelled}
    />
  );
}
