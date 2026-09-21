"use client";

import { useEffect, useRef, useState } from "react";

import type { EventWithAssignees } from "@/lib/calendar/model";
import {
  WEEKDAYS,
  formatTime,
  fromDateKey,
  todayKey,
} from "@/lib/calendar/date";
import { layoutDay, snapMinutes, toTimeString } from "@/lib/calendar/layout";

/** 1時間ぶんの高さ。CSS にも同じ値を渡す（ずれると罫線と予定が合わなくなる） */
const HOUR_PX = 44;
const PX_PER_MIN = HOUR_PX / 60;
/** 押しただけ（動かさなかった）ときに作る長さ */
const CLICK_MINUTES = 60;

type Chip = { color: string; time: string | null };

/**
 * 週表示・日表示。縦が時刻、横が日。
 *
 * 空いているところを押すと、その時刻で予定を作れる（FR-E07）。
 * 下へなぞれば長さも決まる。
 */
export function WeekView({
  days,
  events,
  chipFor,
  onSelect,
  onCreate,
}: {
  days: string[];
  events: EventWithAssignees[];
  chipFor: (e: EventWithAssignees) => Chip;
  onSelect: (e: EventWithAssignees) => void;
  onCreate: (date: string, startTime: string, endTime: string) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{
    day: string;
    from: number;
    to: number;
  } | null>(null);
  const today = todayKey();
  const columns = `44px repeat(${days.length}, minmax(0, 1fr))`;

  // 0時から始まると空白しか見えない。朝から見えるところまで送る。
  // 高さが決まるのは描画のあとなので、1フレーム待ってから動かす。
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = 7 * HOUR_PX;
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const minutesAt = (clientY: number, el: HTMLElement) =>
    snapMinutes((clientY - el.getBoundingClientRect().top) / PX_PER_MIN);

  const start = (day: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    // 予定の上から始まったときは、なぞって作らない（詳細を開く側の操作）
    if ((e.target as HTMLElement).closest(".wk-ev")) return;
    // 押さえたままなぞると、既定では文字の選択が始まる。
    // 選択のために外側の箱が勝手にスクロールしてしまうので止める。
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = minutesAt(e.clientY, e.currentTarget);
    setDraft({ day, from: m, to: m });
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    setDraft({ ...draft, to: minutesAt(e.clientY, e.currentTarget) });
  };

  const finish = () => {
    if (!draft) return;
    const from = Math.min(draft.from, draft.to);
    const to = Math.max(draft.from, draft.to);
    const length = to - from < 15 ? CLICK_MINUTES : to - from;
    setDraft(null);
    onCreate(draft.day, toTimeString(from), toTimeString(from + length));
  };

  const allDayOf = (day: string) =>
    events.filter(
      (e) =>
        e.all_day &&
        e.start_date &&
        e.end_date &&
        e.start_date <= day &&
        day <= e.end_date,
    );

  return (
    <div
      className="wk"
      style={{ "--wk-hour": `${HOUR_PX}px` } as React.CSSProperties}
    >
      <div className="wk-head" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((day) => {
          const d = fromDateKey(day);
          return (
            <div
              key={day}
              className={`wk-dayhead ${day === today ? "is-today" : ""} ${
                d.getDay() === 0 ? "is-sun" : ""
              } ${d.getDay() === 6 ? "is-sat" : ""}`}
            >
              <span className="wk-wd">{WEEKDAYS[d.getDay()]}</span>
              <span className="wk-dn">{d.getDate()}</span>
            </div>
          );
        })}
      </div>

      <div className="wk-allday" style={{ gridTemplateColumns: columns }}>
        <div className="wk-gutter">終日</div>
        {days.map((day) => (
          <div key={day} className="wk-adcol">
            {allDayOf(day).map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => onSelect(event)}
                style={{ borderLeftColor: chipFor(event).color }}
                className={`cal-chip ${
                  event.status === "cancelled" ? "is-cancelled" : ""
                } ${event.status === "tentative" ? "is-tentative" : ""}`}
              >
                <span className="cal-chip-title">{event.title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="wk-body" ref={body}>
        <div
          className="wk-grid"
          style={{ gridTemplateColumns: columns, height: 24 * HOUR_PX }}
        >
          <div className="wk-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="wk-hour">
                {h > 0 && <span>{h}:00</span>}
              </div>
            ))}
          </div>

          {days.map((day) => (
            <div
              key={day}
              className={`wk-col ${day === today ? "is-today" : ""}`}
              onPointerDown={start(day)}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={() => setDraft(null)}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="wk-line" />
              ))}

              {layoutDay(events, day).map((box) => {
                const { color } = chipFor(box.event);
                const width = 100 / box.lanes;
                return (
                  <button
                    key={box.event.id}
                    type="button"
                    className={`wk-ev ${
                      box.event.status === "cancelled" ? "is-cancelled" : ""
                    } ${box.event.status === "tentative" ? "is-tentative" : ""}`}
                    style={{
                      top: `${box.top * 100}%`,
                      height: `${box.height * 100}%`,
                      left: `${box.lane * width}%`,
                      width: `calc(${width}% - 2px)`,
                      borderLeftColor: color,
                    }}
                    onClick={() => onSelect(box.event)}
                  >
                    <span className="wk-ev-time">
                      {box.fromBefore
                        ? "前日から"
                        : formatTime(
                            box.event.starts_at as string,
                            box.event.timezone,
                          )}
                    </span>
                    <span className="wk-ev-title">{box.event.title}</span>
                  </button>
                );
              })}

              {draft?.day === day && (
                <div
                  aria-hidden
                  className="wk-draft"
                  style={{
                    top: `${(Math.min(draft.from, draft.to) / (24 * 60)) * 100}%`,
                    height: `${(Math.max(Math.abs(draft.to - draft.from), CLICK_MINUTES) / (24 * 60)) * 100}%`,
                  }}
                />
              )}

              {day === today && <NowLine />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** いまの時刻の線。今日の列にだけ引く */
function NowLine() {
  const now = new Date();
  const top = ((now.getHours() * 60 + now.getMinutes()) / (24 * 60)) * 100;
  return <div aria-hidden className="wk-now" style={{ top: `${top}%` }} />;
}
