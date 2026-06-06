// Operator scrub: remove *impossible* match results from the live database.
//
// A match whose scheduled kickoff is still in the future cannot have been
// played, so a `finished` status (or a non-null score / finished_at) on it is
// stranded data — almost always from an e2e run (scoring-loop.spec) that was
// interrupted before its afterAll restore ran against the shared DB. Symptom:
// the app shows bogus "FINAL" cards (e.g. MEX 2-1 RSA) before the tournament.
//
// Reuses resetStrandedMatchResults (e2e/helpers.ts) — the same self-heal the
// e2e global-setup runs. The future-date predicate makes this safe to run at
// any time; it can never wipe a legitimately-finished past match.
//
// Usage:
//   npx tsx scripts/reset-match-results.ts
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { resetStrandedMatchResults } from "../e2e/helpers";
import { THIRD_PLACE_SLOT_LABELS } from "../lib/bracket";

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
  console.log(`Target: ${SUPABASE_URL}`);

  // Before: which future-dated matches currently look "played" (mirrors the
  // helper's predicate — finished/in_progress or carrying score data;
  // `cancelled` is a legitimate terminal state and left alone).
  const { data: before, error: beforeErr } = await admin
    .from("matches")
    .select("id, status, home_score, away_score, scheduled_at")
    .gt("scheduled_at", new Date().toISOString())
    .or(
      "status.eq.finished,status.eq.in_progress,home_score.not.is.null,away_score.not.is.null,finished_at.not.is.null",
    )
    .order("scheduled_at", { ascending: true });
  if (beforeErr) throw beforeErr;

  if (!before || before.length === 0) {
    console.log("\n✓ No stranded match results — nothing to reset.");
  } else {
    console.log(`\nStranded matches (${before.length}):`);
    for (const m of before) {
      console.log(
        `  ${m.id}  status=${m.status}  score=${m.home_score}-${m.away_score}  kickoff=${m.scheduled_at}`,
      );
    }

    const out = await resetStrandedMatchResults(admin);
    if (out.skipped === "tournament-started") {
      console.warn(
        "\n⚠️  Refusing to auto-reset: the tournament has started (a match has " +
          "kicked off). Future-dated 'played' rows may be legitimate reschedules — " +
          "inspect and fix manually rather than blindly resetting.",
      );
    } else {
      console.log(
        `\n✓ Reset ${out.matchesReset.length} match(es) to 'scheduled'; ` +
          `cleared ${out.scoringCleared} prediction scoring row(s).`,
      );
    }
  }

  // Sanity: knockout real_team_id slots should still be null pre-tournament
  // (populateRealR32SlotsFromGroupResults only fires once ALL group matches
  // finish). Flag anything unexpected for manual review.
  const { data: thirdSlots, error: slotErr } = await admin
    .from("bracket_slots")
    .select("slot_label, real_team_id")
    .in("slot_label", [...THIRD_PLACE_SLOT_LABELS])
    .not("real_team_id", "is", null);
  if (slotErr) throw slotErr;
  if (thirdSlots && thirdSlots.length > 0) {
    console.warn(
      `\n⚠️  ${thirdSlots.length} third-place slot(s) carry a real_team_id — ` +
        `unexpected pre-tournament, review manually:`,
      thirdSlots,
    );
  } else {
    console.log("✓ Knockout third-place slots are clean (no real_team_id).");
  }

  // After: confirm idempotency / users restored.
  const { data: nonZero, error: usersErr } = await admin
    .from("users")
    .select("username, total_points")
    .gt("total_points", 0);
  if (usersErr) throw usersErr;
  if (nonZero && nonZero.length > 0) {
    console.log(
      `\nNote: ${nonZero.length} user(s) still have total_points > 0 ` +
        `(legitimate if real matches have been scored):`,
      nonZero.map((u) => `${u.username}=${u.total_points}`).join(", "),
    );
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
