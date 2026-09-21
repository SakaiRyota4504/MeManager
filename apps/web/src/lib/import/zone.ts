/**
 * 時間帯つきの「現地時刻」を UTC にする。
 *
 * .ics の `DTSTART;TZID=Asia/Tokyo:20260919T230000` のような書き方を読むのに使う。
 * 予定の入力（日本時間に固定）とは別物なので、ファイルを分けてある。
 */

/** その瞬間に、その時間帯が UTC から何分ずれているか */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return (asUtc - utcMs) / 60000;
}

/**
 * "2026-09-19T23:00:00" をその時間帯の時刻として読み、ISO（UTC）にする。
 *
 * ずれは時期によって変わる（夏時間）。一度仮の値で引いてから、
 * その結果でもう一度引き直して合わせる。
 */
export function zonedToIso(local: string, timeZone: string): string | null {
  const guess = Date.parse(`${local}Z`);
  if (Number.isNaN(guess)) return null;

  try {
    const first = guess - offsetMinutes(guess, timeZone) * 60000;
    const ms = guess - offsetMinutes(first, timeZone) * 60000;
    return new Date(ms).toISOString();
  } catch {
    // 知らない時間帯の名前
    return null;
  }
}
