// Pure scoring planner. The deterministic core called by the impure
// scoreMatch executor in lib/scoring-runtime.ts.
//
// Same inputs → same outputs. Calling it twice produces an identical
// plan, which is what makes scoreMatch idempotent end-to-end. SET
// semantics throughout (never INCREMENT) — re-runs on an already-
// scored match yield the same persisted state, so polling retries
// are safe.

import {
  computeMatchPoints,
  type ActualMatch,
  type MatchPrediction,
} from "./bracket";

// ----------------------------------------------------------------------
// Pure planner
// ----------------------------------------------------------------------

export interface ScorablePrediction {
  user_id: string;
  match_id: string;
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_winning_slot_id: string | null;
}

export interface PredictionUpdate {
  user_id: string;
  match_id: string;
  points_awarded: number | null;
}

export interface MatchScoringPlan {
  predictionUpdates: PredictionUpdate[];
  affected_user_ids: string[];
}

export interface MatchScoringInput {
  match: ActualMatch;
  predictions: readonly ScorablePrediction[];
}

/**
 * Compute the new points_awarded value for every prediction on a
 * given match. Returns a write plan plus the set of users whose
 * total_points need recomputing.
 *
 * Pure: same inputs → same outputs. Calling twice produces the
 * same plan, which is what makes scoreMatch idempotent end-to-end.
 *
 * Pre-finished matches return a plan where every points_awarded is
 * null (computeMatchPoints itself returns null). The executor uses
 * this to clear stale scoring if a match goes from finished back to
 * in_progress (api-football status corrections happen).
 */
export function planMatchScoring(
  input: MatchScoringInput,
): MatchScoringPlan {
  const predictionUpdates: PredictionUpdate[] = [];
  const userIds = new Set<string>();
  for (const p of input.predictions) {
    const pred: MatchPrediction = {
      predicted_home_score: p.predicted_home_score,
      predicted_away_score: p.predicted_away_score,
      predicted_winning_slot_id: p.predicted_winning_slot_id,
    };
    const pts = computeMatchPoints(pred, input.match);
    predictionUpdates.push({
      user_id: p.user_id,
      match_id: p.match_id,
      points_awarded: pts,
    });
    userIds.add(p.user_id);
  }
  return {
    predictionUpdates,
    affected_user_ids: [...userIds],
  };
}
