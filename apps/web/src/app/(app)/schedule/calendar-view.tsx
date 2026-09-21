"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Calendar, Member } from "@/lib/supabase/types";
import type { EventWithAssignees } from "@/lib/calendar/model";
import { eventColor, groupByDate } from "@/lib/calendar/model";
import {
  VIEWS,
  WEEKDAYS,
  formatRange,
  formatTime,
  monthGridDays,
  shiftView,
  weekDays,
  toDateKey,
  toMonthKey,
  todayKey,
  type View,
} from "@/lib/calendar/date";
import {
  filterEvents,
  isSelfOnly,
  serializeSelected,
  type Selected,
} from "@/lib/calendar/filter";
import { EventPanel } from "./event-panel";
import { EventDetail } from "./event-detail";
import { FilterMenu } from "./filter-menu";
import { WeekView } from "./week-view";
import { saveScheduleFilter } from "./actions";
import "./calendar.css";

export function CalendarView({
  view,
  date,
  weekStart,
  members,
  calendars,
  events,
  selfMemberId,
  selected: initialSelected,
}: {
  view: View;
  date: string;
  weekStart: number;
  members: Member[];
  calendars: Calendar[];
  events: EventWithAssignees[];
  selfMemberId: string;
  selected: Selected;
}) {
  const router = useRouter();
  const today = todayKey();
  const month = date.slice(0, 7);

  const [editing, setEditing] = useState<
    | { mode: "create"; date: string; startTime?: string; endTime?: string }
    | { mode: "edit"; event: EventWithAssignees }
    | null
  >(null);
  const [detail, setDetail] = useState<EventWithAssignees | null>(null);

  // 絞り込みは取り直さず、手元にある予定を減らして見せる（NFR-P02）。
  const [selected, setSelected] = useState<Selected>(initialSelected);

  const changeFilter = useCallback((next: Selected) => {
    setSelected(next);
    const value = serializeSelected(next);

    // URL にも残す。再読み込みしても戻らず、家族にリンクを送れる。
    // router を使うと取り直しになるので、履歴だけ書き換える。
    const url = new URL(window.location.href);
    url.searchParams.set("m", value);
    window.history.replaceState(null, "", url);

    // 次に開いたときのために覚えておく。
    // 保存できなくても画面はそのままでよい（次に開いたとき戻るだけ）ので、
    // 待たずに投げ、失敗も握りつぶす。
    void saveScheduleFilter(value).catch(() => {});
  }, []);

  // 見せ方と日付は URL に持たせているので、移動はサーバーに投げ直す。
  // 取る期間が変わるため（絞り込みだけはクライアントで済ませている）。
  const goTo = useCallback(
    (nextView: View, nextDate: string) => {
      const query = new URLSearchParams({ view: nextView, date: nextDate });
      if (selected !== null) query.set("m", serializeSelected(selected));
      router.push(`/schedule?${query}`);
    },
    [router, selected],
  );
  const go = useCallback(
    (delta: number) => goTo(view, shiftView(view, date, delta)),
    [goTo, view, date],
  );

  const openPanel = editing !== null || detail !== null;

  // キーボードだけで動かせるようにする（9.3 節）。
  // 入力中とパネル表示中は、画面の裏側を動かさない。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (openPanel) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;

      switch (e.key) {
        case "ArrowLeft":
          go(-1);
          break;
        case "ArrowRight":
          go(1);
          break;
        case "t":
        case "T":
          goTo(view, today);
          break;
        case "n":
        case "N":
          setEditing({ mode: "create", date: view === "month" ? today : date });
          break;
        case "m":
        case "M":
          changeFilter(
            isSelfOnly(selected, selfMemberId) ? null : [selfMemberId],
          );
          break;
        case "1":
        case "2":
        case "3":
        case "4": {
          const next = VIEWS[Number(e.key) - 1];
          if (next) goTo(next.id, date);
          break;
        }
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    changeFilter,
    date,
    go,
    goTo,
    openPanel,
    selected,
    selfMemberId,
    today,
    view,
  ]);

  const shown = useMemo(
    () => filterEvents(events, selected),
    [events, selected],
  );
  const byDate = useMemo(() => groupByDate(shown), [shown]);
  const days = useMemo(
    () => monthGridDays(month, weekStart),
    [month, weekStart],
  );
  const defaultCalendar = calendars.find((c) => c.is_default) ?? calendars[0];

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
    <div className="flex min-h-0 flex-1 flex-col gap-3 py-3">
      <div className="flex flex-wrap items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="前へ"
          className="cal-nav-btn grid size-8 place-items-center rounded-md border border-border-strong"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="次へ"
          className="cal-nav-btn grid size-8 place-items-center rounded-md border border-border-strong"
        >
          ›
        </button>
        <h1 className="text-lg font-bold tabular-nums">
          {formatRange(view, date, weekStart)}
        </h1>
        {/* 狭い画面で、ここから下を必ず2行目に送る（下の .cal-break 参照） */}
        <div aria-hidden className="cal-break" />

        <div className="cal-actions flex items-center gap-2">
          <button
            type="button"
            onClick={() => goTo(view, today)}
            className="rounded-md border border-border-strong px-3 py-1 text-sm"
          >
            今日
          </button>
          {/* 予定はマスを押して追加する。この＋は一覧表示のときの入口 */}
          <button
            type="button"
            onClick={() =>
              setEditing({
                mode: "create",
                date: view === "month" ? today : date,
              })
            }
            aria-label="予定を追加"
            title="予定を追加"
            className="cal-nav-btn grid size-8 place-items-center rounded-md bg-accent text-lg leading-none text-accent-fg"
          >
            ＋
          </button>
        </div>

        <div className="cal-tools ml-auto flex items-center gap-2">
          <FilterMenu
            members={members}
            selected={selected}
            selfMemberId={selfMemberId}
            onChange={changeFilter}
          />
          <div className="cal-seg inline-flex overflow-hidden rounded-md border border-border-strong">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={view === v.id}
                onClick={() => goTo(v.id, date)}
                className={`px-3 py-1.5 text-sm ${
                  view === v.id ? "bg-accent text-accent-fg" : ""
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "week" || view === "day" ? (
        <WeekView
          days={
            view === "day"
              ? [date]
              : weekDays(date, weekStart).map((d) => toDateKey(d))
          }
          events={shown}
          chipFor={chipFor}
          onSelect={setDetail}
          onCreate={(day, startTime, endTime) =>
            setEditing({ mode: "create", date: day, startTime, endTime })
          }
        />
      ) : view === "month" ? (
        <div className="flex min-h-0 flex-1 flex-col">
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
                      onClick={() => goTo("day", key)}
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
          filtered={selected !== null}
          chipFor={chipFor}
          onSelect={setDetail}
        />
      )}

      {detail && (
        <EventDetail
          event={detail}
          members={members}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing({ mode: "edit", event: detail });
            setDetail(null);
          }}
        />
      )}

      {editing && defaultCalendar && (
        <EventPanel
          key={
            editing.mode === "edit"
              ? editing.event.id
              : `${editing.date}-${editing.startTime ?? ""}`
          }
          members={members}
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
  filtered,
  chipFor,
  onSelect,
}: {
  month: string;
  byDate: Map<string, EventWithAssignees[]>;
  members: Member[];
  today: string;
  filtered: boolean;
  chipFor: (e: EventWithAssignees) => { color: string; time: string | null };
  onSelect: (e: EventWithAssignees) => void;
}) {
  const keys = [...byDate.keys()].filter((k) => k.startsWith(month)).sort();

  if (keys.length === 0) {
    return (
      <p className="px-3 py-12 text-center text-sm text-muted">
        {filtered
          ? "絞り込みに当てはまる予定はありません。"
          : "この月の予定はまだありません。"}
      </p>
    );
  }

  return (
    <div className="flex flex-col px-3">
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
