// Impure scoring executor. Calls into the pure planner in lib/scoring.ts
// and handles all Supabase I/O so the polling cron (APT-26) can stay
// thin.
//
// Excluded from the 100% coverage bar — it's I/O orchestration and is
// validated via smoke testing against staging plus the planner's own
// idempotency tests. See lib/scoring.test.ts for the deterministic
// scoring guarantees.

import {
  planMatchScoring,
  type ScorablePrediction,
} from "./scoring";
import {
  computeThirdPlacePlacementPoints,
  THIRD_PLACE_SLOT_LABELS,
  type ActualMatch,
  type BracketSlot,
  type PredictedThirdPlaceAssignment,
} from "./bracket";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ScoreMatchOutcome =
  | { ok: true; scored: number; skipped?: undefined }
  | { ok: true; scored: 0; skipped: string }
  | { ok: false; reason: string };

/**
 * Score every prediction on a single match.
 *
 *   - Skips when status is `scheduled` or `in_progress` — predictions
 *     are scored only after the polling job sees a terminal status.
 *   - For `cancelled`, every prediction is set to 0 (per design).
 *   - Idempotent: running twice on the same finished match produces
 *     the same persisted state. SET semantics, not INCREMENT.
 *   - After writing predictions, recomputes users.total_points for
 *     every affected user as SUM(predictions.points_awarded) +
 *     COALESCE(finalist_picks.points_awarded, 0).
 *
 * Third-place placement bonus and finalist scoring are owned by
 * separate passes (APT-28 + downstream); both materialize their
 * results onto users.total_points via the same recompute path.
 */
export async function scoreMatch(
  supabase: SupabaseClient,
  match_id: string,
): Promise<ScoreMatchOutcome> {
  const { data: matchRow, error: matchErr } = await supabase
    .from("matches")
    .select(
      "id, status, home_slot_id, away_slot_id, home_score, away_score, finished_at, rounds(stage)",
    )
    .eq("id", match_id)
    .maybeSingle();
  if (matchErr) {
    return { ok: false, reason: `match lookup: ${matchErr.message}` };
  }
  if (!matchRow) {
    return { ok: false, reason: "match not found" };
  }

  const round = Array.isArray(matchRow.rounds)
    ? matchRow.rounds[0]
    : matchRow.rounds;
  const stage: ActualMatch["stage"] =
    round?.stage === "group" ? "group" : "knockout";

  const status = matchRow.status as ActualMatch["status"];
  if (status !== "finished" && status !== "cancelled") {
    return { ok: true, scored: 0, skipped: `status=${status}` };
  }

  // Resolve the winning slot for knockouts from the score. The polling
  // job (APT-28) will land penalty winners on a dedicated column; for
  // now, tied 90+ET knockouts leave winning_slot_id null and the pure
  // scorer returns null for those predictions — re-runs once the
  // shootout result lands are safe.
  let winning_slot_id: string | null = null;
  if (stage === "knockout" && status === "finished") {
    const h = matchRow.home_score as number | null;
    const a = matchRow.away_score as number | null;
    if (h != null && a != null) {
      if (h > a) winning_slot_id = matchRow.home_slot_id as string;
      else if (a > h) winning_slot_id = matchRow.away_slot_id as string;
    }
  }

  const actualMatch: ActualMatch = {
    status,
    stage,
    home_slot_id: matchRow.home_slot_id as string,
    away_slot_id: matchRow.away_slot_id as string,
    home_score: matchRow.home_score as number | null,
    away_score: matchRow.away_score as number | null,
    winning_slot_id,
  };

  const { data: preds, error: predsErr } = await supabase
    .from("predictions")
    .select(
      "user_id, match_id, predicted_home_score, predicted_away_score, predicted_winning_slot_id",
    )
    .eq("match_id", match_id);
  if (predsErr) {
    return { ok: false, reason: `predictions lookup: ${predsErr.message}` };
  }
  if (!preds || preds.length === 0) {
    return { ok: true, scored: 0, skipped: "no predictions" };
  }

  const plan = planMatchScoring({
    match: actualMatch,
    predictions: preds as unknown as ScorablePrediction[],
  });

  const predByUser = new Map<string, ScorablePrediction>();
  for (const p of preds as unknown as ScorablePrediction[]) {
    predByUser.set(p.user_id, p);
  }
  const rows = plan.predictionUpdates.map((u) => {
    const src = predByUser.get(u.user_id)!;
    return {
      user_id: u.user_id,
      match_id: u.match_id,
      points_awarded: u.points_awarded,
      // upsert needs the rest of the row's NOT NULL columns.
      predicted_home_score: src.predicted_home_score,
      predicted_away_score: src.predicted_away_score,
    };
  });
  const { error: upsertErr } = await supabase
    .from("predictions")
    .upsert(rows, { onConflict: "user_id,match_id" });
  if (upsertErr) {
    return { ok: false, reason: `prediction upsert: ${upsertErr.message}` };
  }

  // Recompute users.total_points for affected users. One round-trip
  // per user — fine for a 5-50 person pool. APT-29 may materialize
  // via a SQL trigger later.
  for (const user_id of plan.affected_user_ids) {
    const total = await recomputeUserTotal(supabase, user_id);
    if (total.ok === false) {
      console.error(
        `[scoring] total recompute failed for ${user_id}:`,
        total.reason,
      );
    }
  }

  return { ok: true, scored: plan.predictionUpdates.length };
}

