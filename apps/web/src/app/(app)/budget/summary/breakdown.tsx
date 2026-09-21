import { formatYen, level } from "@/lib/budget/money";
import type { Slice } from "@/lib/budget/summary";
import { Dot, LevelPill, Meter } from "../parts";

/**
 * 内訳の一覧（FR-B41 / FR-B43）。
 *
 * 円グラフにしない。費目は10件を超えることがあり、近い大きさの扇は
 * 目で比べられない。額と割合を文字で出し、棒で長さを添える。
 *
 * **棒の長さは、どの行でも「その月に占める割合」。**
 * 予算のある費目だけ予算に対する長さにすると、同じ見た目の棒が
 * 2つの意味を持ってしまい、どちらの物差しなのか読み手に分からない。
 * 予算に対する状態は、長さではなく**色とラベルと数字**で伝える（FR-B32）。
 *
 * 費目の色は**名前の隣の点**としてだけ使う。色だけで見分けさせない。
 */
export function Breakdown({
  slices,
  total,
  /** 予算に対する状態も出すか。人ごとの内訳には予算が無い */
  withBudget = false,
}: {
  slices: Slice[];
  total: number;
  withBudget?: boolean;
}) {
  if (slices.length === 0) {
    return (
      <p className="text-[13px] text-muted">この月の記録はまだありません。</p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {slices.map((s) => {
        const status = withBudget ? level(s.amount, s.budget) : "none";
        return (
          <li key={s.id} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <Dot color={s.color} />
              <span>{s.label}</span>
              {withBudget && s.budget !== null && (
                <span className="text-xs text-muted tabular-nums">
                  {`予算 ${formatYen(s.budget)}円`}
                </span>
              )}
              {withBudget && <LevelPill level={status} />}
              <span className="ml-auto tabular-nums">
                {formatYen(s.amount)}円
              </span>
              <span className="w-10 text-right text-xs text-muted tabular-nums">
                {Math.round(s.share * 100)}%
              </span>
            </span>
            {/* 長さは常に「その月に占める割合」。色だけが予算の状態を表す */}
            <Meter
              used={s.amount}
              budget={total}
              level={status}
              label="この月の支出"
            />
          </li>
        );
      })}
    </ul>
  );
}
