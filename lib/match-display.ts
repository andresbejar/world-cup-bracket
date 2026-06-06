// Pure display predicates for match state. Kept out of the client component
// so they're unit-testable and reusable across surfaces.

export type MatchStatus =
  | "scheduled"
  | "in_progress"
  | "finished"
  | "cancelled";

/**
 * Whether a match has a *real, playable* result to show.
 *
 * A match cannot have a real result before it kicks off, so a `finished`
 * status on a future-dated match is impossible — it's stranded/phantom data
 * (e.g. an e2e run against the shared DB that was interrupted before its
 * cleanup ran). Gating display + standings on this predicate keeps such rows
 * from ever rendering as bogus FINAL scores.
 *
 * `now` is injectable for deterministic tests; defaults to wall-clock.
 */
export function hasRealResult(
  m: { status: MatchStatus; scheduled_at: string },
  now: number = Date.now(),
): boolean {
  return m.status === "finished" && new Date(m.scheduled_at).getTime() <= now;
}
