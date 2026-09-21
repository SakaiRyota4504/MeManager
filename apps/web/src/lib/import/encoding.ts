/**
 * 取り込むファイルの文字コードを決める（FR-I04）。
 *
 * 日本で配られる日程表は Excel 経由の Shift_JIS が多い。
 * そのまま UTF-8 として読むと文字化けした見出しになり、
 * 「列が足りません」という的外れなエラーになる。
 *
 * ライブラリは入れない。ブラウザの TextDecoder が Shift_JIS を読めるので、
 * **UTF-8 として厳密に読んでみて、失敗したら Shift_JIS** で足りる。
 */

export type Encoding = "auto" | "utf-8" | "shift_jis";

export type DecodeResult = {
  text: string;
  /** 実際に使った文字コード */
  used: "utf-8" | "shift_jis";
  /** 自動判定が外れている疑いがあるか */
  suspicious: boolean;
};

export function decodeFile(
  buffer: ArrayBuffer,
  encoding: Encoding = "auto",
): DecodeResult {
  if (encoding === "shift_jis") {
    return {
      text: decode(buffer, "shift_jis"),
      used: "shift_jis",
      suspicious: false,
    };
  }
  if (encoding === "utf-8") {
    return { text: decode(buffer, "utf-8"), used: "utf-8", suspicious: false };
  }

  // UTF-8 として筋が通っているか。通らなければ Shift_JIS とみなす。
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, used: "utf-8", suspicious: false };
  } catch {
    const text = decode(buffer, "shift_jis");
    // Shift_JIS でも読めていない（置換文字だらけ）なら、選び直してもらう
    return { text, used: "shift_jis", suspicious: garbled(text) };
  }
}

function decode(buffer: ArrayBuffer, encoding: string): string {
  return new TextDecoder(encoding).decode(buffer);
}

/** 読めなかった文字（U+FFFD）が目立つか */
function garbled(text: string): boolean {
  const bad = (text.match(/�/g) ?? []).length;
  return bad > 0 && bad > text.length / 100;
}
