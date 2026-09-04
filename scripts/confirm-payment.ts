// Operator action: manually mark a participant as PAID + CONFIRMED in the prize
// pool by upserting their public.pool_entries row to status='confirmed'.
//
// Normal flow is two-step: the user taps "I paid" in /pool (creates a 'claimed'
// row), then an admin clicks "Confirm" on the roster (flips it to 'confirmed').
// Use this script when someone paid out-of-band and never tapped "I paid", so
// there's no row for the admin Confirm button to act on. It does both steps at
// once with the service-role client (RLS would otherwise block inserting another
// user's entry), satisfying the table's check constraint by stamping
// confirmed_at + confirmed_by.
//
// The target must already be a real user (they have to have signed in at least
// once). confirmed_by must be an admin user id; it defaults to the first id in
// ADMIN_USER_IDS, or pass --by=<admin_user_id> explicitly.
//
// Usage:
//   npx tsx scripts/confirm-payment.ts <user_id|email>                  # method defaults to 'other'
//   npx tsx scripts/confirm-payment.ts <user_id|email> --method=venmo
//   npx tsx scripts/confirm-payment.ts <user_id|email> --by=<admin_id>  # who is confirming
//   npx tsx scripts/confirm-payment.ts <user_id|email> --notes="paid cash 6/10"
//   npx tsx scripts/confirm-payment.ts <user_id|email> --yes            # skip the confirm prompt
//
// Reverse it with the "Undo" button on /pool (sets the row back to 'claimed'),
// or re-run elsewhere — this script is idempotent (re-confirming is a no-op).
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
// (prod, per CLAUDE.md operator-script convention). ADMIN_USER_IDS optional.

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

const PAYMENT_METHODS = ["venmo", "zelle", "cashapp", "paypal", "other"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--") && !a.includes("=")));
const opts = new Map(
  args
    .filter((a) => a.startsWith("--") && a.includes("="))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split("=");
      return [k, rest.join("=")];
    }),
);
const target = args.find((a) => !a.startsWith("--"));
const skipConfirm = flags.has("--yes");
const method = (opts.get("method") ?? "other") as PaymentMethod;
const notes = opts.get("notes") ?? null;

if (!target) {
  console.error(
    "Usage: npx tsx scripts/confirm-payment.ts <user_id|email> " +
      "[--method=venmo|zelle|cashapp|paypal|other] [--by=<admin_id>] " +
      '[--notes="..."] [--yes]',
  );
  process.exit(1);
}

if (!PAYMENT_METHODS.includes(method)) {
  console.error(
    `Invalid --method=${method}. Allowed: ${PAYMENT_METHODS.join(", ")}`,
  );
  process.exit(1);
}

// confirmed_by defaults to the first id in ADMIN_USER_IDS (same parse as
// lib/auth-guard.ts), overridable with --by=.
function firstAdminId(): string | undefined {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0];
}
const confirmedBy = opts.get("by") ?? firstAdminId();

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

async function lookupUser(idOrEmail: string) {
  const col = idOrEmail.includes("@") ? "email" : "id";
  const { data, error } = await admin
    .from("users")
    .select("id, username, email, is_banned")
    .eq(col, idOrEmail)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function main() {
  console.log(`Target DB: ${SUPABASE_URL}`);

  // Resolve the participant. Must be a real user (signed in at least once).
  const user = await lookupUser(target!);
  if (!user) {
    console.error(
      `\n✗ No user found matching "${target}". ` +
        "They must sign in to the app at least once before they can be added to the pool.",
    );
    process.exit(1);
  }

  // confirmed_by must be a real admin user id (the table FKs it to users.id).
  if (!confirmedBy) {
    console.error(
      "\n✗ No confirmer. Set ADMIN_USER_IDS in .env.local or pass --by=<your_admin_user_id>.",
    );
    process.exit(1);
  }
  const confirmer = await lookupUser(confirmedBy);
  if (!confirmer) {
    console.error(`\n✗ --by=${confirmedBy} is not a real user id.`);
    process.exit(1);
  }

  // Is there already an entry? (idempotency + context)
  const { data: existing, error: exErr } = await admin
    .from("pool_entries")
    .select("status, method, confirmed_at, confirmed_by")
    .eq("user_id", user.id)
    .maybeSingle();
  if (exErr) throw exErr;

  console.log(
    `\nUser: ${user.username ?? "(no username)"} <${user.email}>` +
      `\n  id:            ${user.id}` +
      `\n  current entry: ${existing ? `${existing.status} (method=${existing.method})` : "none"}` +
      `\n  → set to:      confirmed (method=${method})` +
      `\n  confirmed_by:  ${confirmer.username ?? confirmer.email} (${confirmer.id})`,
  );

  if (existing?.status === "confirmed") {
    console.log("\n✓ Already confirmed — nothing to do (idempotent).");
    return;
  }

  if (!(await confirm(`\nMark ${user.username ?? user.email} as PAID + confirmed?`))) {
    console.log("Aborted — no changes made.");
    return;
  }

  // upsert on the user_id primary key: creates the row if absent, promotes a
  // 'claimed' row to 'confirmed' if present. confirmed_at/by satisfy the
  // status='confirmed' check constraint.
  const { error: upErr } = await admin.from("pool_entries").upsert(
    {
      user_id: user.id,
      status: "confirmed",
      method,
      notes,
      confirmed_at: new Date().toISOString(),
      confirmed_by: confirmer.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upErr) throw upErr;

  console.log(
    `\n✓ ${user.username ?? user.email} is now PAID + confirmed (method=${method}).` +
      `\n  Reverse via the "Undo" button on /pool, or it shows immediately in the roster.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
