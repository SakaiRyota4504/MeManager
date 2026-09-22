import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fetchHabits } from "@/lib/habit/queries";
import { HabitList } from "./habit-list";

export const dynamic = "force-dynamic";

/** 習慣の登録。毎日開くのは「今日」のほうなので、こちらは設定に置く */
export default async function HabitSettingsPage() {
  const session = await requireSession();

  const supabase = await createClient();
  const [habits, { data: members }] = await Promise.all([
    fetchHabits(),
    supabase
      .from("members")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto px-5 py-7">
      <div className="space-y-1">
        <h1 className="text-base font-semibold">習慣</h1>
        {/* 日本語は改行がそのまま空白になるので、1つの文字列にまとめて渡す */}
        <p className="text-sm text-muted">
          {
            "続けたいことを登録します。1人あたり1〜5個がちょうどよく、10個を超えると続きません。"
          }
        </p>
      </div>

      <HabitList
        habits={habits}
        members={members ?? []}
        selfMemberId={session.member.id}
      />
    </div>
  );
}
