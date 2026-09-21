"use client";

import type { Preview } from "./actions";

/** 取り込む前の内訳（FR-I10）。入る前に何が起きるかを見せる */
export function PreviewTable({
  preview,
  duplicates,
  onDuplicates,
  excluded,
  onToggleRow,
  willAdd,
  pending,
  onCancel,
  onCommit,
}: {
  preview: Preview;
  duplicates: "skip" | "add";
  onDuplicates: (next: "skip" | "add") => void;
  excluded: number[];
  onToggleRow: (line: number) => void;
  willAdd: number;
  pending: boolean;
  onCancel: () => void;
  onCommit: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">
          {preview.counts.total}件を読みました
        </span>
        <span className="text-muted">
          登録 {willAdd}件 / 重複 {preview.counts.duplicate}件 / 取り込めない{" "}
          {preview.counts.problem}件
        </span>
        {preview.range && (
          <span className="text-muted">
            期間 {preview.range.from} 〜 {preview.range.to}
          </span>
        )}
      </div>

      {preview.counts.duplicate > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">すでにある予定は</span>
          {(
            [
              ["skip", "入れない"],
              ["add", "そのまま入れる"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={duplicates === id}
              onClick={() => onDuplicates(id)}
              className={`rounded-md border px-3 py-1 text-xs ${
                duplicates === id
                  ? "border-transparent bg-accent text-accent-fg"
                  : "border-border-strong"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-80 overflow-auto rounded-md border border-border">
        {/* 狭い画面では、表だけが横にスクロールする。
            縮めると見出しが縦書きのように折れて読めなくなる。 */}
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="sticky top-0 bg-surface-2 text-muted">
            <tr className="whitespace-nowrap">
              <th className="px-2 py-1.5">入れる</th>
              <th className="px-2 py-1.5">タイトル</th>
              <th className="px-2 py-1.5">日時</th>
              <th className="px-2 py-1.5">担当</th>
              <th className="px-2 py-1.5">状態</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => {
              const skipped =
                Boolean(row.problem) ||
                excluded.includes(row.line) ||
                (duplicates === "skip" && row.duplicate);
              return (
                <tr
                  key={row.line}
                  className={`border-t border-border ${skipped ? "text-muted" : ""}`}
                >
                  <td className="px-2 py-1.5">
                    {row.problem ? (
                      <span className="text-amber-600">×</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={!skipped}
                        disabled={duplicates === "skip" && row.duplicate}
                        onChange={() => onToggleRow(row.line)}
                        aria-label={`${row.title} を取り込む`}
                        className="size-4 accent-accent disabled:opacity-50"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.title || <span className="text-muted">（空）</span>}
                    {row.problem && (
                      <span className="block text-amber-600">
                        {row.problem}
                      </span>
                    )}
                    {row.duplicate && (
                      <span className="block text-muted">
                        すでに同じ予定があります
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                    {row.when}
                  </td>
                  <td className="px-2 py-1.5">{row.assignees}</td>
                  <td className="px-2 py-1.5">{row.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border-strong px-4 py-2 text-sm"
        >
          やめる
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={pending || willAdd === 0}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
        >
          {pending ? "取り込み中…" : `${willAdd}件を取り込む`}
        </button>
      </div>
    </div>
  );
}
