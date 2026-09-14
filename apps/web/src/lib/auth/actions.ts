"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

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
  redirect("/members");
}

export async function signUp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();
  const familyName = String(formData.get("family_name") ?? "").trim();
  const invitationToken = String(formData.get("invitation_token") ?? "").trim();

  if (!email || !password || !displayName) {
    return { error: "表示名・メールアドレス・パスワードを入力してください" };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      error: `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // 家族とメンバーの作成は、このメタデータを見て DB のトリガーが行う。
      // アプリ側で複数回に分けて書き込むと、途中で失敗したときに
      // 中途半端な状態が残る。
      data: {
        display_name: displayName,
        family_name: familyName || undefined,
        invitation_token: invitationToken || undefined,
      },
    },
  });

  if (error) return { error: toJapaneseMessage(error.message) };

  revalidatePath("/", "layout");
  redirect("/members");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function acceptInvitation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: "招待リンクが正しくありません" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", { token });

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/members");
}
