"use client";

import { useState, useTransition } from "react";

import type { ImportBatch } from "@/lib/supabase/types";
import { FormError } from "@/components/form";
import {
  batchSummary,
  removeBatch,
  undoRemoveBatch,
  type BatchSummary,
} from "./actions";

type Row = ImportBatch & { by: string | null };

/**
 * 取り込み履歴（FR-I29）。
 *
 * 「塊で入れて、塊で消す」の消すほう。
 * 消す前に件数と期間を見せ、手で直した予定があればその数も伝える（FR-I26・I27）。
 */
export function BatchList({ batches }: { batches: Row[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const ask = (batch: Row) => {
    setOpenId(batch.id);
    setSummary(null);
    startTransition(async () => setSummary(await batchSummary(batch.id)));
  };

  const act = (run: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await run();
      setError(result.ok ? undefined : result.error);
      setOpenId(null);
    });

  if (batches.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">取り込み履歴</h2>
        <p className="text-sm text-muted">まだ取り込みはありません。</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">取り込み履歴</h2>
        <p className="mt-1 text-sm text-muted">
          1回ぶんをまとめて消せます。消しても30日は戻せます。
        </p>
      </div>

      <FormError message={error} />

      <ul className="divide-y divide-border rounded-lg border border-border">
        {batches.map((batch) => (
          <li key={batch.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className="min-w-0">
                <span
                  className={`block text-sm ${batch.deleted_at ? "text-muted line-through" : ""}`}
                >
                  {batch.name}
                </span>
                <span className="block text-xs text-muted">
                  {batch.event_count}件{batch.by && ` ・ ${batch.by}`}
                  {batch.deleted_at && " ・ 削除済み"}
                </span>
              </span>

              {batch.deleted_at ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => undoRemoveBatch(batch.id))}
                  className="text-xs underline disabled:opacity-50"
                >
                  戻す
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => ask(batch)}
                  className="text-xs text-red-600 underline disabled:opacity-50"
                >
                  削除
                </button>
              )}
            </div>

            {openId === batch.id && (
              <div className="space-y-2 rounded-md border border-dashed border-border p-3 text-xs">
                {summary ? (
                  <>
                    <p>
                      <strong className="font-medium">{summary.count}件</strong>
                      {summary.from && (
                        <>
                          （{summary.from} 〜 {summary.to}）
                        </>
                      )}
                      を消します。
                    </p>
                    {summary.edited > 0 && (
                      <p className="text-amber-600">
                        このうち {summary.edited}
                        件は、取り込んだあとに手で直されています。
                      </p>
                    )}
                    <p className="text-muted">30日は戻せます。</p>
                  </>
                ) : (
                  <p className="text-muted">数えています…</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenId(null)}
                    className="rounded-md border border-border-strong px-3 py-1.5"
                  >
                    やめる
                  </button>
                  <button
                    type="button"
                    disabled={pending || !summary}
                    onClick={() => act(() => removeBatch(batch.id))}
                    className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
                  >
                    まとめて削除
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
