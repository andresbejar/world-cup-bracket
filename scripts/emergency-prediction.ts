// Operator action: write a single match-score prediction on behalf of a user,
// for emergency cases ONLY — e.g. a pool member who had their picks ready (you
// have a pre-kickoff screenshot as evidence) but never submitted them before the
// round locked. The normal /api/predictions route and Supabase RLS both refuse
// writes once rounds.locked_at / deadline_at pass; this uses the service-role
// client to bypass that lock the same way the scoring engine and cron do.
//
// TWO HARD SAFETY RULES (see plan / CLAUDE.md anti-cheat intent):
//   1. Admin-gated. --by must be an admin user id (in ADMIN_USER_IDS); defaults
//      to the first id there. This is the explicit operator-identity check on
//      top of merely possessing the service-role key.
//   2. Insert-only — NEVER overwrites. predictions has NOT NULL scores + a
//      unique(user_id, match_id), so "empty score" == no row exists. If a row is
//      already there, the script prints it and refuses. It can fill a gap but can
//      never alter a real pick after results are known. Uses .insert() (not the
//      route's upsert), so the unique constraint is a second line of defense.
//
// Run it once per missed match, confirming each preview against the screenshot.
// The console output is the audit record — keep it (and the screenshot).
//
// Usage:
//   npx tsx scripts/emergency-prediction.ts <user_id|email> <match_id> <home> <away>
//   npx tsx scripts/emergency-prediction.ts <user|email> <match_id> 1 1 --winner=<slot_id>  # tied knockout
//   npx tsx scripts/emergency-prediction.ts <user|email> <match_id> 2 0 --by=<admin_id>
//   npx tsx scripts/emergency-prediction.ts <user|email> <match_id> 2 0 --yes   # skip the prompt
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
// (prod, per CLAUDE.md operator-script convention). ADMIN_USER_IDS required.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { isAdminUserId } from "../lib/auth-guard";
import { checkRoundLock, validateKnockoutPrediction } from "../lib/lock-check";

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
const flags = new Set(args.filter((a) => a.startsWith("--") && !a.includes("=")));
const opts = new Map(
  args
    .filter((a) => a.startsWith("--") && a.includes("="))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split("=");
      return [k, rest.join("=")];
    }),
);
const positionals = args.filter((a) => !a.startsWith("--"));
const [target, matchId, homeRaw, awayRaw] = positionals;
const skipConfirm = flags.has("--yes");
const winnerSlotId = opts.get("winner") ?? null;

const USAGE =
  "Usage: npx tsx scripts/emergency-prediction.ts <user_id|email> <match_id> " +
  "<home> <away> [--winner=<slot_id>] [--by=<admin_id>] [--yes]";

if (!target || !matchId || homeRaw === undefined || awayRaw === undefined) {
  console.error(USAGE);
  process.exit(1);
}

// Score validation mirrors app/api/predictions/route.ts::parseBody: integers 0-20.
function parseScore(raw: string, label: string): number {
  if (!/^\d+$/.test(raw)) {
    console.error(`✗ ${label} must be a non-negative integer (got "${raw}").`);
    process.exit(1);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 20) {
    console.error(`✗ ${label} must be an integer 0-20 (got "${raw}").`);
    process.exit(1);
  }
  return n;
}
const home = parseScore(homeRaw, "home");
const away = parseScore(awayRaw, "away");

