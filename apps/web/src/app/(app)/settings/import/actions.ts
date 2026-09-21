"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { formatTime } from "@/lib/calendar/date";
import { duplicateKey, readCsv, type ImportRow } from "@/lib/import/rows";

export type PreviewRow = {
  line: number;
  title: string;
  when: string;
  assignees: string;
  status: string;
  problem: string | null;
  duplicate: boolean;
};

export type Preview = {
  ok: true;
  rows: PreviewRow[];
  counts: { total: number; add: number; duplicate: number; problem: number };
  range: { from: string; to: string } | null;
};

export type PreviewResult = Preview | { ok: false; error: string };

export type ImportSettings = {
  /** 画面で一括指定した担当者。CSV に列があればそちらが優先される */
  assignees: string[];
  /** 重複した行をどうするか（FR-I21） */
  duplicates: "skip" | "add";
  /** 取り込まない行（FR-I13） */
  excluded: number[];
  fileName: string;
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: "確定",
  tentative: "仮",
  cancelled: "中止",
};

/** その行が何日のものか。重複の判定と期間の表示に使う */
function dateOf(row: ImportRow): string {
  return row.startDate ?? (row.startsAt ?? "").slice(0, 10);
}

function whenLabel(row: ImportRow): string {
  if (row.allDay) {
    return row.startDate === row.endDate
      ? `${row.startDate} 終日`
      : `${row.startDate} 〜 ${row.endDate} 終日`;
  }
  if (!row.startsAt) return "—";
  const day = dateOf(row);
  return `${day} ${formatTime(row.startsAt)}〜${formatTime(row.endsAt as string)}`;
}

/**
 * 取り込む前に中身を読む（FR-I10）。
 *
 * ここでは何も書き込まない。読めない行と、すでにある行を数えて返すだけ。
 */
export async function previewImport(
  text: string,
  assignees: string[],
): Promise<PreviewResult> {
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("members")
    .select("id, display_name")
    .eq("is_active", true);

  const { rows, missing } = readCsv(text, {
    members: members ?? [],
    defaultAssignees: assignees,
  });

  if (missing.length > 0) {
    return {
      ok: false,
      error: `列が足りません: ${missing.join("、")}。1行目に列名が要ります。`,
    };
  }
  if (rows.length === 0) {
    return { ok: false, error: "取り込む行がありません" };
  }

  const existing = await existingKeys(rows);
  const nameOf = new Map((members ?? []).map((m) => [m.id, m.display_name]));

  const dates = rows.map(dateOf).filter(Boolean).sort();
  const preview: PreviewRow[] = rows.map((row) => ({
    line: row.line,
    title: row.title,
    when: whenLabel(row),
    assignees: row.assignees.map((id) => nameOf.get(id) ?? "?").join("・"),
    status: STATUS_LABEL[row.status] ?? row.status,
    problem: row.problem,
    duplicate: row.problem === null && existing.has(duplicateKey(row)),
  }));

  return {
    ok: true,
    rows: preview,
    counts: {
      total: preview.length,
      add: preview.filter((r) => !r.problem && !r.duplicate).length,
      duplicate: preview.filter((r) => r.duplicate).length,
      problem: preview.filter((r) => r.problem).length,
    },
    range:
      dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
  };
}

/**
 * すでに入っている予定の印を集める。
 *
 * **消した予定は数に入れない。**「消して入れ直す」が主な操作なので、
 * ここが逆だと入れ直せなくなる（docs/04-csv-format.md 3.2）。
 */
async function existingKeys(rows: ImportRow[]): Promise<Set<string>> {
  const dates = rows.map(dateOf).filter(Boolean).sort();
  if (dates.length === 0) return new Set();

  const from = dates[0];
  const to = dates[dates.length - 1];
  const supabase = await createClient();

  const { data } = await supabase
    .from("events")
    .select("external_key, title, starts_at, start_date")
    .is("deleted_at", null)
    .or(
      `and(all_day.eq.true,end_date.gte.${from},start_date.lte.${to}),` +
        `and(all_day.eq.false,starts_at.gte.${from},starts_at.lte.${to}T23:59:59)`,
    );

  return new Set((data ?? []).map((e) => duplicateKey(e)));
}

export type ImportResult =
  { ok: true; added: number; skipped: number } | { ok: false; error: string };

/**
 * 取り込む（FR-I23）。
 *
 * プレビューで見せたものをもう一度読み直してから入れる。
 * 画面から送られた行をそのまま信じると、見せたものと違うものが入りうる。
 */
