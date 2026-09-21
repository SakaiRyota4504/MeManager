/**
 * 繰り返しの展開。**ルールと期間を渡すと、日付の一覧が返る。**
 *
 * 予定のデータ構造には触れない。ここを予定と結び付けないのは、
 * 習慣管理でも同じものを使うため（docs/03-roadmap.md Step 5）。
 *
 * 日付だけを扱い、時刻は持たない。
 * 時刻まで含めて展開すると、夏時間や時間帯の違いで1時間ずれる問題が
 * 展開のたびに出てくる。「何日に起きるか」と「何時に起きるか」を分けて、
 * 時刻は元の予定が持ったままにする。
 */

import { RRule } from "rrule";

/** 1回の展開で返す上限。終了日の無いルールが無限に伸びないようにする */
const MAX = 400;

/** YYYY-MM-DD をその日の 0:00 UTC の Date にする（展開は日付だけで行う） */
function atUtcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 期間内に起きる日付を返す。
 *
 * @param rrule    RFC 5545 の RRULE（`FREQ=WEEKLY;BYDAY=TU` など）
 * @param startDate 1回目の日付（YYYY-MM-DD）
 * @param from     期間の始め（含む）
 * @param to       期間の終わり（**含まない**）
 */
export function expand(
  rrule: string,
  startDate: string,
  from: string,
  to: string,
): string[] {
  let rule: RRule;
  try {
    rule = new RRule({
      ...RRule.parseString(rrule),
      dtstart: atUtcMidnight(startDate),
    });
  } catch {
    // 読めないルールは「繰り返さない」として扱う。
    // 画面が真っ白になるより、1回だけ出るほうがまだ気づける。
    return from <= startDate && startDate < to ? [startDate] : [];
  }

  const end = new Date(atUtcMidnight(to).getTime() - 1);
  return rule.between(atUtcMidnight(from), end, true).slice(0, MAX).map(toKey);
}
