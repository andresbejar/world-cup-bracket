import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  loadMatchPredictions,
  MatchNotFoundError,
  MatchNotStartedError,
} from "@/lib/match-predictions-data";

// GET /api/match-predictions?match_id=... — every player's predicted score for
// a single match (APT-62). View-only and purely informative.
//
// The hard rule: predictions for a match that hasn't started must never leak.
// RLS is permissive (predictions are read-all for leaderboard transparency),
// so this endpoint — via loadMatchPredictions' hasMatchStarted gate — is the
// real boundary. A future match returns 403, never the picks.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const matchId = request.nextUrl.searchParams.get("match_id");
  if (!matchId) {
    return NextResponse.json({ error: "match_id required" }, { status: 400 });
  }

  try {
    const payload = await loadMatchPredictions(matchId, user.id);
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof MatchNotStartedError) {
      return NextResponse.json({ error: "match_not_started" }, { status: 403 });
    }
    if (e instanceof MatchNotFoundError) {
      return NextResponse.json({ error: "match_not_found" }, { status: 404 });
    }
    console.error("[api/match-predictions] load failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
