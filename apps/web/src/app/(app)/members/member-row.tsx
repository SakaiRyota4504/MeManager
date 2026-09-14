"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { Member } from "@/lib/supabase/types";
import {
  deactivateMember,
  reactivateMember,
  type ActionState,
} from "./actions";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理者",
  member: "メンバー",
  viewer: "閲覧のみ",
};

export function MemberRow({
  member,
  isSelf,
  canManage,
}: {
  member: Member;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    member.is_active ? deactivateMember : reactivateMember,
    null,
  );

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
        {member.user_id === null && <span>アカウント未登録</span>}
        <span>{ROLE_LABEL[member.role] ?? member.role}</span>

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
