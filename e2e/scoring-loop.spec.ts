import { test, expect } from "@playwright/test";
import { scoreMatch, clearMatchScoring } from "@/lib/scoring-runtime";
import { adminClient, listGroupMatches } from "./helpers";
import { TEST_USER_EMAIL } from "./global-setup";

// Critical path #4 from the test plan: the reality loop. The heart of
// the product — when a real match finishes, scoring runs idempotently,
// users.total_points updates, the leaderboard reflects the new state,
// and the bracket card on /predictions swaps to the predicted-vs-real
// triptych with the correct (green/yellow/red) tint.
//
// We don't drive the api-football fetch in this test — the cron route's
// fetchFixtures path is exercised separately via the unit tests in
// lib/apifootball.test.ts. Here we pre-stage a match row directly to
// `status='finished'` with chosen scores, then invoke `scoreMatch`
// (the same function the cron's orchestrator calls per match) using a
// service-role client. That isolates the scoring engine's contract
// from the upstream HTTP source.
//
// Three different prediction shapes scored against the same actual
// match cover the three triptych tints (3 / 1 / 0 pts). We only have
// one test user, so we run the test sequentially across three
// match × prediction pairings to exercise all three tints.

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

interface MatchSnapshot {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  finished_at: string | null;
}

const mutatedMatches: MatchSnapshot[] = [];
let testUserId = "";

