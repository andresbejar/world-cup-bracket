// Pure helpers that decide whether a match is in its "expected end" polling
// window. The polling endpoint (app/api/cron/poll-results) uses this to
// self-throttle: it only calls api-football when at least one match could be
// finishing around now, so a dumb every-5-min external pinger spends ~zero
// api-football quota outside live windows (see APT-60).
//
// We only care about FINAL results, never live scores, so there's no point
// polling during a match's first ~1h45. We start near the earliest a 90' match
// can realistically end and keep polling (every tick) until the row flips to
// finished/cancelled or the window cap passes. Knockouts get a longer cap to
// absorb extra time + penalties + reporting lag.

/** Earliest a 90' match can realistically finish: 45 + ~15 HT + 45 + stoppage. */
export const POLL_LEAD_MS = 105 * 60 * 1000; // kickoff + 1h45m

/** Group-stage window cap: regulation can't run past this. */
export const GROUP_WINDOW_MS = 135 * 60 * 1000; // kickoff + 2h15m

/** Knockout window cap: covers 30' ET + penalties + reporting lag. */
export const KNOCKOUT_WINDOW_MS = 225 * 60 * 1000; // kickoff + 3h45m

/**
 * Group vs knockout, by round id. Mirrors the predicate already used in
 * app/api/cron/poll-results/route.ts: group round ids are "group-r1".."group-r3";
 * every other round (r32/r16/qf/sf/third_place/final) is a knockout.
 */
export function isKnockoutRound(roundId: string): boolean {
  return !roundId.startsWith("group-");
}

/**
 * True when `nowMs` falls inside [kickoff + lead, kickoff + cap] for a match
 * that hasn't reached a terminal state yet. Finished/cancelled rows and rows
 * with an unparseable `scheduled_at` are never in-window.
 */
export function isInPollWindow(
  match: { round_id: string; scheduled_at: string; status: string },
  nowMs: number,
): boolean {
  if (match.status === "finished" || match.status === "cancelled") return false;
  const kickoff = Date.parse(match.scheduled_at);
  if (!Number.isFinite(kickoff)) return false;
  const cap = isKnockoutRound(match.round_id)
    ? KNOCKOUT_WINDOW_MS
    : GROUP_WINDOW_MS;
  return nowMs >= kickoff + POLL_LEAD_MS && nowMs <= kickoff + cap;
}
