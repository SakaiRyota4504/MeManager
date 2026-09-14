"use client";

import Link from "next/link";
import { useActionState } from "react";

import { acceptInvitation, signUp, type FormState } from "@/lib/auth/actions";
import { Field, FormError, SubmitButton } from "@/components/form";

export function InviteForms({
  token,
  familyName,
  emailHint,
  signedInAs,
}: {
  token: string;
  familyName: string;
  emailHint: string | null;
  signedInAs: string | null;
}) {
  const [signUpState, signUpAction] = useActionState<FormState, FormData>(
    signUp,
    null,
  );
  const [acceptState, acceptAction] = useActionState<FormState, FormData>(
    acceptInvitation,
    null,
  );

  // すでにログインしている場合は、参加するだけでよい。
  if (signedInAs) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          <strong>{familyName}</strong> に招待されています。
        </p>
        <form action={acceptAction} className="space-y-4">
          <FormError message={acceptState?.error} />
          <input type="hidden" name="token" value={token} />
          <SubmitButton pendingText="参加中…">
            {signedInAs} として参加する
          </SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-sm">
        <p>
          <strong>{familyName}</strong> に招待されています。
          <br />
          アカウントを作って参加してください。
        </p>
        {emailHint && (
          <p className="text-xs text-muted">
            この招待は <strong>{emailHint}</strong> 宛てです。
            このメールアドレスでのみ登録できます。
          </p>
        )}
      </div>

      <form action={signUpAction} className="space-y-4">
        <FormError message={signUpState?.error} />
        <input type="hidden" name="invitation_token" value={token} />
        <Field
          label="あなたの表示名"
          name="display_name"
          required
          placeholder="母"
          hint="カレンダーで予定の担当者として表示されます"
        />
        <Field
          label="メールアドレス"
          name="email"
          type="email"
          required
          autoComplete="email"
          hint={
            emailHint
              ? "招待された宛先と同じアドレスを入力してください"
              : undefined
          }
        />
        <Field
          label="パスワード"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          hint="8文字以上"
        />
        <SubmitButton pendingText="参加中…">参加する</SubmitButton>
      </form>

      <p className="text-center text-sm text-muted">
        すでにアカウントがある場合は{" "}
        <Link href="/login" className="text-accent underline">
          ログイン
        </Link>
        してから、もう一度このリンクを開いてください。
      </p>
    </div>
  );
}
