"use server";

/**
 * ログインとログアウト。**アカウントを作る操作はここには無い。**
 *
 * アカウントを用意するのは家族の管理者だけで、
 * メンバー画面（`/members`）か Supabase の管理画面から行う。
 * 迷い込んだ人が自分で作れる口は、どこにも置かない。
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { HOME } from "@/lib/nav/features";

export type FormState = { error: string } | null;

const PASSWORD_MIN_LENGTH = 8;

/** Supabase のエラーメッセージを、日本語の短い説明に置き換える。 */
function toJapaneseMessage(message: string): string {
  if (/Invalid login credentials/i.test(message)) {
    return "メールアドレスかパスワードが違います";
  }
  if (/User already registered/i.test(message)) {
    return "このメールアドレスはすでに登録されています";
  }
  if (/Email not confirmed/i.test(message)) {
    return "メールアドレスの確認が済んでいません";
  }
  if (/Password should be at least/i.test(message)) {
    return `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`;
  }
  return message;
}

export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "メールアドレスとパスワードを入力してください" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: toJapaneseMessage(error.message) };

  revalidatePath("/", "layout");
  redirect(HOME);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
