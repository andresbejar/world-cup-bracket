import { test, expect } from "@playwright/test";
import {
  adminClient,
  listGroupMatches,
  listKnockoutMatches,
} from "./helpers";
import { TEST_USER_EMAIL } from "./global-setup";

// Critical path #2 from the test plan: build the entire bracket end-to-end.
// We seed every pick via /api/* (the same RLS-gated paths the workspace
// hits) to keep the run under 30s; the value is in proving the UI
// hydrates correctly from the DB after a full build, not in re-asserting
// that 72 individual button clicks work (APT-33 already covers the
// single-prediction flow click-by-click).
//
// The second spec is the cascade-reactivity assertion the AC calls for:
// change a group score in the UI, see the sidebar re-rank without a
// reload.

test.describe.configure({ mode: "serial" });

// Bumped from the 30s default — the build spec issues ~105 sequential
// API calls (72 group + 32 knockout + 1 finalist) plus a reload + a
// handful of UI assertions. ~60s comfortably covers both local and CI
// runs. (Best-third picks are auto-derived now, no API calls.)
test.setTimeout(90_000);

// Kickoffs we pushed into the future so the seed predictions are accepted,
// restored verbatim in afterAll. The suite predates the live tournament and
// the per-match lock (lib/lock-check.ts checkMatchLock) now rejects writes to
// any match whose kickoff has passed; this spec predicts every match, so we
// re-open the ones real time has already passed.
const restoredKickoffs: { id: string; scheduled_at: string }[] = [];

// Match result rows the second spec flips to `finished` to exercise the
// real-only sidebar; restored verbatim in afterAll.
const restoredResults: {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  finished_at: string | null;
  scheduled_at: string;
}[] = [];

