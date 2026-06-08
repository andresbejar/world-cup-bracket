// Operator script: backfill api-football fixture ids for knockout matches.
//
// The seed leaves every knockout match's `apifootball_fixture_id` null
// (scripts/build-seed.ts) because api-sports.io had not yet published the
// 2026 knockout fixtures when the seed was built — and the polling cron
// only touches matches with a non-null fixture id. Once api-sports
// publishes the knockout bracket (with stable fixture ids, even while the
// teams are still TBD), run this to map each published fixture to our
// internal knockout match and set its `apifootball_fixture_id`. After that
// the hourly cron ingests/advances/scores the knockouts automatically.
//
// Matching strategy (teams are TBD, so we can't match by team):
//   1. Pull all season-2026 fixtures; drop "Group Stage - N".
//   2. Infer the api-round -> our-round mapping by fixture COUNT in
//      CHRONOLOGICAL order — we never trust the api's round-name string
//      (2026 is the first 48-team WC; the "Round of 32" label is
//      unverified). Expected chronological counts: 16, 8, 4, 2, 1, 1
//      -> r32, r16, qf, sf, third_place, final.
//   3. Within each round, pair each of our matches to the published
//      fixture with the nearest kickoff (1:1; our KNOCKOUT_SCHEDULE holds
//      exact UTC times, so deltas are tight).
//
// Safety: DRY-RUN by default — prints the proposed mapping and writes
// nothing. Pass --apply to persist. Refuses to write if any of the 32
// isn't matched, a fixture maps to >1 of ours, the chronological count
// structure doesn't match [16,8,4,2,1,1], or any kickoff delta exceeds
// 24h. Idempotent: re-running --apply sets the same ids.
//
// Usage:
//   npx tsx scripts/backfill-knockout-fixtures.ts            # dry-run
//   npx tsx scripts/backfill-knockout-fixtures.ts --apply    # write
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
// APIFOOTBALL_HOST + APIFOOTBALL_KEY from .env.local (targets prod, like
// the other operator scripts).

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const API_HOST = process.env.APIFOOTBALL_HOST!;
const API_KEY = process.env.APIFOOTBALL_KEY!;
const LEAGUE_ID = 1;
const SEASON = 2026;
const MAX_DELTA_MS = 24 * 60 * 60 * 1000;

// Our knockout rounds in chronological order, with the fixture count each
// must receive. The two singletons are ordered third_place before final.
const ROUND_PLAN: { round_id: string; count: number }[] = [
  { round_id: "r32", count: 16 },
  { round_id: "r16", count: 8 },
  { round_id: "qf", count: 4 },
  { round_id: "sf", count: 2 },
  { round_id: "third_place", count: 1 },
  { round_id: "final", count: 1 },
];

