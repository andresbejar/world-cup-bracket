// api-sports.io / api-football v3 client.
//
// Only the /fixtures endpoint is needed at runtime — the seed script
// pulls teams once at build time (scripts/build-seed.ts), so this
// module is the polling-job adapter.
//
// Per design doc § Premise 7: canonical score is fulltime + extratime,
// NEVER penalties. Penalty shootout outcomes ride in `penalty_winner`
// so the polling job can advance the winner side to the next round.

export const FIFA_2026_LEAGUE_ID = 1;
export const FIFA_2026_SEASON = 2026;

export type FixtureStatus =
  | "scheduled"
  | "in_progress"
  | "finished"
  | "cancelled";

export interface FixtureResult {
  apifootball_fixture_id: number;
  status: FixtureStatus;
  /** FT + ET goals. Null until finished. */
  home_score: number | null;
  away_score: number | null;
  /**
   * Set only when a finished knockout went to penalties — tells the
   * polling job which side advanced. Null otherwise.
   */
  penalty_winner: "home" | "away" | null;
  finished_at: string | null;
}

export interface ApiFootballConfig {
  host: string;
  key: string;
  /** Inject a fetch impl for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch every fixture for the FIFA 2026 World Cup. Returns a
 * normalized list, or null on 429 / 5xx / fetch error / malformed
 * payload — the polling job treats null as a soft skip and retries
 * next tick.
 */
export async function fetchFixtures(
  config: ApiFootballConfig,
): Promise<FixtureResult[] | null> {
  const f = config.fetchImpl ?? fetch;
  const url = `${config.host}/fixtures?league=${FIFA_2026_LEAGUE_ID}&season=${FIFA_2026_SEASON}`;
  let res: Response;
  try {
    res = await f(url, {
      headers: { "x-apisports-key": config.key },
    });
  } catch (e) {
    console.error("[apifootball] network error:", e);
    return null;
  }
  if (res.status === 429) {
    console.warn("[apifootball] rate-limited (429) — skipping this tick");
    return null;
  }
  if (res.status >= 500) {
    console.warn(`[apifootball] upstream ${res.status} — skipping this tick`);
    return null;
  }
  if (!res.ok) {
    console.error(`[apifootball] HTTP ${res.status} on /fixtures`);
    return null;
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (e) {
    console.error("[apifootball] invalid JSON:", e);
    return null;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("response" in payload) ||
    !Array.isArray((payload as { response: unknown }).response)
  ) {
    console.error("[apifootball] unexpected payload shape");
    return null;
  }
  const rows = (payload as { response: unknown[] }).response;
  const results: FixtureResult[] = [];
  for (const row of rows) {
    const parsed = parseFixture(row);
    if (parsed) results.push(parsed);
  }
  return results;
}

/**
 * Pure parser. Accepts a single row from api-football's /fixtures
 * response and returns the canonical shape, or null if the row is
 * malformed enough that we can't trust any of it.
 *
 * Status code mapping (api-football short codes):
 *   NS, TBD                       → scheduled
 *   1H, 2H, HT, ET, BT, P, LIVE   → in_progress
 *   FT, AET, PEN                  → finished
 *   PST, CANC, ABD, AWD, WO       → cancelled
 *   anything else                 → scheduled (defensive)
 */
export function parseFixture(raw: unknown): FixtureResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fixture = r.fixture as Record<string, unknown> | undefined;
  if (!fixture) return null;
  const fixture_id = fixture.id;
  if (typeof fixture_id !== "number") return null;

  const statusObj = fixture.status as Record<string, unknown> | undefined;
  const short = typeof statusObj?.short === "string" ? statusObj.short : "NS";
  const status: FixtureStatus = mapStatus(short);

  const score = (r.score as Record<string, unknown>) ?? {};
  const fulltime = (score.fulltime as Record<string, unknown>) ?? {};
  const extratime = (score.extratime as Record<string, unknown>) ?? {};
  const penalty = (score.penalty as Record<string, unknown>) ?? {};

  const ftHome = numOrNull(fulltime.home);
  const ftAway = numOrNull(fulltime.away);
  const etHome = numOrNull(extratime.home);
  const etAway = numOrNull(extratime.away);

  // Premise 7 canonical: fulltime + extratime (no penalties).
  // Pre-finished rows can leave fulltime null — treat as no score yet.
  let home_score: number | null = null;
  let away_score: number | null = null;
  if (status === "finished" && ftHome != null && ftAway != null) {
    home_score = ftHome + (etHome ?? 0);
    away_score = ftAway + (etAway ?? 0);
  }

  let penalty_winner: "home" | "away" | null = null;
  if (short === "PEN") {
    const pHome = numOrNull(penalty.home);
    const pAway = numOrNull(penalty.away);
    if (pHome != null && pAway != null && pHome !== pAway) {
      penalty_winner = pHome > pAway ? "home" : "away";
    }
  }

  const finished_at =
    status === "finished" && typeof fixture.date === "string"
      ? (fixture.date as string)
      : null;

  return {
    apifootball_fixture_id: fixture_id,
    status,
    home_score,
    away_score,
    penalty_winner,
    finished_at,
  };
}

function mapStatus(short: string): FixtureStatus {
  switch (short) {
    case "NS":
    case "TBD":
      return "scheduled";
    case "1H":
    case "2H":
    case "HT":
    case "ET":
    case "BT":
    case "P":
    case "LIVE":
      return "in_progress";
    case "FT":
    case "AET":
    case "PEN":
      return "finished";
    case "PST":
    case "CANC":
    case "ABD":
    case "AWD":
    case "WO":
      return "cancelled";
    default:
      return "scheduled";
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
