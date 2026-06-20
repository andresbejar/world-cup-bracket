// Operator tool: recompute every user's total_points from scratch.
//
// One-time hygiene after retiring the best-third-placed side bet (it now
// contributes 0 — see lib/scoring-runtime.ts). Because the real qualifying
// set was never settled, current totals shouldn't actually include any
// third-place points, so this is normally a no-op — but it's the safe way
// to guarantee no stored total carries a stale bonus. Idempotent.
//
// Usage:
//   npx tsx scripts/recompute-totals.ts
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { recomputeAllUserTotals } from "../lib/scoring-runtime";

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
  const res = await recomputeAllUserTotals(admin);
  if (res.ok === false) {
    console.error(`✗ ${res.reason}`);
    process.exit(1);
  }
  console.log(`✓ Recomputed total_points for ${res.recomputed} user(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
