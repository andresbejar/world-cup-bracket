import { test, expect } from "@playwright/test";
import {
  scoreMatch,
  scoreFinalists,
  clearMatchScoring,
} from "@/lib/scoring-runtime";
import { populateRealKnockoutSlots } from "@/lib/reality";
import { adminClient, listKnockoutMatches } from "./helpers";
import { TEST_USER_EMAIL } from "./global-setup";

// The knockout endgame loop (APT-28): the pieces that did not exist before
// this change. Validates, against the test DB, that —
//   1. a PENALTY-decided knockout actually scores (previously a tied 90+ET
//      knockout left winning_slot_id null and never scored),
//   2. populateRealKnockoutSlots advances the real winner into the
//      downstream bracket slot,
//   3. scoreFinalists materializes the champion/runner-up/3rd podium bet
//      onto users.total_points,
//   4. the leaderboard reflects the new totals.
//
// Like scoring-loop.spec, we pre-stage rows with a service-role client
// rather than driving api-football, and we snapshot+restore every match
// row and slot real_team_id we touch so the shared test DB is left clean.

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

interface MatchSnapshot {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  winning_slot_id: string | null;
  finished_at: string | null;
  scheduled_at: string;
}

const mutatedMatches: MatchSnapshot[] = [];
const touchedSlots: string[] = []; // slot ids we set real_team_id on (restore → null)
let testUserId = "";
let teamIds: string[] = [];

// Once real wall-clock passes a seed match's kickoff (the tournament is live),
// the per-match lock (lib/lock-check.ts checkMatchLock) rejects a prediction
// write to that match with a 403. Push the target's kickoff just into the
// future so the write is accepted again — same trick as scoring-loop.spec.
const editableKickoff = () =>
  new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

async function snapshotMatch(id: string) {
  const admin = adminClient();
  const { data, error } = await admin
    .from("matches")
    .select(
      "id, status, home_score, away_score, winning_slot_id, finished_at, scheduled_at",
    )
    .eq("id", id)
    .single();
  if (error || !data) throw error ?? new Error(`snapshot ${id} failed`);
  mutatedMatches.push(data as MatchSnapshot);
}

async function setSlotTeam(slotId: string, teamId: string) {
  const admin = adminClient();
  await admin.from("bracket_slots").update({ real_team_id: teamId }).eq("id", slotId);
  touchedSlots.push(slotId);
}

