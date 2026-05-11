import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/third-place-assignments
// Body: { slot_id: string; team_id: string | null }
//
// team_id !== null → upsert on (user_id, slot_id)
// team_id === null → delete the row (user is clearing their pick)
//
// Lock enforcement is APT-24's scope. RLS catches direct-from-client
// writes via the round-deadline check on the R32 round.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

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
