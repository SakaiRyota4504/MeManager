"use client";

import { useState, useTransition } from "react";

import { WEEKDAYS } from "@/lib/calendar/date";
import { setWeekStart } from "./actions";

/** カレンダーを何曜日から始めるか（FR-V10）。家族で1つの設定 */
export function WeekStart({
  familyId,
  value,
  canManage,
}: {
  familyId: string;
  value: number;
  canManage: boolean;
}) {
  const [current, setCurrent] = useState(value);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  if (!canManage) return null;

  function change(next: number) {
    const before = current;
    setCurrent(next);
    startTransition(async () => {
      const form = new FormData();
      form.set("family_id", familyId);
      form.set("week_start", String(next));
      const result = await setWeekStart(null, form);
      if (result && "error" in result) {
        setCurrent(before);
        setError(result.error);
      } else {
        setError(undefined);
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">カレンダーの始まりの曜日</span>
      <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
        {[0, 1].map((d) => (
          <button
            key={d}
            type="button"
            disabled={pending}
            aria-pressed={current === d}
            onClick={() => change(d)}
            className={`px-4 py-1.5 text-sm disabled:opacity-60 ${
              current === d ? "bg-accent text-accent-fg" : ""
            }`}
          >
            {WEEKDAYS[d]}曜
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
