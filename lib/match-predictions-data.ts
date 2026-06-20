// Loader for "everyone's picks on a match" (APT-62). Returns every player's
// predicted score for a single match — but ONLY once the match has started.
//
// The reveal gate lives here (and in the API route), not in RLS: the
// `predictions_select_all` policy is `using (true)`, so the database would
// happily hand back picks for a not-yet-kicked-off match. `hasMatchStarted`
// is the hard boundary that keeps future-match predictions secret.

import { createClient } from "@/lib/supabase/server";
import { hasMatchStarted, type MatchStatus } from "@/lib/match-display";

/** Thrown when picks are requested for a match that hasn't started. Route → 403. */
export class MatchNotStartedError extends Error {
  constructor(matchId: string) {
    super(`match ${matchId} has not started`);
    this.name = "MatchNotStartedError";
  }
}

export class MatchNotFoundError extends Error {
  constructor(matchId: string) {
    super(`match ${matchId} not found`);
    this.name = "MatchNotFoundError";
  }
}

export interface MatchPick {
  username: string | null;
  profile_pic: string | null;
  predicted_home_score: number;
  predicted_away_score: number;
  /** Knockout only — the slot the player picked to advance. Null for group/non-tie. */
  predicted_winning_slot_id: string | null;
  /** Set once the match is scored. Null while in progress. */
  points_awarded: number | null;
  /** True for the requesting user's own row, so the UI can mark "(you)". */
  is_self: boolean;
}

export interface MatchPredictionsPayload {
  match_status: MatchStatus;
  picks: MatchPick[];
}

interface PredictionJoinRow {
  user_id: string;
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_winning_slot_id: string | null;
  points_awarded: number | null;
  users: {
    username: string | null;
    profile_pic: string | null;
    is_banned: boolean;
  } | null;
}

/**
 * Every player's prediction for `matchId`, gated on the match having started.
 * Throws `MatchNotFoundError` / `MatchNotStartedError` for the route to map.
 */
export async function loadMatchPredictions(
  matchId: string,
  callerUserId: string,
): Promise<MatchPredictionsPayload> {
  const supabase = await createClient();

  const { data: match, error: matchErr } = await supabase
    .from("matches")
    .select("id, status, scheduled_at")
    .eq("id", matchId)
    .maybeSingle();
  if (matchErr) throw matchErr;
  if (!match) throw new MatchNotFoundError(matchId);

  const status = match.status as MatchStatus;
  if (!hasMatchStarted({ status, scheduled_at: match.scheduled_at as string })) {
    throw new MatchNotStartedError(matchId);
  }

  const { data: rows, error: predErr } = await supabase
    .from("predictions")
    .select(
      "user_id, predicted_home_score, predicted_away_score, predicted_winning_slot_id, points_awarded, users!inner(username, profile_pic, is_banned)",
    )
    .eq("match_id", matchId);
  if (predErr) throw predErr;

  const picks: MatchPick[] = ((rows ?? []) as unknown as PredictionJoinRow[])
    .filter((r) => r.users != null && !r.users.is_banned)
    .map((r) => ({
      username: r.users!.username,
      profile_pic: r.users!.profile_pic,
      predicted_home_score: r.predicted_home_score,
      predicted_away_score: r.predicted_away_score,
      predicted_winning_slot_id: r.predicted_winning_slot_id,
      points_awarded: r.points_awarded,
      is_self: r.user_id === callerUserId,
    }))
    // Stable alphabetical order; the viewer's own row is marked, not floated.
    .sort((a, b) =>
      (a.username ?? "").localeCompare(b.username ?? "", undefined, {
        sensitivity: "base",
      }),
    );

  return { match_status: status, picks };
}
