import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/predictions
// Body: { match_id, predicted_home_score, predicted_away_score,
//         predicted_winning_slot_id? }
// Upserts on (user_id, match_id).
//
// NOTE: Server-side lock enforcement (rejecting writes after a round's
// deadline) is APT-24's scope. RLS catches direct-from-client writes
// in the meantime; this route trusts authenticated callers until then.
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

  const { error } = await supabase.from("predictions").upsert(
    {
      user_id: user.id,
      match_id: parsed.match_id,
      predicted_home_score: parsed.predicted_home_score,
      predicted_away_score: parsed.predicted_away_score,
      predicted_winning_slot_id: parsed.predicted_winning_slot_id ?? null,
    },
    { onConflict: "user_id,match_id" },
  );
  if (error) {
    console.error("[api/predictions] upsert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

interface ParsedBody {
  match_id: string;
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_winning_slot_id?: string | null;
}

function parseBody(raw: unknown): ParsedBody | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "expected object body" };
  const r = raw as Record<string, unknown>;
  const match_id = r.match_id;
  if (typeof match_id !== "string" || match_id.length === 0) {
    return { error: "match_id required" };
  }
  const home = r.predicted_home_score;
  const away = r.predicted_away_score;
  if (!Number.isInteger(home) || (home as number) < 0 || (home as number) > 20) {
    return { error: "predicted_home_score must be int 0-20" };
  }
  if (!Number.isInteger(away) || (away as number) < 0 || (away as number) > 20) {
    return { error: "predicted_away_score must be int 0-20" };
  }
  let winning: string | null | undefined = undefined;
  if (r.predicted_winning_slot_id !== undefined) {
    const v = r.predicted_winning_slot_id;
    if (v !== null && (typeof v !== "string" || v.length === 0)) {
      return { error: "predicted_winning_slot_id must be string or null" };
    }
    winning = v as string | null;
  }
  return {
    match_id,
    predicted_home_score: home as number,
    predicted_away_score: away as number,
    predicted_winning_slot_id: winning,
  };
}
