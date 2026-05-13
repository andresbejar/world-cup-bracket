import { test, expect } from "@playwright/test";
import { adminClient, listGroupMatches } from "./helpers";
import { TEST_USER_EMAIL } from "./global-setup";

// Critical path #3 from the test plan: round lock enforcement at deadline.
// Verifies the design-doc invariant that "Next.js API routes are the
// source of truth; Supabase RLS is the safety-net backup" — we don't
// rely on the client's clock; the server checks locked_at and
// deadline_at against its own Date.now() on every /api/predictions
// write.
//
// Strategy: manipulate the round row directly via service-role, then
// observe the API response. Each test snapshots + restores so the
// rounds stay in their seed-default state between specs.

test.describe.configure({ mode: "serial" });
test.setTimeout(45_000);

interface RoundSnapshot {
  id: string;
  locked_at: string | null;
  deadline_at: string;
}

let probeRoundId = "";
let probeMatchId = "";
let originalRound: RoundSnapshot | null = null;

test.describe("round lock enforcement", () => {
  test.beforeAll(async () => {
    const admin = adminClient();

    // Clean slate for the test user; this spec mutates predictions
    // across multiple round states and needs to know its starting point.
    const list = await admin.auth.admin.listUsers();
    if (list.error) throw list.error;
    const user = list.data.users.find((u) => u.email === TEST_USER_EMAIL);
    if (!user) throw new Error("test user missing — global-setup ran?");
    await admin.from("predictions").delete().eq("user_id", user.id);

    // Pick the M1 round + its first group match. Snapshot the round
    // row so we can restore exactly after each test. Round IDs in the
    // seed look like "group-r1" (matchday 1).
    const groupMatches = await listGroupMatches();
    const m1 = groupMatches.find((m) => m.round_id === "group-r1");
    if (!m1) throw new Error("no group-r1 match in seed");
    probeRoundId = m1.round_id;
    probeMatchId = m1.id;

    const { data: round, error } = await admin
      .from("rounds")
      .select("id, locked_at, deadline_at")
      .eq("id", probeRoundId)
      .single();
    if (error || !round) {
      throw new Error(
        `failed to snapshot round ${probeRoundId}: ${error?.message ?? "missing"}`,
      );
    }
    originalRound = {
      id: round.id as string,
      locked_at: round.locked_at as string | null,
      deadline_at: round.deadline_at as string,
    };
  });

  test.afterEach(async () => {
    // Restore round to its seed-default state after every test so the
    // next test starts from a known good shape.
    if (!originalRound) return;
    const admin = adminClient();
    await admin
      .from("rounds")
      .update({
        locked_at: originalRound.locked_at,
        deadline_at: originalRound.deadline_at,
      })
      .eq("id", originalRound.id);
  });

  test("editable round: API accepts the write", async ({ request }) => {
    // No mutation — round is in its seed-default state (deadline in
    // the future, locked_at null). Save should succeed.
    const res = await request.post("/api/predictions", {
      data: {
        match_id: probeMatchId,
        predicted_home_score: 2,
        predicted_away_score: 1,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("locked_at set: API rejects with 403 reason=locked", async ({
    request,
  }) => {
    const admin = adminClient();
    await admin
      .from("rounds")
      .update({ locked_at: new Date().toISOString() })
      .eq("id", probeRoundId);

    const res = await request.post("/api/predictions", {
      data: {
        match_id: probeMatchId,
        predicted_home_score: 2,
        predicted_away_score: 1,
      },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("locked");
    expect(body.error).toMatch(/admin closed predictions/i);
  });

  test("deadline_at in the past: API rejects with 403 reason=past_deadline", async ({
    request,
  }) => {
    const admin = adminClient();
    // Push deadline 5 minutes into the past. The handler reads
    // deadline_at on every request and compares to Date.now(), so we
    // don't need to touch the client clock or the server clock.
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await admin
      .from("rounds")
      .update({ locked_at: null, deadline_at: past })
      .eq("id", probeRoundId);

    const res = await request.post("/api/predictions", {
      data: {
        match_id: probeMatchId,
        predicted_home_score: 3,
        predicted_away_score: 0,
      },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("past_deadline");
    expect(body.error).toMatch(/deadline has passed/i);
  });

  test("UI surfaces save failure when the round is locked", async ({
    page,
  }) => {
    const admin = adminClient();
    await admin
      .from("rounds")
      .update({ locked_at: new Date().toISOString() })
      .eq("id", probeRoundId);

    await page.goto("/predictions");
    await expect(page.getByText("GROUP STAGE · ACTIVE ROUND")).toBeVisible({
      timeout: 15_000,
    });

    // Wait for the prediction save attempt + 403 to land, then assert
    // the save status surfaced an error rather than silently dropping
    // the user's edit on the floor.
    const savePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/predictions") &&
        res.request().method() === "POST",
      { timeout: 10_000 },
    );

    const firstIncrement = page
      .getByRole("button", { name: /score \+ increment$/ })
      .first();
    await firstIncrement.click();

    const saveResponse = await savePromise;
    expect(saveResponse.status()).toBe(403);

    // The current MatchCard surfaces failures as a small "retry" label
    // next to the score input. This is the visible client-side proof
    // that the server rejection registered — not just a silent failure.
    // (A clearer "round is locked — admin closed predictions" message
    // is a separate UX improvement worth its own ticket.)
    await expect(page.getByText("retry").first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
