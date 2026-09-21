"use client";

import { useState, useTransition } from "react";

import type { CategoryStatus, Member } from "@/lib/supabase/types";
import { orderForSettings } from "@/lib/budget/categories";
import { formatAmountInput, formatYen, parseAmount } from "@/lib/budget/money";
import { formatDay } from "@/lib/budget/month";
import type { TransactionView } from "@/lib/budget/queries";
import {
  deleteTransaction,
  updateTransaction,
  type BudgetFormState,
} from "../actions";
import { Dot } from "../parts";

/** 日ごとにまとめる。同じ日の合計も出す */
function groupByDay(rows: TransactionView[]): [string, TransactionView[]][] {
  const days = new Map<string, TransactionView[]>();
  for (const row of rows) {
    const list = days.get(row.occurred_on);
    if (list) list.push(row);
    else days.set(row.occurred_on, [row]);
  }
  return [...days.entries()];
}

export function TransactionList({
  rows,
  categories,
  members,
}: {
  rows: TransactionView[];
  categories: CategoryStatus[];
  members: Member[];
}) {
  const [editing, setEditing] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="text-sm text-muted">この月の記録はまだありません。</p>;
  }

  return (
    <div className="flex flex-col">
      {groupByDay(rows).map(([day, items]) => {
        // 収入は引く。日ごとの行は「その日いくら出ていったか」を見るもの
        const sum = items.reduce(
          (total, t) => total + (t.kind === "income" ? -t.amount : t.amount),
          0,
        );
        return (
          <section key={day}>
            <h2 className="pt-3 pb-1 text-xs text-muted tabular-nums">
              {formatDay(day)} ・ {formatYen(sum)}円
            </h2>
            <ul className="flex flex-col">
              {items.map((t) => (
                <li key={t.id} className="border-t border-border">
                  <Row
                    row={t}
                    categories={categories}
                    members={members}
                    open={editing === t.id}
                    onToggle={() => setEditing(editing === t.id ? null : t.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Row({
  row,
  categories,
  members,
  open,
  onToggle,
}: {
  row: TransactionView;
  categories: CategoryStatus[];
  members: Member[];
  open: boolean;
  onToggle: () => void;
}) {
  const member = members.find((m) => m.id === row.member_id);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2.5 py-2 text-left"
      >
        <Dot color={row.budget_categories?.color ?? "#71717a"} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            {row.note || row.budget_categories?.name || "記録"}
          </span>
          <span className="block text-[11.5px] text-muted">
            {row.budget_categories?.name ?? "—"}
            {member ? ` ・ ${member.display_name}` : ""}
          </span>
        </span>
        <span
          className={`font-semibold whitespace-nowrap tabular-nums ${
            row.kind === "income" ? "text-ok" : ""
          }`}
        >
          {row.kind === "income" ? "+" : ""}
          {formatYen(row.amount)}円
        </span>
      </button>

      {open && (
        <EditPanel
          row={row}
          categories={categories}
          members={members}
          onDone={onToggle}
        />
      )}
    </>
  );
}

function EditPanel({
  row,
  categories,
  members,
  onDone,
}: {
  row: TransactionView;
  categories: CategoryStatus[];
  members: Member[];
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(formatYen(row.amount));
  const [categoryId, setCategoryId] = useState(row.category_id);
  const [date, setDate] = useState(row.occurred_on);
  const [memberId, setMemberId] = useState(row.member_id ?? "");
  const [note, setNote] = useState(row.note ?? "");
  const [state, setState] = useState<BudgetFormState>(null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  // 費目の種類は変えられない（記録の向きが変わってしまうため）
  const choices = orderForSettings(categories, row.kind).filter(
    (c) => c.is_active || c.category_id === row.category_id,
  );

  function save() {
    const data = new FormData();
    data.set("transaction_id", row.id);
    data.set("amount", String(parseAmount(amount)));
    data.set("category_id", categoryId);
    data.set("member_id", memberId);
    data.set("note", note);
    data.set("occurred_on", date);

    startTransition(async () => {
      const result = await updateTransaction(null, data);
      if (result && "ok" in result) onDone();
      else setState(result);
    });
  }

  function remove() {
    const data = new FormData();
    data.set("transaction_id", row.id);
    startTransition(async () => {
      const result = await deleteTransaction(null, data);
      if (result && "ok" in result) onDone();
      else setState(result);
    });
  }

  return (
    <div className="mb-2 flex flex-col gap-2.5 rounded-lg border border-border bg-surface-2 p-3">
      <label className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="w-16 shrink-0 text-muted">金額</span>
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(formatAmountInput(e.target.value))}
          className="w-32 rounded-md border border-border-strong bg-background px-2 py-1.5 text-right tabular-nums"
        />
        <span className="text-muted">円</span>
      </label>

      <label className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="w-16 shrink-0 text-muted">費目</span>
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

      <label className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="w-16 shrink-0 text-muted">日付</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-border-strong bg-background px-2 py-1.5"
        />
      </label>

      <label className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="w-16 shrink-0 text-muted">使った人</span>
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

      <label className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="w-16 shrink-0 text-muted">メモ</span>
        <input
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-background px-2 py-1.5"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
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

        {/* 消す操作は一度確かめる。30日は戻せるが、戻し方は画面に無い */}
        {confirming ? (
          <span className="ml-auto flex items-center gap-2 text-[13px]">
            消しますか？
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="rounded-md border border-over px-3 py-1.5 font-medium text-over disabled:opacity-60"
            >
              消す
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="ml-auto text-[13px] text-over underline"
          >
            削除
          </button>
        )}
      </div>

      {state && "error" in state && (
        <p role="alert" className="text-sm text-over">
          {state.error}
        </p>
      )}
    </div>
  );
}
