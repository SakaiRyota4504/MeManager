"use client";

import { useState, useTransition } from "react";

import { formatDayShort } from "@/lib/budget/month";
import { describeFrequency } from "@/lib/habit/frequency";
import { frequencyOf, type TodayItem } from "@/lib/habit/model";
import { toggleHabit, type HabitFormState } from "./actions";

/**
 * 今日やること（FR-H10）。
 *
 * **押すのが仕事の画面。**行そのものを大きな押しどころにして、
 * どこを押しても記録になるようにしてある。
 */
export function TodayList({
  items,
  date,
  selfMemberId,
}: {
  items: TodayItem[];
  date: string;
  selfMemberId: string;
}) {
  const [state, setState] = useState<HabitFormState>(null);

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted">
        今日やることはありません。設定の「習慣」から足せます。
      </p>
    );
  }

  const mine = items.filter((i) => i.habit.member_id === selfMemberId);
  const others = items.filter((i) => i.habit.member_id !== selfMemberId);

  return (
    <div className="flex flex-col gap-5">
      <Group items={mine} date={date} onResult={setState} />
      {others.length > 0 && (
        <Group
          items={others}
          date={date}
          onResult={setState}
          label="家族のぶん"
        />
      )}
      {state && "error" in state && (
        <p role="alert" className="text-sm text-over">
          {state.error}
        </p>
      )}
    </div>
  );
}

function Group({
  items,
  date,
  onResult,
  label,
}: {
  items: TodayItem[];
  date: string;
  onResult: (state: HabitFormState) => void;
  label?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      {label && <h2 className="text-xs text-muted">{label}</h2>}
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.habit.id}>
            <Row
              item={item}
              date={date}
              onResult={onResult}
              showMember={!!label}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({
  item,
  date,
  onResult,
  showMember,
}: {
  item: TodayItem;
  date: string;
  onResult: (state: HabitFormState) => void;
  showMember: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { habit, done, progress } = item;

  function press() {
    startTransition(async () => {
      onResult(await toggleHabit(habit.id, date));
    });
  }

  return (
    <button
      type="button"
      onClick={press}
      disabled={pending}
      aria-pressed={done}
      className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left disabled:opacity-60 ${
        done ? "border-transparent bg-surface-2" : "border-border-strong"
      }`}
    >
      {/* 押したかどうかは、丸の塗りと中のチェックの両方で表す */}
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-full border-2"
        style={{
          borderColor: habit.color,
          backgroundColor: done ? habit.color : "transparent",
        }}
      >
        {done && (
          <svg viewBox="0 0 24 24" fill="none" className="size-4">
            <path
              d="M5 12.5 10 17.5 19 7"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className={`block ${done ? "text-muted line-through" : ""}`}>
          {habit.name}
        </span>
        <span className="block text-[11.5px] text-muted">
          {describeFrequency(frequencyOf(habit))}
          {showMember && item.member ? ` ・ ${item.member.display_name}` : ""}
          {habit.visibility === "private" ? " ・ 自分だけ" : ""}
        </span>
      </span>

      {/* 回数で決めるものは、期間内の進みを出す */}
      {progress && (
        <span className="shrink-0 text-[13px] text-muted tabular-nums">
          {progress.done} / {progress.target}
        </span>
      )}
    </button>
  );
}

/** 見ている日。今日でなければ、戻れるようにする */
export function DayNote({ date, today }: { date: string; today: string }) {
  if (date === today) return null;
  return (
    <p className="text-xs text-warn">
      {`${formatDayShort(date, today)}のぶんを見ています`}
    </p>
  );
}
