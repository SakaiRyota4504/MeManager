/**
 * 金額の扱い。
 *
 * 金額は整数（円）で持つ（docs/07-budget-requirements.md 3.3）。
 * 小数も浮動小数点も使わない。ここは文字列と整数の変換だけを担当する。
 */

/** 入れられる上限。桁の打ち間違いを止めるためのもので、DB 側にも同じ制限がある */
export const MAX_AMOUNT = 100_000_000;

/** 予算に対する状態。色だけで伝えないよう、ラベルも一緒に持つ（4.4） */
export type Level = "none" | "ok" | "warn" | "over";

/** 1,234 のように3桁ごとに区切る。円記号は付けない */
export function formatYen(amount: number): string {
  return Math.round(amount).toLocaleString("ja-JP");
}

/**
 * 入力された文字から金額を読む。
 * 数字以外は捨てる。全角の数字も受ける（スマートフォンで混ざることがある）。
 */
export function parseAmount(text: string): number {
  const half = text.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  const digits = half.replace(/[^0-9]/g, "").slice(0, 9);
  if (!digits) return 0;
  return Math.min(Number(digits), MAX_AMOUNT);
}

/** 入力欄に出す形。打っている途中も3桁区切りにする */
export function formatAmountInput(text: string): string {
  const amount = parseAmount(text);
  return amount === 0 ? "" : formatYen(amount);
}

/**
 * 予算に対して、いまどの状態か。
 *
 * 8割で「残りわずか」、超えたら「超過」。
 * 予算を決めていない費目は "none" で、色も付けない。
 * 予算 0円を「超過」と呼ばないのは、決めていないのと区別できないため。
 */
export function level(used: number, budget: number | null): Level {
  if (budget === null || budget <= 0) return "none";
  if (used > budget) return "over";
  if (used >= budget * 0.8) return "warn";
  return "ok";
}

/** 残り。超えていれば負になる */
export function remaining(used: number, budget: number | null): number {
  return (budget ?? 0) - used;
}

/** メーターの長さ（％）。100を超えても伸ばさない */
export function usedPercent(used: number, budget: number | null): number {
  if (!budget || budget <= 0) return 0;
  return Math.min(100, Math.round((used / budget) * 100));
}

/** 状態に付けるラベル。null なら何も出さない */
export function levelLabel(value: Level): string | null {
  if (value === "over") return "超過";
  if (value === "warn") return "残りわずか";
  return null;
}
