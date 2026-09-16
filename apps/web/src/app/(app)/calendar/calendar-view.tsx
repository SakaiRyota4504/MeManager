"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { Calendar, Member } from "@/lib/supabase/types";
import type { EventWithAssignees } from "@/lib/calendar/model";
import { eventColor, groupByDate } from "@/lib/calendar/model";
import {
  WEEKDAYS,
  formatMonth,
  formatTime,
  monthGridDays,
  shiftMonth,
  toDateKey,
  toMonthKey,
  todayKey,
} from "@/lib/calendar/date";
import { EventPanel } from "./event-panel";
import { EventDetail } from "./event-detail";
import "./calendar.css";

type View = "month" | "list";

export function CalendarView({
  month,
  weekStart,
  members,
  calendars,
  events,
  selfMemberId,
}: {
  month: string;
  weekStart: number;
  members: Member[];
  calendars: Calendar[];
  events: EventWithAssignees[];
  selfMemberId: string;
}) {
  const router = useRouter();
  const today = todayKey();

  // スマートフォンの既定は一覧表示（要件 FR-V04）。
  // 狭い画面でマスに詰め込むより、時系列に並べたほうが読める。
  const [view, setView] = useState<View>(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 900px)").matches
      ? "list"
      : "month",
  );
  const [editing, setEditing] = useState<
    | { mode: "create"; date: string }
    | { mode: "edit"; event: EventWithAssignees }
    | null
  >(null);
  const [detail, setDetail] = useState<EventWithAssignees | null>(null);

  const byDate = useMemo(() => groupByDate(events), [events]);
  const days = useMemo(
    () => monthGridDays(month, weekStart),
    [month, weekStart],
  );
  const defaultCalendar = calendars.find((c) => c.is_default) ?? calendars[0];

  const go = (delta: number) => {
    router.push(`/calendar?month=${shiftMonth(month, delta)}`);
  };

  const weekdayLabels = Array.from(
    { length: 7 },
    (_, i) => WEEKDAYS[(weekStart + i) % 7],
  );

  const chipFor = (event: EventWithAssignees) => {
    const calendar = calendars.find((c) => c.id === event.calendar_id);
    return {
      color: eventColor(event, members, calendar?.color ?? "#2563eb"),
      time:
        event.all_day || !event.starts_at
          ? null
          : formatTime(event.starts_at, event.timezone),
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="前の月"
          className="cal-nav-btn grid size-8 place-items-center rounded-md border border-border-strong"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="次の月"
          className="cal-nav-btn grid size-8 place-items-center rounded-md border border-border-strong"
        >
          ›
        </button>
        <h1 className="text-lg font-bold tabular-nums">{formatMonth(month)}</h1>
        <button
          type="button"
          onClick={() =>
            router.push(`/calendar?month=${toMonthKey(new Date())}`)
          }
          className="rounded-md border border-border-strong px-3 py-1 text-sm"
        >
          今日
        </button>

        <div className="cal-seg ml-auto inline-flex overflow-hidden rounded-md border border-border-strong">
          {(["month", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 text-sm ${
                view === v ? "bg-accent text-accent-fg" : ""
              }`}
            >
              {v === "month" ? "月" : "一覧"}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setEditing({ mode: "create", date: today })}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
      >
        ＋ 予定を追加
      </button>

      {view === "month" ? (
        <div>
          <div className="cal-weekhead">
            {weekdayLabels.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="cal-grid">
            {days.map((day) => {
              const key = toDateKey(day);
              const list = byDate.get(key) ?? [];
              const limit = 3;
              const inMonth = toMonthKey(day) === month;
              return (
                <div
                  key={key}
                  className={[
                    "cal-cell",
                    inMonth ? "" : "is-out",
                    key === today ? "is-today" : "",
                    day.getDay() === 0 ? "is-sun" : "",
                    day.getDay() === 6 ? "is-sat" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="cal-daynum">{day.getDate()}</span>

                  {list.slice(0, limit).map((event) => {
                    const { color, time } = chipFor(event);
                    return (
                      <button
                        key={`${event.id}-${key}`}
                        type="button"
                        onClick={() => setDetail(event)}
                        style={{ borderLeftColor: color }}
                        className={`cal-chip ${
                          event.status === "cancelled" ? "is-cancelled" : ""
                        } ${event.status === "tentative" ? "is-tentative" : ""}`}
                      >
                        {time && <span className="cal-chip-time">{time}</span>}
                        <span className="cal-chip-title">{event.title}</span>
                      </button>
                    );
                  })}

                  {list.length > limit && (
                    <button
                      type="button"
                      className="cal-more"
                      onClick={() => setView("list")}
                    >
                      他 {list.length - limit} 件
                    </button>
                  )}

                  {/* マスの余白を押すと、その日に追加する */}
                  <button
                    type="button"
                    className="cal-add"
                    aria-label={`${day.getMonth() + 1}月${day.getDate()}日に予定を追加`}
                    onClick={() => setEditing({ mode: "create", date: key })}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EventList
          month={month}
          byDate={byDate}
          members={members}
          today={today}
          chipFor={chipFor}
          onSelect={setDetail}
        />
      )}

      {detail && (
        <EventDetail
          event={detail}
          members={members}
          calendars={calendars}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing({ mode: "edit", event: detail });
            setDetail(null);
          }}
        />
      )}

      {editing && defaultCalendar && (
        <EventPanel
          key={editing.mode === "edit" ? editing.event.id : editing.date}
          members={members}
          calendars={calendars}
          defaultCalendarId={defaultCalendar.id}
          selfMemberId={selfMemberId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EventList({
  month,
  byDate,
  members,
  today,
  chipFor,
  onSelect,
}: {
  month: string;
  byDate: Map<string, EventWithAssignees[]>;
  members: Member[];
  today: string;
  chipFor: (e: EventWithAssignees) => { color: string; time: string | null };
  onSelect: (e: EventWithAssignees) => void;
}) {
  const keys = [...byDate.keys()].filter((k) => k.startsWith(month)).sort();

  if (keys.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        この月の予定はまだありません。
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {keys.map((key) => {
        const [, m, d] = key.split("-");
        const wd = WEEKDAYS[new Date(key + "T00:00:00").getDay()];
        return (
          <div
            key={key}
            className="grid grid-cols-[62px_minmax(0,1fr)] gap-3 border-t border-border py-3"
          >
            <div
              className={`text-sm tabular-nums ${
                key === today ? "font-bold text-accent" : "text-muted"
              }`}
            >
              {Number(m)}/{Number(d)} <span className="text-xs">({wd})</span>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              {(byDate.get(key) ?? []).map((event) => {
                const { color, time } = chipFor(event);
                const names = members
                  .filter((m2) => event.assignees.includes(m2.id))
                  .map((m2) => m2.display_name)
                  .join("・");
                return (
                  <button
                    key={`${event.id}-${key}`}
                    type="button"
                    onClick={() => onSelect(event)}
                    className="flex min-w-0 items-start gap-2 text-left"
                  >
                    <span
                      aria-hidden
                      className="min-h-5 w-[3px] shrink-0 self-stretch rounded"
                      style={{ backgroundColor: color }}
                    />
                    <span className="min-w-0">
                      <span
                        className={
                          event.status === "cancelled"
                            ? "text-muted line-through"
                            : ""
                        }
                      >
                        {time && <span className="tabular-nums">{time}　</span>}
                        {event.title}
                      </span>
                      {event.status === "cancelled" && (
                        <span className="ml-1 rounded-full border border-red-500 px-1.5 text-[10px] text-red-600">
                          中止
                        </span>
                      )}
                      {event.status === "tentative" && (
                        <span className="ml-1 rounded-full border border-border-strong px-1.5 text-[10px] text-muted">
                          仮
                        </span>
                      )}
                      <br />
                      <span className="text-xs text-muted">
                        {names}
                        {event.location ? `　${event.location}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
