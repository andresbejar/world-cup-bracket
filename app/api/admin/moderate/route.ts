import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth-guard";
import { describeError, validateUsername } from "@/lib/username";

// POST /api/admin/moderate
// Body: { user_id: string, action: "ban" | "unban" | "rename", username?: string }
//
// Admin-only moderation actions. Gating:
//   - caller must be authenticated AND their auth.uid() must appear in
//     the ADMIN_USER_IDS env list (lib/auth-guard.isAdminUserId).
//   - service-role client performs the actual mutation so the admin can
//     update other users' rows (RLS users_update_own would otherwise
//     reject — it only permits self-update).
//
// Audit: writes a one-line log per action; for ~50 family members that's
// enough. A proper audit table is post-v1.

type Action = "ban" | "unban" | "rename";

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
  const parsed = parseBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Service-role bypasses RLS for cross-user mutations.
  const admin = createServiceRoleClient();

  // Verify the target exists so we return a clean 404 instead of
  // silently no-oping on an unknown id.
  const { data: target, error: lookupErr } = await admin
    .from("users")
    .select("id, username, is_banned")
    .eq("id", parsed.user_id)
    .maybeSingle();
  if (lookupErr) {
    console.error("[api/admin/moderate] lookup failed:", lookupErr);
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  if (parsed.action === "rename") {
    const { error } = await admin
      .from("users")
      .update({ username: parsed.username })
      .eq("id", parsed.user_id);
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "That username is taken." },
          { status: 409 },
        );
      }
      console.error("[api/admin/moderate] rename failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.warn(
      `[admin] ${operator.id} renamed ${parsed.user_id}: ${target.username} → ${parsed.username}`,
    );
    return NextResponse.json({ ok: true, username: parsed.username });
  }

  const is_banned = parsed.action === "ban";
  const { error } = await admin
    .from("users")
    .update({ is_banned })
    .eq("id", parsed.user_id);
  if (error) {
    console.error("[api/admin/moderate] ban-toggle failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  console.warn(
    `[admin] ${operator.id} ${is_banned ? "banned" : "unbanned"} ${parsed.user_id} (was banned=${target.is_banned})`,
  );
  return NextResponse.json({ ok: true, is_banned });
}

interface ParsedBody {
  user_id: string;
  action: Action;
  username?: string;
}

function parseBody(raw: unknown): ParsedBody | { error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { error: "expected object body" };
  }
  const r = raw as Record<string, unknown>;
  const user_id = r.user_id;
  if (typeof user_id !== "string" || user_id.length === 0) {
    return { error: "user_id required" };
  }
  const action = r.action;
  if (action !== "ban" && action !== "unban" && action !== "rename") {
    return { error: "action must be ban | unban | rename" };
  }
  if (action === "rename") {
    const check = validateUsername(r.username);
    if (!check.ok) {
      return { error: describeError(check.error) };
    }
    return { user_id, action, username: check.username };
  }
  return { user_id, action };
}
