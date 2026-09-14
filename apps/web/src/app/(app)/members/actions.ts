"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type InviteState = { url: string } | { error: string } | null;
export type ActionState = { error: string } | { ok: true } | null;

/** 招待リンクを発行する。権限の確認は create_invitation() の中で行う。 */
export async function createInvitation(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const familyId = String(formData.get("family_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  if (!familyId) return { error: "家族が特定できません" };

  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("create_invitation", {
    target_family_id: familyId,
    target_email: email || null,
  });

  if (error) return { error: error.message };

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const url = `${isLocal ? "http" : "https"}://${host}/invite/${token}`;

  revalidatePath("/members");
  return { url };
}

export async function revokeInvitation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("invitation_id") ?? "");
  if (!id) return { error: "招待が特定できません" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", {
    invitation_id: id,
  });
  if (error) return { error: error.message };

  revalidatePath("/members");
  return { ok: true };
}

/** アカウントを持たないメンバー（幼い子どもなど）を追加する。 */
export async function addOfflineMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const familyId = String(formData.get("family_id") ?? "");
  const name = String(formData.get("display_name") ?? "").trim();
  if (!familyId) return { error: "家族が特定できません" };
  if (!name) return { error: "表示名を入力してください" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_offline_member", {
    target_family_id: familyId,
    name,
  });
  if (error) return { error: error.message };

  revalidatePath("/members");
  return { ok: true };
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
  if (error) return { error: error.message };

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
  if (error) return { error: error.message };

  revalidatePath("/members");
  return { ok: true };
}
