import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ImportPanel } from "./import-panel";
import { BatchList } from "./batch-list";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: members }, { data: batches }] = await Promise.all([
    supabase
      .from("members")
      .select("*")
      .eq("is_active", true)
      .order("created_at"),
    supabase
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const nameOf = new Map((members ?? []).map((m) => [m.id, m.display_name]));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-10 overflow-y-auto px-6 py-8">
      <ImportPanel members={members ?? []} selfMemberId={session.member.id} />
      <BatchList
        batches={(batches ?? []).map((b) => ({
          ...b,
          by: b.created_by ? (nameOf.get(b.created_by) ?? null) : null,
        }))}
      />
    </div>
  );
}
