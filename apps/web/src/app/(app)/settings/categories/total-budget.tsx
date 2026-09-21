"use client";

import { useActionState, useState } from "react";

import { formatAmountInput } from "@/lib/budget/money";
import { setTotalBudget } from "../../budget/actions";

/** ひと月に使ってよい額（FR-B34）。費目ごとの予算とは別に持つ */
export function TotalBudget({
  month,
  amount,
}: {
  month: string;
  amount: number | null;
}) {
  const [state, action, pending] = useActionState(setTotalBudget, null);
  const [value, setValue] = useState(
    amount === null ? "" : amount.toLocaleString("ja-JP"),
  );

  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-[13px]"
    >
      <input type="hidden" name="month" value={month} />
      <label htmlFor="total-budget" className="shrink-0">
        ひと月の予算
      </label>
      <input
        id="total-budget"
        name="budget"
        inputMode="numeric"
        value={value}
        placeholder="決めない"
        onChange={(e) => setValue(formatAmountInput(e.target.value))}
        className="w-32 rounded-md border border-border-strong px-2 py-1.5 text-right tabular-nums"
      />
      <span className="text-muted">円</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border-strong px-3 py-1.5 disabled:opacity-60"
      >
        決める
      </button>
      <span className="w-full text-xs text-muted">
        費目ごとの予算を足した額とは別の決めごとです。集計に出ます。
      </span>
      {state && "error" in state && (
        <p role="alert" className="w-full text-sm text-over">
          {state.error}
        </p>
      )}
    </form>
  );
}
