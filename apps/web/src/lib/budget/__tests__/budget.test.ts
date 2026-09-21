import { describe, expect, it } from "vitest";

import {
  formatAmountInput,
  formatYen,
  level,
  levelLabel,
  parseAmount,
  remaining,
  usedPercent,
  MAX_AMOUNT,
} from "@/lib/budget/money";
import {
  currentMonth,
  formatDay,
  formatDayShort,
  isDateKey,
  isMonthKey,
  monthFirstDay,
  monthOf,
} from "@/lib/budget/month";
import {
  orderForInput,
  orderForSettings,
  swappedOrder,
  VISIBLE_CHIPS,
} from "@/lib/budget/categories";
import type { CategoryStatus } from "@/lib/supabase/types";

function category(over: Partial<CategoryStatus>): CategoryStatus {
  return {
    category_id: "c1",
    name: "食費",
    kind: "expense",
    color: "#2563eb",
    sort_order: 10,
    is_active: true,
    budget: null,
    used: 0,
    uses: 0,
    ...over,
  };
}

describe("金額", () => {
  it("3桁ごとに区切る", () => {
    expect(formatYen(1234567)).toBe("1,234,567");
    expect(formatYen(0)).toBe("0");
  });

  it("数字以外は捨てる", () => {
    expect(parseAmount("1,234円")).toBe(1234);
    expect(parseAmount("あ")).toBe(0);
    expect(parseAmount("")).toBe(0);
  });

  it("全角の数字も受ける", () => {
    expect(parseAmount("１２３０")).toBe(1230);
  });

  it("上限で頭を打つ。桁を打ち間違えても通らない", () => {
    expect(parseAmount("999999999")).toBe(MAX_AMOUNT);
  });

  it("打っている途中も区切る。0 のときは空にする", () => {
    expect(formatAmountInput("4280")).toBe("4,280");
    expect(formatAmountInput("0")).toBe("");
    expect(formatAmountInput("")).toBe("");
  });
});

describe("予算に対する状態", () => {
  it("予算を決めていなければ色を付けない", () => {
    expect(level(5000, null)).toBe("none");
    expect(levelLabel("none")).toBeNull();
  });

  it("予算 0円は「超過」と呼ばない。決めていないのと区別できないため", () => {
    expect(level(5000, 0)).toBe("none");
  });

  it("8割で残りわずか、超えたら超過", () => {
    expect(level(7900, 10000)).toBe("ok");
    expect(level(8000, 10000)).toBe("warn");
    expect(level(10000, 10000)).toBe("warn");
    expect(level(10001, 10000)).toBe("over");
  });

  it("超過にはラベルも付く。色だけで伝えない", () => {
    expect(levelLabel("over")).toBe("超過");
    expect(levelLabel("warn")).toBe("残りわずか");
  });

  it("残りは超えると負になる", () => {
    expect(remaining(8800, 10000)).toBe(1200);
    expect(remaining(12000, 10000)).toBe(-2000);
  });

  it("メーターは100%より伸びない", () => {
    expect(usedPercent(5000, 10000)).toBe(50);
    expect(usedPercent(30000, 10000)).toBe(100);
    expect(usedPercent(5000, null)).toBe(0);
  });
});

describe("月と日", () => {
  it("月キーの形を見分ける", () => {
    expect(isMonthKey("2026-09")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-09-01")).toBe(false);
    expect(isMonthKey(null)).toBe(false);
  });

  it("日付キーの形を見分ける", () => {
    expect(isDateKey("2026-09-21")).toBe(true);
    expect(isDateKey("2026-09")).toBe(false);
  });

  it("DB には月初の日付で渡す", () => {
    expect(monthFirstDay("2026-09")).toBe("2026-09-01");
    expect(monthOf("2026-09-21")).toBe("2026-09");
    expect(isMonthKey(currentMonth())).toBe(true);
  });

  it("日付は曜日を添える。今日は「今日」と出す", () => {
    expect(formatDay("2026-09-21")).toBe("9/21（月）");
    expect(formatDayShort("2026-09-21", "2026-09-21")).toBe("9/21（今日）");
    expect(formatDayShort("2026-09-20", "2026-09-21")).toBe("9/20（日）");
  });
});

describe("費目の並び", () => {
  const list: CategoryStatus[] = [
    category({ category_id: "a", name: "食費", sort_order: 10, uses: 3 }),
    category({ category_id: "b", name: "日用品", sort_order: 20, uses: 9 }),
    category({ category_id: "c", name: "外食", sort_order: 30, uses: 0 }),
    category({
      category_id: "d",
      name: "交通",
      sort_order: 40,
      is_active: false,
    }),
    category({
      category_id: "e",
      name: "給与",
      kind: "income",
      sort_order: 10,
    }),
  ];

  it("入力はよく使う順。隠した費目と、別の種類は出さない", () => {
    expect(orderForInput(list, "expense").map((c) => c.name)).toEqual([
      "日用品",
      "食費",
      "外食",
    ]);
  });

  it("収入を選ぶと収入の費目だけになる", () => {
    expect(orderForInput(list, "income").map((c) => c.name)).toEqual(["給与"]);
  });

  it("設定は決めた順のまま。隠した費目も出す", () => {
    expect(orderForSettings(list, "expense").map((c) => c.name)).toEqual([
      "食費",
      "日用品",
      "外食",
      "交通",
    ]);
  });

  it("最初から見えているのは8件まで", () => {
    expect(VISIBLE_CHIPS).toBe(8);
  });
});

describe("費目の並べ替え", () => {
  const list = orderForSettings(
    [
      category({ category_id: "a", name: "食費", sort_order: 10 }),
      category({ category_id: "b", name: "日用品", sort_order: 20 }),
      category({ category_id: "c", name: "外食", sort_order: 30 }),
    ],
    "expense",
  );

  it("隣と入れ替える", () => {
    expect(swappedOrder(list, "b", -1)).toEqual([
      { id: "b", sort_order: 10 },
      { id: "a", sort_order: 20 },
    ]);
  });

  it("端からは動かせない", () => {
    expect(swappedOrder(list, "a", -1)).toBeNull();
    expect(swappedOrder(list, "c", 1)).toBeNull();
  });

  it("同じ順番の値が並んでいたら、位置から振り直す", () => {
    const flat = [
      category({ category_id: "a", name: "食費", sort_order: 100 }),
      category({ category_id: "b", name: "日用品", sort_order: 100 }),
    ];
    expect(swappedOrder(flat, "a", 1)).toEqual([
      { id: "a", sort_order: 20 },
      { id: "b", sort_order: 10 },
    ]);
  });
});
