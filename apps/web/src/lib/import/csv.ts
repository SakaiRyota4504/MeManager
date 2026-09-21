/**
 * CSV を表にする。
 *
 * ライブラリを入れずに自前で持っているのは、必要なのが RFC 4180 の
 * 素直な形だけで、外から来る文字列を扱う以上どう動くかを
 * 自分たちのテストで押さえておきたいため。
 */

/** 先頭の BOM。Excel から出した UTF-8 に付く */
const BOM = "﻿";

/**
 * 1枚のテキストを、行 × 列の表にする。
 *
 * - 改行は LF / CRLF のどちらでもよい
 * - 値にカンマ・改行・引用符を含むときは `"` で囲む（`""` で引用符1つ）
 * - 空行は読み飛ばす
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith(BOM) ? text.slice(1) : text;

  const table: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let started = false;

  const endValue = () => {
    row.push(value);
    value = "";
    started = false;
  };
  const endRow = () => {
    endValue();
    // 空行（列が1つで中身も空）は捨てる
    if (!(row.length === 1 && row[0] === "")) table.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i];

    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        value += c;
      }
      continue;
    }

    if (c === '"' && !started) {
      quoted = true;
      started = true;
    } else if (c === ",") {
      endValue();
    } else if (c === "\n") {
      endRow();
    } else if (c === "\r") {
      // CRLF の CR は読み飛ばす
    } else {
      value += c;
      started = true;
    }
  }

  // 最後の行に改行が無いこともある
  if (value !== "" || row.length > 0 || quoted) endRow();

  return table;
}