test.describe("bracket build", () => {
  test.beforeAll(async () => {
    // Wipe any leftover state from prior spec runs so this file is
    // idempotent regardless of test order. The test user is the same
    // across the whole suite; we don't want APT-33's saved score to
    // contaminate our standings assertions.
    const admin = adminClient();
    const list = await admin.auth.admin.listUsers();
    if (list.error) throw list.error;
    const user = list.data.users.find((u) => u.email === TEST_USER_EMAIL);
    if (!user) throw new Error("test user not found — global-setup ran?");
    await admin.from("predictions").delete().eq("user_id", user.id);
    await admin
      .from("predicted_qualifying_thirds")
      .delete()
      .eq("user_id", user.id);
    await admin.from("finalist_picks").delete().eq("user_id", user.id);

    // Re-open every match real wall-clock has already passed, so the full
    // build (group + knockout + finalist) writes are all accepted. Snapshot
    // first; afterAll restores the original kickoffs.
    const nowIso = new Date().toISOString();
    const { data: past, error: pastErr } = await admin
      .from("matches")
      .select("id, scheduled_at")
      .lte("scheduled_at", nowIso);
    if (pastErr) throw pastErr;
    for (const m of past ?? []) {
      restoredKickoffs.push({
        id: m.id as string,
        scheduled_at: m.scheduled_at as string,
      });
    }
    if (restoredKickoffs.length > 0) {
      const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      await admin
        .from("matches")
        .update({ scheduled_at: future })
        .in(
          "id",
          restoredKickoffs.map((m) => m.id),
        );
    }
  });

  test.afterAll(async () => {
    const admin = adminClient();
    // Restore flipped results first (status → scheduled), then kickoffs.
    for (const snap of restoredResults) {
      await admin
        .from("matches")
        .update({
          status: snap.status,
          home_score: snap.home_score,
          away_score: snap.away_score,
          finished_at: snap.finished_at,
          scheduled_at: snap.scheduled_at,
        })
        .eq("id", snap.id);
    }
    restoredResults.length = 0;
    for (const snap of restoredKickoffs) {
      await admin
        .from("matches")
        .update({ scheduled_at: snap.scheduled_at })
        .eq("id", snap.id);
    }
    restoredKickoffs.length = 0;
  });

  test("seed every pick via API, reload, verify UI hydrates", async ({
    page,
    request,
  }) => {
    const groupMatches = await listGroupMatches();
    expect(groupMatches.length).toBe(72);

    // Bulk-seed group predictions. Deterministic 2-1 home win on every
    // match. Run 12 in parallel — Next dev/start handles concurrent
    // /api/predictions writes per-user fine (the upsert key is (user_id,
    // match_id), no contention across different match_ids).
    await runInBatches(groupMatches, 12, async (m) => {
      const res = await request.post("/api/predictions", {
        data: {
          match_id: m.id,
          predicted_home_score: 2,
          predicted_away_score: 1,
        },
      });
      expect(res.status(), `predict ${m.id} (${m.home_code} vs ${m.away_code})`).toBe(200);
    });

    // The "best third-placed teams" qualifying set is no longer a manual
    // pick — it's auto-derived from the group predictions (top 8 thirds by
    // points → GD → goals for) and contributes 0 points. With every group
    // fully predicted below, the 8 best-3rd-vs R32 slots fill automatically
    // via Annex C; we assert that (zero dashes) further down.
    const teamPool = Array.from(
      new Set(groupMatches.map((m) => m.home_team_id)),
    );

    // Knockout predictions: home wins 1-0 in every match. predicted_
    // winning_slot_id = home_slot_id for the slot-vs-team premise.
    const knockoutMatches = await listKnockoutMatches();
    expect(knockoutMatches.length).toBe(32);
    await runInBatches(knockoutMatches, 12, async (m) => {
      const res = await request.post("/api/predictions", {
        data: {
          match_id: m.id,
          predicted_home_score: 1,
          predicted_away_score: 0,
          predicted_winning_slot_id: m.home_slot_id,
        },
      });
      expect(res.status(), `predict knockout ${m.id}`).toBe(200);
    });

    // Finalist picks: pick three distinct teams from the pool.
    const finalistRes = await request.post("/api/finalist-picks", {
      data: {
        first_place_team_id: teamPool[0],
        second_place_team_id: teamPool[1],
        third_place_team_id: teamPool[2],
      },
    });
    expect(finalistRes.status()).toBe(200);

    // Now hydrate the UI from a fresh load and verify everything stuck.
    await page.goto("/predictions");
    await expect(page.getByText("GROUP STAGE · ACTIVE ROUND")).toBeVisible({
      timeout: 15_000,
    });

    // PODIUM pill should show 3/3 FILLED in the round selector.
    await expect(
      page
        .getByRole("button", { name: /PODIUM/ })
        .first()
        .locator("span", { hasText: /FILLED|3\/3/ }),
    ).toBeVisible();

    // Switch to the standings tab. The sidebar now shows REAL standings only
    // (the predicted view + source toggle were removed): with no real matches
    // finished, all 12 group tables render at 0 played.
    await page.getByRole("tab", { name: /Standings/i }).click();
    await expect(page.getByText("GROUP STAGE", { exact: true })).toBeVisible();
    await expect(page.getByText("0/72 PLAYED")).toBeVisible();
    await expect(page.locator('[role="tabpanel"] table')).toHaveCount(12);

    // Bracket view is projected from current real standings: the 32 R32 input
    // slots fill from the (all-zero) standings — 12 winners + 12 runners-up +
    // 8 best-thirds via Annex C — while downstream R16→Final stay "—" until
    // real results land. So the meta reads 32/32 R32 under the disclaimer.
    await page.getByRole("tab", { name: /Bracket/i }).click();
    await expect(page.getByText(/Based on current standings/)).toBeVisible();
    await expect(page.getByText("32/32 R32")).toBeVisible();
    // Downstream slots are still blank (no winner predictions applied, no real
    // knockout results), so the bracket SVG does contain dashes.
    await expect(
      page.locator("svg text", { hasText: /^—$/ }).first(),
    ).toBeVisible();

    // Visit the PODIUM tab and verify the three picks rendered. The
    // round-selector pill is a <button> with text PODIUM in the first
    // line; multiple PODIUM-named elements exist (banner button, pill
    // button) so we anchor to the pill by its mono caps text.
    const podiumPill = page
      .locator('nav[aria-label="Tournament rounds"] button', {
        hasText: "PODIUM",
      })
      .first();
    await podiumPill.click();
    await expect(
      page.getByRole("heading", { name: "Podium picks", exact: true }),
    ).toBeVisible();
    const podiumSelects = page.getByRole("combobox");
    const selectedValues = await podiumSelects.evaluateAll((nodes) =>
      nodes
        .filter((n): n is HTMLSelectElement => n instanceof HTMLSelectElement)
        .map((n) => n.value),
    );
    expect(selectedValues.filter((v) => v.length > 0).length).toBeGreaterThanOrEqual(3);
  });

  test("real results drive the sidebar standings", async ({ page }) => {
    // The sidebar is real-only now: predictions no longer move it; real
    // finished results do. Finish one group-A match and assert the standings
    // re-derive — the group's played count ticks up and the winner takes rank 1.
    const groupMatches = await listGroupMatches();
    const groupAMatch = groupMatches.find((m) => m.group_letter === "A");
    expect(groupAMatch).toBeDefined();

    const admin = adminClient();
    const { data: before, error: beforeErr } = await admin
      .from("matches")
      .select("status, home_score, away_score, finished_at, scheduled_at")
      .eq("id", groupAMatch!.id)
      .single();
    if (beforeErr) throw beforeErr;
    restoredResults.push({
      id: groupAMatch!.id,
      status: before!.status as string,
      home_score: before!.home_score as number | null,
      away_score: before!.away_score as number | null,
      finished_at: before!.finished_at as string | null,
      scheduled_at: before!.scheduled_at as string,
    });

    // Before any real result, group A shows 0/6 played in the sidebar.
    await page.goto("/predictions");
    await expect(page.getByText("GROUP STAGE · ACTIVE ROUND")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("tab", { name: /Standings/i }).click();
    const groupACard = page
      .locator("ul li", { has: page.getByText(/^Group A/) })
      .first();
    await expect(groupACard.getByText("0/6 PLAYED")).toBeVisible();

    // Finish group A's first match as a 3-0 home win. Date it in the past so
    // hasRealResult() (status=finished AND kickoff passed) counts it as real.
    const pastIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { error: finErr } = await admin
      .from("matches")
      .update({
        status: "finished",
        home_score: 3,
        away_score: 0,
        finished_at: pastIso,
        scheduled_at: pastIso,
      })
      .eq("id", groupAMatch!.id);
    if (finErr) throw finErr;

    // Reload: the real-only standings now reflect the result.
    await page.reload();
    await page.getByRole("tab", { name: /Standings/i }).click();
    await expect(groupACard.getByText("1/6 PLAYED")).toBeVisible();
    // The home team won 3-0 → 3 points → rank 1 (code in the 2nd cell).
    const rank1Code = await groupACard
      .locator("tbody tr")
      .first()
      .locator("td")
      .nth(1)
      .textContent();
    expect(rank1Code?.trim()).toBe(groupAMatch!.home_code);

    // The projected bracket reads off the same real standings, so winner-A's
    // R32 slot is now the real group-A leader — assert the home team's code
    // appears in the bracket SVG (covers the real-standings → projected-bracket
    // path with a non-trivial result, not just the all-zero baseline).
    await page.getByRole("tab", { name: /Bracket/i }).click();
    await expect(
      page.locator("svg text", { hasText: groupAMatch!.home_code }).first(),
    ).toBeVisible();
  });
});

// Run an async task over a list with bounded concurrency. We use this
// to parallelize the API seed without overwhelming the test server.
async function runInBatches<T>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(fn));
  }
}
