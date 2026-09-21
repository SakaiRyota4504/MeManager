import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ImportPanel } from "./import-panel";
import type { Preset } from "./actions";
import { BatchList } from "./batch-list";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: members }, { data: batches }, { data: presets }] =
    await Promise.all([
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
      supabase.from("import_presets").select("*").order("name"),
    ]);

  const nameOf = new Map((members ?? []).map((m) => [m.id, m.display_name]));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-10 overflow-y-auto px-6 py-8">
      <ImportPanel
        members={members ?? []}
        selfMemberId={session.member.id}
        presets={(presets ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          settings: p.settings as Preset["settings"],
        }))}
      />
      <BatchList
        batches={(batches ?? []).map((b) => ({
          ...b,
          by: b.created_by ? (nameOf.get(b.created_by) ?? null) : null,
        }))}
      />
    </div>
  );
}
