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
import { chunk } from "./chunk";
import {
  computeFinalistPoints,
  type ActualMatch,
  type FinalStandings,
  type FinalistPicks,
} from "./bracket";
import type { SupabaseClient } from "@supabase/supabase-js";

// Per-user total recompute is ~9 sequential queries; each user's rows are
// independent, so run them in bounded-concurrency batches to keep a single
// match's scoring fast (~10s → ~1-2s for a 50-user pool) without flooding the
// connection pool.
const RECOMPUTE_CONCURRENCY = 8;

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
      "id, status, home_slot_id, away_slot_id, home_score, away_score, winning_slot_id, finished_at, rounds(stage)",
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

  // The winning slot is the single source of truth for knockout
  // outcomes — written by the polling job from api-football (regulation
  // winner OR penalty-shootout winner; see route.ts resolveWinningSlot)
  // or by an operator for awarded walkovers. A still-null knockout winner
  // (shootout result not yet ingested) makes the pure scorer return null
  // for those predictions; re-running once it lands is safe.
  const actualMatch: ActualMatch = {
    status,
    stage,
    home_slot_id: matchRow.home_slot_id as string,
    away_slot_id: matchRow.away_slot_id as string,
    home_score: matchRow.home_score as number | null,
    away_score: matchRow.away_score as number | null,
    winning_slot_id:
      stage === "knockout"
        ? (matchRow.winning_slot_id as string | null)
        : null,
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

  // Recompute users.total_points for affected users, in bounded-concurrency
  // batches (each user is independent). A failed recompute is logged, not
  // fatal — the next poll tick re-scores it (idempotent SET semantics).
  for (const batch of chunk(plan.affected_user_ids, RECOMPUTE_CONCURRENCY)) {
    const results = await Promise.all(
      batch.map((user_id) =>
        recomputeUserTotal(supabase, user_id).then((r) => ({ user_id, r })),
      ),
    );
    for (const { user_id, r } of results) {
      if (r.ok === false) {
        console.error(
          `[scoring] total recompute failed for ${user_id}:`,
          r.reason,
        );
      }
    }
  }

  return { ok: true, scored: plan.predictionUpdates.length };
}

export type ScoreFinalistsOutcome =
  | { ok: true; scored: number; skipped?: string }
  | { ok: false; reason: string };

/** Minimal match shape needed to read off the podium. */
export interface PodiumMatchRow {
  status: string;
  home_slot_id: string;
  away_slot_id: string;
  winning_slot_id: string | null;
}

/**
 * Pure: derive reality's podium from the two terminal knockout matches and
 * the real occupants of their slots. Champion/runner-up come from the
 * Final's winning/losing slot; 3rd from the third-place match's winning
 * slot. Any position the match hasn't settled (unfinished, or a shootout
 * winner not yet ingested) resolves to null — computeFinalistPoints
 * tolerates nulls, so a partly-settled podium scores only what's known.
 */
export function deriveFinalStandings(
  final: PodiumMatchRow | null,
  thirdPlace: PodiumMatchRow | null,
  teamBySlot: Map<string, string>,
): FinalStandings {
  let champion: string | null = null;
  let runnerUp: string | null = null;
  if (final && final.status === "finished" && final.winning_slot_id) {
    const winSlot = final.winning_slot_id;
    const loseSlot =
      winSlot === final.home_slot_id ? final.away_slot_id : final.home_slot_id;
    champion = teamBySlot.get(winSlot) ?? null;
    runnerUp = teamBySlot.get(loseSlot) ?? null;
  }
  const third =
    thirdPlace && thirdPlace.status === "finished" && thirdPlace.winning_slot_id
      ? teamBySlot.get(thirdPlace.winning_slot_id) ?? null
      : null;
  return {
    first_place_team_id: champion,
    second_place_team_id: runnerUp,
    third_place_team_id: third,
  };
}

/**
 * Score the finalist podium side-bet (Champion 5 / Runner-up 3 / 3rd 1).
 *
 * Builds reality's podium from the two terminal knockout matches:
 *   - champion   = real team in the Final's winning slot
 *   - runner-up  = real team in the Final's losing slot
 *   - third      = real team in the third-place match's winning slot
 * Those slots are filled by populateRealKnockoutSlots, so run this AFTER
 * advancement. Any position is null until its match has settled (incl. a
 * penalty winner landing); computeFinalistPoints tolerates nulls, so a
 * partly-settled podium (Final done, 3rd-place not) scores 1st/2nd only.
 *
 * Idempotent (SET semantics on points_awarded) and safe to re-run.
 */
