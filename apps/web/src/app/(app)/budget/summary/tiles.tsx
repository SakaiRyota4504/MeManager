import { formatYen } from "@/lib/budget/money";
import { change, changeLabel } from "@/lib/budget/summary";

/**
 * 月の合計（FR-B40）。
 *
 * 3つの数字を棒グラフにしない。並べて読む数字であって、
 * 長さを比べるものではないため（支出と収入は桁が違う）。
 */
export function Tiles({
  expense,
  income,
  previousExpense,
}: {
  expense: number;
  income: number;
  previousExpense: number;
}) {
  const diff = change(expense, previousExpense);
  const label = changeLabel(diff.ratio);
  const net = income - expense;

  return (
    <ul className="flex flex-wrap gap-2.5">
      <Tile
        label="支出"
        value={expense}
        note={
          label
            ? `前の月より ${formatYen(Math.abs(diff.diff))}円 ${label}`
            : previousExpense > 0
              ? "前の月とほぼ同じ"
              : undefined
        }
      />
      <Tile label="収入" value={income} />
      <Tile
        label="差引"
        value={net}
        sign
        note={net < 0 ? "収入より多く使っています" : undefined}
      />
    </ul>
  );
}

function Tile({
  label,
  value,
  note,
  sign = false,
}: {
  label: string;
  value: number;
  note?: string;
  sign?: boolean;
}) {
  return (
    <li className="min-w-[9.5rem] flex-1 rounded-lg border border-border px-3 py-2">
      <span className="block text-[11.5px] text-muted">{label}</span>
      <span
        className={`block text-xl font-bold tabular-nums ${
          sign && value < 0 ? "text-over" : ""
        }`}
      >
        {sign && value > 0 ? "+" : ""}
        {formatYen(value)}
        <span className="text-[13px] font-normal">円</span>
      </span>
      {note && <span className="block text-[11.5px] text-muted">{note}</span>}
    </li>
  );
}
