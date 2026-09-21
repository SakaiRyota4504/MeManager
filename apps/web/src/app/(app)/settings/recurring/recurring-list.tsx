"use client";

import { useState, useTransition } from "react";

import type {
  CategoryStatus,
  Member,
  RecurringExpense,
} from "@/lib/supabase/types";
import { orderForSettings } from "@/lib/budget/categories";
import { formatAmountInput, formatYen } from "@/lib/budget/money";
import {
  defaultCycle,
  describeCycle,
  fromRRule,
  toRRule,
  type Cycle,
} from "@/lib/budget/recurring";
import {
  createRecurring,
  updateRecurring,
  type BudgetFormState,
} from "../../budget/actions";
import { Dot } from "../../budget/parts";
import { CycleField } from "./cycle-field";

export function RecurringList({
  items,
  categories,
  members,
}: {
  items: RecurringExpense[];
  categories: CategoryStatus[];
  members: Member[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const active = items.filter((r) => r.is_active);
  const hidden = items.filter((r) => !r.is_active);

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {[...active, ...hidden].map((item) => (
            <li key={item.id} className="px-3 py-2.5">
              <Summary
                item={item}
                categories={categories}
                open={editing === item.id}
                onToggle={() =>
                  setEditing(editing === item.id ? null : item.id)
                }
              />
              {editing === item.id && (
                <Form
                  item={item}
                  categories={categories}
                  members={members}
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
            categories={categories}
            members={members}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md border border-border-strong px-4 py-2 text-sm"
        >
          固定費を足す
        </button>
      )}
    </div>
  );
}

function Summary({
  item,
  categories,
  open,
  onToggle,
}: {
  item: RecurringExpense;
  categories: CategoryStatus[];
  open: boolean;
  onToggle: () => void;
}) {
  const category = categories.find((c) => c.category_id === item.category_id);
  const cycle = fromRRule(item.rrule);

  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <Dot color={category?.color ?? "#71717a"} />
      <span className={item.is_active ? "" : "text-muted line-through"}>
        {item.name}
      </span>
      <span className="text-xs text-muted">
        {cycle ? describeCycle(cycle) : item.rrule}
        {category ? ` ・ ${category.name}` : ""}
      </span>
      <span className="ml-auto tabular-nums">
        {item.amount === null ? (
          <span className="text-xs text-muted">毎月変わる</span>
        ) : (
          `${formatYen(item.amount)}円`
        )}
      </span>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="text-[13px] underline"
      >
        {open ? "閉じる" : "変える"}
      </button>
    </div>
  );
}

function Form({
  item,
  categories,
  members,
  onDone,
}: {
  item?: RecurringExpense;
  categories: CategoryStatus[];
  members: Member[];
  onDone: () => void;
}) {
  const choices = orderForSettings(categories, "expense").filter(
    (c) => c.is_active || c.category_id === item?.category_id,
  );

  const [name, setName] = useState(item?.name ?? "");
  const [amount, setAmount] = useState(
    item?.amount == null ? "" : formatYen(item.amount),
  );
  const [categoryId, setCategoryId] = useState(
    item?.category_id ?? choices[0]?.category_id ?? "",
  );
  const [memberId, setMemberId] = useState(item?.member_id ?? "");
  const [cycle, setCycle] = useState<Cycle>(
    (item && fromRRule(item.rrule)) || defaultCycle(),
  );
  const [active, setActive] = useState(item?.is_active ?? true);
  const [state, setState] = useState<BudgetFormState>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const data = new FormData();
    data.set("name", name.trim());
    data.set("amount", amount);
    data.set("category_id", categoryId);
    data.set("member_id", memberId);
    data.set("rrule", toRRule(cycle));
    if (item) {
      data.set("recurring_id", item.id);
      data.set("is_active", active ? "1" : "0");
    }

    startTransition(async () => {
      const result = item
        ? await updateRecurring(null, data)
        : await createRecurring(null, data);
      if (result && "ok" in result) onDone();
      else setState(result);
    });
  }

  return (
    <div className="mt-2.5 flex flex-col gap-2.5 rounded-lg border border-border bg-surface-2 p-3 text-[13px]">
      <label className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-muted">名前</span>
        <input
          value={name}
          maxLength={40}
          placeholder="家賃"
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-background px-2 py-1.5"
        />
      </label>

      <label className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-muted">金額</span>
        <input
          inputMode="numeric"
          value={amount}
          placeholder="毎月変わる"
          onChange={(e) => setAmount(formatAmountInput(e.target.value))}
          className="w-32 rounded-md border border-border-strong bg-background px-2 py-1.5 text-right tabular-nums"
        />
        <span className="text-muted">円</span>
        <span className="w-full text-xs text-muted">
          空欄にすると、入れるときに金額を聞きます（光熱費など）。
        </span>
      </label>

      <label className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-muted">費目</span>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-md border border-border-strong bg-background px-2 py-1.5"
        >
          {choices.map((c) => (
            <option key={c.category_id} value={c.category_id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-muted">繰り返し</span>
        <CycleField value={cycle} onChange={setCycle} />
      </div>

      <label className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-muted">払う人</span>
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="rounded-md border border-border-strong bg-background px-2 py-1.5"
        >
          <option value="">指定しない</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
      </label>

      {item && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!active}
            onChange={(e) => setActive(!e.target.checked)}
          />
          やめた固定費として隠す（これまでの記録は残ります）
        </label>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg disabled:opacity-60"
        >
          {item ? "保存" : "足す"}
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
