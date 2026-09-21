"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { isColor } from "@/lib/colors";

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
 * メンバーを登録する。入力の組み合わせで3通りになる。
 *
 *   名前だけ            … 予定の担当者として登録する（小さいお子さんなど）
 *   名前 + メール       … ログインの枠だけ用意する。
 *                         Supabase の管理画面で同じアドレスのユーザーを作ると、
 *                         このメンバーとしてログインできるようになる
 *   名前 + メール + PW  … ここでアカウントまで作る（Supabase を開かなくてよい）
 *
 * どの道でもアカウントは「先に用意したメンバー」に紐付く。
 * こちらが用意していない枠にアカウントが増えることはない。
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

  if (password && !email) {
    return { error: "パスワードを決めるには、メールアドレスも必要です" };
  }
  if (password && password.length < PASSWORD_MIN_LENGTH) {
    return {
      error: `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`,
    };
  }

  // パスワードを決めないときは、ここではアカウントを作らない。
  // メールアドレスがあれば「この人はこのアドレスでログインする」という枠だけ残し、
  // 実際のユーザー作成は Supabase の管理画面に任せる。
  if (!password) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_offline_member", {
      target_family_id: familyId,
      name,
      login_email: email || null,
    });
    if (error) return { error: toJapaneseMessage(error.message) };
    revalidatePath("/settings/members");
    return {
      ok: true,
      message: email
        ? `${name} を追加しました。Supabase で ${email} のユーザーを作ると、この人としてログインできます`
        : `${name} を追加しました`,
    };
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
      error:
        "ここでパスワードを決めるには、サーバーの設定（SUPABASE_SERVICE_ROLE_KEY）が要ります。" +
        "Vercel の Settings → Environment Variables に入れて Redeploy してください。" +
        "入れずに進めるなら、パスワードを空にして追加し、" +
        "Supabase の Authentication で同じメールアドレスのユーザーを作ってください。",
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

  revalidatePath("/settings/members");
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

  revalidatePath("/settings/members");
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

  revalidatePath("/settings/members");
  return { ok: true };
}

/**
 * 表示名を変える。
 *
 * Supabase の管理画面で作った1人目は、表示名がメールアドレスの
 * `@` より前になる。あとから直せないと困るので用意してある。
 * 更新できる範囲は RLS とトリガーが決める（本人か管理者、表示名と色だけ）。
 */
export async function renameMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const memberId = String(formData.get("member_id") ?? "");
  const name = String(formData.get("display_name") ?? "").trim();

  if (!memberId) return { error: "メンバーが特定できません" };
  if (!name) return { error: "表示名を入力してください" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .update({ display_name: name })
    .eq("id", memberId)
    .select("id");

  if (error) return { error: toJapaneseMessage(error.message) };
  if (!data || data.length === 0) {
    return { error: "この人の表示名を変える権限がありません" };
  }

  revalidatePath("/settings/members");
  revalidatePath("/schedule");
  return { ok: true };
}

/**
 * 色を変える。
 *
 * 予定の色は「最初の担当者の色」で決まるので、ここはカレンダーの見え方を
 * 決める設定でもある。本人と管理者が変えられる（範囲は RLS とトリガーが決める）。
 */
export async function setMemberColor(
  memberId: string,
  color: string,
): Promise<ActionState> {
  if (!memberId) return { error: "メンバーが特定できません" };
  if (!isColor(color)) return { error: "色の指定が正しくありません" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .update({ color })
    .eq("id", memberId)
    .select("id");

  if (error) return { error: toJapaneseMessage(error.message) };
  if (!data || data.length === 0) {
    return { error: "この人の色を変える権限がありません" };
  }

  revalidatePath("/settings/members");
  revalidatePath("/schedule");
  return { ok: true };
}

/** 家族の名前を変える。管理者だけ（RLS で決まる）。 */
export async function renameFamily(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const familyId = String(formData.get("family_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!familyId) return { error: "家族が特定できません" };
  if (!name) return { error: "家族の名前を入力してください" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("families")
    .update({ name })
    .eq("id", familyId)
    .select("id");

  if (error) return { error: toJapaneseMessage(error.message) };
  if (!data || data.length === 0) {
    return { error: "家族の名前を変える権限がありません" };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** 週の開始曜日を変える。管理者だけ（RLS で決まる） */
export async function setWeekStart(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const familyId = String(formData.get("family_id") ?? "");
  const weekStart = Number(formData.get("week_start"));

  if (!familyId) return { error: "家族が特定できません" };
  if (!Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6) {
    return { error: "曜日の指定が正しくありません" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("families")
    .update({ week_start: weekStart })
    .eq("id", familyId)
    .select("id");

  if (error) return { error: toJapaneseMessage(error.message) };
  if (!data || data.length === 0) {
    return { error: "この設定を変える権限がありません" };
  }

  revalidatePath("/schedule");
  return { ok: true };
}
