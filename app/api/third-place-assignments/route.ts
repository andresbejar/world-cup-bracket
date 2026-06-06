import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth-guard";
import { checkRoundLock } from "@/lib/lock-check";

// POST /api/third-place-assignments
// Body: { group_letter: "A".."L"; selected: boolean }
//
// Toggles one group in the user's "best third-placed teams" qualifying
// set. The user picks WHICH 8 of the 12 groups' third-placed teams
// advance; FIFA's Annex C (lib/annex-c.ts) then deterministically decides
// each one's R32 opponent. This replaces the old per-slot assignment that
// could produce illegal same-group matchups.
//
//   selected: true  → add the group (rejected with 409 if already at 8)
//   selected: false → remove the group
//
// Picks lock at R32's deadline (4hr before R32 starts).
const MAX_QUALIFIERS = 8;

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

  // Gated by the R32 round's lock state.
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

  if (!parsed.selected) {
    const { error } = await supabase
      .from("predicted_qualifying_thirds")
      .delete()
      .eq("user_id", user.id)
      .eq("group_letter", parsed.group_letter);
    if (error) {
      console.error("[api/third-place-assignments] delete failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, selected: false });
  }

  // Enforce the "exactly 8" ceiling: reject an add that would exceed it.
  // (UI prevents this; this is the server-side backstop.)
  const { data: existing, error: countErr } = await supabase
    .from("predicted_qualifying_thirds")
    .select("group_letter")
    .eq("user_id", user.id);
  if (countErr) {
    console.error("[api/third-place-assignments] count failed:", countErr);
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  const current = new Set((existing ?? []).map((r) => r.group_letter as string));
  if (!current.has(parsed.group_letter) && current.size >= MAX_QUALIFIERS) {
    return NextResponse.json(
      { error: `at most ${MAX_QUALIFIERS} groups can qualify — deselect one first` },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("predicted_qualifying_thirds")
    .upsert(
      { user_id: user.id, group_letter: parsed.group_letter },
      { onConflict: "user_id,group_letter", ignoreDuplicates: true },
    );
  if (error) {
    console.error("[api/third-place-assignments] upsert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, selected: true });
}

interface ParsedBody {
  group_letter: string;
  selected: boolean;
}

function parseBody(raw: unknown): ParsedBody | { error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { error: "expected object body" };
  }
  const r = raw as Record<string, unknown>;
  const group_letter = r.group_letter;
  if (typeof group_letter !== "string" || !/^[A-L]$/.test(group_letter)) {
    return { error: "group_letter must be a single letter A–L" };
  }
  if (typeof r.selected !== "boolean") {
    return { error: "selected must be a boolean" };
  }
  return { group_letter, selected: r.selected };
}
