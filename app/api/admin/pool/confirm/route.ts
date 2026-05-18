import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth-guard";

// POST /api/admin/pool/confirm
// Body: { user_id: string, confirmed: boolean }
//
// Admin-only. Flips a pool_entries row to 'confirmed' (or back to
// 'claimed' if confirmed=false — useful if a confirmation was a
// mistake). Mirrors the audit + service-role pattern from
// app/api/admin/moderate/route.ts (APT-40).

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const guard = await requireAdmin(supabase);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const operator = guard.user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const r = (body as Record<string, unknown> | null) ?? {};
  const user_id = r.user_id;
  if (typeof user_id !== "string" || user_id.length === 0) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }
  if (typeof r.confirmed !== "boolean") {
    return NextResponse.json(
      { error: "confirmed must be boolean" },
      { status: 400 },
    );
  }

  // Service-role bypasses RLS so the admin can flip another user's row.
  const admin = createServiceRoleClient();

  const { data: target, error: lookupErr } = await admin
    .from("pool_entries")
    .select("status, method")
    .eq("user_id", user_id)
    .maybeSingle();
  if (lookupErr) {
    console.error("[api/admin/pool/confirm] lookup failed:", lookupErr);
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json(
      { error: "no pool entry for that user" },
      { status: 404 },
    );
  }

  const update = r.confirmed
    ? {
        status: "confirmed" as const,
        confirmed_at: new Date().toISOString(),
        confirmed_by: operator.id,
      }
    : {
        status: "claimed" as const,
        confirmed_at: null,
        confirmed_by: null,
      };

  const { error } = await admin
    .from("pool_entries")
    .update(update)
    .eq("user_id", user_id);
  if (error) {
    console.error("[api/admin/pool/confirm] update failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  console.warn(
    `[admin] ${operator.id} ${r.confirmed ? "confirmed" : "un-confirmed"} pool entry for ${user_id} (method=${target.method}, was=${target.status})`,
  );
  return NextResponse.json({ ok: true, status: update.status });
}
