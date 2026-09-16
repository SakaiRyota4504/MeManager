"use client";

import { useActionState } from "react";

import { signIn, type FormState } from "@/lib/auth/actions";
import { Field, FormError, SubmitButton } from "@/components/form";

export default function LoginPage() {
  const [state, formAction] = useActionState<FormState, FormData>(signIn, null);

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <FormError message={state?.error} />
        <Field
          label="メールアドレス"
          name="email"
          type="email"
          required
          autoComplete="email"
        />
        <Field
          label="パスワード"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
        <SubmitButton pendingText="ログイン中…">ログイン</SubmitButton>
      </form>

      <p className="text-center text-xs text-muted">
        アカウントは家族の管理者が用意します。
        ログインできないときは管理者に確認してください。
      </p>
    </div>
  );
}
