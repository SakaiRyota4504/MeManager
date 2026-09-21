"use client";

import { useState, useTransition } from "react";

import type { CategoryKind, CategoryStatus } from "@/lib/supabase/types";
import { swappedOrder } from "@/lib/budget/categories";
import { formatAmountInput, formatYen, level } from "@/lib/budget/money";
import {
  reorderCategories,
  updateCategory,
  type BudgetFormState,
} from "../../budget/actions";
import { Dot, LevelPill } from "../../budget/parts";

/** 費目に選べる色。注意・超過の色（黄・赤）は入れない（4.4） */
const COLORS = [
  "#2563eb",
  "#0284c7",
  "#0891b2",
  "#0f766e",
  "#16a34a",
  "#65a30d",
  "#ea580c",
  "#db2777",
  "#c026d3",
  "#7c3aed",
  "#4f46e5",
  "#475569",
  "#57534e",
  "#78716c",
  "#71717a",
];

export function CategoryTable({
  kind,
  month,
  categories,
}: {
  kind: CategoryKind;
  month: string;
  categories: CategoryStatus[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(categoryId: string, direction: -1 | 1) {
    const moves = swappedOrder(categories, categoryId, direction);
    if (!moves) return;
    startTransition(async () => {
      await reorderCategories(moves);
    });
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {categories.map((c, index) => (
        <li key={c.category_id} className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Dot color={c.color} />
            <span className={c.is_active ? "" : "text-muted line-through"}>
              {c.name}
            </span>

            {kind === "expense" && (
              <span className="text-xs text-muted tabular-nums">
                {c.budget === null
                  ? "予算なし"
                  : `${formatYen(c.used)} / ${formatYen(c.budget)}円`}
              </span>
            )}
            {kind === "expense" && (
              <LevelPill level={level(c.used, c.budget)} />
            )}

            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-label={`${c.name}を上へ`}
                disabled={index === 0 || pending}
                onClick={() => move(c.category_id, -1)}
                className="flex size-7 items-center justify-center rounded border border-border text-muted disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`${c.name}を下へ`}
                disabled={index === categories.length - 1 || pending}
                onClick={() => move(c.category_id, 1)}
                className="flex size-7 items-center justify-center rounded border border-border text-muted disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                aria-expanded={editing === c.category_id}
                onClick={() =>
                  setEditing(editing === c.category_id ? null : c.category_id)
                }
                className="ml-1 text-[13px] underline"
              >
                {editing === c.category_id ? "閉じる" : "変える"}
              </button>
            </span>
          </div>

          {editing === c.category_id && (
            <EditRow
              category={c}
              kind={kind}
              month={month}
              onDone={() => setEditing(null)}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function EditRow({
  category,
  kind,
  month,
  onDone,
}: {
  category: CategoryStatus;
  kind: CategoryKind;
  month: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [budget, setBudget] = useState(
    category.budget === null ? "" : formatYen(category.budget),
  );
  const [active, setActive] = useState(category.is_active);
  const [state, setState] = useState<BudgetFormState>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const data = new FormData();
    data.set("category_id", category.category_id);
    data.set("name", name);
    data.set("color", color);
    data.set("is_active", active ? "1" : "0");
    // 収入に予算は無い。送らなければ、予算の行には触らない
    if (kind === "expense") {
      data.set("budget", budget);
      data.set("month", month);
    }

    startTransition(async () => {
      const result = await updateCategory(null, data);
      if (result && "ok" in result) onDone();
      else setState(result);
    });
  }

  return (
    <div className="mt-2.5 flex flex-col gap-2.5 rounded-lg border border-border bg-surface-2 p-3">
      <label className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="w-16 shrink-0 text-muted">名前</span>
        <input
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-background px-2 py-1.5"
        />
      </label>

      {kind === "expense" && (
        <label className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="w-16 shrink-0 text-muted">予算</span>
          <input
            inputMode="numeric"
            value={budget}
            placeholder="決めない"
            onChange={(e) => setBudget(formatAmountInput(e.target.value))}
            className="w-32 rounded-md border border-border-strong bg-background px-2 py-1.5 text-right tabular-nums"
          />
          <span className="text-muted">円</span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="w-16 shrink-0 text-muted">色</span>
        <span className="flex flex-wrap gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`色 ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={`size-6 rounded-full ${
                color === c
                  ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface-2"
                  : ""
              }`}
            />
          ))}
        </span>
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={!active}
          onChange={(e) => setActive(!e.target.checked)}
        />
        使わない費目として隠す（これまでの記録は残ります）
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
        >
          保存
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-border-strong px-3 py-2 text-sm"
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
