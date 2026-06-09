// Operator action: ban (or unban) a participant by flipping users.is_banned.
//
// A banned user vanishes from the leaderboard immediately — loadLeaderboard
// (lib/leaderboard-data.ts) filters `is_banned = false` — and every write path
// rejects via requireActiveUser (lib/auth-guard.ts). Their predictions and pool
// entry are PRESERVED, so this is fully reversible: re-run with --unban.
//
// This is the same single-column mutation the POST /api/admin/moderate endpoint
// performs with the service-role client; doing it as a script sidesteps needing
// an admin session cookie / the admin UI (there isn't one).
//
// Usage:
//   npx tsx scripts/ban-user.ts <user_id>            # ban
//   npx tsx scripts/ban-user.ts <user_id> --unban    # reverse
//   npx tsx scripts/ban-user.ts <user_id> --yes      # skip the confirm prompt
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
// (prod, per CLAUDE.md operator-script convention).

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const userId = args.find((a) => !a.startsWith("--"));
const unban = flags.has("--unban");
const skipConfirm = flags.has("--yes");
const targetBanned = !unban; // ban => true, unban => false

if (!userId) {
  console.error(
    "Usage: npx tsx scripts/ban-user.ts <user_id> [--unban] [--yes]",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function confirm(question: string): Promise<boolean> {
  if (skipConfirm) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main() {
  console.log(`Target DB: ${SUPABASE_URL}`);
  const action = unban ? "UNBAN" : "BAN";

  // Look up the target so we operate on a real, named row (not a silent no-op).
  const { data: user, error: lookupErr } = await admin
    .from("users")
    .select("id, username, email, is_banned, total_points")
    .eq("id", userId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!user) {
    console.error(`\n✗ No user found with id ${userId}`);
    process.exit(1);
  }

  console.log(
    `\nUser: ${user.username} <${user.email}>` +
      `\n  id:          ${user.id}` +
      `\n  is_banned:   ${user.is_banned}` +
      `\n  total_points:${user.total_points}`,
  );

  if (user.is_banned === targetBanned) {
    console.log(
      `\n✓ Already is_banned=${targetBanned} — nothing to do (idempotent).`,
    );
    return;
  }

  // How many scored predictions are being hidden (not deleted) — context only.
  const { count: predCount } = await admin
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  console.log(
    `\n${action} will set is_banned=${targetBanned}. ` +
      `${predCount ?? 0} prediction row(s) are PRESERVED (hidden, not deleted).` +
      (unban ? "" : " They will disappear from the leaderboard immediately."),
  );

  if (!(await confirm(`\nProceed to ${action} ${user.username}?`))) {
    console.log("Aborted — no changes made.");
    return;
  }

  const { error: updateErr } = await admin
    .from("users")
    .update({ is_banned: targetBanned })
    .eq("id", userId);
  if (updateErr) throw updateErr;

  console.log(
    `\n✓ ${action} complete: ${user.username} is_banned ` +
      `${user.is_banned} → ${targetBanned}.` +
      (unban ? "" : " Reverse with: npx tsx scripts/ban-user.ts " + userId + " --unban"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