test.describe("scoring loop", () => {
  test.beforeAll(async () => {
    const admin = adminClient();
    const list = await admin.auth.admin.listUsers();
    if (list.error) throw list.error;
    const user = list.data.users.find((u) => u.email === TEST_USER_EMAIL);
    if (!user) throw new Error("test user missing — global-setup ran?");
    testUserId = user.id;

    // Clean any leftover predictions / total_points from prior specs so
    // we know our scoring assertion is on a fresh ledger.
    await admin.from("predictions").delete().eq("user_id", testUserId);
    await admin.from("users").update({ total_points: 0 }).eq("id", testUserId);
  });

  test.afterAll(async () => {
    const admin = adminClient();
    // scoreMatch operates on every prediction for the match, not just the
    // test user's. Any non-test user with a prior prediction on these
    // seed matches would otherwise be left with stranded points_awarded +
    // a stale total_points. Clear before restoring status — once status
    // flips back to `scheduled`, scoreMatch's early-return at the status
    // check means a re-run won't undo the damage.
    for (const snap of mutatedMatches) {
      const out = await clearMatchScoring(admin, snap.id);
      if (out.ok === false) {
        console.error(`[e2e teardown] clearMatchScoring ${snap.id}:`, out.reason);
      }
    }
    // Belt-and-suspenders assertion: no prediction on a mutated match
    // may carry a non-null points_awarded after cleanup. Catches future
    // regressions where someone adds another scoring path that bypasses
    // clearMatchScoring.
    if (mutatedMatches.length > 0) {
      const { data: leftover, error: leftoverErr } = await admin
        .from("predictions")
        .select("match_id, user_id")
        .in(
          "match_id",
          mutatedMatches.map((m) => m.id),
        )
        .not("points_awarded", "is", null);
      if (leftoverErr) {
        console.error("[e2e teardown] leftover check failed:", leftoverErr);
      } else if (leftover && leftover.length > 0) {
        throw new Error(
          `e2e teardown left ${leftover.length} stranded prediction scoring rows: ${JSON.stringify(
            leftover,
          )}`,
        );
      }
    }
    // Restore every match row we mutated. Match-row drift across spec
    // runs would corrupt downstream specs (and surface real-team_ids
    // in the bracket where the seed expects nulls).
    for (const snap of mutatedMatches) {
      await admin
        .from("matches")
        .update({
          status: snap.status,
          home_score: snap.home_score,
          away_score: snap.away_score,
          finished_at: snap.finished_at,
        })
        .eq("id", snap.id);
    }
    mutatedMatches.length = 0;
    // The test user's row is gone via clearMatchScoring's null + recompute,
    // but the prior beforeAll also nukes any predictions to start clean —
    // mirror that here for symmetry across spec runs.
    await admin.from("predictions").delete().eq("user_id", testUserId);
    await admin.from("users").update({ total_points: 0 }).eq("id", testUserId);
  });

  test("exact-score prediction scores 3 pts, leaderboard reflects it", async ({
    page,
    request,
  }) => {
    const admin = adminClient();
    const groupMatches = await listGroupMatches();
    const target = groupMatches[0];

    // Snapshot the match BEFORE we mutate it so afterAll can restore.
    const { data: pre, error: preErr } = await admin
      .from("matches")
      .select("id, status, home_score, away_score, finished_at")
      .eq("id", target.id)
      .single();
    if (preErr || !pre) throw preErr ?? new Error("match snapshot failed");
    mutatedMatches.push(pre as MatchSnapshot);

    // User predicts 2-1.
    const predRes = await request.post("/api/predictions", {
      data: {
        match_id: target.id,
        predicted_home_score: 2,
        predicted_away_score: 1,
      },
    });
    expect(predRes.status()).toBe(200);

    // Match actually finishes 2-1. Predicted-home-wins matches the
    // outcome AND the exact score → 3 pts.
    await admin
      .from("matches")
      .update({
        status: "finished",
        home_score: 2,
        away_score: 1,
        finished_at: new Date().toISOString(),
      })
      .eq("id", target.id);

    // Invoke the same per-match scoring function the cron's per-match
    // loop calls. Idempotent: re-running on an already-scored row writes
    // the same value (covered separately in lib/scoring.test.ts).
    const outcome = await scoreMatch(admin, target.id);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.scored).toBeGreaterThanOrEqual(1);
    }

    // Predictions row carries points_awarded = 3.
    const { data: predRow } = await admin
      .from("predictions")
      .select("points_awarded")
      .eq("user_id", testUserId)
      .eq("match_id", target.id)
      .single();
    expect(predRow?.points_awarded).toBe(3);

    // users.total_points materialized to 3 (APT-29 path).
    const { data: userRow } = await admin
      .from("users")
      .select("total_points")
      .eq("id", testUserId)
      .single();
    expect(userRow?.total_points).toBe(3);

    // Leaderboard UI reflects the new score. The poller is 30s but
    // a fresh /leaderboard load hits loadLeaderboard server-side so
    // we see the points immediately without waiting on the timer.
    await page.goto("/leaderboard");
    await expect(
      page.getByRole("heading", { name: /Leaderboard/i }),
    ).toBeVisible({ timeout: 10_000 });
    // The test user's row shows "You" pill and the points total.
    const youRow = page.locator("li", {
      has: page.getByText("You", { exact: true }),
    });
    await expect(youRow).toBeVisible();
    await expect(youRow).toContainText("3");

    // Predictions page swaps the finished match's card to the triptych.
    await page.goto("/predictions");
    await expect(page.getByText("GROUP STAGE · ACTIVE ROUND")).toBeVisible({
      timeout: 15_000,
    });
    // Triptych header is "GROUP X · M?? · ..." and contains "FINAL".
    // Tint is green for an exact-score hit (3 pts) — the badge text is
    // explicit per DESIGN.md "color independence" rule.
    await expect(page.getByText(/\+3 pts · exact/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("outcome-only prediction scores 1 pt (yellow tint)", async ({
    page,
    request,
  }) => {
    const admin = adminClient();
    const groupMatches = await listGroupMatches();
    const target = groupMatches[1];

    const { data: pre } = await admin
      .from("matches")
      .select("id, status, home_score, away_score, finished_at")
      .eq("id", target.id)
      .single();
    if (pre) mutatedMatches.push(pre as MatchSnapshot);

    // Predict 3-0 home win.
    await request.post("/api/predictions", {
      data: {
        match_id: target.id,
        predicted_home_score: 3,
        predicted_away_score: 0,
      },
    });

    // Actual: 1-0 home win → correct outcome, wrong score → 1 pt.
    await admin
      .from("matches")
      .update({
        status: "finished",
        home_score: 1,
        away_score: 0,
        finished_at: new Date().toISOString(),
      })
      .eq("id", target.id);

    const outcome = await scoreMatch(admin, target.id);
    expect(outcome.ok).toBe(true);

    const { data: predRow } = await admin
      .from("predictions")
      .select("points_awarded")
      .eq("user_id", testUserId)
      .eq("match_id", target.id)
      .single();
    expect(predRow?.points_awarded).toBe(1);

    await page.goto("/predictions");
    await expect(page.getByText(/\+1 pt · outcome/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("wrong-outcome prediction scores 0 pts (red tint)", async ({
    page,
    request,
  }) => {
    const admin = adminClient();
    const groupMatches = await listGroupMatches();
    const target = groupMatches[2];

    const { data: pre } = await admin
      .from("matches")
      .select("id, status, home_score, away_score, finished_at")
      .eq("id", target.id)
      .single();
    if (pre) mutatedMatches.push(pre as MatchSnapshot);

    // Predict 0-3 away win.
    await request.post("/api/predictions", {
      data: {
        match_id: target.id,
        predicted_home_score: 0,
        predicted_away_score: 3,
      },
    });

    // Actual: 2-0 home win → wrong outcome → 0 pts.
    await admin
      .from("matches")
      .update({
        status: "finished",
        home_score: 2,
        away_score: 0,
        finished_at: new Date().toISOString(),
      })
      .eq("id", target.id);

    const outcome = await scoreMatch(admin, target.id);
    expect(outcome.ok).toBe(true);

    const { data: predRow } = await admin
      .from("predictions")
      .select("points_awarded")
      .eq("user_id", testUserId)
      .eq("match_id", target.id)
      .single();
    expect(predRow?.points_awarded).toBe(0);

    await page.goto("/predictions");
    // Triptych for wrong-outcome shows "0 pts" with red tint. The label
    // is just "0 pts" (no qualifier) per the PredictedVsRealCard's
    // PointsBadge logic.
    await expect(
      page.getByText(/^0 pts$/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
