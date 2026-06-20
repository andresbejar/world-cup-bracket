import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clearMatchScoring } from "../lib/scoring-runtime";

// Shared e2e utilities. Specs that need to inspect seed data (match
// IDs, slot labels, team mappings) go through here instead of duplicating
// the supabase admin client setup per file.

// Production Supabase project ref. The e2e suite mutates matches/rounds and
// is only safe against a dedicated test project (APT-52); this constant lets
// assertTestDatabase fail loud if a misconfigured env ever points e2e at prod.
// The project ref is part of the public NEXT_PUBLIC_SUPABASE_URL — not a secret.
const PROD_PROJECT_REF = "xuqonbzvkgfqhkkypdja";

/**
 * Hard refusal to run e2e against the live tournament database. After kickoff
 * (2026-06-11) the resetStrandedMatchResults self-heal no-ops, so an e2e run
 * against prod could flip real result rows and recompute leaderboards (APT-52).
 * Every admin-client construction routes through here.
 */
export function assertTestDatabase(url: string): void {
  if (url.includes(PROD_PROJECT_REF)) {
    throw new Error(
      `E2E refuses to run against the production Supabase project (${PROD_PROJECT_REF}). ` +
        "Point NEXT_PUBLIC_SUPABASE_URL at the dedicated test project " +
        "(see .env.test locally / TEST_SUPABASE_* secrets in CI).",
    );
  }
}

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "helpers.adminClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  assertTestDatabase(url);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface StrandedReset {
  matchesReset: string[];
  scoringCleared: number;
  /** Set when the reset was refused; the rest is a no-op. */
  skipped?: "tournament-started";
}

/**
 * Self-heal *impossible* match results: a match whose scheduled kickoff is
 * still in the future, yet looks played (`finished`/`in_progress`, or carries
 * a score / finished_at). Pre-tournament that can only be stranded data —
 * almost always from an e2e run (e.g. scoring-loop.spec) that was interrupted
 * before its afterAll restore ran against the shared DB.
 *
 * For each such match we clear the prediction scoring it stamped (so no user
 * is left with phantom points) and reset the row to `scheduled` with null
 * scores.
 *
 * SAFETY GATE: this only runs *before the tournament starts* (no match kickoff
 * has passed yet). Once play begins, a future-dated row that looks played is no
 * longer necessarily impossible — a match can be played-then-rescheduled, and
 * blindly resetting it would null real scores and recompute leaderboards down.
 * So past kickoff this refuses and no-ops; e2e must move off the shared prod DB
 * before then (tracked follow-up). `cancelled` is left alone — it's a
 * legitimate terminal state, not phantom "played" data.
 *
 * Used by global-setup (run-start self-heal) and the scripts/reset-match-results.ts
 * operator scrub.
 */
export async function resetStrandedMatchResults(
  admin: SupabaseClient,
): Promise<StrandedReset> {
  const now = Date.now();

  // Gate: refuse once any match has kicked off (tournament is live).
  const { data: earliest, error: earliestErr } = await admin
    .from("matches")
    .select("scheduled_at")
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (earliestErr) throw earliestErr;
  if (earliest && new Date(earliest.scheduled_at).getTime() <= now) {
    return { matchesReset: [], scoringCleared: 0, skipped: "tournament-started" };
  }

  const nowIso = new Date(now).toISOString();
  const { data: stranded, error } = await admin
    .from("matches")
    .select("id, status, home_score, away_score, finished_at, scheduled_at")
    .gt("scheduled_at", nowIso)
    .or("status.eq.finished,status.eq.in_progress,home_score.not.is.null,away_score.not.is.null,finished_at.not.is.null");
  if (error) throw error;
  if (!stranded || stranded.length === 0) {
    return { matchesReset: [], scoringCleared: 0 };
  }

  let scoringCleared = 0;
  const matchesReset: string[] = [];
  for (const m of stranded) {
    const id = m.id as string;
    // Clear scoring BEFORE resetting status — scoreMatch/clearMatchScoring
    // short-circuit on non-terminal statuses, so once status flips back to
    // `scheduled` the stranded points_awarded can no longer be undone.
    const cleared = await clearMatchScoring(admin, id);
    if (cleared.ok === false) {
      throw new Error(`resetStrandedMatchResults: clearMatchScoring ${id}: ${cleared.reason}`);
    }
    scoringCleared += cleared.cleared;

    const { error: upErr } = await admin
      .from("matches")
      .update({
        status: "scheduled",
        home_score: null,
        away_score: null,
        finished_at: null,
      })
      .eq("id", id);
    if (upErr) {
      throw new Error(`resetStrandedMatchResults: reset ${id}: ${upErr.message}`);
    }
    matchesReset.push(id);
  }
  return { matchesReset, scoringCleared };
}

