import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AddMemberPanel } from "./add-member-panel";
import { FamilyName } from "./family-name";
import { MemberRow } from "./member-row";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const isAdmin = session.member.role === "admin";

  // RLS により、自分の家族のメンバーだけが返る。
  // family_id での絞り込みを書かなくても他の家族は見えない。
  const { data: allMembers } = await supabase
    .from("members")
    .select("*")
    .order("created_at");

  const active = allMembers?.filter((m) => m.is_active) ?? [];
  const inactive = allMembers?.filter((m) => !m.is_active) ?? [];

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="space-y-1">
          <FamilyName
            familyId={session.family.id}
            name={session.family.name}
            canManage={isAdmin}
          />
          <p className="text-sm text-muted">{active.length} 人のメンバー</p>
        </div>

        <ul className="divide-y divide-border rounded-lg border border-border">
          {active.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isSelf={member.id === session.member.id}
              canManage={isAdmin}
              familyId={session.family.id}
            />
          ))}
        </ul>

        {!isAdmin && (
          <p className="text-xs text-muted">
            メンバーの追加や削除は、家族の管理者だけが行えます。
          </p>
        )}
      </section>

      {isAdmin && <AddMemberPanel familyId={session.family.id} />}

      {inactive.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">外したメンバー</h2>
            <p className="mt-1 text-sm text-muted">
              過去の予定の担当者として残っています。データは見られません。
            </p>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {inactive.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isSelf={false}
                canManage={isAdmin}
                familyId={session.family.id}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
