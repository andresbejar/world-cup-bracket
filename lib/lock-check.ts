// Pure lock-state helpers used by every write API.
//
// Design doc § Lock Enforcement Architecture: Next.js API routes are the
// source of truth; Supabase RLS is the safety-net backup. The same lock
// semantics ship in the RLS function `is_round_editable(round_id)` —
// these helpers mirror them so the user-facing 403 carries a clear
// message instead of RLS's cryptic "row-level security violation".

export interface RoundLockState {
  /** Hard lock — set when the round is administratively closed. */
  locked_at: string | null;
  /** Soft lock — 4 hours before the round's first kickoff. */
  deadline_at: string;
}

export type LockStatus =
  | { editable: true }
  | { editable: false; reason: "locked"; locked_at: string }
  | { editable: false; reason: "past_deadline"; deadline_at: string };

/**
 * Determine if a round's writes should be accepted. A round is editable
 * iff it's not administratively locked AND its 4-hour-pre-kickoff
 * deadline hasn't elapsed.
 */
export function checkRoundLock(
  round: RoundLockState,
  nowMs: number,
): LockStatus {
  if (round.locked_at != null) {
    return { editable: false, reason: "locked", locked_at: round.locked_at };
  }
  const deadlineMs = Date.parse(round.deadline_at);
  if (Number.isFinite(deadlineMs) && nowMs >= deadlineMs) {
    return {
      editable: false,
      reason: "past_deadline",
      deadline_at: round.deadline_at,
    };
  }
  return { editable: true };
}

/**
 * Same shape for the finalist (tournament-wide) lock, which is the
 * first match kickoff — not a 4-hour-pre cutoff. Pre-tournament =
 * editable; once the first match starts, finalist picks freeze.
 */
export function checkFinalistLock(
  firstMatchKickoffIso: string | null,
  nowMs: number,
): LockStatus {
  if (firstMatchKickoffIso == null) {
    // No matches scheduled yet — treat as editable (pre-seed state).
    return { editable: true };
  }
  const kickoffMs = Date.parse(firstMatchKickoffIso);
  if (Number.isFinite(kickoffMs) && nowMs >= kickoffMs) {
    return {
      editable: false,
      reason: "past_deadline",
      deadline_at: firstMatchKickoffIso,
    };
  }
  return { editable: true };
}

/**
 * Server-side validation that mirrors the knockout-card UX rule: a
 * knockout match's outcome must not be a tie without an explicit
 * penalty-winner pick. Group matches are always allowed to be ties.
 */
export interface KnockoutValidationInput {
  stage: "group" | "knockout";
  home_score: number;
  away_score: number;
  predicted_winning_slot_id: string | null | undefined;
}

export type KnockoutValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateKnockoutPrediction(
  input: KnockoutValidationInput,
): KnockoutValidationResult {
  if (input.stage === "group") return { ok: true };
  const tied = input.home_score === input.away_score;
  if (tied && (input.predicted_winning_slot_id == null)) {
    return {
      ok: false,
      error:
        "knockout matches require a winning slot when the score is tied",
    };
  }
  return { ok: true };
}
