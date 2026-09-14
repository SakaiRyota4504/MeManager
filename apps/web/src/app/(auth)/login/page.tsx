"use client";

import Link from "next/link";
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

      <p className="text-center text-sm text-muted">
        はじめて使う場合は{" "}
        <Link href="/signup" className="text-accent underline">
          アカウントを作る
        </Link>
      </p>
    </div>
  );
}
