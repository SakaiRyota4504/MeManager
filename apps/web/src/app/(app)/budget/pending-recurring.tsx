"use client";

import { useState, useTransition } from "react";

import type { CategoryStatus } from "@/lib/supabase/types";
import { formatAmountInput, formatYen, parseAmount } from "@/lib/budget/money";
import { formatDayShort } from "@/lib/budget/month";
import type { Occurrence } from "@/lib/budget/pending";
import { pendingOnly, pendingTotal } from "@/lib/budget/pending";
import { recordRecurring, type BudgetFormState } from "./actions";
import { Dot } from "./parts";

/**
 * 今月まだ入れていない固定費（FR-B22）。
 *
 * **自動では記録に入れない。**押したときに初めて記録になる。
 * 自動計上にすると、解約したはずのサブスクが毎月積み上がり、
 * 「実際に使った額」が信じられない数字になる。
 *
 * 入力の邪魔をしないよう、金額と費目の下に置く。
 * 1件も無い月は、何も出さない。
 */
export function PendingRecurring({
  occurrences,
  categories,
  today,
}: {
  occurrences: Occurrence[];
  categories: CategoryStatus[];
  today: string;
}) {
  const pending = pendingOnly(occurrences);
  const total = pendingTotal(occurrences);
  const [state, setState] = useState<BudgetFormState>(null);

  if (pending.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong p-3">
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <span className="font-semibold">今月まだ入れていない固定費</span>
        <span className="text-muted tabular-nums">
          {total.unknown > 0
            ? `${formatYen(total.amount)}円 ＋ 金額未定 ${total.unknown}件`
            : `${formatYen(total.amount)}円`}
        </span>
      </h2>

      <ul className="flex flex-col gap-1.5">
        {pending.map((o) => (
          <Row
            key={o.recurring.id}
            occurrence={o}
            categories={categories}
            today={today}
            onResult={setState}
          />
        ))}
      </ul>

      {state && "error" in state && (
        <p role="alert" className="text-sm text-over">
          {state.error}
        </p>
      )}
    </section>
  );
}

function Row({
  occurrence,
  categories,
  today,
  onResult,
}: {
  occurrence: Occurrence;
  categories: CategoryStatus[];
  today: string;
  onResult: (state: BudgetFormState) => void;
}) {
  const { recurring, date } = occurrence;
  const category = categories.find(
    (c) => c.category_id === recurring.category_id,
  );
  // 金額の決まっていないものは、その場で聞く（FR-B23）
  const [amount, setAmount] = useState("");
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();

  const needsAmount = recurring.amount === null;

  function record() {
    if (needsAmount && parseAmount(amount) <= 0) {
      setAsking(true);
      return;
    }
    const data = new FormData();
    data.set("recurring_id", recurring.id);
    data.set("occurred_on", date);
    data.set("name", recurring.name);
    if (needsAmount) data.set("amount", String(parseAmount(amount)));

    startTransition(async () => {
      onResult(await recordRecurring(null, data));
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-2 text-[13px]">
      <Dot color={category?.color ?? "#71717a"} />
      <span className="min-w-0 flex-1 truncate">
        {recurring.name}
        <span className="ml-1.5 text-xs text-muted">
          {formatDayShort(date, today)}
        </span>
      </span>

      {needsAmount ? (
        <input
          inputMode="numeric"
          value={amount}
          placeholder="金額"
          aria-label={`${recurring.name}の金額`}
          onChange={(e) => {
            setAmount(formatAmountInput(e.target.value));
            setAsking(false);
          }}
          className={`w-24 rounded-md border px-2 py-1 text-right tabular-nums ${
            asking ? "border-over" : "border-border-strong"
          }`}
        />
      ) : (
        <span className="tabular-nums">{formatYen(recurring.amount!)}円</span>
      )}

      <button
        type="button"
        onClick={record}
        disabled={pending}
        className="min-h-8 rounded-md border border-border-strong px-3 disabled:opacity-60"
      >
        入れる
      </button>
    </li>
  );
}
