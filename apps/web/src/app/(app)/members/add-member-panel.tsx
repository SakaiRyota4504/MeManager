"use client";

import { useActionState } from "react";

import { addOfflineMember, type ActionState } from "./actions";
import { Field, FormError, SubmitButton } from "@/components/form";

export function AddMemberPanel({ familyId }: { familyId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    addOfflineMember,
    null,
  );

  return (
    <section className="space-y-4 rounded-lg border border-border p-5">
      <div>
        <h2 className="text-sm font-semibold">
          アカウントを持たないメンバーを追加する
        </h2>
        <p className="mt-1 text-sm text-muted">
          小さいお子さんなど、ログインしない家族を予定の担当者として登録できます。
          あとから招待してアカウントを紐付けることもできます。
        </p>
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="family_id" value={familyId} />
        <div className="min-w-48 flex-1">
          <Field
            label="表示名"
            name="display_name"
            required
            placeholder="たろう"
          />
        </div>
        <div className="w-36">
          <SubmitButton pendingText="追加中…">追加</SubmitButton>
        </div>
      </form>

      <FormError
        message={state && "error" in state ? state.error : undefined}
      />
    </section>
  );
}
