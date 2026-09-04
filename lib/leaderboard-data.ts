// Leaderboard data helpers.
//
// Archive note: loadLeaderboard() is gone along with the Supabase read
// path — the ranked entries now come frozen from data/archive-snapshot.json
// via lib/archive.ts. What remains is the pagination helper and its
// regression test, which are kept deliberately: they encode the
// PostgREST 1000-row-cap lesson documented in
// docs/leaderboard-counts-explainer.md, and the snapshot generator
// depends on that same contract.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaderboardEntry, ScoredPrediction } from "./bracket";

type ServerClient = SupabaseClient;

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
