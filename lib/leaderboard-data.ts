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
import { createClient } from "@/lib/supabase/server";

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
  const [
    { data: users, error: usersErr },
    { data: predictions, error: predErr },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id, username, profile_pic, total_points, created_at")
      .eq("is_banned", false),
    supabase
      .from("predictions")
      .select("user_id, points_awarded")
      .not("points_awarded", "is", null),
  ]);
  if (usersErr) throw usersErr;
  if (predErr) throw predErr;

  const usersList: LeaderboardUser[] = (users ?? []).map((u) => ({
    id: u.id as string,
    username: (u.username as string | null) ?? null,
    profile_pic: (u.profile_pic as string | null) ?? null,
    total_points: (u.total_points as number) ?? 0,
    created_at: u.created_at as string,
  }));
  const predList: ScoredPrediction[] = (predictions ?? []).map((p) => ({
    user_id: p.user_id as string,
    points_awarded: (p.points_awarded as number | null) ?? null,
  }));

  const entries = computeLeaderboard(usersList, predList).slice(0, limit);

  return {
    entries,
    total_players: usersList.length,
    computed_at: new Date().toISOString(),
  };
}
