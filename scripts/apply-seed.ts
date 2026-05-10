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
