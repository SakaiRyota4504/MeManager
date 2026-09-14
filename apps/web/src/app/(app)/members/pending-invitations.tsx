"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { Invitation } from "@/lib/supabase/types";
import { revokeInvitation, type ActionState } from "./actions";

export function PendingInvitations({
  invitations,
}: {
  invitations: Invitation[];
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">発行済みの招待</h2>
        <p className="mt-1 text-sm text-muted">
          まだ使われていない招待です。渡し間違えたときは取り消してください。
        </p>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {invitations.map((invitation) => (
          <InvitationRow key={invitation.id} invitation={invitation} />
        ))}
      </ul>
    </section>
  );
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    revokeInvitation,
    null,
  );

  const expires = new Date(invitation.expires_at).toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
      <span>{invitation.email ?? "宛先の指定なし（誰でも使える）"}</span>
      <span className="flex items-center gap-3 text-xs text-muted">
        <span>{expires} まで</span>
        <form action={formAction}>
          <input type="hidden" name="invitation_id" value={invitation.id} />
          <RevokeButton />
        </form>
      </span>
      {state && "error" in state && (
        <p role="alert" className="w-full text-xs text-red-600">
          {state.error}
        </p>
      )}
    </li>
  );
}

function RevokeButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="underline disabled:opacity-50"
    >
      {pending ? "…" : "取り消す"}
    </button>
  );
}