export async function scoreFinalists(
  supabase: SupabaseClient,
): Promise<ScoreFinalistsOutcome> {
  const { data: matches, error: matchErr } = await supabase
    .from("matches")
    .select("id, status, home_slot_id, away_slot_id, winning_slot_id")
    .in("id", ["m-final", "m-third-place"]);
  if (matchErr) return { ok: false, reason: `finalist matches: ${matchErr.message}` };

  const final = (matches?.find((m) => m.id === "m-final") ?? null) as PodiumMatchRow | null;
  const thirdPlace = (matches?.find((m) => m.id === "m-third-place") ?? null) as PodiumMatchRow | null;
  const finalDone = final?.status === "finished" && final?.winning_slot_id != null;
  const thirdDone = thirdPlace?.status === "finished" && thirdPlace?.winning_slot_id != null;
  if (!finalDone && !thirdDone) {
    return { ok: true, scored: 0, skipped: "podium not settled" };
  }

  // Resolve the slots we care about to their real occupants.
  const slotIds = new Set<string>();
  if (final) {
    slotIds.add(final.home_slot_id);
    slotIds.add(final.away_slot_id);
  }
  if (thirdPlace?.winning_slot_id) slotIds.add(thirdPlace.winning_slot_id);
  const { data: slots, error: slotErr } = await supabase
    .from("bracket_slots")
    .select("id, real_team_id")
    .in("id", Array.from(slotIds));
  if (slotErr) return { ok: false, reason: `finalist slots: ${slotErr.message}` };
  const teamBySlot = new Map<string, string>();
  for (const s of slots ?? []) {
    if (s.real_team_id) teamBySlot.set(s.id as string, s.real_team_id as string);
  }

  const standings = deriveFinalStandings(final, thirdPlace, teamBySlot);

  const { data: picks, error: picksErr } = await supabase
    .from("finalist_picks")
    .select("user_id, first_place_team_id, second_place_team_id, third_place_team_id");
  if (picksErr) return { ok: false, reason: `finalist picks: ${picksErr.message}` };
  if (!picks || picks.length === 0) return { ok: true, scored: 0, skipped: "no finalist picks" };

  // Update each pick's points + recompute its user's total, in bounded
  // batches (independent per user). Hard-fail on the first error so the
  // caller surfaces it; idempotent SET semantics make a retry safe.
  let scored = 0;
  for (const batch of chunk(picks, RECOMPUTE_CONCURRENCY)) {
    const results = await Promise.all(
      batch.map(async (p) => {
        const points = computeFinalistPoints(
          p as unknown as FinalistPicks,
          standings,
        );
        const { error: updErr } = await supabase
          .from("finalist_picks")
          .update({ points_awarded: points })
          .eq("user_id", p.user_id as string);
        if (updErr) {
          return {
            ok: false as const,
            reason: `finalist update ${p.user_id}: ${updErr.message}`,
          };
        }
        const total = await recomputeUserTotal(supabase, p.user_id as string);
        if (total.ok === false) {
          return {
            ok: false as const,
            reason: `recompute ${p.user_id}: ${total.reason}`,
          };
        }
        return { ok: true as const };
      }),
    );
    for (const r of results) {
      if (r.ok === false) return { ok: false, reason: r.reason };
      scored += 1;
    }
  }
  return { ok: true, scored };
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

  // The best-third-placed side bet is intentionally not scored: it locked at
  // R32's deadline (after every group match finished), so its outcome was
  // fully known before lock — a free-points leak. It's now display-only and
  // contributes 0 to the leaderboard. The predicted thirds are still derived
  // for the read-only UI; see predictions-client.tsx.
  const total = predTotal + finalistTotal;
  const { error: updateErr } = await supabase
    .from("users")
    .update({ total_points: total })
    .eq("id", user_id);
  if (updateErr) return { ok: false, reason: updateErr.message };
  return { ok: true };
}

/**
 * Recompute every user's `total_points` from scratch. Operator hygiene —
 * e.g. after retiring the third-place bonus, to flush any total that
 * included it. Idempotent; safe to run any time.
 */
export async function recomputeAllUserTotals(
  supabase: SupabaseClient,
): Promise<{ ok: true; recomputed: number } | { ok: false; reason: string }> {
  const { data: users, error } = await supabase.from("users").select("id");
  if (error) return { ok: false, reason: error.message };
  let recomputed = 0;
  for (const u of users ?? []) {
    const out = await recomputeUserTotal(supabase, u.id as string);
    if (out.ok === false) {
      return { ok: false, reason: `recompute ${u.id}: ${out.reason}` };
    }
    recomputed += 1;
  }
  return { ok: true, recomputed };
}

