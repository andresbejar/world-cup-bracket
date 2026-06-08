// Knockout fixture-id backfill.
//
// The seed leaves every knockout match's apifootball_fixture_id null
// (api-sports hadn't published the 2026 knockout bracket at build time),
// and the polling cron only ingests matches with a non-null fixture id.
// This module maps api-sports' published knockout fixtures onto our 32
// internal knockout matches and fills in the ids — so once api-sports
// publishes (which may happen incrementally, even before the group stage
// fully clears), the cron starts ingesting them automatically.
//
// Pure planner (planKnockoutBackfill) + a thin fetch/apply wrapper. The
// planner is incremental and conservative: it backfills only the rounds
// api-sports has fully published, leaves the rest for a later run, and
// never guesses across a kickoff gap wider than maxDeltaMs.

import { FIFA_2026_LEAGUE_ID, FIFA_2026_SEASON } from "./apifootball";
import type { SupabaseClient } from "@supabase/supabase-js";

export type KnockoutRoundId = "r32" | "r16" | "qf" | "sf" | "third_place" | "final";

// Each knockout round and the number of matches it contains, in
// chronological order. Used to validate that a round is fully published
// before we trust the kickoff-based pairing.
export const ROUND_PLAN: { round_id: KnockoutRoundId; count: number }[] = [
  { round_id: "r32", count: 16 },
  { round_id: "r16", count: 8 },
  { round_id: "qf", count: 4 },
  { round_id: "sf", count: 2 },
  { round_id: "third_place", count: 1 },
  { round_id: "final", count: 1 },
];

/** A published api-sports fixture, reduced to what the planner needs. */
export interface PublishedFixture {
  fixture_id: number;
  round: string; // api-sports league.round string
  kickoff_at: string; // ISO 8601
}

/** Our knockout match, as stored. */
export interface OurKnockoutMatch {
  id: string;
  round_id: string;
  scheduled_at: string;
  apifootball_fixture_id: number | null;
}

export interface BackfillAssignment {
  match_id: string;
  fixture_id: number;
  round_id: KnockoutRoundId;
  delta_ms: number;
}

export interface BackfillPlan {
  assignments: BackfillAssignment[];
  warnings: string[];
}

const DEFAULT_MAX_DELTA_MS = 12 * 60 * 60 * 1000; // 12h

/**
 * Classify an api-sports round-name string to one of our knockout round
 * ids, or null if it isn't a (recognized) knockout round. The 2026
 * "Round of 32" label is unverified (first 48-team WC), so the planner
 * also has a count-based fallback; the other five names have been stable
 * across past World Cups. Order matters: "Quarter-finals"/"Semi-finals"/
 * "3rd Place Final" all contain "final", so the bare-final check is exact.
 */
export function classifyApiRound(name: string): KnockoutRoundId | null {
  const n = name.trim().toLowerCase();
  if (n.includes("group")) return null;
  if (n.includes("round of 32") || n.includes("32")) return "r32";
  if (n.includes("round of 16") || n.includes("16")) return "r16";
  if (n.includes("quarter")) return "qf";
  if (n.includes("semi")) return "sf";
  if (n.includes("third") || n.includes("3rd")) return "third_place";
  if (n === "final" || n === "finals") return "final";
  return null;
}

// Greedy 1:1 nearest-kickoff pairing within a single round.
function pairByNearestKickoff(
  matches: OurKnockoutMatch[],
  fixtures: PublishedFixture[],
): { match: OurKnockoutMatch; fixture: PublishedFixture; delta_ms: number }[] {
  const candidates: { match: OurKnockoutMatch; fixture: PublishedFixture; delta_ms: number }[] = [];
  for (const m of matches) {
    const t = new Date(m.scheduled_at).getTime();
    for (const f of fixtures) {
      candidates.push({ match: m, fixture: f, delta_ms: Math.abs(new Date(f.kickoff_at).getTime() - t) });
    }
  }
  candidates.sort((a, b) => a.delta_ms - b.delta_ms);
  const usedMatch = new Set<string>();
  const usedFixture = new Set<number>();
  const out: typeof candidates = [];
  for (const c of candidates) {
    if (usedMatch.has(c.match.id) || usedFixture.has(c.fixture.fixture_id)) continue;
    usedMatch.add(c.match.id);
    usedFixture.add(c.fixture.fixture_id);
    out.push(c);
  }
  return out;
}

/**
 * Pure: plan which fixture id to write onto which of our knockout matches.
 *
 * - Buckets published fixtures by classified round (with a count-16
 *   fallback for an unrecognized "Round of 32" label).
 * - Only acts on a round api-sports has FULLY published (fixture count ==
 *   the round's expected count) — partial publication of a round is left
 *   for a later run.
 * - Within a round, pairs each of our matches to the nearest-kickoff
 *   fixture 1:1, skipping any pairing wider than maxDeltaMs.
 * - Emits an assignment only when it changes the stored id (idempotent).
 */
