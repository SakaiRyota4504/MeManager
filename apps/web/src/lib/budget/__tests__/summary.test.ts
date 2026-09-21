import { describe, expect, it } from "vitest";

import {
  byCategory,
  byMember,
  change,
  changeLabel,
  totals,
} from "@/lib/budget/summary";
import {
  applyFilter,
  EMPTY,
  filterQuery,
  isFiltering,
  parseFilter,
} from "@/lib/budget/filter";
import type { TransactionView } from "@/lib/budget/queries";
import type { CategoryStatus, Member } from "@/lib/supabase/types";

const now = "2026-09-21T09:00:00+09:00";

function tx(over: Partial<TransactionView>): TransactionView {
  return {
    id: "t1",
    family_id: "f1",
    occurred_on: "2026-09-20",
    amount: 1000,
    kind: "expense",
    category_id: "c1",
    member_id: "m1",
    note: null,
    recurring_id: null,
    created_by: "m1",
    deleted_at: null,
    created_at: now,
    updated_at: now,
    budget_categories: { name: "食費", color: "#2563eb" },
    ...over,
  };
}

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

function member(id: string, name: string): Member {
  return {
    id,
    family_id: "f1",
    user_id: null,
    display_name: name,
    color: "#2563eb",
    role: "member",
    timezone: "Asia/Tokyo",
    is_active: true,
    login_email: null,
    created_at: now,
    updated_at: now,
  };
}

const rows: TransactionView[] = [
  tx({ id: "a", category_id: "c1", amount: 6000, member_id: "m1" }),
  tx({
    id: "b",
    category_id: "c2",
    amount: 3000,
    member_id: "m2",
    note: "薬",
    budget_categories: { name: "日用品", color: "#0891b2" },
  }),
  tx({ id: "c", category_id: "c1", amount: 1000, member_id: "m2" }),
  tx({
    id: "d",
    category_id: "i1",
    amount: 420000,
    kind: "income",
    member_id: null,
    budget_categories: { name: "給与", color: "#16a34a" },
  }),
];

const categories: CategoryStatus[] = [
  category({ category_id: "c1", name: "食費", budget: 10000 }),
  category({ category_id: "c2", name: "日用品", color: "#0891b2" }),
  category({ category_id: "c3", name: "交通", color: "#65a30d", budget: 5000 }),
  category({ category_id: "i1", name: "給与", kind: "income" }),
];

const members = [member("m1", "父"), member("m2", "母")];

describe("月の合計", () => {
  it("支出と収入を分けて足す。差引は収入から支出を引く", () => {
    expect(totals(rows)).toEqual({
      expense: 10000,
      income: 420000,
      net: 410000,
    });
  });

  it("記録が無ければ全部0", () => {
    expect(totals([])).toEqual({ expense: 0, income: 0, net: 0 });
  });
});

describe("費目ごとの内訳", () => {
  const slices = byCategory(rows, categories, "expense");

  it("多い順に並べ、割合を出す", () => {
    expect(slices.map((s) => [s.label, s.amount])).toEqual([
      ["食費", 7000],
      ["日用品", 3000],
      ["交通", 0],
    ]);
    expect(slices[0].share).toBeCloseTo(0.7);
  });

  it("予算があって使っていない費目も出す。残りを見たいのはそこ", () => {
    const trans = slices.find((s) => s.label === "交通");
    expect(trans).toBeDefined();
    expect(trans?.budget).toBe(5000);
  });

  it("予算も記録も無い費目は出さない", () => {
    expect(slices.some((s) => s.label === "給与")).toBe(false);
  });

  it("収入は収入だけで割合を出す", () => {
    const income = byCategory(rows, categories, "income");
    expect(income).toHaveLength(1);
    expect(income[0].share).toBe(1);
  });

  it("消えた費目の記録も落とさない", () => {
    const orphan = byCategory([tx({ category_id: "zz" })], [], "expense");
    expect(orphan[0].label).toBe("（消えた費目）");
  });
});

describe("使った人ごとの内訳", () => {
  it("支出だけを、人ごとに足す", () => {
    expect(byMember(rows, members).map((s) => [s.label, s.amount])).toEqual([
      ["父", 6000],
      ["母", 4000],
    ]);
  });

  it("人を入れていない記録は「指定なし」にまとまる", () => {
    const slices = byMember([tx({ member_id: null })], members);
    expect(slices[0].label).toBe("指定なし");
  });
});

describe("前の月との比較", () => {
  it("増減を額と割合で出す", () => {
    expect(change(11000, 10000)).toEqual({ diff: 1000, ratio: 0.1 });
    expect(changeLabel(0.1)).toBe("10%増");
    expect(changeLabel(-0.25)).toBe("25%減");
  });

  it("前の月が0なら割合を出さない。必ず「∞%増」になってしまう", () => {
    expect(change(5000, 0)).toEqual({ diff: 5000, ratio: null });
    expect(changeLabel(null)).toBeNull();
  });

  it("ほぼ同じなら何も言わない", () => {
    expect(changeLabel(0.001)).toBeNull();
  });
});

describe("一覧の絞り込み", () => {
  it("指定が無ければ全部返す", () => {
    expect(isFiltering(EMPTY)).toBe(false);
    expect(applyFilter(rows, EMPTY)).toHaveLength(4);
  });

  it("費目でしぼる", () => {
    const f = { ...EMPTY, category: "c1" };
    expect(applyFilter(rows, f).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("人でしぼる", () => {
    expect(
      applyFilter(rows, { ...EMPTY, member: "m2" }).map((r) => r.id),
    ).toEqual(["b", "c"]);
  });

  it("「指定なし」は人が入っていない記録", () => {
    expect(
      applyFilter(rows, { ...EMPTY, member: "-" }).map((r) => r.id),
    ).toEqual(["d"]);
  });

  it("言葉はメモと費目名にかかる。大文字小文字は区別しない", () => {
    expect(
      applyFilter(rows, { ...EMPTY, text: "薬" }).map((r) => r.id),
    ).toEqual(["b"]);
    expect(applyFilter(rows, { ...EMPTY, text: "食費" })).toHaveLength(2);
  });

  it("いくつも重ねられる", () => {
    const f = { category: "c1", member: "m2", text: "" };
    expect(applyFilter(rows, f).map((r) => r.id)).toEqual(["c"]);
  });

  it("URL から読み、URL に戻せる", () => {
    const f = parseFilter({ c: "c1", p: "m2", q: " 薬 " });
    expect(f).toEqual({ category: "c1", member: "m2", text: "薬" });
    expect(filterQuery("2026-09", f)).toBe("?m=2026-09&c=c1&p=m2&q=%E8%96%AC");
    expect(filterQuery("2026-09", EMPTY)).toBe("?m=2026-09");
  });
});
