"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signUp, type FormState } from "@/lib/auth/actions";
import { Field, FormError, SubmitButton } from "@/components/form";

export default function SignUpPage() {
  const [state, formAction] = useActionState<FormState, FormData>(signUp, null);

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <FormError message={state?.error} />
        <Field
          label="あなたの表示名"
          name="display_name"
          required
          placeholder="父"
          hint="カレンダーで予定の担当者として表示されます"
        />
        <Field
          label="家族の名前"
          name="family_name"
          placeholder="さかい家"
          hint="未入力なら「◯◯ の家族」になります"
        />
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
          autoComplete="new-password"
          hint="8文字以上"
        />
        <SubmitButton pendingText="作成中…">アカウントを作る</SubmitButton>
      </form>

      <p className="text-center text-sm text-muted">
        すでにアカウントがある場合は{" "}
        <Link href="/login" className="text-accent underline">
          ログイン
        </Link>
      </p>
    </div>
  );
}
