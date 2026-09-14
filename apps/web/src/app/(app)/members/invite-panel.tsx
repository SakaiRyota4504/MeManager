"use client";

import { useActionState, useState } from "react";

import { createInvitation, type InviteState } from "./actions";
import { Field, FormError, SubmitButton } from "@/components/form";

export function InvitePanel({ familyId }: { familyId: string }) {
  const [state, formAction] = useActionState<InviteState, FormData>(
    createInvitation,
    null,
  );
  const [copied, setCopied] = useState(false);

  const url = state && "url" in state ? state.url : null;

  return (
    <section className="space-y-4 rounded-lg border border-border p-5">
      <div>
        <h2 className="text-sm font-semibold">家族を招待する</h2>
        <p className="mt-1 text-sm text-muted">
          このアプリは招待がないとアカウントを作れません。
          リンクを発行して、招待したい人に渡してください。有効期限は7日間です。
        </p>
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <FormError
          message={state && "error" in state ? state.error : undefined}
        />
        <input type="hidden" name="family_id" value={familyId} />
        <div className="min-w-56 flex-1">
          <Field
            label="宛先のメールアドレス"
            name="email"
            type="email"
            placeholder="haha@example.com"
            hint="指定すると、このアドレスでしか使えなくなります。リンクが転送されても他人は参加できません"
          />
        </div>
        <div className="w-44">
          <SubmitButton pendingText="発行中…">招待リンクを発行</SubmitButton>
        </div>
      </form>

      {url && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs text-muted">
            このリンクは一度しか表示されません。今すぐ控えてください。
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 font-mono text-xs"
            />
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-sm"
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
