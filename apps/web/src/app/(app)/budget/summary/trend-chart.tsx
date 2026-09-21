"use client";

import { useState } from "react";

import type { TrendPoint } from "@/lib/supabase/types";
import { formatYen } from "@/lib/budget/money";
import { formatMonth } from "@/lib/budget/month";

/**
 * 12か月の支出（FR-B44）。
 *
 * **1本だけの棒グラフにしてある。**収入と差引は上のタイルに出ているので、
 * ここで線や色を増やしても「どれがどれか」を見分ける仕事が増えるだけになる。
 * 見ている月だけを濃くし、他は淡くする。
 *
 * 目盛りは上端の1本だけ。高さを比べる図なので、横線を何本も引いても
 * 読み取りの助けにならない。値はさわると出る。
 *
 * SVG ではなく普通の箱で描いている。棒の太さ（24px以下）と角の丸み（4px）を
 * 画面幅によらず同じにしたいのに、SVG を横に引き伸ばすと両方が歪むため。
 */
export function TrendChart({
  points,
  month,
}: {
  points: TrendPoint[];
  month: string;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const max = Math.max(...points.map((p) => p.expense), 1);
  // 目盛りは切りのいい数に丸める
  const step = Math.pow(10, Math.max(3, String(Math.round(max)).length - 1));
  const top = Math.ceil(max / step) * step;

  const shown =
    points.find((p) => p.month.slice(0, 7) === hover) ??
    points.find((p) => p.month.slice(0, 7) === month) ??
    null;

  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <figcaption className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs text-muted">月ごとの支出</span>
        <span className="text-xs tabular-nums">
          {shown
            ? `${formatMonth(shown.month.slice(0, 7))} ${formatYen(shown.expense)}円`
            : ""}
        </span>
      </figcaption>

      {/* 上端の目盛り。棒の高さが何を意味するかの基準になる */}
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10.5px] text-muted tabular-nums">
          {formatYen(top)}円
        </span>
      </div>

      <ul
        className="flex h-32 items-end gap-0.5"
        onMouseLeave={() => setHover(null)}
      >
        {points.map((p) => {
          const key = p.month.slice(0, 7);
          const on = key === month;
          const lit = on || key === hover;
          return (
            <li
              key={key}
              className="flex h-full min-w-0 flex-1 items-end justify-center"
              onMouseEnter={() => setHover(key)}
              onFocus={() => setHover(key)}
            >
              <button
                type="button"
                aria-label={`${formatMonth(key)} ${formatYen(p.expense)}円`}
                onClick={() => setHover(key)}
                className="flex h-full w-full max-w-6 items-end justify-center"
              >
                <span
                  className={`w-full rounded-t ${lit ? "bg-accent" : "bg-accent/30"}`}
                  style={{
                    // 0円の月は棒を描かない。1pxでも描くと「少し使った」に見える
                    height:
                      p.expense === 0
                        ? 0
                        : `${Math.max(2, (p.expense / top) * 100)}%`,
                  }}
                />
              </button>
            </li>
          );
        })}
      </ul>

      {/* 月の名前。全部は出さない。3か月おきと、見ている月 */}
      <ul className="flex gap-0.5">
        {points.map((p, i) => {
          const key = p.month.slice(0, 7);
          const on = key === month;
          const show = on || (points.length - 1 - i) % 3 === 0;
          return (
            <li
              key={key}
              className={`min-w-0 flex-1 text-center text-[10.5px] tabular-nums ${
                on ? "font-semibold" : "text-muted"
              }`}
            >
              {show ? `${Number(key.slice(5))}月` : ""}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
