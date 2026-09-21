"use client";

import { useState, useTransition } from "react";

import type {
  CategoryKind,
  CategoryStatus,
  Member,
} from "@/lib/supabase/types";
import { orderForInput, VISIBLE_CHIPS } from "@/lib/budget/categories";
import {
  formatAmountInput,
  formatYen,
  level,
  parseAmount,
  remaining,
} from "@/lib/budget/money";
import { formatDayShort } from "@/lib/budget/month";
import { createTransaction, type BudgetFormState } from "./actions";
import { Dot, LevelPill, Meter } from "./parts";

/**
 * 記録の入力。
 *
 * **触るのは金額と費目の2か所だけ**で保存できる（FR-B03）。
 * 日付と使った人は既定のまま1行にたたんであり、変えたいときだけ開く。
 */
export function EntryForm({
  categories,
  members,
  today,
  defaultMemberId,
}: {
  categories: CategoryStatus[];
  members: Member[];
  today: string;
  defaultMemberId: string;
}) {
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [memberId, setMemberId] = useState(defaultMemberId);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [state, setState] = useState<BudgetFormState>(null);
  const [pending, startTransition] = useTransition();

  const ordered = orderForInput(categories, kind);
  const shown = showAll ? ordered : ordered.slice(0, VISIBLE_CHIPS);
  const selected = ordered.find((c) => c.category_id === categoryId) ?? null;

  const typing = parseAmount(amount);
  // 予算がいちばん効くのは使った直後なので、**いま入れようとしている額を
  // 足した状態**で残りを出す（FR-B31b）。
  const used = selected ? selected.used + typing : 0;
  const budget = selected?.budget ?? null;
  const status = level(used, budget);
  const rest = remaining(used, budget);

  const member = members.find((m) => m.id === memberId);
  const canSave = typing > 0 && categoryId !== null && !pending;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || !selected) return;

    const data = new FormData();
    data.set("amount", String(typing));
    data.set("category_id", selected.category_id);
    data.set("category_name", selected.name);
    data.set("member_id", memberId);
    data.set("note", note);
    data.set("occurred_on", date);

    const saved = { name: selected.name, amount: typing };

    startTransition(async () => {
      const result = await createTransaction(null, data);
      if (result && "ok" in result) {
        // 次の1件をすぐ入れられるように戻す。
        // 日付と使った人は残す。買い物は続けて入ることが多い。
        setAmount("");
        setCategoryId(null);
        setNote("");
        setOpen(false);
        setShowAll(false);
        setState({
          ok: true,
          message: `${saved.name} ${formatYen(saved.amount)}円 を記録しました`,
        });
      } else {
        setState(result);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      {/* 金額。開いた瞬間ここに入る */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="amount" className="text-xs text-muted">
          金額
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          <span aria-hidden className="text-xl text-muted">
            ¥
          </span>
          <input
            id="amount"
            name="amount"
            /* レジを出た直後に開く画面なので、数字のキーボードを出す */
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="0"
            aria-label="金額（円）"
            value={amount}
            onChange={(e) => {
              setAmount(formatAmountInput(e.target.value));
              setState(null);
            }}
            className="w-full min-w-0 bg-transparent py-0.5 text-right text-3xl font-bold tabular-nums outline-none"
          />
          <span className="text-base text-muted">円</span>
        </div>
      </div>

      {/* 費目。プルダウンは開かせない（FR-B03） */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">費目</span>
          <div
            role="group"
            aria-label="支出か収入か"
            className="ml-auto flex overflow-hidden rounded-md border border-border-strong text-xs"
          >
            {(["expense", "income"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setCategoryId(null);
                  setShowAll(false);
                }}
                className={`px-2.5 py-1 ${
                  kind === k ? "bg-accent text-accent-fg" : "text-muted"
                }`}
              >
                {k === "expense" ? "支出" : "収入"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {shown.map((c) => {
            const on = c.category_id === categoryId;
            return (
              <button
                key={c.category_id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setCategoryId(on ? null : c.category_id);
                  setState(null);
                }}
                style={on ? { backgroundColor: c.color } : undefined}
                className={`flex min-h-[38px] items-center gap-1.5 rounded-full border py-1 pr-3.5 pl-2.5 text-sm ${
                  on
                    ? "border-transparent font-semibold text-white"
                    : "border-border-strong"
                }`}
              >
                <Dot color={on ? "#ffffff" : c.color} />
                {c.name}
              </button>
            );
          })}

          {ordered.length > VISIBLE_CHIPS && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="min-h-[38px] rounded-full border border-dashed border-border-strong px-3.5 text-sm text-muted"
            >
              {showAll
                ? "閉じる"
                : `ほかの費目（${ordered.length - VISIBLE_CHIPS}）`}
            </button>
          )}
        </div>
      </div>

      {/* 選んだ費目の「今月の残り」。予算を決めていない費目では出さない */}
      {selected && budget !== null && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-1.5 text-[13px]">
            <Dot color={selected.color} />
            <span>{selected.name}</span>
            <span className="text-muted tabular-nums">
              {formatYen(used)} / {formatYen(budget)}円
            </span>
            <LevelPill level={status} />
            <span
              className={`ml-auto font-bold tabular-nums ${
                status === "over"
                  ? "text-over"
                  : status === "warn"
                    ? "text-warn"
                    : ""
              }`}
            >
              {rest >= 0
                ? `残り ${formatYen(rest)}円`
                : `${formatYen(-rest)}円 超過`}
            </span>
          </div>
          <Meter used={used} budget={budget} level={status} />
        </div>
      )}

      {/* 既定の行。変えたいときだけ開く */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-left text-[13px]"
      >
        <span>
          {formatDayShort(date, today)} ・ {member?.display_name ?? "—"}
        </span>
        <span className="ml-auto text-muted">{open ? "閉じる" : "変える"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
          <label className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="w-16 shrink-0 text-muted">日付</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-border-strong px-2 py-1.5"
            />
          </label>
          <label className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="w-16 shrink-0 text-muted">使った人</span>
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="rounded-md border border-border-strong px-2 py-1.5"
            >
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
              onChange={(e) => setNote(e.target.value)}
              placeholder="スーパー"
              maxLength={200}
              className="min-w-0 flex-1 rounded-md border border-border-strong px-2 py-1.5"
            />
          </label>
        </div>
      )}

      {/* 親指の届く下に置く */}
      <button
        type="submit"
        disabled={!canSave}
        className="min-h-12 rounded-lg bg-accent px-4 py-3 text-[15px] font-semibold text-accent-fg disabled:opacity-45"
      >
        {pending ? "保存中…" : "保存"}
      </button>

      {state && "error" in state && (
        <p role="alert" className="text-sm text-over">
          {state.error}
        </p>
      )}
      {state && "ok" in state && state.message && (
        <p
          role="status"
          className="rounded-md border border-ok/35 px-3 py-2 text-[13px] text-ok"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
