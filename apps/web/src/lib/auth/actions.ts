"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

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
  // DB のトリガーが投げる印。公開サインアップを止めた最後の砦。
  if (/INVITATION_REQUIRED/.test(message)) {
    return "アカウントの作成には招待が必要です。家族の管理者に招待リンクを発行してもらってください";
  }
  if (/INVITATION_INVALID/.test(message)) {
    return "招待が使えません。期限切れ・使用済みか、宛先のメールアドレスが違います";
  }
  if (/Signups not allowed/i.test(message)) {
    return "アカウントの作成には招待が必要です";
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
  if (!hasServiceRoleKey()) {
    return {
      error: "サーバーの設定が足りません（SUPABASE_SERVICE_ROLE_KEY が未設定）",
    };
  }

  const supabase = await createClient();

  // 招待が無い場合に作れるのは、まだ家族が1つも無いとき（最初の1人）だけ。
  // ここで弾くのは分かりやすいエラーを出すため。実際の強制は DB のトリガー。
  if (!invitationToken) {
    const { data: isBootstrap } = await supabase.rpc("is_bootstrap");
    if (!isBootstrap) {
      return {
        error:
          "アカウントの作成には招待が必要です。家族の管理者に招待リンクを発行してもらってください",
      };
    }
  }

  // 公開サインアップは止めてあるので、管理APIでユーザーを作る。
  // 招待の検証は DB のトリガーが行い、条件を満たさなければ作成ごと失敗する。
  const admin = createAdminClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    // 家族内で使うため、確認メールは挟まない。
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
      family_name: familyName || undefined,
      invitation_token: invitationToken || undefined,
    },
  });

  if (createError) return { error: toJapaneseMessage(createError.message) };

  // 作成しただけではログイン状態にならないので、続けてサインインする。
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) return { error: toJapaneseMessage(signInError.message) };

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