test.describe("knockout endgame loop", () => {
  test.beforeAll(async () => {
    const admin = adminClient();
    const list = await admin.auth.admin.listUsers();
    if (list.error) throw list.error;
    const user = list.data.users.find((u) => u.email === TEST_USER_EMAIL);
    if (!user) throw new Error("test user missing — global-setup ran?");
    testUserId = user.id;

    const { data: teams, error: teamsErr } = await admin
      .from("teams")
      .select("id")
      .limit(4);
    if (teamsErr || !teams || teams.length < 4) {
      throw teamsErr ?? new Error("need >=4 seed teams");
    }
    teamIds = teams.map((t) => t.id as string);

    await admin.from("predictions").delete().eq("user_id", testUserId);
    await admin.from("finalist_picks").delete().eq("user_id", testUserId);
    await admin.from("users").update({ total_points: 0 }).eq("id", testUserId);
  });

  test.afterAll(async () => {
    const admin = adminClient();
    for (const snap of mutatedMatches) {
      const out = await clearMatchScoring(admin, snap.id);
      if (out.ok === false) {
        console.error(`[e2e teardown] clearMatchScoring ${snap.id}:`, out.reason);
      }
    }
    for (const snap of mutatedMatches) {
      await admin
        .from("matches")
        .update({
          status: snap.status,
          home_score: snap.home_score,
          away_score: snap.away_score,
          winning_slot_id: snap.winning_slot_id,
          finished_at: snap.finished_at,
          scheduled_at: snap.scheduled_at,
        })
        .eq("id", snap.id);
    }
    // Knockout slots are null in the seed until reality lands — reset every
    // slot we filled so downstream specs see a clean bracket.
    for (const slotId of touchedSlots) {
      await admin.from("bracket_slots").update({ real_team_id: null }).eq("id", slotId);
    }
    mutatedMatches.length = 0;
    touchedSlots.length = 0;
    await admin.from("predictions").delete().eq("user_id", testUserId);
    await admin.from("finalist_picks").delete().eq("user_id", testUserId);
    await admin.from("users").update({ total_points: 0 }).eq("id", testUserId);
  });

  test("penalty-decided R32 scores, advances the winner, and leaderboard updates", async ({
    page,
    request,
  }) => {
    const admin = adminClient();
    const knockouts = await listKnockoutMatches();
    const r32 = knockouts.find((m) => m.round_id === "r32");
    if (!r32) throw new Error("no R32 match in seed");
    await snapshotMatch(r32.id);

    const [homeTeam, awayTeam] = teamIds;
    // Seed the two R32 input slots with real teams (as group-stage settling
    // would), so advancement has a real winner to propagate.
    await setSlotTeam(r32.home_slot_id, homeTeam);
    await setSlotTeam(r32.away_slot_id, awayTeam);

    // Re-open this (possibly kicked-off) seed match so the prediction write is
    // accepted — once wall-clock passes the seed kickoff, the per-match lock
    // would 403 the POST below. Restored by afterAll via the snapshot.
    await admin
      .from("matches")
      .update({ scheduled_at: editableKickoff() })
      .eq("id", r32.id);

    // User predicts a 1-1 draw with the AWAY side winning on penalties.
    const predRes = await request.post("/api/predictions", {
      data: {
        match_id: r32.id,
        predicted_home_score: 1,
        predicted_away_score: 1,
        predicted_winning_slot_id: r32.away_slot_id,
      },
    });
    expect(predRes.status()).toBe(200);

    // Match finishes 1-1; away advances on penalties. The cron would set
    // winning_slot_id from penalty_winner — we set it directly here.
    await admin
      .from("matches")
      .update({
        status: "finished",
        home_score: 1,
        away_score: 1,
        winning_slot_id: r32.away_slot_id,
        finished_at: new Date().toISOString(),
      })
      .eq("id", r32.id);

    // Exact tied score (1-1) AND correct shootout winner (away) → 3 exact
    // + 1 penalty-winner bonus = 4 pts. (This is also the case that
    // silently scored 0/null before winning_slot_id existed.)
    const outcome = await scoreMatch(admin, r32.id);
    expect(outcome.ok).toBe(true);

    const { data: predRow } = await admin
      .from("predictions")
      .select("points_awarded")
      .eq("user_id", testUserId)
      .eq("match_id", r32.id)
      .single();
    expect(predRow?.points_awarded).toBe(4);

    // Advancement writes the winner (away team) into the downstream R16 slot.
    const advance = await populateRealKnockoutSlots(admin);
    expect(advance.ok).toBe(true);
    const downstreamSlotId = `r16-r32-match-${r32.match_index}-winner`;
    const { data: downstream } = await admin
      .from("bracket_slots")
      .select("real_team_id")
      .eq("id", downstreamSlotId)
      .single();
    expect(downstream?.real_team_id).toBe(awayTeam);
    touchedSlots.push(downstreamSlotId);

    // Leaderboard reflects the 4 pts.
    await page.goto("/leaderboard");
    const youRow = page.locator("li", {
      has: page.getByText("You", { exact: true }),
    });
    await expect(youRow).toBeVisible({ timeout: 10_000 });
    await expect(youRow).toContainText("4");
  });

  test("finalist podium bet materializes onto total_points", async () => {
    const admin = adminClient();
    const [champion, runnerUp, third] = teamIds;

    await snapshotMatch("m-final");
    await snapshotMatch("m-third-place");

    // Final: home slot wins → champion; away slot → runner-up.
    await setSlotTeam("final-sf-match-1-winner", champion);
    await setSlotTeam("final-sf-match-2-winner", runnerUp);
    await admin
      .from("matches")
      .update({
        status: "finished",
        home_score: 2,
        away_score: 0,
        winning_slot_id: "final-sf-match-1-winner",
        finished_at: new Date().toISOString(),
      })
      .eq("id", "m-final");

    // Third-place playoff: home slot wins → 3rd.
    await setSlotTeam("third_place-sf-match-1-loser", third);
    await admin
      .from("matches")
      .update({
        status: "finished",
        home_score: 1,
        away_score: 0,
        winning_slot_id: "third_place-sf-match-1-loser",
        finished_at: new Date().toISOString(),
      })
      .eq("id", "m-third-place");

    // Test user nails all three: 5 + 3 + 1 = 9 pts.
    await admin.from("finalist_picks").upsert(
      {
        user_id: testUserId,
        first_place_team_id: champion,
        second_place_team_id: runnerUp,
        third_place_team_id: third,
      },
      { onConflict: "user_id" },
    );

    const out = await scoreFinalists(admin);
    expect(out.ok).toBe(true);

    const { data: pickRow } = await admin
      .from("finalist_picks")
      .select("points_awarded")
      .eq("user_id", testUserId)
      .single();
    expect(pickRow?.points_awarded).toBe(9);

    // total_points = 3 (R32 from prior test) + 9 (finalist) = 12.
    const { data: userRow } = await admin
      .from("users")
      .select("total_points")
      .eq("id", testUserId)
      .single();
    expect(userRow?.total_points).toBe(12);

    // Idempotent: re-running writes the same totals.
    const again = await scoreFinalists(admin);
    expect(again.ok).toBe(true);
    const { data: userRow2 } = await admin
      .from("users")
      .select("total_points")
      .eq("id", testUserId)
      .single();
    expect(userRow2?.total_points).toBe(12);
  });
});
