// Leaderboard data loader. Wraps the pure computeLeaderboard from
// lib/bracket.ts with the database query bits — used both by the
// initial server render and by the /api/leaderboard route the
// client polls every 30s.

import {
  computeLeaderboard,
  type LeaderboardEntry,
  type LeaderboardUser,
  type ScoredPrediction,
} from "./bracket";
import { createClient } from "./supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// PostgREST caps a single response at `db-max-rows` (1000 by default on
// Supabase). The leaderboard's exact/outcome counts are aggregated from
// EVERY scored prediction, and the tournament long ago crossed 1000 of
// them — so a single unpaginated `.select()` silently dropped the overflow
// and undercounted every user whose rows fell past the cap (the
// materialized `total_points`, computed per-user, stayed correct, which is
// what made the mismatch visible). Page through the full set so the counts
// can never be truncated again.
export const LEADERBOARD_PAGE_SIZE = 1000;
const PAGE_SIZE = LEADERBOARD_PAGE_SIZE;

export async function fetchAllScoredPredictions(
  supabase: ServerClient,
): Promise<ScoredPrediction[]> {
  const all: ScoredPrediction[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("predictions")
      .select("user_id, points_awarded")
      .not("points_awarded", "is", null)
      // Stable total ordering on the (user_id, match_id) PK so paging with
      // .range() can't duplicate or skip rows across page boundaries.
      .order("user_id", { ascending: true })
      .order("match_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const p of rows) {
      all.push({
        user_id: p.user_id as string,
        points_awarded: (p.points_awarded as number | null) ?? null,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

export interface LeaderboardPayload {
  entries: LeaderboardEntry[];
  total_players: number;
  /** ISO timestamp of when this snapshot was computed — client uses it
   * to display a "last updated" hint. */
  computed_at: string;
}

/**
 * Top-N ranked entries computed against current materialized totals.
 * Default limit of 50 matches the AC; pass a different cap if needed
 * (e.g. for an export or admin view).
 */
export async function loadLeaderboard(
  limit = 50,
): Promise<LeaderboardPayload> {
  const supabase = await createClient();
  const [{ data: users, error: usersErr }, predictions] = await Promise.all([
    supabase
      .from("users")
      .select("id, username, profile_pic, total_points, created_at")
      .eq("is_banned", false),
    fetchAllScoredPredictions(supabase),
  ]);
  if (usersErr) throw usersErr;

  const usersList: LeaderboardUser[] = (users ?? []).map((u) => ({
    id: u.id as string,
    username: (u.username as string | null) ?? null,
    profile_pic: (u.profile_pic as string | null) ?? null,
    total_points: (u.total_points as number) ?? 0,
    created_at: u.created_at as string,
  }));
  const entries = computeLeaderboard(usersList, predictions).slice(0, limit);

  return {
    entries,
    total_players: usersList.length,
    computed_at: new Date().toISOString(),
  };
}
