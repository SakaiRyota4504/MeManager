"use client";

import { useRef, useState, useTransition } from "react";

import type { Member } from "@/lib/supabase/types";
import { FormError } from "@/components/form";
import {
  previewImport,
  runImport,
  type Preview,
  type ImportSettings,
} from "./actions";

/**
 * CSV の取り込み。
 *
 * 年に1回しか使わないこともあるので、画面に手順を置く（FR-I19）。
 * 入れる前に必ずプレビューを挟み、何が起きるかを見せてから実行する（FR-I10）。
 */
export function ImportPanel({
  members,
  selfMemberId,
}: {
  members: Member[];
  selfMemberId: string;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [assignees, setAssignees] = useState<string[]>([selfMemberId]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [duplicates, setDuplicates] = useState<"skip" | "add">("skip");
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const look = (source: string, who: string[]) => {
    startTransition(async () => {
      const result = await previewImport(source, who);
      if (result.ok) {
        setPreview(result);
        setExcluded([]);
        setError(undefined);
      } else {
        setPreview(null);
        setError(result.error);
      }
    });
  };

  const onFile = async (f: File | undefined) => {
    setDone(undefined);
    if (!f) return;
    const source = await f.text();
    setText(source);
    setFileName(f.name);
    look(source, assignees);
  };

  const toggleAssignee = (id: string) => {
    const next = assignees.includes(id)
      ? assignees.filter((a) => a !== id)
      : [...assignees, id];
    setAssignees(next);
    if (text) look(text, next);
  };

  const toggleRow = (line: number) =>
    setExcluded((prev) =>
      prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line],
    );

  const commit = () => {
    const settings: ImportSettings = {
      assignees,
      duplicates,
      excluded,
      fileName,
    };
    startTransition(async () => {
      const result = await runImport(text, settings);
      if (result.ok) {
        setDone(`${result.added}件を取り込みました`);
        setPreview(null);
        setText("");
        setFileName("");
        if (file.current) file.current.value = "";
      } else {
        setError(result.error);
      }
    });
  };

  const willAdd = preview
    ? preview.rows.filter(
        (r) =>
          !r.problem &&
          !excluded.includes(r.line) &&
          (duplicates === "add" || !r.duplicate),
      ).length
    : 0;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">取り込み</h1>
        <p className="mt-1 text-sm text-muted">
          CSV
          ファイルから予定をまとめて登録します。取り込んだ1回ぶんはまとめて消せるので、日程が変わったときは「消して入れ直す」で直します。
        </p>
      </div>

      <ol className="list-inside list-decimal space-y-1 rounded-lg border border-border bg-surface-2 p-4 text-sm text-muted">
        <li>ファイルを選ぶ（1行目に列名が要ります）</li>
        <li>担当者を決める（CSV に担当者の列があればそちらが使われます）</li>
        <li>中身を確かめて取り込む</li>
      </ol>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">ファイル</span>
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-accent-fg"
        />
        <span className="block text-xs text-muted">
          文字コードは UTF-8。書き方は docs/04-csv-format.md にあります
        </span>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">
          担当者 <span className="text-xs text-muted">（全体に付けます）</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => {
            const on = assignees.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleAssignee(m.id)}
                style={on ? { backgroundColor: m.color } : undefined}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border-strong py-1 pr-3 pl-2 text-sm ${
                  on ? "border-transparent text-white" : ""
                }`}
              >
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: on ? "#fff" : m.color }}
                />
                {m.display_name}
              </button>
            );
          })}
        </div>
      </div>

      <FormError message={error} />
      {done && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {done}
        </p>
      )}

      {preview && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">
              {preview.counts.total}件を読みました
            </span>
            <span className="text-muted">
              登録 {willAdd}件 / 重複 {preview.counts.duplicate}件 /
              取り込めない {preview.counts.problem}件
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
                  onClick={() => setDuplicates(id)}
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
                            onChange={() => toggleRow(row.line)}
                            aria-label={`${row.title} を取り込む`}
                            className="size-4 accent-accent disabled:opacity-50"
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {row.title || (
                          <span className="text-muted">（空）</span>
                        )}
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
              onClick={() => {
                setPreview(null);
                setText("");
                if (file.current) file.current.value = "";
              }}
              className="rounded-md border border-border-strong px-4 py-2 text-sm"
            >
              やめる
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={pending || willAdd === 0}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
            >
              {pending ? "取り込み中…" : `${willAdd}件を取り込む`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
