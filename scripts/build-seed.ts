// Build the FIFA World Cup 2026 fixture seed JSON.
// Issue: APT-4
//
// Pulls live data from api-sports.io for what's available (48 teams + 72
// group-stage fixtures) and merges with the hand-encoded knockout bracket
// structure (lib/bracket-structure.ts).
//
// Output: supabase/seed/fixtures.json
// Consumed by: scripts/apply-seed.ts (APT-10).
//
// Usage:
//   npx tsx scripts/build-seed.ts
//
// Reads APIFOOTBALL_HOST + APIFOOTBALL_KEY from .env.local.

import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ISO_CODE_BY_APIFOOTBALL_ID } from "./iso-codes.js";
import {
  ALL_KNOCKOUT_MATCHES,
  KNOCKOUT_SLOT_LABELS,
} from "../lib/bracket-structure.js";

config({ path: resolve(process.cwd(), ".env.local") });

const HOST = process.env.APIFOOTBALL_HOST!;
const KEY = process.env.APIFOOTBALL_KEY!;
const LEAGUE_ID = 1;
const SEASON = 2026;

// ============================================================
// Knockout schedule (FIFA's announced 2026 dates).
// First-match dates per round; exact kickoff times TBD by FIFA.
// Using 19:00 UTC (a common WC kickoff slot) as a placeholder; refine
// when FIFA publishes the final fixture list, or when api-sports
// populates these fixtures and we re-run this script.
// ============================================================
const KNOCKOUT_FIRST_MATCH = {
  r32:         "2026-06-28T19:00:00Z",
  r16:         "2026-07-04T19:00:00Z",
  qf:          "2026-07-09T19:00:00Z",
  sf:          "2026-07-14T19:00:00Z",
  third_place: "2026-07-18T19:00:00Z",
  final:       "2026-07-19T19:00:00Z",
} as const;

// 4 hours before first match → prediction-edit deadline.
function deadlineFromFirstMatch(iso: string): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() - 4);
  return d.toISOString();
}

// ============================================================
// Types
// ============================================================
type SeedTeam = {
  id: string; // ISO 3166 alpha-3
  name: string;
  code: string; // == id, kept explicit
  flag_url: string | null;
  group_letter: string;
  apifootball_team_id: number;
};

type SeedRound = {
  id: string;
  name: string;
  stage: "group" | "r32" | "r16" | "qf" | "sf" | "third_place" | "final";
  matchday: number | null;
  deadline_at: string;
};

type SeedSlot = {
  id: string;
  round_id: string;
  slot_label: string;
  real_team_id: string | null;
};

type SeedMatch = {
  id: string;
  round_id: string;
  home_slot_id: string;
  away_slot_id: string;
  scheduled_at: string;
  apifootball_fixture_id: number | null;
};

type Seed = {
  generated_at: string;
  teams: SeedTeam[];
  rounds: SeedRound[];
  bracket_slots: SeedSlot[];
  matches: SeedMatch[];
};

// ============================================================
// api-sports helpers
// ============================================================
async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${HOST}${path}`, {
    headers: { "x-apisports-key": KEY },
  });
  if (!res.ok) {
    throw new Error(`api-sports ${path} → HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type ApiTeamRow = {
  team: { id: number; name: string; code: string | null; logo: string };
};

