import {
  formatYen,
  levelLabel,
  usedPercent,
  type Level,
} from "@/lib/budget/money";

/** 費目の色。**色だけで見分けさせない**ので、必ず名前の隣に置く */
export function Dot({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ backgroundColor: color, width: size, height: size }}
    />
  );
}

/** 予算に対する状態。色に加えて、ラベルでも出す（4.4） */
export function LevelPill({ level }: { level: Level }) {
  const label = levelLabel(level);
  if (!label) return null;
  return (
    <span
      className={`rounded-full border px-2 py-px text-[11px] font-semibold ${
        level === "over" ? "text-over" : "text-warn"
      }`}
    >
      {label}
    </span>
  );
}

/** 使った割合。太らせない。6px の細い帯にする */
export function Meter({
  used,
  budget,
  level,
}: {
  used: number;
  budget: number | null;
  level: Level;
}) {
  const percent = usedPercent(used, budget);
  return (
    <span
      role="img"
      aria-label={`予算 ${formatYen(budget ?? 0)}円 の ${percent}%`}
      className="block h-1.5 overflow-hidden rounded-full bg-border"
    >
      <span
        className={`block h-full rounded-full ${
          level === "over"
            ? "bg-over"
            : level === "warn"
              ? "bg-warn"
              : "bg-accent"
        }`}
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}
