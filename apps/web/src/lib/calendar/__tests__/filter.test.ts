import { describe, expect, it } from "vitest";

import type { EventWithAssignees } from "../model";
import {
  filterEvents,
  filterLabel,
  isSelfOnly,
  parseSelected,
  serializeSelected,
  toggleMember,
} from "../filter";

const IDS = ["a", "b", "c"];
const MEMBERS = [
  { id: "a", display_name: "父" },
  { id: "b", display_name: "母" },
  { id: "c", display_name: "たろう" },
];

function ev(id: string, assignees: string[]): EventWithAssignees {
  return { id, assignees } as unknown as EventWithAssignees;
}

describe("絞り込みの読み取り", () => {
  it("指定が無ければ undefined（「全員」とは区別する）", () => {
    expect(parseSelected(null, IDS)).toBeUndefined();
    expect(parseSelected("", IDS)).toBeUndefined();
  });

  it("all は全員", () => {
    expect(parseSelected("all", IDS)).toBeNull();
  });

  it("IDの並びを読む", () => {
    expect(parseSelected("a,c", IDS)).toEqual(["a", "c"]);
    expect(parseSelected(" a , c ", IDS)).toEqual(["a", "c"]);
  });

  it("家族から外れた人のIDは落とす", () => {
    expect(parseSelected("a,zzz", IDS)).toEqual(["a"]);
  });

  it("全員が外れて0人になったら、全員に戻す（予定が消えたままにしない）", () => {
    expect(parseSelected("zzz", IDS)).toBeNull();
  });

  it("書き出したものを読み戻せる", () => {
    for (const s of [null, ["a"], ["a", "b"]]) {
      expect(parseSelected(serializeSelected(s), IDS)).toEqual(s);
    }
  });
});

describe("予定の絞り込み", () => {
  const events = [ev("1", ["a"]), ev("2", ["b", "c"]), ev("3", ["a", "b"])];

  it("全員なら何も落とさない", () => {
    expect(filterEvents(events, null)).toHaveLength(3);
  });

  it("担当者に含まれる予定だけ残る", () => {
    expect(filterEvents(events, ["a"]).map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("複数人を選ぶと、どれか1人でも担当なら残る", () => {
    expect(filterEvents(events, ["a", "c"]).map((e) => e.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});

describe("メンバーの出し入れ", () => {
  it("全員の状態から1人を外すと、その人以外になる", () => {
    expect(toggleMember(null, "b", IDS)).toEqual(["a", "c"]);
  });

  it("最後の1人を外したら全員に戻す（0人にはしない）", () => {
    expect(toggleMember(["b"], "b", IDS)).toBeNull();
  });

  it("全員を選び直したら「全員」に戻す", () => {
    expect(toggleMember(["a", "b"], "c", IDS)).toBeNull();
  });
});

describe("ボタンの表示", () => {
  it("人数と名前で言い分ける", () => {
    expect(filterLabel(null, MEMBERS, "a")).toBe("全員");
    expect(filterLabel(["a"], MEMBERS, "a")).toBe("自分のみ");
    expect(filterLabel(["b"], MEMBERS, "a")).toBe("母 のみ");
    expect(filterLabel(["b", "c"], MEMBERS, "a")).toBe("2人のみ");
  });

  it("自分だけを選んだ状態が分かる", () => {
    expect(isSelfOnly(["a"], "a")).toBe(true);
    expect(isSelfOnly(["a", "b"], "a")).toBe(false);
    expect(isSelfOnly(null, "a")).toBe(false);
  });
});
