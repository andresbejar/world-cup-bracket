import { test, expect } from "@playwright/test";
import { adminClient, listGroupMatches } from "./helpers";
import { TEST_USER_EMAIL } from "./global-setup";

// Critical path #3 from the test plan: prediction lock enforcement.
// Verifies the design-doc invariant that "Next.js API routes are the
// source of truth; Supabase RLS is the safety-net backup" — we don't
// rely on the client's clock; the server checks the round's admin
// locked_at and the match's own kickoff against its own Date.now() on
// every /api/predictions write.
//
// Locks are PER MATCH: each match freezes at its own kickoff
// (matches.scheduled_at), independent of the others in the round. A
// round-level admin locked_at still hard-locks every match in the round.
//
// Strategy: drive each match's scheduled_at (and the round's locked_at)
// directly via service-role, then observe the API response / UI. Each
// test snapshots + restores so rows stay in their seed-default state
// between specs. (assertTestDatabase refuses to run against prod.)

test.describe.configure({ mode: "serial" });
test.setTimeout(45_000);

interface MatchSnapshot {
  id: string;
  home_code: string;
  scheduled_at: string;
}
interface RoundSnapshot {
  id: string;
  locked_at: string | null;
  deadline_at: string;
}

let probeRoundId = "";
// Two matches in the same round — the engine of the per-match story:
// one can be frozen while the other stays open.
let matchA: MatchSnapshot | null = null;
let matchB: MatchSnapshot | null = null;
let originalRound: RoundSnapshot | null = null;

const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 5 * 60 * 1000).toISOString();

async function setKickoff(id: string, scheduled_at: string) {
  const admin = adminClient();
  const { error } = await admin
    .from("matches")
    .update({ scheduled_at })
    .eq("id", id);
  if (error) throw error;
}

