// Operator tool: preview the 8 real qualifying third-placed groups.
//
// The poll-results cron auto-populates the 8 "best-3rd-vs-{winner}" R32
// slots once the group stage finishes (see lib/reality.ts
// populateRealBestThirdSlotsAuto). This script is the read-only dry-run:
// it runs the exact same resolver (resolveRealQualifyingThirds) and prints
// what WOULD be applied, without writing. Use it to confirm the derived set
// before a round, and — crucially — to spot the boundary-tie case where
// FIFA's disciplinary/drawing-of-lots tiebreak can't be simulated and you
// must set the REAL_QUALIFYING_THIRDS override.
//
// Usage:
//   npx tsx scripts/preview-real-thirds.ts
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
// (targets prod, like the other operator scripts). To preview the override,
// run with REAL_QUALIFYING_THIRDS="A,B,D,E,G,I,K,L" prefixed.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { resolveRealQualifyingThirds } from "../lib/reality";

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
  const override = process.env.REAL_QUALIFYING_THIRDS;
  console.log("=== Real best-third qualifying set (dry-run) ===");
  console.log(
    `REAL_QUALIFYING_THIRDS override: ${override ? `"${override}"` : "(unset)"}`,
  );

  const res = await resolveRealQualifyingThirds(admin);

  if (res.ok === false) {
    console.error(`\n✗ ERROR: ${res.reason}`);
    process.exit(1);
  }
  if ("pending" in res) {
    console.log(`\n⏳ PENDING — nothing will be written yet:`);
    console.log(`   ${res.pending}`);
    return;
  }

  console.log(`\n✓ Would populate 8 best-3rd slots (source: ${res.source}):`);
  console.log(`   qualifying groups: ${res.groups.join(", ")}`);
  console.log(
    "\n   Run the poll-results cron (or wait for the pinger) to apply.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
