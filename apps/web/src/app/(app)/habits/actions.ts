"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { isDateKey } from "@/lib/budget/month";

export type HabitFormState = { error: string } | { ok: true } | null;

function toJapaneseMessage(message: string): string {
  if (/HABIT_NOT_FOUND/.test(message)) return "その習慣は見つかりません";
  if (/INVALID_HABIT/.test(message)) return "習慣の指定が正しくありません";
  if (/INVALID_MEMBER/.test(message)) return "その人は選べません";
  if (/FUTURE_DATE/.test(message)) return "これからの日はまだ押せません";
  if (/MEMBER_REQUIRED/.test(message)) return "メンバーが見つかりません";
  return message;
}

function refresh(): void {
  revalidatePath("/habits");
  revalidatePath("/settings/habits");
}

/**
 * 押す・取り消す（FR-H11）。
 *
 * 同じ関数で両方を扱う。DB 側が「あれば消す、無ければ入れる」を1往復でやる。
 * アプリ側で今の状態を見てから分岐すると、2人が同時に押したときにずれる。
 */
export async function toggleHabit(
  habitId: string,
  date?: string,
): Promise<HabitFormState> {
  if (!habitId) return { error: "習慣が特定できません" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("toggle_habit_log", {
    target_habit_id: habitId,
    target_date: date && isDateKey(date) ? date : null,
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  refresh();
  return { ok: true };
}

function habitPayload(formData: FormData): Record<string, unknown> {
  const kind = String(formData.get("kind") ?? "schedule");
  const base: Record<string, unknown> = {
    name: String(formData.get("name") ?? "").trim(),
    member_id: String(formData.get("member_id") ?? ""),
    color: String(formData.get("color") ?? ""),
    kind,
    visibility: String(formData.get("visibility") ?? "family"),
  };

  if (kind === "count") {
    return {
      ...base,
      target_count: Number(formData.get("target_count") ?? 3),
      period: String(formData.get("period") ?? "week"),
    };
  }
  return { ...base, rrule: String(formData.get("rrule") ?? "") };
}

export async function createHabit(
  _prev: HabitFormState,
  formData: FormData,
): Promise<HabitFormState> {
  const payload = habitPayload(formData);
  if (!payload.name) return { error: "名前を入れてください" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_habit", { payload });
  if (error) return { error: toJapaneseMessage(error.message) };

  refresh();
  return { ok: true };
}

export async function updateHabit(
  _prev: HabitFormState,
  formData: FormData,
): Promise<HabitFormState> {
  const id = String(formData.get("habit_id") ?? "");
  if (!id) return { error: "習慣が特定できません" };

  const payload = habitPayload(formData);
  if (formData.has("is_active")) {
    payload.is_active = formData.get("is_active") === "1";
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_habit", {
    target_habit_id: id,
    payload,
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  refresh();
  return { ok: true };
}