type ApiFixtureRow = {
  fixture: { id: number; date: string; status: { short: string } };
  league: { round: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
};

// ============================================================
// Build
// ============================================================
async function main() {
  console.log("Fetching teams from api-sports.io...");
  const teamsRes = await api<{ response: ApiTeamRow[] }>(
    `/teams?league=${LEAGUE_ID}&season=${SEASON}`,
  );
  if (teamsRes.response.length !== 48) {
    throw new Error(
      `Expected 48 teams, got ${teamsRes.response.length}. Bracket format may have changed.`,
    );
  }

  console.log("Fetching group-stage fixtures...");
  const fixturesRes = await api<{ response: ApiFixtureRow[] }>(
    `/fixtures?league=${LEAGUE_ID}&season=${SEASON}`,
  );
  if (fixturesRes.response.length !== 72) {
    console.warn(
      `Expected 72 group-stage fixtures, got ${fixturesRes.response.length}. ` +
      `Continuing — will write what's available.`,
    );
  }

  // ----------------------------------------------------------------
  // Determine each team's group letter from its group-stage fixtures.
  // api-sports stores rounds as "Group Stage - 1", "Group Stage - 2",
  // etc., but the GROUP letter (A-L) isn't in the fixture payload directly.
  // We need to query /standings or infer from the season's group structure.
  // ----------------------------------------------------------------
  console.log("Fetching standings (to map teams → groups)...");
  const standingsRes = await api<{
    response: { league: { standings: { team: { id: number }; group: string }[][] } }[];
  }>(`/standings?league=${LEAGUE_ID}&season=${SEASON}`);

  const teamIdToGroup = new Map<number, string>();
  for (const entry of standingsRes.response) {
    for (const groupRows of entry.league.standings) {
      for (const row of groupRows) {
        // group looks like "World Cup Group A" — extract the letter
        const m = row.group.match(/Group ([A-L])/i);
        if (m) {
          teamIdToGroup.set(row.team.id, m[1]);
        }
      }
    }
  }
  if (teamIdToGroup.size !== 48) {
    console.warn(
      `Expected to map 48 teams to groups, got ${teamIdToGroup.size}. ` +
      `Some teams may end up with a placeholder group letter.`,
    );
  }

  // ----------------------------------------------------------------
  // Build teams
  // ----------------------------------------------------------------
  const teams: SeedTeam[] = teamsRes.response.map(({ team }) => {
    const iso = ISO_CODE_BY_APIFOOTBALL_ID[team.id];
    if (!iso) {
      throw new Error(
        `No ISO code mapping for api-sports team id=${team.id} (${team.name}). ` +
        `Add it to scripts/iso-codes.ts.`,
      );
    }
    const group = teamIdToGroup.get(team.id) ?? "?";
    return {
      id: iso.code,
      name: iso.name,
      code: iso.code,
      flag_url: team.logo ?? null,
      group_letter: group,
      apifootball_team_id: team.id,
    };
  });

  // ----------------------------------------------------------------
  // Build rounds — 3 group matchdays + 6 knockout
  // Group deadlines: 4hr before first match of each matchday
  // ----------------------------------------------------------------
  const groupFixturesByMatchday = new Map<number, ApiFixtureRow[]>();
  for (const f of fixturesRes.response) {
    const m = f.league.round.match(/Group Stage - (\d)/);
    if (m) {
      const md = Number(m[1]);
      if (!groupFixturesByMatchday.has(md))
        groupFixturesByMatchday.set(md, []);
      groupFixturesByMatchday.get(md)!.push(f);
    }
  }

  const groupRounds: SeedRound[] = [1, 2, 3].map((md) => {
    const fixturesForMd = groupFixturesByMatchday.get(md) ?? [];
    const earliest = fixturesForMd
      .map((f) => f.fixture.date)
      .sort()[0];
    return {
      id: `group-r${md}`,
      name: `Group Stage · Matchday ${md}`,
      stage: "group",
      matchday: md,
      deadline_at: earliest ? deadlineFromFirstMatch(earliest) : "2026-06-11T15:00:00Z",
    };
  });

  const knockoutRounds: SeedRound[] = [
    { id: "r32", name: "Round of 32", stage: "r32", matchday: null,
      deadline_at: deadlineFromFirstMatch(KNOCKOUT_FIRST_MATCH.r32) },
    { id: "r16", name: "Round of 16", stage: "r16", matchday: null,
      deadline_at: deadlineFromFirstMatch(KNOCKOUT_FIRST_MATCH.r16) },
    { id: "qf", name: "Quarter-finals", stage: "qf", matchday: null,
      deadline_at: deadlineFromFirstMatch(KNOCKOUT_FIRST_MATCH.qf) },
    { id: "sf", name: "Semi-finals", stage: "sf", matchday: null,
      deadline_at: deadlineFromFirstMatch(KNOCKOUT_FIRST_MATCH.sf) },
    { id: "third_place", name: "Third-place playoff", stage: "third_place", matchday: null,
      deadline_at: deadlineFromFirstMatch(KNOCKOUT_FIRST_MATCH.third_place) },
    { id: "final", name: "Final", stage: "final", matchday: null,
      deadline_at: deadlineFromFirstMatch(KNOCKOUT_FIRST_MATCH.final) },
  ];

  const rounds = [...groupRounds, ...knockoutRounds];

  // ----------------------------------------------------------------
  // Build bracket_slots
  // 48 group slots (one per team, all attached to group-r1 for stable
  //                round_id; matches reference the same slot across
  //                matchdays since the team identity doesn't change)
  // 64 knockout slots
  // ----------------------------------------------------------------
  const groupSlots: SeedSlot[] = teams.map((t) => ({
    id: `team-${t.id.toLowerCase()}`,
    round_id: "group-r1",
    slot_label: `team-${t.id}`,
    real_team_id: t.id,
  }));

  const knockoutSlots: SeedSlot[] = KNOCKOUT_SLOT_LABELS.map((s) => ({
    id: `${s.round_id}-${s.slot_label}`,
    round_id: s.round_id,
    slot_label: s.slot_label,
    real_team_id: null,
  }));

  const bracket_slots = [...groupSlots, ...knockoutSlots];

  // ----------------------------------------------------------------
  // Build matches
  // 72 group + 32 knockout = 104
  // ----------------------------------------------------------------
  const apifootballIdToOurTeamId = new Map<number, string>(
    teams.map((t) => [t.apifootball_team_id, t.id]),
  );

  const groupMatches: SeedMatch[] = fixturesRes.response.flatMap((f) => {
    const m = f.league.round.match(/Group Stage - (\d)/);
    if (!m) return [];
    const matchday = Number(m[1]);
    const homeTeamCode = apifootballIdToOurTeamId.get(f.teams.home.id);
    const awayTeamCode = apifootballIdToOurTeamId.get(f.teams.away.id);
    if (!homeTeamCode || !awayTeamCode) {
      console.warn(`Skipping fixture ${f.fixture.id} — unknown team`);
      return [];
    }
    return [{
      id: `m-${f.fixture.id}`,
      round_id: `group-r${matchday}`,
      home_slot_id: `team-${homeTeamCode.toLowerCase()}`,
      away_slot_id: `team-${awayTeamCode.toLowerCase()}`,
      scheduled_at: f.fixture.date,
      apifootball_fixture_id: f.fixture.id,
    }];
  });

  const knockoutMatches: SeedMatch[] = ALL_KNOCKOUT_MATCHES.map((km) => ({
    id: `m-${km.id}`,
    round_id: km.round_id,
    home_slot_id: `${km.round_id}-${km.home_slot_label}`,
    away_slot_id: `${km.round_id}-${km.away_slot_label}`,
    scheduled_at: KNOCKOUT_FIRST_MATCH[km.round_id],
    apifootball_fixture_id: null,
  }));

  const matches = [...groupMatches, ...knockoutMatches];

  // ----------------------------------------------------------------
  // Sanity checks
  // ----------------------------------------------------------------
  console.log("\n=== Counts ===");
  console.log(`teams:          ${teams.length}     (expected 48)`);
  console.log(`rounds:         ${rounds.length}     (expected 9)`);
  console.log(`bracket_slots:  ${bracket_slots.length}    (expected 112)`);
  console.log(`matches:        ${matches.length}    (expected 104)`);

  if (teams.length !== 48) throw new Error("teams != 48");
  if (rounds.length !== 9) throw new Error("rounds != 9");
  if (bracket_slots.length !== 112) throw new Error(`bracket_slots != 112 (got ${bracket_slots.length})`);
  if (matches.length !== 104) throw new Error(`matches != 104 (got ${matches.length})`);

  // ----------------------------------------------------------------
  // Write
  // ----------------------------------------------------------------
  const seed: Seed = {
    generated_at: new Date().toISOString(),
    teams,
    rounds,
    bracket_slots,
    matches,
  };

  const outPath = resolve(process.cwd(), "supabase/seed/fixtures.json");
  mkdirSync(resolve(process.cwd(), "supabase/seed"), { recursive: true });
  writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n");
  console.log(`\nWrote ${outPath} (${(JSON.stringify(seed).length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
