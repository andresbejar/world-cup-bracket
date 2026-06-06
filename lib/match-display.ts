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

/**
 * Compact "Jun 28, 12:00 PM PDT" rendering of a kickoff timestamp.
 *
 * Kickoffs are stored in UTC; this renders them in the viewer's local zone
 * and appends the zone abbreviation (`timeZoneName: "short"`) so a time is
 * never ambiguous across the US/CA/MX timezones the Cup spans. `toLocaleString`
 * separates the time from AM/PM with a narrow no-break space (U+202F); we
 * normalize it to a regular space for predictable, copy-pasteable output.
 *
 * `timeZone` is injectable so tests can pin a zone deterministically; in the
 * app it's omitted, falling back to the runtime's local zone.
 */
export function shortDateTime(iso: string, timeZone?: string): string {
  return new Date(iso)
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      ...(timeZone ? { timeZone } : {}),
    })
    .replace(/ /g, " ");
}
