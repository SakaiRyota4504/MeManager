"use client";

import { LAST_DAY, toRRule, type Cycle } from "@/lib/budget/recurring";

/**
 * 繰り返しの指定（FR-B21）。
 *
 * 聞くのは「毎月◯日」「毎月末日」「毎年◯月◯日」の3つだけ。
 * 予定の繰り返しには曜日や回数もあるが、固定費では意味を持たない。
 */
export function CycleField({
  value,
  onChange,
}: {
  value: Cycle;
  onChange: (cycle: Cycle) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="繰り返しの種類"
        value={value.kind}
        onChange={(e) =>
          onChange(
            e.target.value === "yearly"
              ? { kind: "yearly", month: 4, day: 1 }
              : { kind: "monthly", day: 27, interval: 1 },
          )
        }
        className="rounded-md border border-border-strong px-2 py-1.5"
      >
        <option value="monthly">毎月</option>
        <option value="yearly">毎年</option>
      </select>

      {value.kind === "monthly" ? (
        <select
          aria-label="何日か"
          value={String(value.day)}
          onChange={(e) =>
            onChange({
              ...value,
              day:
                e.target.value === LAST_DAY ? LAST_DAY : Number(e.target.value),
            })
          }
          className="rounded-md border border-border-strong px-2 py-1.5"
        >
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}日
            </option>
          ))}
          <option value={LAST_DAY}>末日</option>
        </select>
      ) : (
        <>
          <select
            aria-label="何月か"
            value={value.month}
            onChange={(e) =>
              onChange({ ...value, month: Number(e.target.value) })
            }
            className="rounded-md border border-border-strong px-2 py-1.5"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
          <select
            aria-label="何日か"
            value={value.day}
            onChange={(e) =>
              onChange({ ...value, day: Number(e.target.value) })
            }
            className="rounded-md border border-border-strong px-2 py-1.5"
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}日
              </option>
            ))}
          </select>
        </>
      )}

      <input type="hidden" name="rrule" value={toRRule(value)} />

      {/* 29〜31日は、その日の無い月に飛ぶ。黙って飛ばすと気づけない */}
      {value.kind === "monthly" &&
        value.day !== LAST_DAY &&
        value.day >= 29 && (
          <span className="w-full text-xs text-warn">
            {`${value.day}日の無い月は飛びます。毎月出したいなら「末日」を選んでください。`}
          </span>
        )}
    </div>
  );
}
