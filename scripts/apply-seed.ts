// Apply supabase/seed/fixtures.json to the live Supabase database.
// Issue: APT-10
//
// Idempotent: uses upsert by primary key. Re-running this script after the
// upstream JSON regenerates leaves the DB in the same state.
//
// Usage:
//   npx tsx scripts/apply-seed.ts
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Seed = {
  generated_at: string;
  teams: Array<Record<string, unknown>>;
  rounds: Array<Record<string, unknown>>;
  bracket_slots: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
};

async function upsertBatch<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  conflictKey: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error, count } = await supabase
    .from(table)
    .upsert(rows, { onConflict: conflictKey, count: "exact" })
    .select("*", { count: "exact" });
  if (error) {
    console.error(`Failed to upsert into ${table}:`, error);
    throw error;
  }
  // count from upsert is total matched rows (including no-op upserts);
  // use returned data length as a proxy for "rows touched".
  return data?.length ?? rows.length ?? count ?? 0;
}

async function main() {
  const seedPath = resolve(process.cwd(), "supabase/seed/fixtures.json");
  console.log(`Reading ${seedPath}...`);
  const seed: Seed = JSON.parse(readFileSync(seedPath, "utf-8"));
  console.log(`Seed generated at: ${seed.generated_at}`);
  console.log("");

  // Order matters: teams → rounds → bracket_slots → matches
  // (foreign keys enforce this).

  console.log("[1/4] Upserting teams...");
  const tCount = await upsertBatch("teams", seed.teams, "id");
  console.log(`  ${tCount} teams upserted`);

  console.log("[2/4] Upserting rounds...");
  const rCount = await upsertBatch("rounds", seed.rounds, "id");
  console.log(`  ${rCount} rounds upserted`);

  console.log("[3/4] Upserting bracket_slots...");
  const sCount = await upsertBatch("bracket_slots", seed.bracket_slots, "id");
  console.log(`  ${sCount} bracket_slots upserted`);

  console.log("[4/4] Upserting matches...");
  const mCount = await upsertBatch("matches", seed.matches, "id");
  console.log(`  ${mCount} matches upserted`);

  // Prune bracket_slots no longer in the seed (e.g. the old best-3rd-{1..8}
  // slots replaced by best-3rd-vs-{winner}). Safe only after matches above
  // are re-pointed at the new slots; the annexc_thirdplace migration must
  // have already deleted knockout predictions that referenced the old ones.
  const seedSlotIds = new Set(seed.bracket_slots.map((s) => s.id as string));
  const { data: dbSlots, error: dbSlotsErr } = await supabase
    .from("bracket_slots")
    .select("id");
  if (dbSlotsErr) {
    console.error("Failed to read bracket_slots for pruning:", dbSlotsErr);
    throw dbSlotsErr;
  }
  const orphanIds = (dbSlots ?? [])
    .map((s) => s.id as string)
    .filter((id) => !seedSlotIds.has(id));
  if (orphanIds.length > 0) {
    const { error: pruneErr } = await supabase
      .from("bracket_slots")
      .delete()
      .in("id", orphanIds);
    if (pruneErr) {
      // Non-fatal: a leftover FK (e.g. the pre-migration
      // predicted_third_place_assignments table still referencing old
      // best-3rd-{1..8} slots) means the annexc_thirdplace migration
      // hasn't been applied yet. The upserts above already succeeded;
      // warn loudly and let the run finish rather than abort the seed.
      console.warn(
        `  ⚠️  could not prune ${orphanIds.length} orphan bracket_slots ` +
          `(${pruneErr.code ?? "error"}): ${pruneErr.message}`,
      );
      console.warn(
        "     → apply the annexc_thirdplace migration (supabase migration up " +
          "/ supabase db reset), then re-run seed:apply to clear them.",
      );
    } else {
      console.log(`  pruned ${orphanIds.length} orphan bracket_slots`);
    }
  }

  // Verify final counts
  console.log("\n=== Verifying final row counts ===");
  for (const tbl of ["teams", "rounds", "bracket_slots", "matches"]) {
    const { count, error } = await supabase
      .from(tbl)
      .select("*", { count: "exact", head: true });
    if (error) {
      console.error(`  ${tbl}: error ${error.message}`);
    } else {
      console.log(`  ${tbl}: ${count}`);
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
