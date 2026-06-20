// Read-only: how many users actually engaged with the best-third-place bet?
//
// Counts predicted_qualifying_thirds rows per user. A "full set" = exactly 8
// selected groups (the bet's capacity). Tells us whether this mechanic sees
// real engagement before we decide to auto-derive / zero it out.
//
// Usage: npx tsx scripts/inspect-third-place-picks.ts
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // Total registered users, for a denominator.
  const { data: authList, error: pErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (pErr) throw pErr;
  const totalProfiles = authList.users.length;

  const { data: rows, error } = await admin
    .from("predicted_qualifying_thirds")
    .select("user_id, group_letter");
  if (error) throw error;

  const perUser = new Map<string, number>();
  for (const r of rows ?? []) {
    perUser.set(r.user_id as string, (perUser.get(r.user_id as string) ?? 0) + 1);
  }

  const counts = [...perUser.values()];
  const full8 = counts.filter((c) => c === 8).length;
  const partial = counts.filter((c) => c > 0 && c < 8).length;
  const usersWithAny = perUser.size;

  // Distribution of selection sizes.
  const dist = new Map<number, number>();
  for (const c of counts) dist.set(c, (dist.get(c) ?? 0) + 1);

  console.log("=== Best-third-place bet engagement (PROD) ===");
  console.log(`Total profiles:                ${totalProfiles ?? "?"}`);
  console.log(`Users with >=1 group selected: ${usersWithAny}`);
  console.log(`Users with a FULL set of 8:    ${full8}`);
  console.log(`Users with a partial set:      ${partial}`);
  console.log(`Total pqt rows:                ${rows?.length ?? 0}`);
  console.log("\nSelection-size distribution (groups selected -> #users):");
  for (const n of [...dist.keys()].sort((a, b) => a - b)) {
    console.log(`  ${n} groups -> ${dist.get(n)} user(s)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
