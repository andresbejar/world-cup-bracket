import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth-guard";
import { checkRoundLock } from "@/lib/lock-check";

// POST /api/third-place-assignments
// Body: { slot_id: string; team_id: string | null }
//
// team_id !== null → upsert on (user_id, slot_id)
// team_id === null → delete the row (user is clearing their pick)
//
// Third-place picks lock at R32's deadline (4hr before R32 starts) —
// after that, FIFA has settled which group's third-place team lands
// where and the bet is decided.
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
  const parsed = parseBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Third-place picks are gated by the R32 round's lock state.
  const { data: round, error: roundErr } = await supabase
    .from("rounds")
    .select("locked_at, deadline_at")
    .eq("id", "r32")
    .maybeSingle();
  if (roundErr) {
    console.error("[api/third-place-assignments] round lookup failed:", roundErr);
    return NextResponse.json({ error: roundErr.message }, { status: 500 });
  }
  if (!round) {
    return NextResponse.json(
      { error: "R32 round not configured" },
      { status: 500 },
    );
  }
  const lock = checkRoundLock(round, Date.now());
  if (!lock.editable) {
    return NextResponse.json(
      {
        error:
          lock.reason === "locked"
            ? "third-place picks are locked — admin closed predictions"
            : "third-place picks lock at R32's deadline — too late to change",
        reason: lock.reason,
      },
      { status: 403 },
    );
  }

  if (parsed.team_id == null) {
    const { error } = await supabase
      .from("predicted_third_place_assignments")
      .delete()
      .eq("user_id", user.id)
      .eq("slot_id", parsed.slot_id);
    if (error) {
      console.error("[api/third-place-assignments] delete failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, cleared: true });
  }

  const { error } = await supabase
    .from("predicted_third_place_assignments")
    .upsert(
      {
        user_id: user.id,
        slot_id: parsed.slot_id,
        predicted_team_id: parsed.team_id,
      },
      { onConflict: "user_id,slot_id" },
    );
  if (error) {
    // Hits the (user_id, predicted_team_id) unique constraint when a
    // client tries to assign the same team to two slots — UI prevents
    // this, but we surface a clean 409 if it sneaks through.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "team already picked for another slot" },
        { status: 409 },
      );
    }
    console.error("[api/third-place-assignments] upsert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

interface ParsedBody {
  slot_id: string;
  team_id: string | null;
}

function parseBody(raw: unknown): ParsedBody | { error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { error: "expected object body" };
  }
  const r = raw as Record<string, unknown>;
  const slot_id = r.slot_id;
  if (typeof slot_id !== "string" || slot_id.length === 0) {
    return { error: "slot_id required" };
  }
  const team_id = r.team_id;
  if (team_id !== null && (typeof team_id !== "string" || team_id.length === 0)) {
    return { error: "team_id must be string or null" };
  }
  return { slot_id, team_id: (team_id as string | null) ?? null };
}
