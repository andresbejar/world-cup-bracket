// Operator tool: backfill api-football fixture ids for knockout matches.
//
// The hourly poll-results cron already does this automatically (see
// lib/knockout-backfill.ts applyKnockoutBackfill). This script is the
// manual equivalent for one-off inspection / forcing a run: it prints the
// proposed mapping (dry-run) and only writes with --apply. Both paths
// share the same pure planner, so they can't drift.
//
// Usage:
//   npx tsx scripts/backfill-knockout-fixtures.ts            # dry-run
//   npx tsx scripts/backfill-knockout-fixtures.ts --apply    # write
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
// APIFOOTBALL_HOST + APIFOOTBALL_KEY from .env.local (targets prod, like
// the other operator scripts).

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import {
  fetchKnockoutFixtureRefs,
  planKnockoutBackfill,
  type OurKnockoutMatch,
} from "../lib/knockout-backfill";

config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const API_HOST = process.env.APIFOOTBALL_HOST!;
const API_KEY = process.env.APIFOOTBALL_KEY!;
const APPLY = process.argv.includes("--apply");

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!API_HOST || !API_KEY) {
  console.error("Missing APIFOOTBALL_HOST or APIFOOTBALL_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log(`Target: ${SUPABASE_URL}  (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  const published = await fetchKnockoutFixtureRefs(API_HOST, API_KEY);
  if (!published) {
    console.error("api-sports fetch failed (rate limit / 5xx / malformed). Try again later.");
    process.exit(1);
  }
  const knockoutCount = published.filter((f) => !/group/i.test(f.round)).length;
  if (knockoutCount === 0) {
    console.log("api-sports has not published any 2026 knockout fixtures yet — nothing to backfill.");
    console.log("Re-run once the knockout bracket appears in the feed (the hourly cron also checks).");
    return;
  }

  const { data: ours, error } = await admin
    .from("matches")
    .select("id, round_id, scheduled_at, apifootball_fixture_id")
    .not("round_id", "like", "group-%")
    .order("scheduled_at", { ascending: true });
  if (error) throw error;

  const plan = planKnockoutBackfill(published, (ours ?? []) as OurKnockoutMatch[]);

  if (plan.warnings.length) {
    console.log("Warnings:");
    for (const w of plan.warnings) console.log(`  ⚠️  ${w}`);
    console.log();
  }

  if (plan.assignments.length === 0) {
    console.log("Nothing to link — every publishable knockout match already has its fixture id.");
    return;
  }

  console.log("Proposed links (our match ← api fixture):");
  for (const a of plan.assignments) {
    console.log(`  ${a.match_id.padEnd(16)} ← ${a.fixture_id}  (${a.round_id}, Δ${Math.round(a.delta_ms / 60000)}min)`);
  }

  if (!APPLY) {
    console.log(`\n✓ Dry-run OK (${plan.assignments.length} to link). Re-run with --apply to write.`);
    return;
  }

  let written = 0;
  for (const a of plan.assignments) {
    const { error: updErr } = await admin
      .from("matches")
      .update({ apifootball_fixture_id: a.fixture_id })
      .eq("id", a.match_id);
    if (updErr) {
      console.error(`✗ link ${a.match_id}→${a.fixture_id}: ${updErr.message}`);
      process.exit(1);
    }
    written += 1;
  }
  console.log(`\n✓ Linked ${written} knockout match(es). The hourly cron will ingest them from here.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
