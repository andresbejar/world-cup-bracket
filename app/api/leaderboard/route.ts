import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadLeaderboard } from "@/lib/leaderboard-data";

// GET /api/leaderboard — used by the client's 30s polling loop.
// Authenticated route; the leaderboard itself is read-all per RLS, but
// we gate the endpoint behind the user's session so anonymous traffic
// doesn't hammer it.
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  try {
    const payload = await loadLeaderboard();
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/leaderboard] load failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