const APPLY = process.argv.includes("--apply");

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!API_HOST || !API_KEY) {
  console.error("Missing APIFOOTBALL_HOST or APIFOOTBALL_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ApiFixture = {
  fixture: { id: number; date: string; venue?: { name?: string | null } };
  league: { round: string };
  teams: { home: { name: string }; away: { name: string } };
};

type OurMatch = { id: string; round_id: string; scheduled_at: string; apifootball_fixture_id: number | null };

type Assignment = {
  match: OurMatch;
  fixture: ApiFixture;
  deltaMs: number;
};

async function fetchFixtures(): Promise<ApiFixture[]> {
  const res = await fetch(`${API_HOST}/fixtures?league=${LEAGUE_ID}&season=${SEASON}`, {
    headers: { "x-apisports-key": API_KEY },
  });
  if (!res.ok) throw new Error(`api-sports /fixtures → HTTP ${res.status}`);
  const json = (await res.json()) as { response: ApiFixture[] };
  return json.response ?? [];
}

// Greedy 1:1 nearest-kickoff pairing within a single round.
function pairByNearestKickoff(matches: OurMatch[], fixtures: ApiFixture[]): Assignment[] {
  const candidates: Assignment[] = [];
  for (const m of matches) {
    const t = new Date(m.scheduled_at).getTime();
    for (const f of fixtures) {
      candidates.push({ match: m, fixture: f, deltaMs: Math.abs(new Date(f.fixture.date).getTime() - t) });
    }
  }
  candidates.sort((a, b) => a.deltaMs - b.deltaMs);
  const usedMatch = new Set<string>();
  const usedFixture = new Set<number>();
  const out: Assignment[] = [];
  for (const c of candidates) {
    if (usedMatch.has(c.match.id) || usedFixture.has(c.fixture.fixture.id)) continue;
    usedMatch.add(c.match.id);
    usedFixture.add(c.fixture.fixture.id);
    out.push(c);
  }
  return out;
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  console.error("  No changes written.");
  process.exit(1);
}

async function main() {
  console.log(`Target: ${SUPABASE_URL}  (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  const fixtures = await fetchFixtures();
  const knockoutFixtures = fixtures.filter((f) => !/Group Stage/i.test(f.league.round));
  if (knockoutFixtures.length === 0) {
    console.log("api-sports has not published any 2026 knockout fixtures yet — nothing to backfill.");
    console.log("Re-run once the knockout bracket appears in the feed.");
    return;
  }

  // Group published fixtures by their api round-name, ordered chronologically.
  const byApiRound = new Map<string, ApiFixture[]>();
  for (const f of knockoutFixtures) {
    if (!byApiRound.has(f.league.round)) byApiRound.set(f.league.round, []);
    byApiRound.get(f.league.round)!.push(f);
  }
  const apiRoundsChrono = [...byApiRound.entries()]
    .map(([round, fxs]) => ({
      round,
      fxs,
      earliest: Math.min(...fxs.map((f) => new Date(f.fixture.date).getTime())),
    }))
    .sort((a, b) => a.earliest - b.earliest);

  console.log("Published api-sports knockout rounds (chronological):");
  for (const r of apiRoundsChrono) console.log(`  ${r.fxs.length.toString().padStart(2)}  ${r.round}`);

  // Validate the chronological count structure matches our plan exactly.
  if (apiRoundsChrono.length !== ROUND_PLAN.length) {
    fail(`expected ${ROUND_PLAN.length} knockout rounds, api published ${apiRoundsChrono.length}. Inspect above and map by hand.`);
  }
  apiRoundsChrono.forEach((r, i) => {
    if (r.fxs.length !== ROUND_PLAN[i].count) {
      fail(`round #${i + 1} ("${r.round}") has ${r.fxs.length} fixtures, expected ${ROUND_PLAN[i].count} for ${ROUND_PLAN[i].round_id}.`);
    }
  });

  // Load our knockout matches.
  const { data: ours, error: ourErr } = await admin
    .from("matches")
    .select("id, round_id, scheduled_at, apifootball_fixture_id")
    .not("round_id", "like", "group-%")
    .order("scheduled_at", { ascending: true });
  if (ourErr) throw ourErr;
  const ourByRound = new Map<string, OurMatch[]>();
  for (const m of (ours ?? []) as OurMatch[]) {
    if (!ourByRound.has(m.round_id)) ourByRound.set(m.round_id, []);
    ourByRound.get(m.round_id)!.push(m);
  }

  // Pair each round.
  const assignments: Assignment[] = [];
  apiRoundsChrono.forEach((apiR, i) => {
    const plan = ROUND_PLAN[i];
    const ourMatches = ourByRound.get(plan.round_id) ?? [];
    if (ourMatches.length !== plan.count) {
      fail(`DB has ${ourMatches.length} ${plan.round_id} matches, expected ${plan.count}. Re-run apply-seed first?`);
    }
    assignments.push(...pairByNearestKickoff(ourMatches, apiR.fxs));
  });

  // Print the proposed mapping.
  console.log("\nProposed mapping (our match ← api fixture):");
  for (const a of assignments.sort((x, y) => x.match.scheduled_at.localeCompare(y.match.scheduled_at))) {
    const delta = Math.round(a.deltaMs / 60000);
    const venue = a.fixture.fixture.venue?.name ?? "?";
    console.log(
      `  ${a.match.id.padEnd(16)} ← ${a.fixture.fixture.id}  ` +
        `Δ${delta}min  ours=${a.match.scheduled_at}  api=${a.fixture.fixture.date}  ` +
        `[${a.fixture.teams.home.name} v ${a.fixture.teams.away.name} @ ${venue}]`,
    );
  }

  // Safety gates.
  if (assignments.length !== 32) fail(`matched ${assignments.length}/32 knockout matches.`);
  const fixtureIds = new Set(assignments.map((a) => a.fixture.fixture.id));
  if (fixtureIds.size !== 32) fail("a published fixture was matched to more than one of our matches.");
  const worst = Math.max(...assignments.map((a) => a.deltaMs));
  if (worst > MAX_DELTA_MS) {
    fail(`largest kickoff delta is ${Math.round(worst / 3600000)}h (> 24h) — likely a mis-map. Inspect above.`);
  }

  if (!APPLY) {
    console.log("\n✓ Dry-run OK. Re-run with --apply to write these fixture ids.");
    return;
  }

  let written = 0;
  for (const a of assignments) {
    if (a.match.apifootball_fixture_id === a.fixture.fixture.id) continue; // already set
    const { error } = await admin
      .from("matches")
      .update({ apifootball_fixture_id: a.fixture.fixture.id })
      .eq("id", a.match.id);
    if (error) fail(`update ${a.match.id}: ${error.message}`);
    written += 1;
  }
  console.log(`\n✓ Wrote apifootball_fixture_id for ${written} match(es) (${32 - written} already current).`);
  console.log("The hourly poll-results cron will now ingest, advance, and score the knockouts.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
