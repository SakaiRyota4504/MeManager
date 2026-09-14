"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";

export type InviteState = { url: string } | { error: string } | null;

export async function createInvitation(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const familyId = String(formData.get("family_id") ?? "");
  if (!familyId) return { error: "家族が特定できません" };

  const supabase = await createClient();

  // 権限の確認は create_invitation() の中で行う。
  // 管理者以外が呼ぶとエラーになる。
  const { data: token, error } = await supabase.rpc("create_invitation", {
    target_family_id: familyId,
  });

  if (error) return { error: error.message };

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";

  return { url: `${protocol}://${host}/invite/${token}` };
}
