"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/budget/money";
import { isDateKey, isMonthKey, monthFirstDay } from "@/lib/budget/month";

export type BudgetFormState =
  { error: string } | { ok: true; message?: string } | null;

function toJapaneseMessage(message: string): string {
  if (/CATEGORY_NOT_FOUND/.test(message)) return "費目を選んでください";
  if (/DUPLICATE_CATEGORY/.test(message)) return "同じ名前の費目があります";
  if (/INVALID_CATEGORY/.test(message)) return "費目の指定が正しくありません";
  if (/INVALID_AMOUNT/.test(message)) return "金額を入れてください";
  if (/INVALID_MEMBER/.test(message)) return "その人は選べません";
  if (/TRANSACTION_NOT_FOUND/.test(message)) return "その記録は見つかりません";
  if (/MEMBER_REQUIRED/.test(message)) return "メンバーが見つかりません";
  if (/TOO_OLD/.test(message)) return "削除から30日を過ぎた記録は戻せません";
  return message;
}

/** 一覧と入力はどちらも同じ数字を見ているので、まとめて作り直す */
function refresh(): void {
  revalidatePath("/budget");
  revalidatePath("/budget/list");
}

// ---------------------------------------------------------------------------
// 記録
// ---------------------------------------------------------------------------

export async function createTransaction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const amount = parseAmount(String(formData.get("amount") ?? ""));
  const categoryId = String(formData.get("category_id") ?? "");
  const occurredOn = String(formData.get("occurred_on") ?? "");

  if (amount <= 0) return { error: "金額を入れてください" };
  if (!categoryId) return { error: "費目を選んでください" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_transaction", {
    payload: {
      amount,
      category_id: categoryId,
      member_id: String(formData.get("member_id") ?? ""),
      note: String(formData.get("note") ?? ""),
      ...(isDateKey(occurredOn) ? { occurred_on: occurredOn } : {}),
    },
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  refresh();
  // 何をいくらで入れたかは、保存したあと画面から消える。
  // 入れ間違いにその場で気づけるよう、メッセージに残す。
  return {
    ok: true,
    message: String(formData.get("category_name") ?? "記録"),
  };
}

export async function updateTransaction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const id = String(formData.get("transaction_id") ?? "");
  if (!id) return { error: "記録が特定できません" };

  const amount = parseAmount(String(formData.get("amount") ?? ""));
  if (amount <= 0) return { error: "金額を入れてください" };

  const occurredOn = String(formData.get("occurred_on") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_transaction", {
    target_transaction_id: id,
    payload: {
      amount,
      category_id: String(formData.get("category_id") ?? ""),
      member_id: String(formData.get("member_id") ?? ""),
      note: String(formData.get("note") ?? ""),
      ...(isDateKey(occurredOn) ? { occurred_on: occurredOn } : {}),
    },
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  refresh();
  return { ok: true };
}

export async function deleteTransaction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const id = String(formData.get("transaction_id") ?? "");
  if (!id) return { error: "記録が特定できません" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_transaction", {
    target_transaction_id: id,
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 費目と予算（設定画面から呼ぶ）
// ---------------------------------------------------------------------------

export async function createCategory(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "費目の名前を入れてください" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_budget_category", {
    payload: {
      name,
      kind: String(formData.get("kind") ?? "expense"),
      color: String(formData.get("color") ?? ""),
    },
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  revalidatePath("/settings/categories");
  refresh();
  return { ok: true };
}

export async function updateCategory(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const id = String(formData.get("category_id") ?? "");
  if (!id) return { error: "費目が特定できません" };

  const payload: Record<string, unknown> = {};
  const name = String(formData.get("name") ?? "").trim();
  if (name) payload.name = name;
  const color = String(formData.get("color") ?? "");
  if (color) payload.color = color;
  if (formData.has("is_active")) {
    payload.is_active = formData.get("is_active") === "1";
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_budget_category", {
    target_category_id: id,
    payload,
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  // 予算も同じ行で編集する。空欄は「決めていない」の意味で、0 を渡して消す。
  if (formData.has("budget")) {
    const month = String(formData.get("month") ?? "");
    const budget = parseAmount(String(formData.get("budget") ?? ""));
    const { error: budgetError } = await supabase.rpc("set_budget", {
      target_category_id: id,
      target_month: isMonthKey(month) ? monthFirstDay(month) : null,
      new_amount: budget,
    });
    if (budgetError) return { error: toJapaneseMessage(budgetError.message) };
  }

  revalidatePath("/settings/categories");
  refresh();
  return { ok: true };
}

/** 並べ替え。入れ替えた2件（または振り直した全件）をまとめて書く */
export async function reorderCategories(
  moves: { id: string; sort_order: number }[],
): Promise<void> {
  const supabase = await createClient();
  for (const move of moves) {
    await supabase.rpc("update_budget_category", {
      target_category_id: move.id,
      payload: { sort_order: move.sort_order },
    });
  }
  revalidatePath("/settings/categories");
  refresh();
}
