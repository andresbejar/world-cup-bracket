// Operator tool: re-score every finished knockout match.
//
// Needed once after introducing the penalty-winner bonus (+1): knockout
// matches that finished BEFORE the deploy were scored under the old
// 3/1/0 rule, so a user who nailed the exact tied score AND the shootout
// winner was stamped 3 instead of 4. The polling cron only re-scores
// matches with *unscored* predictions, so it won't touch these on its
// own. This re-runs scoreMatch (idempotent, SET semantics) on every
// finished/cancelled knockout match, which re-applies the new
// computeMatchPoints and recomputes affected users' total_points.
//
// Safe to run any time; a no-op once every knockout already reflects the
// new rule. Group matches are untouched (the bonus is knockout-only).
//
// Usage:
//   npx tsx scripts/rescore-knockouts.ts
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { scoreMatch } from "../lib/scoring-runtime";

config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: matches, error } = await admin
    .from("matches")
    .select("id, status, rounds(stage)")
    .in("status", ["finished", "cancelled"]);
  if (error) {
    console.error(`✗ match lookup: ${error.message}`);
    process.exit(1);
  }

  const knockouts = (matches ?? []).filter((m) => {
    const round = Array.isArray(m.rounds) ? m.rounds[0] : m.rounds;
    return round?.stage === "knockout";
  });

  if (knockouts.length === 0) {
    console.log("No finished knockout matches to re-score yet.");
    return;
  }

  console.log(`Re-scoring ${knockouts.length} finished knockout match(es)…`);
  let scored = 0;
  for (const m of knockouts) {
    const res = await scoreMatch(admin, m.id as string);
    if (res.ok === false) {
      console.error(`✗ ${m.id}: ${res.reason}`);
      process.exit(1);
    }
    if (res.skipped) {
      console.log(`  ${m.id}: skipped (${res.skipped})`);
    } else {
      console.log(`  ${m.id}: re-scored ${res.scored} prediction(s)`);
      scored += res.scored;
    }
  }
  console.log(`✓ Done. Re-scored ${scored} prediction(s) across ${knockouts.length} match(es).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
