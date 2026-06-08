import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { fetchFixtures, type FixtureResult } from "@/lib/apifootball";
import { scoreMatch, scoreFinalists } from "@/lib/scoring-runtime";
import {
  populateRealR32SlotsFromGroupResults,
  populateRealKnockoutSlots,
} from "@/lib/reality";

// POST /api/cron/poll-results
//
// Hourly polling job — triggered by .github/workflows/poll-results.yml.
// Authorization: Bearer <CRON_SECRET> required; non-cron callers get 401.
//
// Lifecycle:
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
// All four steps are safe to repeat. A failed mid-flight tick retries
// next hour with no double-counting.
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

  // 1. Pull fresh fixtures from api-football. Soft skip on rate limit / 5xx.
  const fixtures = await fetchFixtures({ host: apiHost, key: apiKey });
  if (!fixtures) {
    return NextResponse.json({
      ok: true,
      stage: "fetch",
      skipped: "api-football returned null (rate limit, 5xx, or malformed)",
    });
  }

  // 2. Upsert each match. We join by apifootball_fixture_id which the
  // seed already populated for group matches; knockout fixtures don't
  // exist in api-football until FIFA publishes, so they're ignored
  // for now.
  const { data: ourMatches, error: matchErr } = await supabase
    .from("matches")
    .select(
      "id, round_id, apifootball_fixture_id, home_slot_id, away_slot_id, status",
    )
    .not("apifootball_fixture_id", "is", null);
  if (matchErr) {
    return NextResponse.json(
      { ok: false, stage: "match-lookup", reason: matchErr.message },
      { status: 500 },
    );
  }
  const matchByFixtureId = new Map<number, (typeof ourMatches)[number]>();
  for (const m of ourMatches ?? []) {
    matchByFixtureId.set(m.apifootball_fixture_id as number, m);
  }

  let upserted = 0;
  const newlyFinished: string[] = [];
  for (const fx of fixtures) {
    const match = matchByFixtureId.get(fx.apifootball_fixture_id);
    if (!match) continue; // unknown fixture — not in our seed
    const wasFinished =
      match.status === "finished" || match.status === "cancelled";
    const willBeFinished =
      fx.status === "finished" || fx.status === "cancelled";

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
    if (!wasFinished && willBeFinished) {
      newlyFinished.push(match.id);
    }
  }

  // 3. Score every match that's now in a terminal state. scoreMatch
  // is idempotent so re-running on already-scored rows is fine.
  // Iterate over ALL finished matches, not just newly-finished, so
  // we catch any that the polling job missed on a previous tick
  // (e.g., score wrote but scoring failed before the next loop iter).
  const { data: finishedRows, error: finErr } = await supabase
    .from("matches")
    .select("id")
    .in("status", ["finished", "cancelled"]);
  if (finErr) {
    return NextResponse.json(
      { ok: false, stage: "finished-lookup", reason: finErr.message },
      { status: 500 },
    );
  }
  let scored = 0;
  for (const m of finishedRows ?? []) {
    const out = await scoreMatch(supabase, m.id as string);
    if (out.ok) {
      if (!out.skipped) scored += 1;
    } else {
      console.error(`[cron] scoreMatch ${m.id} failed:`, out.reason);
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

  return NextResponse.json({
    ok: true,
    upserted,
    scored,
    newly_finished: newlyFinished.length,
    reality: realityOutcome,
    knockout_reality: knockoutReality,
    finalists: finalistOutcome,
  });
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
