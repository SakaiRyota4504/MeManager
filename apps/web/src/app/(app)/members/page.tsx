import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { InvitePanel } from "./invite-panel";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理者",
  member: "メンバー",
  viewer: "閲覧のみ",
};

export default async function MembersPage() {
  const session = await requireSession();
  const supabase = await createClient();

  // RLS により、自分の家族のメンバーだけが返る。
  // family_id での絞り込みを書かなくても他の家族は見えない。
  const { data: members } = await supabase
    .from("members")
    .select("*")
    .eq("is_active", true)
    .order("created_at");

  const isAdmin = session.member.role === "admin";

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h1 className="text-xl font-bold">{session.family.name}</h1>
          <p className="text-sm text-muted">
            {members?.length ?? 0} 人のメンバー
          </p>
        </div>

        <ul className="divide-y divide-border rounded-lg border border-border">
          {members?.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="inline-block size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: member.color }}
                />
                <span className="text-sm font-medium">
                  {member.display_name}
                </span>
                {member.id === session.member.id && (
                  <span className="text-xs text-muted">（自分）</span>
                )}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted">
                {member.user_id === null && <span>アカウント未登録</span>}
                <span>{ROLE_LABEL[member.role] ?? member.role}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && <InvitePanel familyId={session.family.id} />}
    </div>
  );
}
