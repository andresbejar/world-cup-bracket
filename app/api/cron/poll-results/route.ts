import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { fetchFixtures, type FixtureResult } from "@/lib/apifootball";
import { scoreMatch, scoreFinalists } from "@/lib/scoring-runtime";
import {
  populateRealR32SlotsFromGroupResults,
  populateRealKnockoutSlots,
} from "@/lib/reality";
import { applyKnockoutBackfill } from "@/lib/knockout-backfill";
import { isInPollWindow } from "@/lib/poll-window";

// POST /api/cron/poll-results
//
// Score-polling job. Primary trigger is an external every-5-min cron pinger
// (cron-job.org); .github/workflows/poll-results.yml is a sparse backstop that
// hits it with ?full=1 (see "Self-throttle" below). Authorization: Bearer
// <CRON_SECRET> required; non-cron callers get 401.
//
// Self-throttle (APT-60): we only care about FINAL results, so there's no point
// pulling api-football outside the window where a match could be ending. Unless
// ?full=1 is set, the job first checks whether any not-yet-finished match is in
// its expected-end window (isInPollWindow); if none, it returns {idle:true}
// without touching api-football or the scoring/reality sweeps. That keeps the
// always-on 5-min pinger ~free on quota outside live windows, and concentrates
// polling right around each match's expected end. ?full=1 bypasses the gate so
// the backstop still runs backfill + straggler scoring + reality between rounds.
//
// Lifecycle:
//   0. Backfill knockout fixture ids as api-sports publishes them
//      (knockouts are seeded with a null fixture id until then)
//   1. Pull every fixture from api-football
//   2. Upsert each match's status + canonical 90+ET score + winning
//      slot id when a knockout has resolved (regulation winner OR
//      penalty winner from the shootout)
//   3. For every match in `finished` or `cancelled`, call scoreMatch
//      — idempotent, SET semantics, re-scoring an already-scored row
//      writes the same value
//   4. When every group-stage match is `finished`, call
//      populateRealR32SlotsFromGroupResults to land winner-{A..L} +
//      runner-up-{A..L} real_team_ids
//
// All steps are safe to repeat. A failed mid-flight tick retries next time
// with no double-counting.
//
// Execution model (APT-60 + fix): runs SYNCHRONOUSLY. Scoring is incremental —
// each tick only scores matches that still have unscored predictions (capped at
// SCORE_LIMIT), and the per-user total recompute is parallelized — so an active
// tick finishes in a few seconds, well under the pinger's 30s cap. (An earlier
// version ran the sweep in a fire-and-forget `after()`; the heavy scoring loop
// was truncated after the quick match-upsert, so results updated but scores
// never landed.) Even if a tick runs long, the Vercel function completes
// server-side up to maxDuration, and the next tick re-derives the worklist.

// Headroom for a synchronous tick (and the ?full=1 backstop clearing a backlog).
export const maxDuration = 60;

// Max matches to score per pinger tick. Steady state finishes 0-2 matches per
// window so this is rarely hit; a backlog drains across ticks because the gate
// keeps firing while unscored work remains. ?full=1 ignores the cap.
const SCORE_LIMIT = 5;

