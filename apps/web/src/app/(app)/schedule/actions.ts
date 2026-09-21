"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { toIso } from "@/lib/calendar/date";
import { SCHEDULE_FILTER_KEY } from "@/lib/calendar/filter";

export type EventFormState = { error: string } | { ok: true } | null;

function toJapaneseMessage(message: string): string {
  if (/NO_ASSIGNEE/.test(message)) return "担当者を1人以上選んでください";
  if (/INVALID_ASSIGNEE/.test(message)) {
    return "担当者に指定できない人が含まれています";
  }
  if (/INVALID_PERIOD/.test(message)) {
    return "日時の指定が正しくありません。終了は開始より後にしてください";
  }
  if (/INVALID_RRULE/.test(message)) return "繰り返しの指定が正しくありません";
  if (/CALENDAR_NOT_FOUND/.test(message))
    return "そのカレンダーには書き込めません";
  if (/EVENT_NOT_FOUND/.test(message)) return "その予定は見つかりません";
  if (/TOO_OLD/.test(message)) return "削除から30日を過ぎた予定は戻せません";
  return message;
}

/** フォームの入力を、DB関数に渡す形に整える */
function buildPayload(formData: FormData) {
  const allDay = formData.get("all_day") === "on";
  const startDate = String(formData.get("start_date") ?? "");
  const endDate = String(formData.get("end_date") ?? "") || startDate;
  const assignees = formData.getAll("assignees").map(String).filter(Boolean);

  const base: Record<string, unknown> = {
    calendar_id: String(formData.get("calendar_id") ?? ""),
    rrule: String(formData.get("rrule") ?? ""),
    title: String(formData.get("title") ?? "").trim(),
    location: String(formData.get("location") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    status: String(formData.get("status") ?? "confirmed"),
    all_day: allDay,
    assignees,
  };

  if (allDay) {
    return { ...base, start_date: startDate, end_date: endDate };
  }

  const start = String(formData.get("start_time") ?? "09:00");
  const end = String(formData.get("end_time") ?? "10:00");
  return {
    ...base,
    starts_at: toIso(startDate, start),
    ends_at: toIso(endDate, end),
  };
}

function validate(payload: Record<string, unknown>): string | null {
  if (!payload.calendar_id) return "カレンダーが特定できません";
  if (!payload.title) return "タイトルを入力してください";
  if ((payload.assignees as string[]).length === 0) {
    return "担当者を1人以上選んでください";
  }
  const start = (payload.start_date ?? payload.starts_at) as string | undefined;
  if (!start) return "開始の日付を入力してください";
  return null;
}

export async function createEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const payload = buildPayload(formData);
  const invalid = validate(payload);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_event", { payload });
  if (error) return { error: toJapaneseMessage(error.message) };

  revalidatePath("/schedule");
  return { ok: true };
}

/** 繰り返し予定を直すとき、どこまでを変えるか（FR-R07） */
function readScope(formData: FormData): {
  scope: string;
  occurrence: string | null;
} {
  const scope = String(formData.get("scope") ?? "all");
  const occurrence = String(formData.get("occurrence") ?? "");
  const valid = ["one", "following", "all"].includes(scope);

  // 回を名指しできないなら「すべて」しかない。
  // 指定を信じて片方だけ効かせると、思わぬ回が消える。
  if (!valid || !occurrence) return { scope: "all", occurrence: null };
  return { scope, occurrence };
}

export async function updateEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const eventId = String(formData.get("event_id") ?? "");
  if (!eventId) return { error: "予定が特定できません" };

  const payload = buildPayload(formData);
  const invalid = validate(payload);
  if (invalid) return { error: invalid };

  const { scope, occurrence } = readScope(formData);

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_event", {
    target_event_id: eventId,
    payload,
    scope,
    occurrence,
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  revalidatePath("/schedule");
  return { ok: true };
}

export async function deleteEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const eventId = String(formData.get("event_id") ?? "");
  if (!eventId) return { error: "予定が特定できません" };

  const { scope, occurrence } = readScope(formData);

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_event", {
    target_event_id: eventId,
    scope,
    occurrence,
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  revalidatePath("/schedule");
  return { ok: true };
}

/**
 * 絞り込みの状態を覚えておく。
 *
 * ブラウザではなくDBに置くので、別の端末で開いても同じになる。
 * 保存に失敗しても画面は動いたままでよい（次に開いたとき全員に戻るだけ）。
 */
export async function saveScheduleFilter(value: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("save_preference", {
    key: SCHEDULE_FILTER_KEY,
    value,
  });
}
