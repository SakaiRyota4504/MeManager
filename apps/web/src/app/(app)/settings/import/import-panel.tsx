"use client";

import { useRef, useState, useTransition } from "react";

import type { Member } from "@/lib/supabase/types";
import { FormError } from "@/components/form";
import { decodeFile, type Encoding } from "@/lib/import/encoding";
import { emptyMapping, FIELDS, type Mapping } from "@/lib/import/rows";
import {
  previewImport,
  runImport,
  savePreset,
  type ImportSettings,
  type Preset,
  type PresetSettings,
  type Preview,
  type Source,
} from "./actions";
import { PreviewTable } from "./preview-table";

const ENCODINGS: { id: Encoding; label: string }[] = [
  { id: "auto", label: "自動" },
  { id: "utf-8", label: "UTF-8" },
  { id: "shift_jis", label: "Shift_JIS" },
];

/**
 * ファイルの取り込み。
 *
 * 年に1回しか使わないこともあるので、画面に手順を置く（FR-I19）。
 * 月1回のほうは毎月同じ指定の繰り返しになるので、
 * 設定に名前を付けて残し、次からは選ぶだけで済むようにする（FR-I17）。
 */
export function ImportPanel({
  members,
  selfMemberId,
  presets,
}: {
  members: Member[];
  selfMemberId: string;
  presets: Preset[];
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const buffer = useRef<ArrayBuffer | null>(null);

  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState<Source>("csv");
  const [encoding, setEncoding] = useState<Encoding>("auto");
  const [assignees, setAssignees] = useState<string[]>([selfMemberId]);
  const [duplicates, setDuplicates] = useState<"skip" | "add">("skip");
  const [mapping, setMapping] = useState<Mapping | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();
  const [presetName, setPresetName] = useState("");
  const [pending, startTransition] = useTransition();

  /** いまの設定でもう一度読み直す */
  const reread = (next?: {
    assignees?: string[];
    mapping?: Mapping | null;
    encoding?: Encoding;
    source?: Source;
  }) => {
    const bytes = buffer.current;
    if (!bytes) return;

    const use = {
      assignees: next?.assignees ?? assignees,
      mapping: next?.mapping ?? mapping,
      encoding: next?.encoding ?? encoding,
      source: next?.source ?? source,
    };
    const decoded = decodeFile(bytes, use.encoding);

    startTransition(async () => {
      const result = await previewImport({
        text: decoded.text,
        source: use.source,
        assignees: use.assignees,
        mapping: use.source === "csv" ? use.mapping : null,
      });

      if (result.ok) {
        setPreview(result);
        setHeader(result.header);
        if (!use.mapping && result.mapping) setMapping(result.mapping);
        setExcluded([]);
        setError(
          decoded.suspicious
            ? "文字コードの判定に自信がありません。下で選び直してください。"
            : undefined,
        );
      } else {
        setPreview(null);
        setHeader(result.header ?? []);
        if (result.mapping) setMapping(result.mapping);
        setError(result.error);
      }
    });
  };

  const onFile = async (f: File | undefined) => {
    setDone(undefined);
    if (!f) return;
    buffer.current = await f.arrayBuffer();
    const next: Source = f.name.toLowerCase().endsWith(".ics") ? "ics" : "csv";
    setFileName(f.name);
    setSource(next);
    setMapping(null);
    reread({ source: next, mapping: null });
  };

  const applyPreset = (preset: Preset | undefined) => {
    if (!preset) return;
    const s = preset.settings;
    setAssignees(s.assignees ?? [selfMemberId]);
    setDuplicates(s.duplicates ?? "skip");
    setMapping(s.mapping ?? null);
    setEncoding(s.encoding ?? "auto");
    setPresetName(preset.name);
    reread({
      assignees: s.assignees,
      mapping: s.mapping ?? null,
      encoding: s.encoding ?? "auto",
    });
  };

  const toggleAssignee = (id: string) => {
    const next = assignees.includes(id)
      ? assignees.filter((a) => a !== id)
      : [...assignees, id];
    setAssignees(next);
    reread({ assignees: next });
  };

  const setColumn = (field: string, column: number) => {
    const next = { ...(mapping ?? emptyMapping()), [field]: column } as Mapping;
    setMapping(next);
    reread({ mapping: next });
  };

  const commit = () => {
    const bytes = buffer.current;
    if (!bytes) return;
    const settings: ImportSettings = {
      assignees,
      duplicates,
      excluded,
      fileName,
      source,
      mapping: source === "csv" ? mapping : null,
    };
    const text = decodeFile(bytes, encoding).text;

    startTransition(async () => {
      const result = await runImport(text, settings);
      if (result.ok) {
        setDone(`${result.added}件を取り込みました`);
        reset();
      } else {
        setError(result.error);
      }
    });
  };

  const reset = () => {
    setPreview(null);
    setHeader([]);
    buffer.current = null;
    setFileName("");
    if (fileInput.current) fileInput.current.value = "";
  };

  const keepPreset = () => {
    const settings: PresetSettings = {
      assignees,
      duplicates,
      mapping: source === "csv" ? mapping : null,
      encoding,
    };
    startTransition(async () => {
      const result = await savePreset(presetName, settings);
      if (result.ok) setDone(`設定「${presetName}」を残しました`);
      else setError(result.error);
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

  const needsMapping = header.length > 0 && !preview;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">取り込み</h1>
        <p className="mt-1 text-sm text-muted">
          CSV と .ics
          から予定をまとめて登録します。取り込んだ1回ぶんはまとめて消せるので、日程が変わったときは「消して入れ直す」で直します。
        </p>
      </div>

      <ol className="list-inside list-decimal space-y-1 rounded-lg border border-border bg-surface-2 p-4 text-sm text-muted">
        <li>（あれば）前に残した設定を選ぶ</li>
        <li>ファイルを選ぶ</li>
        <li>中身を確かめて取り込む</li>
      </ol>

      {presets.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">前に残した設定</span>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <span className="text-sm font-medium">ファイル</span>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.ics,text/csv,text/calendar,text/plain"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-accent-fg"
        />
        {source === "csv" && (
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
            文字コード
            <select
              value={encoding}
              onChange={(e) => {
                const next = e.target.value as Encoding;
                setEncoding(next);
                reread({ encoding: next });
              }}
              aria-label="文字コード"
              className="rounded-md border border-border-strong bg-background px-2 py-1"
            >
              {ENCODINGS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            Excel から出したファイルは Shift_JIS のことがあります
          </span>
        )}
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

      {/* 見出しから列が分からなかったとき（FR-I02） */}
      {needsMapping && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm">
            どの列が何かを選んでください。1行目の見出しは
            <span className="text-muted"> {header.join("、")} </span>
            です。
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <label key={field.id} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0">
                  {field.label}
                  {field.required && (
                    <span className="ml-1 text-xs text-red-600">必須</span>
                  )}
                </span>
                <select
                  value={mapping?.[field.id] ?? -1}
                  onChange={(e) => setColumn(field.id, Number(e.target.value))}
                  className="min-w-0 flex-1 rounded-md border border-border-strong bg-background px-2 py-1.5 text-sm"
                >
                  <option value={-1}>—</option>
                  {header.map((h, i) => (
                    <option key={`${h}-${i}`} value={i}>
                      {h || `（${i + 1}列目）`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <PreviewTable
          preview={preview}
          duplicates={duplicates}
          onDuplicates={setDuplicates}
          excluded={excluded}
          onToggleRow={(line) =>
            setExcluded((prev) =>
              prev.includes(line)
                ? prev.filter((l) => l !== line)
                : [...prev, line],
            )
          }
          willAdd={willAdd}
          pending={pending}
          onCancel={reset}
          onCommit={commit}
        />
      )}

      {(preview || needsMapping) && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-4">
          <label className="min-w-0 flex-1 space-y-1.5">
            <span className="text-sm font-medium">
              この設定に名前を付けて残す
            </span>
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="今月の休日"
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
            />
            <span className="block text-xs text-muted">
              担当者・列の対応・重複時の動作・文字コードをまとめて残します。次からは選ぶだけで済みます
            </span>
          </label>
          <button
            type="button"
            disabled={pending || !presetName.trim()}
            onClick={keepPreset}
            className="rounded-md border border-border-strong px-4 py-2 text-sm disabled:opacity-50"
          >
            残す
          </button>
        </div>
      )}
    </section>
  );
}
