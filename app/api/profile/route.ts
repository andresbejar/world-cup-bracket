import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth-guard";
import { describeError, validateUsername } from "@/lib/username";

// POST /api/profile
// Body: { username: string }
//
// Updates the caller's public.users.username. Server-side re-validates
// with lib/username so the same rules apply to the auth-callback default
// and the profile-page edit. Banned users are blocked by the guard.
// Returns 409 on uniqueness collision.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const guard = await requireActiveUser(supabase);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { user } = guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const raw = (body as { username?: unknown } | null)?.username;
  const check = validateUsername(raw);
  if (!check.ok) {
    return NextResponse.json(
      { error: describeError(check.error), reason: check.error },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("users")
    .update({ username: check.username })
    .eq("id", user.id);
  if (error) {
    // unique violation on users.username
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "That username is taken." },
        { status: 409 },
      );
    }
    console.error("[api/profile] update failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, username: check.username });
}
