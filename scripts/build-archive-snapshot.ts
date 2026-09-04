// Operator tool: freeze the finished tournament into a committed JSON
// snapshot, so the deployed archive needs no database at all.
//
// Why this exists
// ---------------
// The World Cup 2026 is over and this app is being retired into a
// permanent, publicly-viewable, read-only artifact. The alternative --
// keeping the pages reading from Supabase -- ties the archive's uptime to
// a free-tier project that auto-pauses after ~7 days of inactivity. A
// portfolio link that 500s months later is the exact failure this avoids.
//
// After this runs, `data/archive-snapshot.json` IS the database. Every
// page reads it via lib/archive.ts, nothing touches `cookies()`, so Next
// prerenders the whole site to static HTML and both Supabase projects can
// be deleted outright.
//
// Two invariants this script must preserve
// ----------------------------------------
//   1. PAGINATE the predictions read. The leaderboard's exact/outcome
//      counts silently undercounted once scored predictions crossed
//      PostgREST's 1000-row default cap (see
//      docs/leaderboard-counts-explainer.md). Baking that bug into a
//      frozen-forever archive would be permanent, so we reuse
//      fetchAllScoredPredictions' paging shape rather than a bare select.
//   2. NO auth UUIDs in the output. Predictions are re-keyed by username
//      slug, which is already unique and already public on the
//      leaderboard. There is no reason to publish auth.users ids.
//
// Avatars are downloaded and rewritten to local paths. `profile_pic` is a
// hotlinked lh3.googleusercontent.com URL; those rotate, and on a
// permanent archive they would eventually decay into 16 broken images.
//
// Usage:
//   npx tsx scripts/build-archive-snapshot.ts [--dry-run]
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { computeLeaderboard } from "../lib/bracket";
import type {
  LeaderboardEntry,
  LeaderboardUser,
  ScoredPrediction,
  FinalStandings,
} from "../lib/bracket";
import { deriveFinalStandings } from "../lib/scoring-runtime";
import { resolveActiveRoundId } from "../lib/active-round";

config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const OUT_JSON = resolve(process.cwd(), "data/archive-snapshot.json");
const AVATAR_DIR = resolve(process.cwd(), "public/avatars");
const PAGE_SIZE = 1000;