export async function runImport(
  text: string,
  settings: ImportSettings,
): Promise<ImportResult> {
  const supabase = await createClient();

  const [{ data: members }, { data: calendars }] = await Promise.all([
    supabase.from("members").select("id, display_name").eq("is_active", true),
    supabase
      .from("calendars")
      .select("id")
      .order("is_default", { ascending: false })
      .limit(1),
  ]);

  const calendarId = calendars?.[0]?.id;
  if (!calendarId) return { ok: false, error: "カレンダーが見つかりません" };

  const { rows, missing } = readCsv(text, {
    members: members ?? [],
    defaultAssignees: settings.assignees,
  });
  if (missing.length > 0) {
    return { ok: false, error: `列が足りません: ${missing.join("、")}` };
  }

  const existing = await existingKeys(rows);
  const excluded = new Set(settings.excluded);

  const target = rows.filter((row) => {
    if (row.problem) return false;
    if (excluded.has(row.line)) return false;
    if (settings.duplicates === "skip" && existing.has(duplicateKey(row))) {
      return false;
    }
    return true;
  });

  if (target.length === 0) {
    return { ok: false, error: "取り込める行がありません" };
  }

  const { error } = await supabase.rpc("commit_import", {
    payload: {
      calendar_id: calendarId,
      name: batchName(settings.fileName),
      file_name: settings.fileName || null,
      source: "csv",
      rows: target.map((row) => ({
        external_key: row.externalKey,
        title: row.title,
        all_day: row.allDay,
        starts_at: row.startsAt,
        ends_at: row.endsAt,
        start_date: row.startDate,
        end_date: row.endDate,
        status: row.status,
        location: row.location,
        description: row.description,
        color: row.color,
        assignees: row.assignees,
      })),
    },
  });

  if (error) return { ok: false, error: toJapanese(error.message) };

  revalidatePath("/schedule");
  revalidatePath("/settings/import");
  return {
    ok: true,
    added: target.length,
    skipped: rows.length - target.length,
  };
}

/** バッチの名前。既定はファイル名と日時から作る（FR-I24） */
function batchName(fileName: string): string {
  const now = new Date();
  const stamp =
    `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ` +
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return fileName ? `${fileName}（${stamp}）` : `取り込み（${stamp}）`;
}

export async function removeBatch(batchId: string): Promise<ImportResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_import_batch", {
    target_batch_id: batchId,
  });
  if (error) return { ok: false, error: toJapanese(error.message) };

  revalidatePath("/schedule");
  revalidatePath("/settings/import");
  return { ok: true, added: 0, skipped: (data as number) ?? 0 };
}

export async function undoRemoveBatch(batchId: string): Promise<ImportResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("restore_import_batch", {
    target_batch_id: batchId,
  });
  if (error) return { ok: false, error: toJapanese(error.message) };

  revalidatePath("/schedule");
  revalidatePath("/settings/import");
  return { ok: true, added: (data as number) ?? 0, skipped: 0 };
}

function toJapanese(message: string): string {
  if (/NO_ROWS/.test(message)) return "取り込む行がありません";
  if (/BATCH_NOT_FOUND/.test(message)) return "その取り込みは見つかりません";
  if (/TOO_OLD/.test(message))
    return "削除から30日を過ぎた取り込みは戻せません";
  if (/CALENDAR_NOT_FOUND/.test(message)) return "カレンダーが見つかりません";
  if (/NO_ASSIGNEE/.test(message)) return "担当者のない行があります";
  if (/INVALID_PERIOD/.test(message)) return "日時が正しくない行があります";
  return message;
}

export type BatchSummary = {
  count: number;
  edited: number;
  from: string | null;
  to: string | null;
};

/**
 * 消す前に見せる内訳（FR-I26・FR-I27）。
 * 手で直した予定が混ざっているときは、その件数も伝える。
 */
export async function batchSummary(batchId: string): Promise<BatchSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("start_date, starts_at, created_at, updated_at")
    .eq("import_batch_id", batchId)
    .is("deleted_at", null);

  const rows = data ?? [];
  const dates = rows
    .map((e) => e.start_date ?? (e.starts_at ?? "").slice(0, 10))
    .filter(Boolean)
    .sort();

  return {
    count: rows.length,
    // 取り込んだ直後は created_at と updated_at がほぼ同じ。
    // 1秒より離れていれば、あとから手で直したとみなす。
    edited: rows.filter(
      (e) => Date.parse(e.updated_at) - Date.parse(e.created_at) > 1000,
    ).length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}
