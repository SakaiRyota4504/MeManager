"use client";

import { useState, useTransition } from "react";

import type { Habit, Member } from "@/lib/supabase/types";
import { HUES } from "@/lib/colors";
import {
  defaultFrequency,
  describeFrequency,
  scheduleToRRule,
  WEEKDAYS_ONLY,
  type Frequency,
} from "@/lib/habit/frequency";
import { frequencyOf } from "@/lib/habit/model";
import type { Weekday } from "@/lib/recurrence/rule";
import {
  createHabit,
  updateHabit,
  type HabitFormState,
} from "../../habits/actions";

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export function HabitList({
  habits,
  members,
  selfMemberId,
}: {
  habits: Habit[];
  members: Member[];
  selfMemberId: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const active = habits.filter((h) => h.is_active);
  const hidden = habits.filter((h) => !h.is_active);

  return (
    <div className="space-y-3">
      {habits.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {[...active, ...hidden].map((habit) => (
            <li key={habit.id} className="px-3 py-2.5">
              <Summary
                habit={habit}
                members={members}
                open={editing === habit.id}
                onToggle={() =>
                  setEditing(editing === habit.id ? null : habit.id)
                }
              />
              {editing === habit.id && (
                <Form
                  habit={habit}
                  members={members}
                  selfMemberId={selfMemberId}
                  onDone={() => setEditing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded-lg border border-border p-3">
          <Form
            members={members}
            selfMemberId={selfMemberId}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md border border-border-strong px-4 py-2 text-sm"
        >
          習慣を足す
        </button>
      )}
    </div>
  );
}

function Summary({
  habit,
  members,
  open,
  onToggle,
}: {
  habit: Habit;
  members: Member[];
  open: boolean;
  onToggle: () => void;
}) {
  const member = members.find((m) => m.id === habit.member_id);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span
        aria-hidden
        className="inline-block size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: habit.color }}
      />
      <span className={habit.is_active ? "" : "text-muted line-through"}>
        {habit.name}
      </span>
      <span className="text-xs text-muted">
        {describeFrequency(frequencyOf(habit))}
        {member ? ` ・ ${member.display_name}` : ""}
        {habit.visibility === "private" ? " ・ 自分だけ" : ""}
      </span>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="ml-auto text-[13px] underline"
      >
        {open ? "閉じる" : "変える"}
      </button>
    </div>
  );
}

function Form({
  habit,
  members,
  selfMemberId,
  onDone,
}: {
  habit?: Habit;
  members: Member[];
  selfMemberId: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(habit?.name ?? "");
  const [memberId, setMemberId] = useState(habit?.member_id ?? selfMemberId);
  const [color, setColor] = useState(
    habit?.color ??
      members.find((m) => m.id === selfMemberId)?.color ??
      HUES[0],
  );
  const [frequency, setFrequency] = useState<Frequency>(
    habit ? frequencyOf(habit) : defaultFrequency(),
  );
  const [privateOnly, setPrivateOnly] = useState(
    habit?.visibility === "private",
  );
  const [active, setActive] = useState(habit?.is_active ?? true);
  const [state, setState] = useState<HabitFormState>(null);
  const [pending, startTransition] = useTransition();

  // 「自分だけ」は自分の習慣にしか付けられない（DB 側も同じ判断をする）
  const canBePrivate = memberId === selfMemberId;

  function save() {
    const data = new FormData();
    data.set("name", name.trim());
    data.set("member_id", memberId);
    data.set("color", color);
    data.set("kind", frequency.kind);
    data.set("visibility", canBePrivate && privateOnly ? "private" : "family");
    if (frequency.kind === "count") {
      data.set("target_count", String(frequency.count));
      data.set("period", frequency.period);
    } else {
      data.set("rrule", scheduleToRRule(frequency.byWeekday));
    }
    if (habit) {
      data.set("habit_id", habit.id);
      data.set("is_active", active ? "1" : "0");
    }

    startTransition(async () => {
      const result = habit
        ? await updateHabit(null, data)
        : await createHabit(null, data);
      if (result && "ok" in result) onDone();
      else setState(result);
    });
  }

  return (
    <div className="mt-2.5 flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3 text-[13px]">
      <label className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-muted">名前</span>
        <input
          value={name}
          maxLength={40}
          placeholder="歯みがき"
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-background px-2 py-1.5"
        />
      </label>

      <label className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-muted">する人</span>
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="rounded-md border border-border-strong bg-background px-2 py-1.5"
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
      </label>

      <FrequencyField value={frequency} onChange={setFrequency} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-muted">色</span>
        <span className="flex flex-wrap gap-1.5">
          {HUES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`色 ${c}`}
              aria-pressed={color.toLowerCase() === c}
              onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={`size-6 rounded-full ${
                color.toLowerCase() === c
                  ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface-2"
                  : ""
              }`}
            />
          ))}
        </span>
      </div>

      {canBePrivate && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={privateOnly}
            className="mt-0.5"
            onChange={(e) => setPrivateOnly(e.target.checked)}
          />
          <span>
            自分だけに見せる
            <span className="block text-xs text-muted">
              {"家族からは、習慣も記録も見えなくなります。"}
            </span>
          </span>
        </label>
      )}

      {habit && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!active}
            onChange={(e) => setActive(!e.target.checked)}
          />
          やめた習慣として隠す（記録は残ります）
        </label>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg disabled:opacity-60"
        >
          {habit ? "保存" : "足す"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-border-strong px-3 py-2"
        >
          やめる
        </button>
      </div>

      {state && "error" in state && (
        <p role="alert" className="text-sm text-over">
          {state.error}
        </p>
      )}
    </div>
  );
}

/**
 * 頻度（docs/08-habit-requirements.md 3.2）。
 *
 * 「曜日で決める」と「回数で決める」を選ばせる。
 * RRULE では「週3回、曜日は問わない」が表せないので、2種類が要る。
 */
function FrequencyField({
  value,
  onChange,
}: {
  value: Frequency;
  onChange: (frequency: Frequency) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-muted">頻度</span>
        <div className="flex overflow-hidden rounded-md border border-border-strong">
          {(
            [
              ["schedule", "曜日で決める"],
              ["count", "回数で決める"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              aria-pressed={value.kind === kind}
              onClick={() =>
                onChange(
                  kind === "count"
                    ? { kind: "count", count: 3, period: "week" }
                    : defaultFrequency(),
                )
              }
              className={`px-2.5 py-1 ${
                value.kind === kind ? "bg-accent text-accent-fg" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {value.kind === "schedule" ? (
        <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[5.5rem]">
          <span className="flex gap-1">
            {DAY_LABELS.map((label, day) => {
              const on = value.byWeekday.includes(day as Weekday);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${label}曜日`}
                  onClick={() =>
                    onChange({
                      kind: "schedule",
                      byWeekday: on
                        ? value.byWeekday.filter((d) => d !== day)
                        : [...value.byWeekday, day as Weekday],
                    })
                  }
                  className={`size-9 rounded-full border text-[13px] ${
                    on
                      ? "border-transparent bg-accent font-semibold text-accent-fg"
                      : "border-border-strong"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </span>
          <button
            type="button"
            onClick={() =>
              onChange({ kind: "schedule", byWeekday: WEEKDAYS_ONLY })
            }
            className="text-xs text-muted underline"
          >
            平日
          </button>
          {value.byWeekday.length > 0 && (
            <button
              type="button"
              onClick={() => onChange(defaultFrequency())}
              className="text-xs text-muted underline"
            >
              毎日に戻す
            </button>
          )}
          <span className="w-full text-xs text-muted">
            {describeFrequency(value)}
            {value.byWeekday.length === 0 ? "（曜日を選ばなければ毎日）" : ""}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[5.5rem]">
          <select
            aria-label="期間"
            value={value.period}
            onChange={(e) =>
              onChange({
                ...value,
                period: e.target.value as "week" | "month",
              })
            }
            className="rounded-md border border-border-strong bg-background px-2 py-1.5"
          >
            <option value="week">週に</option>
            <option value="month">月に</option>
          </select>
          <select
            aria-label="回数"
            value={value.count}
            onChange={(e) =>
              onChange({ ...value, count: Number(e.target.value) })
            }
            className="rounded-md border border-border-strong bg-background px-2 py-1.5"
          >
            {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}回
              </option>
            ))}
          </select>
          <span className="w-full text-xs text-muted">
            {"曜日は決めません。その期間に届けばよい習慣に向いています。"}
          </span>
        </div>
      )}
    </div>
  );
}
