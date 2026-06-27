import { describe, it, expect } from "vitest";
import {
  fetchAllScoredPredictions,
  LEADERBOARD_PAGE_SIZE,
} from "./leaderboard-data";

// Regression test for the leaderboard count truncation bug.
//
// loadLeaderboard aggregates exact/outcome counts from EVERY scored
// prediction. The original code fetched them in one `.select()`, which
// PostgREST silently caps at `db-max-rows` (1000 on Supabase). Once the
// tournament passed 1000 scored predictions, every user whose rows fell
// past the cap was undercounted while their materialized total_points
// (computed per-user) stayed correct — producing leaderboard rows where
// 3*exact + outcome != total_points.
//
// This fake reproduces the server-side cap: a single response can never
// return more than SERVER_MAX rows regardless of the requested range.

const SERVER_MAX = 1000;

type Row = { user_id: string; points_awarded: number | null };

/** Minimal fake of the chained PostgREST builder used by the helper. */
function fakeClient(rows: Row[]) {
  return {
    from() {
      return {
        select() {
          return this;
        },
        not() {
          return this;
        },
        order() {
          return this;
        },
        // PostgREST clamps the response to SERVER_MAX no matter how wide
        // the requested [from, to] window is.
        range(from: number, to: number) {
          const end = Math.min(to, from + SERVER_MAX - 1);
          const data = rows.slice(from, end + 1);
          return Promise.resolve({ data, error: null });
        },
      };
    },
  } as never;
}

describe("fetchAllScoredPredictions", () => {
  it("pages past the 1000-row server cap and returns every scored row", async () => {
    // 1035 rows — just over the cap, mirroring the prod state that
    // surfaced the bug (daniel-bejarano's 2nd exact and arno-snoeys's
    // overflow rows were the dropped ones).
    const total = 1035;
    const rows: Row[] = Array.from({ length: total }, (_, i) => ({
      user_id: `u-${String(i).padStart(5, "0")}`,
      points_awarded: i % 3 === 0 ? 3 : 1,
    }));

    const out = await fetchAllScoredPredictions(fakeClient(rows));

    expect(out).toHaveLength(total);
    // No row dropped: the multiples-of-3 (exact) all survive.
    const exact = out.filter((r) => r.points_awarded === 3).length;
    expect(exact).toBe(Math.ceil(total / 3));
  });

  it("stops after one page when the set fits under the cap", async () => {
    const rows: Row[] = Array.from(
      { length: LEADERBOARD_PAGE_SIZE - 1 },
      (_, i) => ({ user_id: `u-${i}`, points_awarded: 1 }),
    );
    const out = await fetchAllScoredPredictions(fakeClient(rows));
    expect(out).toHaveLength(LEADERBOARD_PAGE_SIZE - 1);
  });

  it("handles an exact multiple of the page size without dropping or looping forever", async () => {
    const rows: Row[] = Array.from(
      { length: LEADERBOARD_PAGE_SIZE * 2 },
      (_, i) => ({ user_id: `u-${i}`, points_awarded: 3 }),
    );
    const out = await fetchAllScoredPredictions(fakeClient(rows));
    expect(out).toHaveLength(LEADERBOARD_PAGE_SIZE * 2);
  });
});
