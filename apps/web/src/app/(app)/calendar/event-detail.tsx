"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

import type { Calendar, Member } from "@/lib/supabase/types";
import type { EventWithAssignees } from "@/lib/calendar/model";
import { formatTime } from "@/lib/calendar/date";
import { deleteEvent, type EventFormState } from "./actions";

const STATUS_LABEL = {
  confirmed: "確定",
  tentative: "仮",
  cancelled: "中止",
} as const;

export function EventDetail({
  event,
  members,
  calendars,
  onClose,
  onEdit,
}: {
  event: EventWithAssignees;
  members: Member[];
  calendars: Calendar[];
  onClose: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<EventFormState, FormData>(
    deleteEvent,
    null,
  );

  useEffect(() => {
    if (state && "ok" in state) {
      onClose();
      router.refresh();
    }
  }, [state, onClose, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const assignees = members.filter((m) => event.assignees.includes(m.id));
  const calendar = calendars.find((c) => c.id === event.calendar_id);

  const when = event.all_day
    ? event.start_date === event.end_date
      ? `${event.start_date} 終日`
      : `${event.start_date} 〜 ${event.end_date} 終日`
    : `${formatTime(event.starts_at!, event.timezone)} 〜 ${formatTime(
        event.ends_at!,
        event.timezone,
      )}`;

  return (
    <>
      <button
        className="fixed inset-0 z-30 bg-zinc-900/35"
        aria-label="閉じる"
        onClick={onClose}
      />
      <section
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-border bg-background shadow-xl"
        aria-label="予定の詳細"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2
            className={`flex-1 text-sm font-semibold ${
              event.status === "cancelled" ? "line-through" : ""
            }`}
          >
            {event.title}
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

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">日時</dt>
            <dd>{when}</dd>

            <dt className="text-muted">担当者</dt>
            <dd className="flex flex-wrap gap-x-3 gap-y-1">
              {assignees.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: m.color }}
                  />
                  {m.display_name}
                </span>
              ))}
            </dd>

            <dt className="text-muted">カレンダー</dt>
            <dd>{calendar?.name ?? "—"}</dd>

            <dt className="text-muted">状態</dt>
            <dd>{STATUS_LABEL[event.status]}</dd>

            {event.location && (
              <>
                <dt className="text-muted">場所</dt>
                <dd>{event.location}</dd>
              </>
            )}
            {event.description && (
              <>
                <dt className="text-muted">メモ</dt>
                <dd className="whitespace-pre-wrap">{event.description}</dd>
              </>
            )}
          </dl>

          {state && "error" in state && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {state.error}
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-border px-4 py-3">
          <form action={formAction} className="flex-1">
            <input type="hidden" name="event_id" value={event.id} />
            <DeleteButton />
          </form>
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
          >
            編集
          </button>
        </div>
      </section>
    </>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md border border-border-strong px-4 py-2 text-sm text-red-600 disabled:opacity-50"
    >
      {pending ? "削除中…" : "削除"}
    </button>
  );
}
