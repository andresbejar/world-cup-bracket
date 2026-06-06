// Read-only post-deploy verifier for the Annex C R32 change. Checks the DB
// pointed at by .env.local (intended: prod, after the migration + reseed).
// Exits non-zero if anything is off. Safe to run anytime — no writes.
//
// Usage: npx tsx scripts/verify-annexc-deploy.ts

import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !SERVICE_ROLE) {
  console.error("Missing Supabase env in .env.local");
  process.exit(1);
}

const supabase = createClient(URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "✓" : "✗"} ${label}: ${detail}`);
  if (!ok) failures++;
}

async function main() {
  console.log(`Verifying ${URL}\n`);

  // New table exists and is queryable.
  const pqt = await supabase
    .from("predicted_qualifying_thirds")
    .select("*", { count: "exact", head: true });
  check(
    "predicted_qualifying_thirds exists",
    !pqt.error,
    pqt.error ? pqt.error.message : `ok (${pqt.count ?? 0} rows)`,
  );

  // Old table is gone (querying it should error).
  const old = await supabase
    .from("predicted_third_place_assignments")
    .select("*", { head: true });
  check(
    "predicted_third_place_assignments dropped",
    !!old.error,
    old.error ? "gone (good)" : "STILL EXISTS — migration didn't run",
  );

  // Bracket slots: 8 new best-3rd-vs slots, 0 old, 112 total.
  const slots = await supabase.from("bracket_slots").select("slot_label");
  if (slots.error) {
    check("bracket_slots query", false, slots.error.message);
  } else {
    const labels = (slots.data ?? []).map((s) => s.slot_label as string);
    const vs = labels.filter((l) => l.startsWith("best-3rd-vs-")).length;
    const oldN = labels.filter((l) => /^best-3rd-[0-9]+$/.test(l)).length;
    check("best-3rd-vs slots", vs === 8, `${vs} (expect 8)`);
    check("old best-3rd-N slots pruned", oldN === 0, `${oldN} (expect 0)`);
    check("bracket_slots total", labels.length === 112, `${labels.length} (expect 112)`);
  }

  // Matches: 104 total, and a spot-check that R32 match 7 is winner-A vs the
  // Annex-C third slot (proves the new structure is live).
  const matches = await supabase
    .from("matches")
    .select("*", { count: "exact", head: true });
  check("matches total", matches.count === 104, `${matches.count} (expect 104)`);

  const slotById = await supabase.from("bracket_slots").select("id, slot_label");
  const labelById = new Map(
    (slotById.data ?? []).map((s) => [s.id as string, s.slot_label as string]),
  );
  const m7 = await supabase
    .from("matches")
    .select("home_slot_id, away_slot_id")
    .eq("id", "m-r32-7")
    .maybeSingle();
  if (m7.data) {
    const home = labelById.get(m7.data.home_slot_id as string);
    const away = labelById.get(m7.data.away_slot_id as string);
    check(
      "m-r32-7 wired to FIFA structure",
      home === "winner-A" && away === "best-3rd-vs-A",
      `${home} vs ${away} (expect winner-A vs best-3rd-vs-A)`,
    );
  } else {
    check("m-r32-7 present", false, "match not found");
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify failed:", e);
  process.exit(1);
});
