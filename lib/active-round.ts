// Determines which round the predictions screen should open to. The "active"
// round is the earliest one (rounds arrive ordered by deadline_at ascending)
// that still has at least one non-finished match — i.e. the round currently
// being played, or the next one up. Pre-tournament this is M1; mid-tournament it
// tracks the live round; once everything is played it falls back to the Final.
//
// Pure and status-based (no Date.now()) so it's deterministic across the
// server/client boundary and trivially unit-testable.
export function resolveActiveRoundId(
  rounds: { id: string }[], // ordered by deadline_at asc
  matches: { round_id: string; status: string }[],
): string {
  for (const round of rounds) {
    const hasUnfinished = matches.some(
      (m) =>
        m.round_id === round.id &&
        m.status !== "finished" &&
        m.status !== "cancelled",
    );
    if (hasUnfinished) return round.id;
  }
  // All matches finished/cancelled → fall back to the last round (the Final).
  return rounds[rounds.length - 1]?.id ?? "";
}
