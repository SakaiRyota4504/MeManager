import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getSession } from "@/lib/auth/session";
import { InviteForms } from "./forms";

export const dynamic = "force-dynamic";

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  if (!hasSupabaseEnv()) redirect("/");

  const { token } = await props.params;

  // 招待を受ける人はまだその家族のメンバーではないため RLS では読めない。
  // peek_invitation() が security definer で家族名だけを返す。
  const supabase = await createClient();
  const { data } = await supabase.rpc("peek_invitation", { token });
  const invitation = data?.[0];

  if (!invitation || !invitation.is_valid) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm">
          この招待リンクは使えません。
          <br />
          期限が切れているか、すでに使われています。
        </p>
        <p className="text-sm text-muted">
          招待した人に、新しいリンクを発行してもらってください。
        </p>
        <Link href="/login" className="text-sm text-accent underline">
          ログイン画面へ
        </Link>
      </div>
    );
  }

  const session = await getSession();

  return (
    <InviteForms
      token={token}
      familyName={invitation.family_name}
      signedInAs={session?.member.display_name ?? null}
    />
  );
}
