"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

export type ActionState =
  { error: string } | { ok: true; message?: string } | null;

const PASSWORD_MIN_LENGTH = 8;

function toJapaneseMessage(message: string): string {
  if (/already been registered|already registered/i.test(message)) {
    return "このメールアドレスはすでに使われています";
  }
  if (/Password should be at least/i.test(message)) {
    return `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`;
  }
  if (/MEMBER_NOT_AVAILABLE/.test(message)) {
    return "このメンバーにはログインを設定できません";
  }
  if (/MEMBER_REQUIRED/.test(message)) {
    return "アカウントは家族の管理者が登録します";
  }
  if (/invalid format|Unable to validate email/i.test(message)) {
    return "メールアドレスの形式が正しくありません";
  }
  return message;
}

/**
 * メンバーを登録する。
 *
 * メールアドレスとパスワードを入れた場合は、そのメンバーにログイン用の
 * アカウントも作る。入れない場合は、予定の担当者として名前だけを登録する
 * （小さいお子さんなど）。
 *
 * アカウントは必ず「先に用意したメンバー」に紐付く。
 * 招待リンクのように、こちらが用意していない枠が増えることはない。
 */
export async function addMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const familyId = String(formData.get("family_id") ?? "");
  const name = String(formData.get("display_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!familyId) return { error: "家族が特定できません" };
  if (!name) return { error: "表示名を入力してください" };

  const wantsAccount = Boolean(email || password);
  if (wantsAccount && (!email || !password)) {
    return {
      error:
        "ログインを設定するには、メールアドレスとパスワードの両方が必要です",
    };
  }
  if (wantsAccount && password.length < PASSWORD_MIN_LENGTH) {
    return {
      error: `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`,
    };
  }

  const supabase = await createClient();

  // ログインなしのメンバーは、これだけで終わり。
  if (!wantsAccount) {
    const { error } = await supabase.rpc("add_offline_member", {
      target_family_id: familyId,
      name,
    });
    if (error) return { error: toJapaneseMessage(error.message) };
    revalidatePath("/members");
    return { ok: true, message: `${name} を追加しました` };
  }

  return attachAccount(familyId, null, name, email, password);
}

/** すでにいるメンバー（ログインなし）に、あとからログインを設定する。 */
export async function enableLogin(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const familyId = String(formData.get("family_id") ?? "");
  const memberId = String(formData.get("member_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!familyId || !memberId) return { error: "メンバーが特定できません" };
  if (!email || !password) {
    return { error: "メールアドレスとパスワードを入力してください" };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      error: `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`,
    };
  }

  return attachAccount(familyId, memberId, null, email, password);
}

async function attachAccount(
  familyId: string,
  memberId: string | null,
  name: string | null,
  email: string,
  password: string,
): Promise<ActionState> {
  if (!hasServiceRoleKey()) {
    return {
      error: "サーバーの設定が足りません（SUPABASE_SERVICE_ROLE_KEY が未設定）",
    };
  }

  const supabase = await createClient();

  // 「この相手にアカウントを付けてよいか」は、呼び出し元の権限で確かめる。
  // 管理者でなければここで失敗する。
  const { data: preparedId, error: prepareError } = await supabase.rpc(
    "prepare_member_for_account",
    { target_family_id: familyId, name, target_member_id: memberId },
  );
  if (prepareError) return { error: toJapaneseMessage(prepareError.message) };

  // ユーザーの作成は管理APIでしか行えない。
  // metadata の member_id を見て、DBのトリガーが上で用意した行に紐付ける。
  const admin = createAdminClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name ?? undefined, member_id: preparedId },
  });

  if (createError) {
    // アカウントが作れなかったとき、名前だけのメンバーが残る。
    // 消さずに残し、あとからログインを設定し直せるようにする。
    return { error: toJapaneseMessage(createError.message) };
  }

  revalidatePath("/members");
  return { ok: true, message: `${email} でログインできるようになりました` };
}

export async function deactivateMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const memberId = String(formData.get("member_id") ?? "");
  if (!memberId) return { error: "メンバーが特定できません" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_member", {
    target_member_id: memberId,
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  revalidatePath("/members");
  return { ok: true };
}

export async function reactivateMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const memberId = String(formData.get("member_id") ?? "");
  if (!memberId) return { error: "メンバーが特定できません" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reactivate_member", {
    target_member_id: memberId,
  });
  if (error) return { error: toJapaneseMessage(error.message) };

  revalidatePath("/members");
  return { ok: true };
}
