"use client";

import { useActionState, useState } from "react";

import { addMember, type ActionState } from "./actions";
import { Field, FormError, SubmitButton } from "@/components/form";

export function AddMemberPanel({
  familyId,
  canCreateAccount,
}: {
  familyId: string;
  /** サーバーの鍵があるか。無いとアプリの中からアカウントを作れない */
  canCreateAccount: boolean;
}) {
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
              {canCreateAccount
                ? "決めたメールアドレスとパスワードを本人に伝えてください。本人があとから変更できます。"
                : "メールアドレスだけ登録します。"}
            </p>
            <Field
              label="メールアドレス"
              name="email"
              type="email"
              required
              autoComplete="off"
            />

            {canCreateAccount ? (
              <>
                <Field
                  label="パスワード"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  hint="8文字以上。空のままにすると、ここではアカウントを作りません"
                />
                <p className="text-xs text-muted">
                  パスワードを空にした場合は、上のメールアドレスをこの人の枠として登録するだけです。
                  Supabase の Authentication で同じアドレスのユーザーを作ると、
                  その時点でこの人としてログインできるようになります。
                </p>
              </>
            ) : (
              /* 鍵が無いときは、入力させてから失敗させない。
                 Supabase 側で作る道（docs/05-setup.md 3-2 B）だけを見せる。 */
              <div className="space-y-1.5 rounded-md border border-border bg-surface-2 p-3 text-xs text-muted">
                <p className="font-medium text-foreground">
                  パスワードはここでは決められません
                </p>
                <p>
                  サーバーの設定（<code>SUPABASE_SERVICE_ROLE_KEY</code>
                  ）が入っていないためです。
                  このまま追加すると「メールアドレスの枠」だけが登録されるので、
                  続けて Supabase の Authentication → Add user で
                  同じアドレスのユーザーを作ってください。
                  その時点でこの人としてログインできます。
                </p>
              </div>
            )}
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