type SupabaseClient = ReturnType<typeof createServiceRoleClient>;
type PipelineResult = { ok: boolean } & Record<string, unknown>;

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/poll-results] CRON_SECRET not configured");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  const header = request.headers.get("authorization") ?? "";
  if (header !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiHost = process.env.APIFOOTBALL_HOST;
  const apiKey = process.env.APIFOOTBALL_KEY;
  if (!apiHost || !apiKey) {
    return NextResponse.json(
      { error: "APIFOOTBALL_HOST / APIFOOTBALL_KEY not configured" },
      { status: 500 },
    );
  }

  const supabase = createServiceRoleClient();
  const fullSweep = new URL(request.url).searchParams.get("full") === "1";

  // The ?full=1 backstop always runs the complete sweep (fetch + score all).
  if (fullSweep) {
    const result = await runPipeline(supabase, apiHost, apiKey, {
      fetch: true,
      scoreLimit: Infinity,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  // Pinger path. Two cheap reasons to do work:
  //   inWindow    — a match is in its expected-end window → fetch fresh results
  //   hasUnscored — a finished match still has unscored predictions → score it
  // Gating scoring on hasUnscored (not just inWindow) is what makes a missed
  // scoring self-heal: a match that already flipped to `finished` is no longer
  // in-window, but it's still picked up here until its points land.
  const { data: pending, error: pendingErr } = await supabase
    .from("matches")
    .select("round_id, scheduled_at, status")
    .in("status", ["scheduled", "in_progress"]);
  if (pendingErr) {
    return NextResponse.json(
      { ok: false, stage: "poll-window", reason: pendingErr.message },
      { status: 500 },
    );
  }
  const nowMs = Date.now();
  const inWindow = (pending ?? []).some((m) => isInPollWindow(m, nowMs));

  // Only pay for the unscored-work check when we're not already fetching.
  let proceed = inWindow;
  if (!proceed) {
    const needing = await findMatchesNeedingScoring(supabase, 1);
    if (needing.error) {
      return NextResponse.json(
        { ok: false, stage: "needs-scoring-lookup", reason: needing.error },
        { status: 500 },
      );
    }
    proceed = needing.ids.length > 0;
  }
  if (!proceed) {
    return NextResponse.json({ ok: true, idle: true });
  }

  const result = await runPipeline(supabase, apiHost, apiKey, {
    fetch: inWindow,
    scoreLimit: SCORE_LIMIT,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

/**
 * Matches that still need scoring: `finished`/`cancelled` rows that have at
 * least one prediction with `points_awarded IS NULL`. Oldest-finished first,
 * capped at `limit` (`Infinity` for the full backstop). Two cheap queries; the
 * `points_awarded IS NULL` predicate is the scoring-state flag (no extra column).
 */
async function findMatchesNeedingScoring(
  supabase: SupabaseClient,
  limit: number,
): Promise<{ ids: string[]; error?: string }> {
  const { data: finished, error: finErr } = await supabase
    .from("matches")
    .select("id, finished_at")
    .in("status", ["finished", "cancelled"])
    .order("finished_at", { nullsFirst: true });
  if (finErr) return { ids: [], error: finErr.message };
  const finishedIds = (finished ?? []).map((m) => m.id as string);
  if (finishedIds.length === 0) return { ids: [] };

  const { data: unscored, error: unErr } = await supabase
    .from("predictions")
    .select("match_id")
    .is("points_awarded", null)
    .in("match_id", finishedIds);
  if (unErr) return { ids: [], error: unErr.message };
  const needs = new Set((unscored ?? []).map((r) => r.match_id as string));

  // Preserve oldest-finished order, then cap.
  return { ids: finishedIds.filter((id) => needs.has(id)).slice(0, limit) };
}

// The (optional) fetch+upsert → score → advance sweep. Runs synchronously.
// opts.fetch gates the api-football steps (0-2); opts.scoreLimit caps how many
// matches are scored this tick. Returns a plain result object: { ok: false,
// stage, reason } on a hard DB error; soft api-football hiccups set fetch_skipped
// and still fall through to scoring so a backlog drains.
async function runPipeline(
  supabase: SupabaseClient,
  apiHost: string,
  apiKey: string,
  opts: { fetch: boolean; scoreLimit: number },
): Promise<PipelineResult> {
  let backfill: unknown = { skipped: "fetch disabled" };
  let upserted = 0;
  let fetchSkipped: string | undefined;

  // Steps 0-2 hit api-football, so run them only when a match is in its
  // expected-end window (opts.fetch) or for the ?full=1 backstop. A scoring-
  // only tick skips straight to step 3 and spends no api quota.
  if (opts.fetch) {
    // 0. Backfill knockout fixture ids. The seed leaves them null (api-sports
    // hadn't published the 2026 knockout bracket); as it publishes — possibly
    // incrementally, even before the group stage fully clears — link each
    // published fixture to our match so the steps below ingest/score it.
    // Idempotent; soft-skips on fetch failure.
    backfill = await applyKnockoutBackfill(supabase, apiHost, apiKey);

    // 1. Pull fresh fixtures from api-football. Soft skip on rate limit / 5xx —
    // we still fall through to scoring so any pending backlog drains.
    const fixtures = await fetchFixtures({ host: apiHost, key: apiKey });
    if (!fixtures) {
      fetchSkipped =
        "api-football returned null (rate limit, 5xx, or malformed)";
    } else {
      // 2. Upsert each match. We join by apifootball_fixture_id which the seed
      // already populated for group matches; knockout fixtures don't exist in
      // api-football until FIFA publishes, so they're ignored for now.
      const { data: ourMatches, error: matchErr } = await supabase
        .from("matches")
        .select(
          "id, round_id, apifootball_fixture_id, home_slot_id, away_slot_id, status",
        )
        .not("apifootball_fixture_id", "is", null);
      if (matchErr) {
        return { ok: false, stage: "match-lookup", reason: matchErr.message };
      }
      const matchByFixtureId = new Map<number, (typeof ourMatches)[number]>();
      for (const m of ourMatches ?? []) {
        matchByFixtureId.set(m.apifootball_fixture_id as number, m);
      }

      for (const fx of fixtures) {
        const match = matchByFixtureId.get(fx.apifootball_fixture_id);
        if (!match) continue; // unknown fixture — not in our seed

        const update: Record<string, unknown> = {
          id: match.id,
          status: fx.status,
          home_score: fx.home_score,
          away_score: fx.away_score,
          finished_at: fx.finished_at,
        };

        // Knockout: record which side advanced (single source of truth for
        // scoring + bracket advancement). Group matches never set this.
        // Regulation → higher 90+ET score's slot. Tie → penalty-shootout
        // winner from api-football. Tie with no shootout data yet, or
        // cancelled → leave null; a later tick settles it.
        const isKnockout = !(match.round_id as string).startsWith("group-");
        if (isKnockout && fx.status === "finished") {
          update.winning_slot_id = resolveWinningSlot(fx, match);
        }
        const { error: upErr } = await supabase
          .from("matches")
          .update(update)
          .eq("id", match.id);
        if (upErr) {
          console.error(`[cron] update failed for ${match.id}:`, upErr);
          continue;
        }
        upserted += 1;
      }
    }
  }

  // 3. Score matches that still need it — finished/cancelled rows with any
  // unscored prediction — oldest first, capped (opts.scoreLimit). Re-derived
  // AFTER the upsert so a match that just flipped to finished scores this tick.
  // scoreMatch is idempotent; a failure is logged and retried next tick.
  const work = await findMatchesNeedingScoring(supabase, opts.scoreLimit);
  if (work.error) {
    return { ok: false, stage: "needs-scoring-lookup", reason: work.error };
  }
  let scored = 0;
  for (const id of work.ids) {
    const out = await scoreMatch(supabase, id);
    if (out.ok) {
      if (!out.skipped) scored += 1;
    } else {
      console.error(`[cron] scoreMatch ${id} failed:`, out.reason);
    }
  }

  // 4. Reality advancement. First land the 24 group-driven R32 slot
  // real_team_ids (once every group match is finished). Then advance
  // knockout winners (and SF losers) round-by-round into their downstream
  // slots, and finally score the finalist podium bets. Order matters:
  // knockout advancement reads R32 slots; finalist scoring reads the
  // final/third-place slots that advancement fills. All idempotent.
  const realityOutcome = await populateRealR32SlotsFromGroupResults(supabase);
  const knockoutReality = await populateRealKnockoutSlots(supabase);
  const finalistOutcome = await scoreFinalists(supabase);

  return {
    ok: true,
    fetched: opts.fetch,
    ...(fetchSkipped ? { fetch_skipped: fetchSkipped } : {}),
    backfill,
    upserted,
    scored,
    matches_needing_scoring: work.ids.length,
    reality: realityOutcome,
    knockout_reality: knockoutReality,
    finalists: finalistOutcome,
  };
}

/**
 * Which slot advanced for a finished knockout match. Returns the
 * regulation winner from the 90+ET score, or — when 90+ET was level —
 * the penalty-shootout winner. Null when the result can't decide a side
 * yet (level score with no shootout data ingested), in which case a
 * later tick resolves it.
 */
function resolveWinningSlot(
  fx: FixtureResult,
  match: { home_slot_id: string; away_slot_id: string },
): string | null {
  const h = fx.home_score;
  const a = fx.away_score;
  if (h != null && a != null) {
    if (h > a) return match.home_slot_id;
    if (a > h) return match.away_slot_id;
    // Level after 90+ET → decided on penalties.
    if (fx.penalty_winner === "home") return match.home_slot_id;
    if (fx.penalty_winner === "away") return match.away_slot_id;
  }
  return null;
}
