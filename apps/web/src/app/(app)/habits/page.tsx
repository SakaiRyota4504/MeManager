import Link from "next/link";

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { shiftDays, todayKey } from "@/lib/calendar/date";
import { isDateKey, formatDay } from "@/lib/budget/month";
import { fetchHabitLogs, fetchHabits } from "@/lib/habit/queries";
import { sortToday, todayList } from "@/lib/habit/model";
import { DayNote, TodayList } from "./today-list";

export const dynamic = "force-dynamic";

/**
 * 今日やること。習慣の入口。
 *
 * 毎日開くのはこの画面で、登録は最初の1回だけ。
 * そのため登録は設定の中に置いてある（docs/08-habit-requirements.md 6章）。
 */
export default async function HabitsPage(props: PageProps<"/habits">) {
  const session = await requireSession();
  const params = await props.searchParams;
  const today = todayKey();

  // 押し忘れた日にさかのぼれる。未来は見せない（3.6）
  const asked =
    typeof params.d === "string" && isDateKey(params.d) ? params.d : today;
  const date = asked > today ? today : asked;

  const supabase = await createClient();
  const [habits, logs, { data: members }] = await Promise.all([
    fetchHabits(),
    fetchHabitLogs(date),
    supabase
      .from("members")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
  ]);

  const items = sortToday(
    todayList(
      habits,
      logs,
      members ?? [],
      date,
      session.family.week_start ?? 0,
    ),
    session.member.id,
  );

  const yesterday = shiftDays(date, -1);
  const tomorrow = shiftDays(date, 1);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-base font-semibold">
          {date === today ? "今日" : formatDay(date)}
        </h1>

        <span className="ml-auto flex items-center gap-2 text-xs">
          <Link
            href={`/habits?d=${yesterday}`}
            className="rounded-md border border-border px-2 py-1 text-muted"
          >
            前の日
          </Link>
          {date < today && (
            <Link
              href={`/habits?d=${tomorrow}`}
              className="rounded-md border border-border px-2 py-1 text-muted"
            >
              次の日
            </Link>
          )}
          {date !== today && (
            <Link href="/habits" className="text-muted underline">
              今日へ
            </Link>
          )}
        </span>
      </div>

      <DayNote date={date} today={today} />

      <TodayList items={items} date={date} selfMemberId={session.member.id} />

      {habits.length === 0 && (
        <Link
          href="/settings/habits"
          className="self-start rounded-md border border-border-strong px-4 py-2 text-sm"
        >
          習慣を登録する
        </Link>
      )}
    </div>
  );
}
