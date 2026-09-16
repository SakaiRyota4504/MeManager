"use client";

import { useState, useTransition } from "react";

import { renameFamily } from "./actions";
import { Field, FormError, SubmitButton } from "@/components/form";

/**
 * 家族の名前。
 *
 * 1人目を Supabase の管理画面で作ると、名前が「（メールの@より前） の家族」に
 * なる。ここで直せるようにしておく。
 */
export function FamilyName({
  familyId,
  name,
  canManage,
}: {
  familyId: string;
  name: string;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [, startTransition] = useTransition();

  // 成功したら畳む。useActionState ではなくここで結果を受けるのは、
  // 「閉じる」という状態の変更が結果に付いてくるため。
  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await renameFamily(null, formData);
      if (result && "error" in result) {
        setError(result.error);
      } else {
        setError(undefined);
        setEditing(false);
      }
    });
  }

  if (!editing) {
    return (
      <h1 className="flex flex-wrap items-baseline gap-2 text-xl font-bold">
        {name}
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-normal text-muted underline"
          >
            名前を変える
          </button>
        )}
      </h1>
    );
  }

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="family_id" value={familyId} />
      <div className="w-48">
        <Field label="家族の名前" name="name" required defaultValue={name} />
      </div>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded-md border border-border px-3 py-2 text-sm"
      >
        やめる
      </button>
      <div className="w-28">
        <SubmitButton pendingText="変更中…">変える</SubmitButton>
      </div>
      <FormError message={error} />
    </form>
  );
}
