"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import type { Member } from "@/lib/supabase/types";
import {
  deactivateMember,
  enableLogin,
  reactivateMember,
  type ActionState,
} from "./actions";
import { Field, FormError, SubmitButton } from "@/components/form";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理者",
  member: "メンバー",
  viewer: "閲覧のみ",
};

export function MemberRow({
  member,
  isSelf,
  canManage,
  familyId,
}: {
  member: Member;
  isSelf: boolean;
  canManage: boolean;
  familyId: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    member.is_active ? deactivateMember : reactivateMember,
    null,
  );
  const [loginState, loginAction] = useActionState<ActionState, FormData>(
    enableLogin,
    null,
  );
  const [opening, setOpening] = useState(false);

  const canEnableLogin =
    canManage && member.is_active && member.user_id === null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <span className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="inline-block size-3 shrink-0 rounded-full"
          style={{ backgroundColor: member.color }}
        />
        <span
          className={`text-sm font-medium ${member.is_active ? "" : "text-muted"}`}
        >
          {member.display_name}
        </span>
        {isSelf && <span className="text-xs text-muted">（自分）</span>}
      </span>

      <span className="flex items-center gap-3 text-xs text-muted">
        {member.user_id === null && <span>ログインなし</span>}
        <span>{ROLE_LABEL[member.role] ?? member.role}</span>

        {canEnableLogin && !opening && (
          <button
            type="button"
            onClick={() => setOpening(true)}
            className="underline"
          >
            ログインを設定
          </button>
        )}

        {canManage && !isSelf && (
          <form action={formAction}>
            <input type="hidden" name="member_id" value={member.id} />
            <RowButton active={member.is_active} />
          </form>
        )}
      </span>

      {state && "error" in state && (
        <p role="alert" className="w-full text-xs text-red-600">
          {state.error}
        </p>
      )}

      {opening && (
        <form
          action={loginAction}
          className="w-full space-y-3 rounded-md border border-dashed border-border p-4"
        >
          <p className="text-xs text-muted">
            {member.display_name} のログインを設定します。
            決めた内容を本人に伝えてください。
          </p>
          <input type="hidden" name="family_id" value={familyId} />
          <input type="hidden" name="member_id" value={member.id} />
          <Field label="メールアドレス" name="email" type="email" required />
          <Field
            label="パスワード"
            name="password"
            type="password"
            required
            hint="8文字以上"
          />
          <FormError
            message={
              loginState && "error" in loginState ? loginState.error : undefined
            }
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpening(false)}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              やめる
            </button>
            <div className="w-40">
              <SubmitButton pendingText="設定中…">設定する</SubmitButton>
            </div>
          </div>
        </form>
      )}
    </li>
  );
}

function RowButton({ active }: { active: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="underline disabled:opacity-50"
    >
      {pending ? "…" : active ? "外す" : "戻す"}
    </button>
  );
}