export function planKnockoutBackfill(
  published: PublishedFixture[],
  ourMatches: OurKnockoutMatch[],
  opts: { maxDeltaMs?: number } = {},
): BackfillPlan {
  const maxDelta = opts.maxDeltaMs ?? DEFAULT_MAX_DELTA_MS;
  const warnings: string[] = [];
  const assignments: BackfillAssignment[] = [];

  // Bucket published fixtures by our round id (via name, then 16-count fallback).
  const byName = new Map<string, PublishedFixture[]>();
  for (const f of published) {
    if (!byName.has(f.round)) byName.set(f.round, []);
    byName.get(f.round)!.push(f);
  }
  const byRound = new Map<KnockoutRoundId, PublishedFixture[]>();
  const unclassified: { name: string; fixtures: PublishedFixture[] }[] = [];
  for (const [name, fixtures] of byName) {
    const rid = classifyApiRound(name);
    if (rid) byRound.set(rid, [...(byRound.get(rid) ?? []), ...fixtures]);
    else unclassified.push({ name, fixtures });
  }
  // Fallback: if R32 wasn't recognized by name but exactly one unclassified
  // non-group round holds 16 fixtures, treat it as the Round of 32.
  if (!byRound.has("r32")) {
    const sixteen = unclassified.filter((u) => u.fixtures.length === 16);
    if (sixteen.length === 1) byRound.set("r32", sixteen[0].fixtures);
  }

  const ourByRound = new Map<string, OurKnockoutMatch[]>();
  for (const m of ourMatches) {
    if (!ourByRound.has(m.round_id)) ourByRound.set(m.round_id, []);
    ourByRound.get(m.round_id)!.push(m);
  }

  for (const { round_id, count } of ROUND_PLAN) {
    const pf = byRound.get(round_id) ?? [];
    if (pf.length === 0) continue; // not published yet — expected, no warning
    if (pf.length !== count) {
      warnings.push(`${round_id}: api published ${pf.length} fixtures, expected ${count} — skipping until complete`);
      continue;
    }
    const om = ourByRound.get(round_id) ?? [];
    if (om.length !== count) {
      warnings.push(`${round_id}: DB has ${om.length} matches, expected ${count} — skipping`);
      continue;
    }
    for (const { match, fixture, delta_ms } of pairByNearestKickoff(om, pf)) {
      if (delta_ms > maxDelta) {
        warnings.push(
          `${round_id}/${match.id}: nearest fixture ${fixture.fixture_id} is ${Math.round(delta_ms / 3600000)}h off — skipping`,
        );
        continue;
      }
      if (match.apifootball_fixture_id !== fixture.fixture_id) {
        assignments.push({ match_id: match.id, fixture_id: fixture.fixture_id, round_id, delta_ms });
      }
    }
  }

  return { assignments, warnings };
}

/**
 * Fetch every season-2026 fixture and reduce to the planner's shape.
 * Returns null on rate-limit / 5xx / network / malformed (caller treats
 * as a soft skip), mirroring apifootball.fetchFixtures.
 */
export async function fetchKnockoutFixtureRefs(
  host: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublishedFixture[] | null> {
  let res: Response;
  try {
    res = await fetchImpl(
      `${host}/fixtures?league=${FIFA_2026_LEAGUE_ID}&season=${FIFA_2026_SEASON}`,
      { headers: { "x-apisports-key": key } },
    );
  } catch (e) {
    console.error("[knockout-backfill] network error:", e);
    return null;
  }
  if (!res.ok) {
    console.warn(`[knockout-backfill] HTTP ${res.status} — skipping`);
    return null;
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    console.error("[knockout-backfill] invalid JSON");
    return null;
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { response?: unknown }).response)) {
    console.error("[knockout-backfill] unexpected payload shape");
    return null;
  }
  const out: PublishedFixture[] = [];
  for (const row of (payload as { response: unknown[] }).response) {
    const r = row as Record<string, unknown>;
    const fixture = r.fixture as Record<string, unknown> | undefined;
    const league = r.league as Record<string, unknown> | undefined;
    const id = fixture?.id;
    const date = fixture?.date;
    const round = league?.round;
    if (typeof id === "number" && typeof date === "string" && typeof round === "string") {
      out.push({ fixture_id: id, round, kickoff_at: date });
    }
  }
  return out;
}

export type BackfillOutcome =
  | { ok: true; linked: number; warnings: string[]; skipped?: string }
  | { ok: false; reason: string };

/**
 * Fetch published fixtures, plan the backfill against our knockout
 * matches, and write the new fixture ids. Idempotent — only changed ids
 * are written. Soft-skips when the fetch fails. Safe to run every cron
 * tick; once api-sports publishes, the matches link and the polling job
 * ingests them automatically.
 */
export async function applyKnockoutBackfill(
  supabase: SupabaseClient,
  host: string,
  key: string,
): Promise<BackfillOutcome> {
  const published = await fetchKnockoutFixtureRefs(host, key);
  if (!published) return { ok: true, linked: 0, warnings: [], skipped: "fetch failed" };

  const { data: ours, error } = await supabase
    .from("matches")
    .select("id, round_id, scheduled_at, apifootball_fixture_id")
    .not("round_id", "like", "group-%");
  if (error) return { ok: false, reason: `matches: ${error.message}` };

  const plan = planKnockoutBackfill(published, (ours ?? []) as OurKnockoutMatch[]);
  for (const a of plan.assignments) {
    const { error: updErr } = await supabase
      .from("matches")
      .update({ apifootball_fixture_id: a.fixture_id })
      .eq("id", a.match_id);
    if (updErr) {
      return { ok: false, reason: `link ${a.match_id}→${a.fixture_id}: ${updErr.message}` };
    }
  }
  for (const w of plan.warnings) console.warn(`[knockout-backfill] ${w}`);
  return { ok: true, linked: plan.assignments.length, warnings: plan.warnings };
}
