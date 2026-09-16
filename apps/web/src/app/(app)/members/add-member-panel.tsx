"use client";

import { useActionState, useState } from "react";

import { addMember, type ActionState } from "./actions";
import { Field, FormError, SubmitButton } from "@/components/form";

export function AddMemberPanel({ familyId }: { familyId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    addMember,
    null,
  );
  const [withLogin, setWithLogin] = useState(false);

  return (
    <section className="space-y-4 rounded-lg border border-border p-5">
      <div>
        <h2 className="text-sm font-semibold">メンバーを追加する</h2>
        <p className="mt-1 text-sm text-muted">
          このアプリを使えるのは、ここで追加した人だけです。
          小さいお子さんのようにログインしない家族も、
          予定の担当者として名前だけ追加できます。
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="family_id" value={familyId} />

        <div className="max-w-xs">
          <Field
            label="表示名"
            name="display_name"
            required
            placeholder="たろう"
            hint="カレンダーで予定の担当者として表示されます"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            id="with-login"
            checked={withLogin}
            onChange={(e) => setWithLogin(e.target.checked)}
            className="size-4 accent-accent"
          />
          この人がログインできるようにする
        </label>

        {withLogin && (
          <div className="space-y-4 rounded-md border border-dashed border-border p-4">
            <p className="text-xs text-muted">
              決めたメールアドレスとパスワードを本人に伝えてください。
              本人があとから変更できます。
            </p>
            <Field
              label="メールアドレス"
              name="email"
              type="email"
              required
              autoComplete="off"
            />
            <Field
              label="パスワード"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              hint="8文字以上"
            />
          </div>
        )}

        <div className="w-40">
          <SubmitButton pendingText="追加中…">追加</SubmitButton>
        </div>
      </form>

      {state && "error" in state && <FormError message={state.error} />}
      {state && "ok" in state && state.message && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {state.message}
        </p>
      )}
    </section>
  );
}