/**
 * Symmetric undo of `scoreMatch`. Nulls `points_awarded` on every
 * prediction for the match, then recomputes `total_points` for every
 * affected user. Intended for test cleanup — restoring a match's status
 * does NOT clear stranded prediction points because `scoreMatch` short-
 * circuits on non-terminal statuses. Without this, an e2e run that flips
 * a real seed match to `finished` will permanently stamp `points_awarded`
 * on every user who already predicted that match, regardless of whose
 * account is being tested.
 */
export async function clearMatchScoring(
  supabase: SupabaseClient,
  match_id: string,
): Promise<{ ok: true; cleared: number } | { ok: false; reason: string }> {
  const { data: preds, error: predsErr } = await supabase
    .from("predictions")
    .select("user_id")
    .eq("match_id", match_id)
    .not("points_awarded", "is", null);
  if (predsErr) {
    return { ok: false, reason: `predictions lookup: ${predsErr.message}` };
  }
  if (!preds || preds.length === 0) return { ok: true, cleared: 0 };

  const affected = Array.from(new Set(preds.map((p) => p.user_id as string)));

  const { error: clearErr } = await supabase
    .from("predictions")
    .update({ points_awarded: null })
    .eq("match_id", match_id);
  if (clearErr) {
    return { ok: false, reason: `prediction clear: ${clearErr.message}` };
  }

  for (const user_id of affected) {
    const out = await recomputeUserTotal(supabase, user_id);
    if (out.ok === false) {
      return { ok: false, reason: `recompute ${user_id}: ${out.reason}` };
    }
  }
  return { ok: true, cleared: preds.length };
}

async function recomputeUserTotal(
  supabase: SupabaseClient,
  user_id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: predRows, error: predErr } = await supabase
    .from("predictions")
    .select("points_awarded")
    .eq("user_id", user_id);
  if (predErr) return { ok: false, reason: predErr.message };
  const predTotal = (predRows ?? []).reduce(
    (sum, r) => sum + ((r.points_awarded as number | null) ?? 0),
    0,
  );

  const { data: finalistRow, error: finErr } = await supabase
    .from("finalist_picks")
    .select("points_awarded")
    .eq("user_id", user_id)
    .maybeSingle();
  if (finErr) return { ok: false, reason: finErr.message };
  const finalistTotal =
    (finalistRow?.points_awarded as number | null | undefined) ?? 0;

  // Third-place placement bonus: computed dynamically from user picks +
  // real best-3rd slot occupants. Returns null when group stage hasn't
  // fully settled — in that case the bonus contributes 0.
  const thirdPlaceBonus = await computeThirdPlaceBonus(supabase, user_id);
  if (thirdPlaceBonus.ok === false) {
    return { ok: false, reason: thirdPlaceBonus.reason };
  }

  const total = predTotal + finalistTotal + thirdPlaceBonus.value;
  const { error: updateErr } = await supabase
    .from("users")
    .update({ total_points: total })
    .eq("id", user_id);
  if (updateErr) return { ok: false, reason: updateErr.message };
  return { ok: true };
}

async function computeThirdPlaceBonus(
  supabase: SupabaseClient,
  user_id: string,
): Promise<{ ok: true; value: number } | { ok: false; reason: string }> {
  // The 8 R32 best-3rd slots. real_team_id is null until the polling
  // job (or admin) populates them post-group-stage.
  const { data: realSlots, error: slotErr } = await supabase
    .from("bracket_slots")
    .select("slot_label, real_team_id")
    .in("slot_label", [...THIRD_PLACE_SLOT_LABELS]);
  if (slotErr) return { ok: false, reason: slotErr.message };

  const { data: picks, error: picksErr } = await supabase
    .from("predicted_third_place_assignments")
    .select("slot_id, predicted_team_id")
    .eq("user_id", user_id);
  if (picksErr) return { ok: false, reason: picksErr.message };

  // The picks reference bracket_slot.id; resolve back to slot_label for
  // the pure scorer. We pull this lookup from the realSlots query above
  // — but those are queried by slot_label, not id. Pull the id→label
  // map for the 8 third-place slots in one shot.
  const { data: thirdPlaceSlotIds, error: idsErr } = await supabase
    .from("bracket_slots")
    .select("id, slot_label")
    .in("slot_label", [...THIRD_PLACE_SLOT_LABELS]);
  if (idsErr) return { ok: false, reason: idsErr.message };
  const labelById = new Map<string, string>();
  for (const s of thirdPlaceSlotIds ?? []) {
    labelById.set(s.id as string, s.slot_label as string);
  }

  const assignments: PredictedThirdPlaceAssignment[] = (picks ?? []).map(
    (p) => ({
      slot_label:
        labelById.get(p.slot_id as string) ?? (p.slot_id as string),
      team_id: p.predicted_team_id as string,
    }),
  );
  const slotsForScorer: BracketSlot[] = (realSlots ?? []).map((s) => ({
    slot_label: s.slot_label as string,
    real_team_id: (s.real_team_id as string | null) ?? null,
  }));

  const pts = computeThirdPlacePlacementPoints(assignments, slotsForScorer);
  return { ok: true, value: pts ?? 0 };
}
