import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Habit, HabitLog } from "@/lib/supabase/types";
import { shiftDays } from "@/lib/calendar/date";

/** 習慣。RLS により「自分だけ」の他人のぶんは返らない */
export async function fetchHabits(): Promise<Habit[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("habits")
    .select("*")
    .order("is_active", { ascending: false })
    .order("created_at");
  return data ?? [];
}

/**
 * 記録。期間を切って引く。
 *
 * 連続日数を数えるには過去にさかのぼる必要があるが、全部は引かない。
 * 既定の120日で、毎日の習慣なら4か月ぶんの連続まで数えられる。
 */
export async function fetchHabitLogs(
  date: string,
  days = 120,
): Promise<HabitLog[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("habit_logs")
    .select("*")
    .gte("done_on", shiftDays(date, -(days - 1)))
    .lte("done_on", date);
  return data ?? [];
}