export interface GroupMatchRow {
  id: string;
  round_id: string;
  home_slot_id: string;
  away_slot_id: string;
  home_team_id: string;
  away_team_id: string;
  home_code: string;
  away_code: string;
  group_letter: string;
}

/**
 * Returns all 72 group-stage matches with their resolved team_ids + 3-letter
 * codes. Stable across runs (seed is hand-curated, never re-randomized).
 * Specs that drive predictions use this to know which teams play whom
 * without depending on DOM ordering.
 */
export async function listGroupMatches(): Promise<GroupMatchRow[]> {
  const admin = adminClient();
  const { data: matches, error: mErr } = await admin
    .from("matches")
    .select("id, round_id, home_slot_id, away_slot_id")
    .like("round_id", "group-%")
    .order("scheduled_at", { ascending: true });
  if (mErr) throw mErr;
  if (!matches || matches.length === 0) {
    throw new Error("listGroupMatches: seed has no group matches");
  }

  const slotIds = new Set<string>();
  for (const m of matches) {
    slotIds.add(m.home_slot_id);
    slotIds.add(m.away_slot_id);
  }
  const { data: slots, error: sErr } = await admin
    .from("bracket_slots")
    .select("id, real_team_id")
    .in("id", [...slotIds]);
  if (sErr) throw sErr;
  const teamBySlot = new Map(
    (slots ?? []).map((s) => [s.id as string, s.real_team_id as string]),
  );

  const teamIds = new Set<string>();
  for (const t of teamBySlot.values()) teamIds.add(t);
  const { data: teams, error: tErr } = await admin
    .from("teams")
    .select("id, code, group_letter")
    .in("id", [...teamIds]);
  if (tErr) throw tErr;
  const teamById = new Map(
    (teams ?? []).map((t) => [
      t.id as string,
      { code: t.code as string, group_letter: t.group_letter as string },
    ]),
  );

  return matches.map((m) => {
    const home_team_id = teamBySlot.get(m.home_slot_id as string)!;
    const away_team_id = teamBySlot.get(m.away_slot_id as string)!;
    const home = teamById.get(home_team_id)!;
    const away = teamById.get(away_team_id)!;
    return {
      id: m.id as string,
      round_id: m.round_id as string,
      home_slot_id: m.home_slot_id as string,
      away_slot_id: m.away_slot_id as string,
      home_team_id,
      away_team_id,
      home_code: home.code,
      away_code: away.code,
      group_letter: home.group_letter,
    };
  });
}

export interface KnockoutMatchRow {
  id: string;
  round_id: string;
  match_index: number;
  home_slot_id: string;
  away_slot_id: string;
}

/**
 * All 32 knockout matches (R32 → Final + 3rd-place playoff). Each row
 * has its match_index so callers can pick a winning side without DOM
 * gymnastics.
 */
export async function listKnockoutMatches(): Promise<KnockoutMatchRow[]> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("matches")
    .select("id, round_id, home_slot_id, away_slot_id")
    .not("round_id", "like", "group-%")
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => {
    const idxMatch = /-(\d+)$/.exec(m.id as string);
    return {
      id: m.id as string,
      round_id: m.round_id as string,
      match_index: idxMatch ? parseInt(idxMatch[1], 10) : 1,
      home_slot_id: m.home_slot_id as string,
      away_slot_id: m.away_slot_id as string,
    };
  });
}

