import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { Family, Member } from "@/lib/supabase/types";

export type Session = {
  userId: string;
  email: string | null;
  member: Member;
  family: Family;
};

/**
 * ログイン中のユーザーと、所属する家族を取得する。
 * 未ログインなら null を返す。
 */
export async function getSession(): Promise<Session | null> {
  if (!hasSupabaseEnv()) return null;

  const supabase = await createClient();

  // getUser() は毎回サーバーに問い合わせて検証する。
  // getSession() は Cookie の内容をそのまま信じるので、認可の判断には使わない。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!member) return null;

  const { data: family } = await supabase
    .from("families")
    .select("*")
    .eq("id", member.family_id)
    .maybeSingle();

  if (!family) return null;

  return { userId: user.id, email: user.email ?? null, member, family };
}

/** ログインを必須にする。未ログインならログイン画面へ送る。 */
export async function requireSession(): Promise<Session> {
  // セットアップが済んでいないうちは、ログイン画面ではなく説明のある
  // トップページへ送る。ログインしようがない状態でフォームを見せても仕方がない。
  if (!hasSupabaseEnv()) redirect("/");

  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
