"use client";

import { useActionState, useEffect, useState } from "react";

import type { Member } from "@/lib/supabase/types";
import type { EventWithAssignees } from "@/lib/calendar/model";
import { eventDateKey, formatTime } from "@/lib/calendar/date";
import { Field, FormError, SubmitButton } from "@/components/form";
import { fromRRule, type Recurrence } from "@/lib/recurrence/rule";
import { RecurrenceField } from "./recurrence-field";
import { createEvent, updateEvent, type EventFormState } from "./actions";

/** 繰り返し予定を直すとき、どこまでを変えるか（FR-R07） */
type Scope = "one" | "following" | "all";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "one", label: "この回のみ" },
  { id: "following", label: "これ以降" },
  { id: "all", label: "すべて" },
];

type Initial =
  | { mode: "create"; date: string; startTime?: string; endTime?: string }
  | { mode: "edit"; event: EventWithAssignees };

export function EventPanel({
  members,
  defaultCalendarId,
  selfMemberId,
  initial,
  onClose,
  onSaved,
}: {
  members: Member[];
  defaultCalendarId: string;
  selfMemberId: string;
  initial: Initial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = initial.mode === "edit" ? initial.event : null;

  const [state, formAction] = useActionState<EventFormState, FormData>(
    editing ? updateEvent : createEvent,
    null,
  );

  const [allDay, setAllDay] = useState(editing?.all_day ?? false);
  const [recurrence, setRecurrence] = useState<Recurrence | null>(() =>
    fromRRule(editing?.rrule),
  );

  // 繰り返しの1回ぶんを開いたときだけ、範囲を聞く。
  // 既定は「この回のみ」。いちばん影響が小さく、押し間違えても被害が少ない。
  const occurrence = editing?.occurrence ?? null;
  const isSeries = Boolean(editing?.rrule && occurrence);
  const [scope, setScope] = useState<Scope>("one");

  // 開始・終了は常に出す。既定は「押した日」で、時刻は 9:00〜10:00。
  const touched = initial.mode === "create" ? initial.date : "";
  const [startDate, setStartDate] = useState(
    editing
      ? editing.all_day
        ? (editing.start_date ?? "")
        : eventDateKey(editing.starts_at!, editing.timezone)
      : touched,
  );
  const [endDate, setEndDate] = useState(
    editing
      ? editing.all_day
        ? (editing.end_date ?? editing.start_date ?? "")
        : eventDateKey(editing.ends_at!, editing.timezone)
      : touched,
  );
  // 週表示でなぞって作ったときは、その時刻から始める。
  const [startTime, setStartTime] = useState(
    editing && !editing.all_day
      ? formatTime(editing.starts_at!, editing.timezone)
      : initial.mode === "create" && initial.startTime
        ? initial.startTime
        : "09:00",
  );
  const [endTime, setEndTime] = useState(
    editing && !editing.all_day
      ? formatTime(editing.ends_at!, editing.timezone)
      : initial.mode === "create" && initial.endTime
        ? initial.endTime
        : "10:00",
  );

  // 開始日を動かしたとき、終了日が同じ日か前の日なら一緒に動かす。
  // 「終了が開始より前」で保存に失敗するのを、入力の側で防ぐ。
  const changeStartDate = (value: string) => {
    if (endDate === startDate || endDate < value) setEndDate(value);
    setStartDate(value);
  };
  // 担当者の初期値は作成者自身（FR-M04）。そのままでよければ操作は要らない。
  const [picked, setPicked] = useState<string[]>(
    editing ? editing.assignees : [selfMemberId],
  );

  useEffect(() => {
    if (state && "ok" in state) onSaved();
  }, [state, onSaved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <>
      <button
        className="fixed inset-0 z-30 bg-zinc-900/35"
        aria-label="閉じる"
        onClick={onClose}
      />
      <section
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-border bg-background shadow-xl"
        aria-label={editing ? "予定を編集" : "予定を追加"}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold">
            {editing ? "予定を編集" : "予定を追加"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="px-2 text-xl leading-none text-muted"
          >
            ×
          </button>
        </div>

        <form
          action={formAction}
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.currentTarget.requestSubmit();
            }
          }}
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <FormError
              message={state && "error" in state ? state.error : undefined}
            />
            {editing && (
              <input type="hidden" name="event_id" value={editing.id} />
            )}

            <Field
              label="タイトル"
              name="title"
              required
              defaultValue={editing?.title ?? ""}
              placeholder="ピアノ教室"
            />

            <div className="space-y-2">
              <span className="text-sm font-medium">
                担当者 <span className="text-xs text-red-600">必須</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const on = picked.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(m.id)}
                      style={on ? { backgroundColor: m.color } : undefined}
                      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border-strong py-1 pr-3 pl-2 text-sm ${
                        on ? "border-transparent text-white" : ""
                      }`}
                    >
                      <span
                        aria-hidden
                        className="inline-block size-2.5 rounded-full"
                        style={{ backgroundColor: on ? "#fff" : m.color }}
                      />
                      {m.display_name}
                    </button>
                  );
                })}
              </div>
              {picked.map((id) => (
                <input key={id} type="hidden" name="assignees" value={id} />
              ))}
              {picked.length === 0 ? (
                <p className="text-xs text-red-600">
                  担当者を1人以上選んでください。選ばないと保存できません。
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setPicked(members.map((m) => m.id))}
                  className="rounded-md border border-border-strong px-3 py-1 text-xs"
                >
                  全員
                </button>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id="all-day"
                name="all_day"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="size-4 accent-accent"
              />
              終日（時刻を決めない）
            </label>

            <div className="space-y-3">
              <DateTimeRow
                label="開始"
                dateName="start_date"
                timeName="start_time"
                date={startDate}
                time={startTime}
                onDateChange={changeStartDate}
                onTimeChange={setStartTime}
                allDay={allDay}
              />
              <DateTimeRow
                label="終了"
                dateName="end_date"
                timeName="end_time"
                date={endDate}
                time={endTime}
                onDateChange={setEndDate}
                onTimeChange={setEndTime}
                allDay={allDay}
              />
            </div>

            <Field
              label="場所"
              name="location"
              defaultValue={editing?.location ?? ""}
              placeholder="市民センター"
            />

            {/* カレンダーは「家族共有」1つだけを使う。選ばせない */}
            <input
              type="hidden"
              name="calendar_id"
              value={editing?.calendar_id ?? defaultCalendarId}
            />

            {isSeries && (
              <div className="space-y-1.5 rounded-md border border-accent/40 bg-accent/5 p-3">
                <span className="text-sm font-medium">変更する範囲</span>
                <div className="flex gap-1.5">
                  {SCOPES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={scope === s.id}
                      onClick={() => setScope(s.id)}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${
                        scope === s.id
                          ? "border-transparent bg-accent text-accent-fg"
                          : "border-border-strong"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted">
                  {scope === "one"
                    ? "この日の分だけ変えます。他の回はそのままです。"
                    : scope === "following"
                      ? "この日から先を変えます。前の回はそのままです。"
                      : "すべての回を変えます。"}
                </p>
                <input type="hidden" name="scope" value={scope} />
                <input
                  type="hidden"
                  name="occurrence"
                  value={occurrence ?? ""}
                />
              </div>
            )}

            {/* この回だけ直すときは、1回きりの予定になるので繰り返しは聞かない */}
            {!(isSeries && scope === "one") && (
              <RecurrenceField
                value={recurrence}
                startDate={startDate}
                onChange={setRecurrence}
              />
            )}

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">状態</span>
              <select
                name="status"
                defaultValue={editing?.status ?? "confirmed"}
                className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm"
              >
                <option value="confirmed">確定</option>
                <option value="tentative">仮（日時が未確定）</option>
                <option value="cancelled">中止</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">メモ</span>
              <textarea
                name="description"
                defaultValue={editing?.description ?? ""}
                placeholder="持ち物、連絡事項など"
                className="min-h-16 w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="flex gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border border-border-strong px-4 py-2 text-sm"
            >
              やめる
            </button>
            <div className="flex-1">
              <SubmitButton pendingText="保存中…">保存</SubmitButton>
            </div>
          </div>
        </form>
      </section>
    </>
  );
}

/**
 * 「日付＋時刻」の1行。開始と終了で同じ形にする。
 *
 * 終日でも日付の欄は出したまま、時刻だけを止める。
 * 切り替えるたびに欄が入れ替わると、どこを触っていたか分からなくなるため。
 */
function DateTimeRow({
  label,
  dateName,
  timeName,
  date,
  time,
  onDateChange,
  onTimeChange,
  allDay,
}: {
  label: string;
  dateName: string;
  timeName: string;
  date: string;
  time: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  allDay: boolean;
}) {
  const box =
    "min-w-0 rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        <input
          type="date"
          name={dateName}
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          required
          aria-label={`${label}の日付`}
          className={`flex-1 ${box}`}
        />
        <input
          type="time"
          name={timeName}
          value={time}
          onChange={(e) => onTimeChange(e.target.value)}
          disabled={allDay}
          aria-label={`${label}の時刻`}
          className={`w-28 shrink-0 ${box} disabled:opacity-40`}
        />
      </div>
    </div>
  );
}
