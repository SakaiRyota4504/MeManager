"use client";

import { useEffect, useRef, useState } from "react";

import type { Member } from "@/lib/supabase/types";
import {
  filterLabel,
  isSelfOnly,
  toggleMember,
  type Selected,
} from "@/lib/calendar/filter";

/**
 * 担当者の絞り込み。
 *
 * ボタン1つと、押したときに開く小窓でできている。
 * メンバーの並びを常に出しておくと、そのぶんカレンダーが下がる。
 * 絞り込みは毎日触るものではないので、普段は畳んでおく。
 *
 * 絞り込み中はボタンの見た目が変わり、隣の × で1操作で戻せる（FR-M09）。
 */
export function FilterMenu({
  members,
  selected,
  selfMemberId,
  onChange,
  hideCancelled,
  onHideCancelled,
}: {
  members: Member[];
  selected: Selected;
  selfMemberId: string;
  onChange: (next: Selected) => void;
  hideCancelled: boolean;
  onHideCancelled: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const memberIds = members.map((m) => m.id);
  const filtered = selected !== null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (next: Selected) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <div
        className={`flex items-center overflow-hidden rounded-md border ${
          filtered ? "border-accent" : "border-border-strong"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="true"
          className={`px-3 py-1 text-sm whitespace-nowrap ${
            filtered ? "bg-accent font-medium text-accent-fg" : ""
          }`}
        >
          {filterLabel(selected, members, selfMemberId)}
        </button>
        {filtered && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="絞り込みを解除して全員を表示"
            title="全員に戻す"
            className="bg-accent px-2 py-1 text-sm text-accent-fg"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="cal-filter-menu absolute top-full z-30 mt-1 w-56 rounded-lg border border-border bg-background p-2 shadow-lg">
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => pick(null)}
              aria-pressed={selected === null}
              className={`rounded-md px-2 py-1.5 text-left text-sm ${
                selected === null ? "font-semibold text-accent" : ""
              }`}
            >
              全員
            </button>
            <button
              type="button"
              onClick={() => pick([selfMemberId])}
              aria-pressed={isSelfOnly(selected, selfMemberId)}
              className={`rounded-md px-2 py-1.5 text-left text-sm ${
                isSelfOnly(selected, selfMemberId)
                  ? "font-semibold text-accent"
                  : ""
              }`}
            >
              自分の予定のみ
              <span className="ml-1 text-xs text-muted">（M）</span>
            </button>
          </div>

          <div className="my-1.5 border-t border-border" />

          <label className="flex items-center gap-2 px-2 py-1.5 text-sm">
            <input
              type="checkbox"
              checked={hideCancelled}
              onChange={(e) => onHideCancelled(e.target.checked)}
              className="size-4 accent-accent"
            />
            中止した予定を隠す
          </label>

          <div className="my-1.5 border-t border-border" />

          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = selected === null || selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onChange(toggleMember(selected, m.id, memberIds))
                  }
                  style={on ? { backgroundColor: m.color } : undefined}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border-strong py-0.5 pr-2.5 pl-2 text-sm ${
                    on ? "border-transparent text-white" : "text-muted"
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
        </div>
      )}
    </div>
  );
}