/** Same paging contract as lib/leaderboard-data.ts. See invariant 1. */
async function fetchAllScoredPredictions(): Promise<ScoredPrediction[]> {
  const all: ScoredPrediction[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("predictions")
      .select("user_id, match_id, points_awarded")
      .not("points_awarded", "is", null)
      .order("user_id", { ascending: true })
      .order("match_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as ScoredPrediction[];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

async function downloadAvatar(url: string, slug: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ! avatar ${slug}: HTTP ${res.status} — falling back to initials`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const file = `${slug}.jpg`;
    if (!DRY_RUN) await writeFile(resolve(AVATAR_DIR, file), buf);
    return `/avatars/${file}`;
  } catch (e) {
    console.warn(`  ! avatar ${slug}: ${(e as Error).message} — falling back to initials`);
    return null;
  }
}

async function main() {
  if (!DRY_RUN) {
    await mkdir(resolve(process.cwd(), "data"), { recursive: true });
    await mkdir(AVATAR_DIR, { recursive: true });
  }

  const [
    { data: users, error: usersErr },
    { data: rounds, error: roundsErr },
    { data: teams, error: teamsErr },
    { data: slots, error: slotsErr },
    { data: matches, error: matchesErr },
    { data: allPreds, error: allPredsErr },
    { data: finalistRows, error: finalistErr },
    { data: poolEntries, error: poolErr },
  ] = await Promise.all([
    admin.from("users").select("id, username, profile_pic, total_points, created_at").eq("is_banned", false),
    admin.from("rounds").select("id, name, stage, matchday, deadline_at, locked_at").order("deadline_at", { ascending: true }),
    admin.from("teams").select("id, name, code, flag_url, group_letter").order("group_letter", { ascending: true }).order("code", { ascending: true }),
    admin.from("bracket_slots").select("id, slot_label, real_team_id"),
    admin.from("matches").select("id, round_id, home_slot_id, away_slot_id, scheduled_at, home_score, away_score, status, winning_slot_id").order("scheduled_at", { ascending: true }),
    admin.from("predictions").select("user_id, match_id, predicted_home_score, predicted_away_score, predicted_winning_slot_id"),
    admin.from("finalist_picks").select("user_id, first_place_team_id, second_place_team_id, third_place_team_id"),
    admin.from("pool_entries").select("user_id, status, method, notes, claimed_at, confirmed_at"),
  ]);
  for (const [label, err] of [
    ["users", usersErr], ["rounds", roundsErr], ["teams", teamsErr],
    ["bracket_slots", slotsErr], ["matches", matchesErr],
    ["predictions", allPredsErr], ["finalist_picks", finalistErr],
    ["pool_entries", poolErr],
  ] as const) {
    if (err) throw new Error(`${label}: ${err.message}`);
  }

  // --- identity: UUID -> username slug (invariant 2) ---
  const slugById = new Map<string, string>();
  for (const u of users ?? []) {
    const slug = (u.username as string | null) ?? `player-${slugById.size + 1}`;
    slugById.set(u.id as string, slug);
  }
  console.log(`Players (non-banned): ${slugById.size}`);

  // --- avatars ---
  const avatarBySlug = new Map<string, string | null>();
  for (const u of users ?? []) {
    const slug = slugById.get(u.id as string)!;
    const src = u.profile_pic as string | null;
    avatarBySlug.set(slug, src ? await downloadAvatar(src, slug) : null);
  }
  const saved = [...avatarBySlug.values()].filter(Boolean).length;
  console.log(`Avatars localized: ${saved}/${avatarBySlug.size}`);

  // --- leaderboard (computed here once, never at runtime) ---
  const usersList: LeaderboardUser[] = (users ?? []).map((u) => ({
    id: slugById.get(u.id as string)!,
    username: (u.username as string | null) ?? null,
    profile_pic: avatarBySlug.get(slugById.get(u.id as string)!) ?? null,
    total_points: (u.total_points as number) ?? 0,
    created_at: u.created_at as string,
  }));
  const scored = await fetchAllScoredPredictions();
  const scoredRekeyed: ScoredPrediction[] = scored
    .filter((p) => slugById.has(p.user_id))
    .map((p) => ({ ...p, user_id: slugById.get(p.user_id)! }));
  console.log(`Scored predictions: ${scored.length} (${scoredRekeyed.length} from active players)`);
  const entries: LeaderboardEntry[] = computeLeaderboard(usersList, scoredRekeyed);

  // --- tournament structure (shared by every player) ---
  const teamById = new Map<string, Record<string, unknown>>(
    (teams ?? []).map((t) => [t.id as string, {
      id: t.id, name: t.name, code: t.code, flag_url: t.flag_url, group_letter: t.group_letter,
    }]),
  );
  const slotToTeamId = new Map<string, string>();
  const slotLabelById: Record<string, string> = {};
  const realTeamIdBySlotLabel: Record<string, string> = {};
  for (const s of slots ?? []) {
    if (s.real_team_id) {
      slotToTeamId.set(s.id as string, s.real_team_id as string);
      realTeamIdBySlotLabel[s.slot_label as string] = s.real_team_id as string;
    }
    slotLabelById[s.id as string] = s.slot_label as string;
  }
  const knockoutMatchIndex = (id: string) => {
    const m = /-(\d+)$/.exec(id);
    return m ? parseInt(m[1], 10) : 1;
  };
  const groupMatches: Record<string, unknown>[] = [];
  const knockoutMatches: Record<string, unknown>[] = [];
  for (const m of matches ?? []) {
    if ((m.round_id as string).startsWith("group-")) {
      const home = teamById.get(slotToTeamId.get(m.home_slot_id as string) ?? "");
      const away = teamById.get(slotToTeamId.get(m.away_slot_id as string) ?? "");
      if (!home || !away) continue;
      groupMatches.push({
        id: m.id, round_id: m.round_id, scheduled_at: m.scheduled_at, home, away,
        home_slot_id: m.home_slot_id, away_slot_id: m.away_slot_id,
        home_score: m.home_score, away_score: m.away_score, status: m.status,
      });
    } else {
      const homeLabel = slotLabelById[m.home_slot_id as string];
      const awayLabel = slotLabelById[m.away_slot_id as string];
      if (!homeLabel || !awayLabel) continue;
      knockoutMatches.push({
        id: m.id, round_id: m.round_id, match_index: knockoutMatchIndex(m.id as string),
        scheduled_at: m.scheduled_at, home_slot_id: m.home_slot_id, away_slot_id: m.away_slot_id,
        home_slot_label: homeLabel, away_slot_label: awayLabel,
        home_score: m.home_score, away_score: m.away_score, status: m.status,
        winning_slot_id: m.winning_slot_id,
      });
    }
  }

  // --- per-player picks ---
  const predictionsByPlayer: Record<string, unknown[]> = {};
  for (const slug of slugById.values()) predictionsByPlayer[slug] = [];
  for (const p of allPreds ?? []) {
    const slug = slugById.get(p.user_id as string);
    if (!slug) continue;
    predictionsByPlayer[slug].push({
      match_id: p.match_id,
      predicted_home_score: p.predicted_home_score,
      predicted_away_score: p.predicted_away_score,
      predicted_winning_slot_id: p.predicted_winning_slot_id,
    });
  }
  const finalistPicksByPlayer: Record<string, unknown> = {};
  for (const slug of slugById.values()) {
    finalistPicksByPlayer[slug] = {
      first_place_team_id: null, second_place_team_id: null, third_place_team_id: null,
    };
  }
  for (const f of finalistRows ?? []) {
    const slug = slugById.get(f.user_id as string);
    if (!slug) continue;
    finalistPicksByPlayer[slug] = {
      first_place_team_id: f.first_place_team_id,
      second_place_team_id: f.second_place_team_id,
      third_place_team_id: f.third_place_team_id,
    };
  }

  // --- reality's podium, derived once ---
  const teamBySlot = new Map<string, string>(slotToTeamId);
  const finalRow = (matches ?? []).find((m) => m.id === "m-final") ?? null;
  const thirdRow = (matches ?? []).find((m) => m.id === "m-third-place") ?? null;
  const finalStandings: FinalStandings = deriveFinalStandings(
    finalRow as never, thirdRow as never, teamBySlot,
  );

  // --- pool: roster + pot, but NO payment path ---
  // The pool is settled. Handles and the PayPal Pool URL are deliberately
  // dropped: a live payment link on a public portfolio page is a standing
  // liability with no upside once the money has moved.
  const entryByUser = new Map<string, Record<string, unknown>>();
  for (const e of poolEntries ?? []) entryByUser.set(e.user_id as string, e as Record<string, unknown>);
  const buyInUsd = Number.parseInt(process.env.POOL_BUY_IN_USD ?? "0", 10) || 0;
  const poolRoster = (users ?? []).map((u) => {
    const slug = slugById.get(u.id as string)!;
    const e = entryByUser.get(u.id as string);
    return {
      player_id: slug,
      username: u.username as string | null,
      profile_pic: avatarBySlug.get(slug) ?? null,
      entry: e ? { status: e.status, method: e.method, notes: e.notes, confirmed_at: e.confirmed_at } : null,
    };
  });
  const confirmedCount = poolRoster.filter((r) => r.entry?.status === "confirmed").length;

  const finishedMatches = (matches ?? []).filter((m) => m.status === "finished").length;
  const exactCount = entries.reduce((n, e) => n + e.exact_count, 0);
  const outcomeCount = entries.reduce((n, e) => n + e.outcome_count, 0);
  const penaltyCount = entries.reduce((n, e) => n + e.penalty_count, 0);

  const snapshot = {
    meta: {
      generated_at: new Date().toISOString(),
      source_project_ref: SUPABASE_URL.replace(/^https:\/\//, "").split(".")[0],
      tournament: "FIFA World Cup 2026",
      counts: {
        players: slugById.size,
        matches_total: (matches ?? []).length,
        matches_finished: finishedMatches,
        predictions_scored: scoredRekeyed.length,
        exact_scores: exactCount,
        outcome_only: outcomeCount,
        penalty_bonuses: penaltyCount,
      },
    },
    tournament: {
      rounds: rounds ?? [],
      groupTeams: [...teamById.values()],
      groupMatches,
      knockoutMatches,
      activeRoundId: resolveActiveRoundId(
        (rounds ?? []) as never,
        [...groupMatches, ...knockoutMatches] as never,
      ),
      slotLabelById,
      realTeamIdBySlotLabel,
    },
    leaderboard: {
      entries,
      total_players: usersList.length,
      computed_at: new Date().toISOString(),
    },
    predictionsByPlayer,
    finalistPicksByPlayer,
    finalStandings,
    pool: { buyInUsd, potUsd: buyInUsd * confirmedCount, confirmedCount, roster: poolRoster },
  };

  const json = JSON.stringify(snapshot, null, 2);
  if (DRY_RUN) {
    console.log(`\n[dry-run] would write ${OUT_JSON} (${(json.length / 1024).toFixed(0)} KB)`);
  } else {
    await writeFile(OUT_JSON, json + "\n");
    console.log(`\n✓ Wrote ${OUT_JSON} (${(json.length / 1024).toFixed(0)} KB)`);
  }
  console.log(`  champion slot -> ${JSON.stringify(finalStandings)}`);
  console.log(`  pool: ${confirmedCount} confirmed x $${buyInUsd} = $${buyInUsd * confirmedCount}`);
  if (entries[0]) console.log(`  pool champion: ${entries[0].username} (${entries[0].total_points} pts)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
