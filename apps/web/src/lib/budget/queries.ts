import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  CategoryStatus,
  Transaction,
  TrendPoint,
} from "@/lib/supabase/types";
import { monthFirstDay } from "@/lib/budget/month";

/** 一覧に出す1件。費目の名前と色を一緒に引く */
export type TransactionView = Transaction & {
  budget_categories: { name: string; color: string } | null;
};

const VIEW_COLUMNS = "*, budget_categories(name, color)";

/** 費目・予算・その月に使った額。入力画面も設定画面もこれ1本で足りる */
export async function fetchCategoryStatus(
  month: string,
): Promise<CategoryStatus[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("budget_status", {
    target_month: monthFirstDay(month),
  });
  return data ?? [];
}

/** その月の記録。新しい順 */
export async function fetchMonthTransactions(
  month: string,
): Promise<TransactionView[]> {
  const supabase = await createClient();
  const start = monthFirstDay(month);
  const [y, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("transactions")
    .select(VIEW_COLUMNS)
    .gte("occurred_on", start)
    .lt("occurred_on", next)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });

  return (data ?? []) as TransactionView[];
}

/** 直前に入れたもの。入力画面の隣に出して、二重に入れていないか確かめられるようにする */
export async function fetchRecentTransactions(
  limit = 5,
): Promise<TransactionView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transactions")
    .select(VIEW_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as TransactionView[];
}

/**
 * 「使った人」の既定（FR-B04）。
 * 自分が前に入れたときと同じ人にする。1件も無ければ自分。
 */
export async function fetchDefaultMemberId(
  selfMemberId: string,
): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transactions")
    .select("member_id")
    .eq("created_by", selfMemberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.member_id ?? selfMemberId;
}

/** 月ごとの合計（FR-B44）。記録そのものは持ってこない */
export async function fetchTrend(
  month: string,
  months = 12,
): Promise<TrendPoint[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("budget_trend", {
    target_month: monthFirstDay(month),
    months,
  });
  return data ?? [];
}

/** 費目を決めない「全体の予算」（FR-B34）。決めていなければ null */
export async function fetchTotalBudget(month: string): Promise<number | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("total_budget", {
    target_month: monthFirstDay(month),
  });
  return data ?? null;
}
