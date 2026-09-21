"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CategoryStatus, Member } from "@/lib/supabase/types";
import { orderForSettings } from "@/lib/budget/categories";
import {
  EMPTY,
  filterQuery,
  isFiltering,
  type Filter,
} from "@/lib/budget/filter";

/** 一覧の絞り込み（FR-B45）。押した時点で URL が変わる */
export function FilterBar({
  month,
  filter,
  categories,
  members,
}: {
  month: string;
  filter: Filter;
  categories: CategoryStatus[];
  members: Member[];
}) {
  const router = useRouter();
  const [text, setText] = useState(filter.text);

  function go(next: Filter) {
    router.push(`/budget/list${filterQuery(month, next)}`);
  }

  const choices = [
    ...orderForSettings(categories, "expense"),
    ...orderForSettings(categories, "income"),
  ].filter((c) => c.is_active || c.category_id === filter.category);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go({ ...filter, text: text.trim() });
      }}
      className="flex flex-wrap items-center gap-2 text-[13px]"
    >
      <select
        aria-label="費目でしぼる"
        value={filter.category}
        onChange={(e) => go({ ...filter, category: e.target.value })}
        className="rounded-md border border-border px-2 py-1.5"
      >
        <option value="">すべての費目</option>
        {choices.map((c) => (
          <option key={c.category_id} value={c.category_id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        aria-label="使った人でしぼる"
        value={filter.member}
        onChange={(e) => go({ ...filter, member: e.target.value })}
        className="rounded-md border border-border px-2 py-1.5"
      >
        <option value="">全員</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name}
          </option>
        ))}
        <option value="-">指定なし</option>
      </select>

      {/* 狭い画面では、しぼり込みの下に1行まるごと使う。
          flex-1 のまま並べると、入力欄が「メモ」だけの幅に潰れる */}
      <span className="flex w-full min-w-0 gap-2 sm:w-auto sm:flex-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="メモをさがす"
          aria-label="メモをさがす"
          className="min-w-0 flex-1 rounded-md border border-border px-2 py-1.5"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md border border-border-strong px-3 py-1.5"
        >
          さがす
        </button>
      </span>

      {isFiltering(filter) && (
        <button
          type="button"
          onClick={() => {
            setText("");
            go(EMPTY);
          }}
          className="text-muted underline"
        >
          しぼり込みをやめる
        </button>
      )}
    </form>
  );
}