// --by defaults to the first id in ADMIN_USER_IDS (same parse as lib/auth-guard).
function firstAdminId(): string | undefined {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0];
}
const actingAdminId = opts.get("by") ?? firstAdminId();

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

  // 1. Admin gate. The acting admin must be configured in ADMIN_USER_IDS AND be a
  //    real user row — service-role possession alone isn't enough.
  if (!actingAdminId) {
    console.error(
      "\n✗ No admin. Set ADMIN_USER_IDS in .env.local or pass --by=<your_admin_user_id>.",
    );
    process.exit(1);
  }
  if (!isAdminUserId(actingAdminId)) {
    console.error(
      `\n✗ --by=${actingAdminId} is not in ADMIN_USER_IDS — only admins may run this.`,
    );
    process.exit(1);
  }
  const actingAdmin = await lookupUser(actingAdminId);
  if (!actingAdmin) {
    console.error(`\n✗ --by=${actingAdminId} is not a real user id.`);
    process.exit(1);
  }

  // 2. Resolve the target user.
  const user = await lookupUser(target!);
  if (!user) {
    console.error(`\n✗ No user found matching "${target}".`);
    process.exit(1);
  }
  if (user.is_banned) {
    console.error(
      `\n✗ ${user.username ?? user.email} is banned — refusing to write predictions for a banned user.`,
    );
    process.exit(1);
  }

  // 3. Resolve the match + its round (for lock context + stage).
  const { data: match, error: matchErr } = await admin
    .from("matches")
    .select(
      "id, round_id, home_slot_id, away_slot_id, scheduled_at, status, " +
        "rounds(name, stage, locked_at, deadline_at)",
    )
    .eq("id", matchId)
    .maybeSingle();
  if (matchErr) throw matchErr;
  if (!match) {
    console.error(`\n✗ No match found with id "${matchId}".`);
    process.exit(1);
  }
  const round = (
    Array.isArray(match.rounds) ? match.rounds[0] : match.rounds
  ) as { name: string; stage: string; locked_at: string | null; deadline_at: string } | null;
  if (!round) {
    console.error(`\n✗ Match ${matchId} has no associated round.`);
    process.exit(1);
  }

  // Resolve slot labels + (where known) the real team names for a readable preview.
  const { data: slots, error: slotsErr } = await admin
    .from("bracket_slots")
    .select("id, slot_label, real_team_id")
    .in("id", [match.home_slot_id, match.away_slot_id]);
  if (slotsErr) throw slotsErr;
  const slotById = new Map((slots ?? []).map((s) => [s.id, s]));
  const teamIds = (slots ?? [])
    .map((s) => s.real_team_id)
    .filter((id): id is string => !!id);
  const teamById = new Map<string, string>();
  if (teamIds.length > 0) {
    const { data: teams, error: teamsErr } = await admin
      .from("teams")
      .select("id, name")
      .in("id", teamIds);
    if (teamsErr) throw teamsErr;
    for (const t of teams ?? []) teamById.set(t.id, t.name);
  }
  const sideLabel = (slotId: string): string => {
    const slot = slotById.get(slotId);
    if (!slot) return slotId;
    const team = slot.real_team_id ? teamById.get(slot.real_team_id) : null;
    return team ? `${team} [${slot.slot_label}]` : slot.slot_label;
  };

  // 4. Knockout tie validation (mirrors the prediction UX + server rule).
  const stage: "group" | "knockout" = round.stage === "group" ? "group" : "knockout";
  if (winnerSlotId && ![match.home_slot_id, match.away_slot_id].includes(winnerSlotId)) {
    console.error(
      `\n✗ --winner=${winnerSlotId} is not a slot in this match ` +
        `(home=${match.home_slot_id}, away=${match.away_slot_id}).`,
    );
    process.exit(1);
  }
  const knockout = validateKnockoutPrediction({
    stage,
    home_score: home,
    away_score: away,
    predicted_winning_slot_id: winnerSlotId,
  });
  if (!knockout.ok) {
    console.error(`\n✗ ${knockout.error}. Pass --winner=<slot_id> (home or away).`);
    process.exit(1);
  }

  // Lock status — informational. This tool is *meant* to bypass the lock, so we
  // proceed regardless; showing it confirms the operator is acting on a closed round.
  const lock = checkRoundLock(
    { locked_at: round.locked_at, deadline_at: round.deadline_at },
    Date.now(),
  );
  const lockDesc = lock.editable
    ? "OPEN (round still editable — user could submit normally!)"
    : lock.reason === "locked"
      ? `LOCKED (admin-closed at ${lock.locked_at})`
      : `PAST DEADLINE (${lock.deadline_at})`;

  // 5. Anti-cheat existence check — refuse if a prediction already exists.
  const { data: existing, error: exErr } = await admin
    .from("predictions")
    .select("id, predicted_home_score, predicted_away_score, points_awarded")
    .eq("user_id", user.id)
    .eq("match_id", matchId)
    .maybeSingle();
  if (exErr) throw exErr;
  if (existing) {
    console.error(
      `\n✗ A prediction already exists for ${user.username ?? user.email} on this match ` +
        `(${existing.predicted_home_score}-${existing.predicted_away_score}, ` +
        `points_awarded=${existing.points_awarded ?? "null"}).` +
        "\n  This tool only fills MISSING predictions — it never overwrites. Refusing.",
    );
    process.exit(1);
  }

  // 6. Preview + confirm.
  console.log(
    `\nAdmin (by):  ${actingAdmin.username ?? actingAdmin.email} (${actingAdmin.id})` +
      `\nFor user:    ${user.username ?? "(no username)"} <${user.email}> (${user.id})` +
      `\nMatch:       ${match.id} — ${round.name} (${round.stage})` +
      `\n  ${sideLabel(match.home_slot_id)}  vs  ${sideLabel(match.away_slot_id)}` +
      `\n  kickoff:   ${match.scheduled_at}  (status=${match.status})` +
      `\n  lock:      ${lockDesc}` +
      `\nPrediction:  ${home} - ${away}` +
      (winnerSlotId ? `  (penalty winner: ${sideLabel(winnerSlotId)})` : ""),
  );

  if (lock.editable) {
    console.warn(
      "\n⚠️  This round is still OPEN — the user can submit this themselves. " +
        "Only use this tool when they genuinely cannot.",
    );
  }

  if (!(await confirm(`\nWrite this prediction on behalf of ${user.username ?? user.email}?`))) {
    console.log("Aborted — no changes made.");
    return;
  }

  // 7. INSERT (not upsert) — the unique(user_id, match_id) constraint rejects
  //    (23505) on any race rather than overwriting. points_awarded left null so
  //    the scoring engine picks it up idempotently when the match finishes.
  const { error: insErr } = await admin.from("predictions").insert({
    user_id: user.id,
    match_id: matchId,
    predicted_home_score: home,
    predicted_away_score: away,
    predicted_winning_slot_id: winnerSlotId,
  });
  if (insErr) {
    if (insErr.code === "23505") {
      console.error(
        "\n✗ A prediction was just created concurrently — refusing to overwrite.",
      );
      process.exit(1);
    }
    throw insErr;
  }

  console.log(
    `\n✓ Wrote prediction ${home}-${away} for ${user.username ?? user.email} on ${match.id} ` +
      `(by admin ${actingAdmin.username ?? actingAdmin.email}).` +
      "\n  Keep this output + the screenshot as the audit record.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
