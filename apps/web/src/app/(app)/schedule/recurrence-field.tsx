"use client";

import {
  WEEKDAY_LABELS,
  defaultRecurrence,
  describeRecurrence,
  toRRule,
  type Freq,
  type Recurrence,
  type Weekday,
} from "@/lib/recurrence/rule";

const FREQ_OPTIONS: { value: Freq | "none"; label: string }[] = [
  { value: "none", label: "繰り返さない" },
  { value: "daily", label: "毎日" },
  { value: "weekly", label: "毎週" },
  { value: "monthly", label: "毎月" },
  { value: "yearly", label: "毎年" },
];

const UNIT: Record<Freq, string> = {
  daily: "日おき",
  weekly: "週おき",
  monthly: "か月おき",
  yearly: "年おき",
};

/**
 * 繰り返しの指定（FR-R01〜R03）。
 *
 * 選んでいない間は一段しか出さない。毎日の予定より1回きりの予定のほうが
 * 多いので、既定の状態でフォームが伸びないようにする。
 */
export function RecurrenceField({
  value,
  startDate,
  onChange,
}: {
  value: Recurrence | null;
  startDate: string;
  onChange: (next: Recurrence | null) => void;
}) {
  const set = (patch: Partial<Recurrence>) =>
    onChange({ ...(value ?? defaultRecurrence()), ...patch });

  const toggleDay = (day: Weekday) => {
    const current = value?.byWeekday ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day];
    set({ byWeekday: next });
  };

  return (
    <div className="space-y-2">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">繰り返し</span>
        <select
          name="freq"
          value={value?.freq ?? "none"}
          onChange={(e) =>
            e.target.value === "none"
              ? onChange(null)
              : set({ freq: e.target.value as Freq })
          }
          className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm"
        >
          {FREQ_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {value && (
        <div className="space-y-3 rounded-md border border-dashed border-border p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="number"
              min={1}
              max={99}
              value={value.interval}
              onChange={(e) =>
                set({ interval: Math.max(1, Number(e.target.value) || 1) })
              }
              aria-label="繰り返しの間隔"
              className="w-16 rounded-md border border-border px-2 py-1 text-sm"
            />
            {UNIT[value.freq]}
          </label>

          {value.freq === "weekly" && (
            <div className="flex flex-wrap gap-1">
              {WEEKDAY_LABELS.map((label, day) => {
                const on = value.byWeekday.includes(day as Weekday);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(day as Weekday)}
                    className={`size-8 rounded-full border text-sm ${
                      on
                        ? "border-transparent bg-accent text-accent-fg"
                        : "border-border-strong text-muted"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={value.end.kind}
              onChange={(e) => {
                const kind = e.target.value;
                if (kind === "never") set({ end: { kind: "never" } });
                else if (kind === "count")
                  set({ end: { kind: "count", count: 10 } });
                else set({ end: { kind: "until", date: startDate } });
              }}
              aria-label="繰り返しの終わり"
              className="rounded-md border border-border-strong bg-background px-2 py-1.5 text-sm"
            >
              <option value="never">ずっと</option>
              <option value="count">回数で終わる</option>
              <option value="until">日付で終わる</option>
            </select>

            {value.end.kind === "count" && (
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={value.end.count}
                  onChange={(e) =>
                    set({
                      end: {
                        kind: "count",
                        count: Math.max(1, Number(e.target.value) || 1),
                      },
                    })
                  }
                  aria-label="繰り返す回数"
                  className="w-20 rounded-md border border-border px-2 py-1 text-sm"
                />
                回
              </label>
            )}

            {value.end.kind === "until" && (
              <input
                type="date"
                value={value.end.date}
                onChange={(e) =>
                  set({ end: { kind: "until", date: e.target.value } })
                }
                aria-label="繰り返しの終わりの日"
                className="rounded-md border border-border px-2 py-1 text-sm"
              />
            )}
          </div>

          <p className="text-xs text-muted">
            {describeRecurrence(value, startDate)}
          </p>
        </div>
      )}

      {/* 保存する形は RRULE の文字列（FR-R08） */}
      <input type="hidden" name="rrule" value={value ? toRRule(value) : ""} />
    </div>
  );
}
