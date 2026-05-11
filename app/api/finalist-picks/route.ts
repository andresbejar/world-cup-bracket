import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/finalist-picks
// Body: { first_place_team_id, second_place_team_id, third_place_team_id }
// Each field is either a team_id string or null. One row per user;
// upsert keyed on user_id.
//
// Lock deadline (first match kickoff) enforcement is APT-24's scope.
// RLS is the safety net.
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

  const { error } = await supabase.from("finalist_picks").upsert(
    {
      user_id: user.id,
      first_place_team_id: parsed.first_place_team_id,
      second_place_team_id: parsed.second_place_team_id,
      third_place_team_id: parsed.third_place_team_id,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    // CHECK constraint violations — three positions can't share a team.
    if (error.code === "23514") {
      return NextResponse.json(
        { error: "podium picks must be distinct teams" },
        { status: 409 },
      );
    }
    console.error("[api/finalist-picks] upsert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

interface ParsedBody {
  first_place_team_id: string | null;
  second_place_team_id: string | null;
  third_place_team_id: string | null;
}

function parseBody(raw: unknown): ParsedBody | { error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { error: "expected object body" };
  }
  const r = raw as Record<string, unknown>;
  const first = nullableTeamId(r.first_place_team_id);
  if (first === undefined) return { error: "first_place_team_id must be string or null" };
  const second = nullableTeamId(r.second_place_team_id);
  if (second === undefined) return { error: "second_place_team_id must be string or null" };
  const third = nullableTeamId(r.third_place_team_id);
  if (third === undefined) return { error: "third_place_team_id must be string or null" };
  // Surface duplicates server-side too — UI prevents but defense in depth.
  const picked = [first, second, third].filter((v): v is string => v != null);
  if (new Set(picked).size !== picked.length) {
    return { error: "podium picks must be distinct teams" };
  }
  return {
    first_place_team_id: first,
    second_place_team_id: second,
    third_place_team_id: third,
  };
}

function nullableTeamId(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}