test.describe("per-match lock enforcement", () => {
  test.beforeAll(async () => {
    const admin = adminClient();

    // Clean slate for the test user; this spec mutates predictions
    // across multiple lock states and needs a known starting point.
    const list = await admin.auth.admin.listUsers();
    if (list.error) throw list.error;
    const user = list.data.users.find((u) => u.email === TEST_USER_EMAIL);
    if (!user) throw new Error("test user missing — global-setup ran?");
    await admin.from("predictions").delete().eq("user_id", user.id);

    // Pick the first two Matchday-1 group matches + snapshot their
    // kickoffs so we can restore exactly after each test. Round IDs in
    // the seed look like "group-r1" (matchday 1).
    const groupMatches = await listGroupMatches();
    const r1 = groupMatches.filter((m) => m.round_id === "group-r1");
    if (r1.length < 2) throw new Error("need ≥2 group-r1 matches in seed");
    probeRoundId = "group-r1";

    const ids = [r1[0].id, r1[1].id];
    const { data: rows, error } = await admin
      .from("matches")
      .select("id, scheduled_at")
      .in("id", ids);
    if (error || !rows) {
      throw new Error(`failed to snapshot matches: ${error?.message ?? "missing"}`);
    }
    const schedById = new Map(rows.map((r) => [r.id as string, r.scheduled_at as string]));
    matchA = {
      id: r1[0].id,
      home_code: r1[0].home_code,
      scheduled_at: schedById.get(r1[0].id)!,
    };
    matchB = {
      id: r1[1].id,
      home_code: r1[1].home_code,
      scheduled_at: schedById.get(r1[1].id)!,
    };

    const { data: round, error: rErr } = await admin
      .from("rounds")
      .select("id, locked_at, deadline_at")
      .eq("id", probeRoundId)
      .single();
    if (rErr || !round) {
      throw new Error(`failed to snapshot round ${probeRoundId}: ${rErr?.message ?? "missing"}`);
    }
    originalRound = {
      id: round.id as string,
      locked_at: round.locked_at as string | null,
      deadline_at: round.deadline_at as string,
    };
  });

  test.afterEach(async () => {
    // Restore the round + both match kickoffs to their seed-default
    // state so the next test starts from a known good shape.
    const admin = adminClient();
    if (originalRound) {
      await admin
        .from("rounds")
        .update({
          locked_at: originalRound.locked_at,
          deadline_at: originalRound.deadline_at,
        })
        .eq("id", originalRound.id);
    }
    if (matchA) await setKickoff(matchA.id, matchA.scheduled_at);
    if (matchB) await setKickoff(matchB.id, matchB.scheduled_at);
  });

  test("match with a future kickoff: API accepts the write", async ({ request }) => {
    await setKickoff(matchA!.id, future());

    const res = await request.post("/api/predictions", {
      data: {
        match_id: matchA!.id,
        predicted_home_score: 2,
        predicted_away_score: 1,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("match has kicked off: API rejects with 403 reason=past_deadline", async ({
    request,
  }) => {
    // Push this match's kickoff 5 minutes into the past. The handler
    // reads scheduled_at on every request and compares to Date.now(),
    // so we don't touch the client or server clock.
    await setKickoff(matchA!.id, past());

    const res = await request.post("/api/predictions", {
      data: {
        match_id: matchA!.id,
        predicted_home_score: 3,
        predicted_away_score: 0,
      },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("past_deadline");
    expect(body.error).toMatch(/kicked off/i);
  });

  test("admin round-lock: API rejects with 403 reason=locked even before kickoff", async ({
    request,
  }) => {
    // Future kickoff (would be editable) but the round is admin-locked —
    // the hard lock still wins, frozen via round_locked_at.
    await setKickoff(matchA!.id, future());
    const admin = adminClient();
    await admin
      .from("rounds")
      .update({ locked_at: new Date().toISOString() })
      .eq("id", probeRoundId);

    const res = await request.post("/api/predictions", {
      data: {
        match_id: matchA!.id,
        predicted_home_score: 2,
        predicted_away_score: 1,
      },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("locked");
    expect(body.error).toMatch(/admin closed predictions/i);
  });

  test("per-match independence: kicked-off match 403s while a later match in the SAME round still accepts", async ({
    request,
  }) => {
    // The headline behavior the feedback asked for: matches across the
    // same matchday lock individually, not all at once.
    await setKickoff(matchA!.id, past());
    await setKickoff(matchB!.id, future());

    const resA = await request.post("/api/predictions", {
      data: {
        match_id: matchA!.id,
        predicted_home_score: 1,
        predicted_away_score: 1,
      },
    });
    expect(resA.status()).toBe(403);
    expect((await resA.json()).reason).toBe("past_deadline");

    const resB = await request.post("/api/predictions", {
      data: {
        match_id: matchB!.id,
        predicted_home_score: 2,
        predicted_away_score: 0,
      },
    });
    expect(resB.status()).toBe(200);
    expect((await resB.json()).ok).toBe(true);
  });

  test("mixed round at load: kicked-off card renders frozen, future card stays editable", async ({
    page,
  }) => {
    // matchA kicked off, matchB still upcoming — same round. The client
    // mirrors checkMatchLock per card, so A freezes (input disabled,
    // chevrons unmounted, "locked" label) while B keeps its steppers.
    await setKickoff(matchA!.id, past());
    await setKickoff(matchB!.id, future());

    await page.goto("/predictions");
    await expect(page.getByText("GROUP STAGE · ACTIVE ROUND")).toBeVisible({
      timeout: 15_000,
    });

    // Frozen match: its score input is disabled and its increment
    // chevron is gone.
    await expect(
      page.getByRole("spinbutton", { name: `${matchA!.home_code} score` }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: `${matchA!.home_code} score + increment` }),
    ).toHaveCount(0);

    // Open match: input enabled, increment chevron present and clickable.
    await expect(
      page.getByRole("spinbutton", { name: `${matchB!.home_code} score` }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: `${matchB!.home_code} score + increment` }),
    ).toBeVisible();
  });

  test("mid-session admin lock: server 403 surfaces as retry", async ({ page }) => {
    // Load while the round is editable (matchB upcoming), then an admin
    // locks the round after load. The client can't see it; the
    // optimistic edit must 403 and surface "retry" rather than silently
    // dropping the user's edit.
    await setKickoff(matchB!.id, future());
    await page.goto("/predictions");
    await expect(page.getByText("GROUP STAGE · ACTIVE ROUND")).toBeVisible({
      timeout: 15_000,
    });
    const increment = page.getByRole("button", {
      name: `${matchB!.home_code} score + increment`,
    });
    await expect(increment).toBeVisible();

    const admin = adminClient();
    await admin
      .from("rounds")
      .update({ locked_at: new Date().toISOString() })
      .eq("id", probeRoundId);

    const savePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/predictions") &&
        res.request().method() === "POST",
      { timeout: 10_000 },
    );
    await increment.click();

    const saveResponse = await savePromise;
    expect(saveResponse.status()).toBe(403);

    await expect(page.getByText("retry").first()).toBeVisible({ timeout: 5_000 });
  });
});
