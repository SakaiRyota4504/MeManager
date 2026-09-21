"use client";

import { useActionState } from "react";

import type { CategoryKind } from "@/lib/supabase/types";
import { createCategory } from "../../budget/actions";

/** 費目を足す。色は後から「変える」で選べるので、ここでは名前だけ聞く */
export function AddCategory({ kind }: { kind: CategoryKind }) {
  const [state, action, pending] = useActionState(createCategory, null);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input
        name="name"
        maxLength={20}
        placeholder={
          kind === "expense" ? "費目を足す（例：ペット）" : "収入の費目を足す"
        }
        aria-label={
          kind === "expense" ? "足す費目の名前" : "足す収入の費目の名前"
        }
        className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border-strong px-4 py-2 text-sm disabled:opacity-60"
      >
        足す
      </button>
      {state && "error" in state && (
        <p role="alert" className="w-full text-sm text-over">
          {state.error}
        </p>
      )}
    </form>
  );
}
