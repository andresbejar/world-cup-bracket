import { describe, it, expect } from "vitest";
import {
  classifyApiRound,
  planKnockoutBackfill,
  ROUND_PLAN,
  type PublishedFixture,
  type OurKnockoutMatch,
} from "./knockout-backfill";

const iso = (day: number, hour: number) =>
  `2026-07-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;

// Build aligned (our match ↔ published fixture) pairs for one round, with
// distinct, identical kickoff times so the nearest-pairing is delta 0.
function genRound(
  roundId: string,
  count: number,
  apiName: string,
  fixtureBase: number,
): { our: OurKnockoutMatch[]; pub: PublishedFixture[] } {
  const our: OurKnockoutMatch[] = [];
  const pub: PublishedFixture[] = [];
  for (let i = 0; i < count; i++) {
    const t = iso(1 + Math.floor(i / 2), 12 + (i % 2) * 4);
    our.push({ id: `m-${roundId}-${i + 1}`, round_id: roundId, scheduled_at: t, apifootball_fixture_id: null });
    pub.push({ fixture_id: fixtureBase + i, round: apiName, kickoff_at: t });
  }
  return { our, pub };
}

const ROUNDS = [
  genRound("r32", 16, "Round of 32", 1000),
  genRound("r16", 8, "Round of 16", 2000),
  genRound("qf", 4, "Quarter-finals", 3000),
  genRound("sf", 2, "Semi-finals", 4000),
  genRound("third_place", 1, "3rd Place Final", 5000),
  genRound("final", 1, "Final", 6000),
];
const ALL_OUR = ROUNDS.flatMap((r) => r.our);
const ALL_PUB = ROUNDS.flatMap((r) => r.pub);

describe("classifyApiRound", () => {
  it("maps the stable knockout round names", () => {
    expect(classifyApiRound("Round of 32")).toBe("r32");
    expect(classifyApiRound("Round of 16")).toBe("r16");
    expect(classifyApiRound("Quarter-finals")).toBe("qf");
    expect(classifyApiRound("Semi-finals")).toBe("sf");
    expect(classifyApiRound("3rd Place Final")).toBe("third_place");
    expect(classifyApiRound("Final")).toBe("final");
  });
  it("ignores group rounds and the unknown", () => {
    expect(classifyApiRound("Group Stage - 1")).toBeNull();
    expect(classifyApiRound("Preliminary Round")).toBeNull();
  });
  it("does not misclassify quarter/semi/3rd as the final (they contain 'final')", () => {
    expect(classifyApiRound("Quarter-finals")).not.toBe("final");
    expect(classifyApiRound("Semi-finals")).not.toBe("final");
    expect(classifyApiRound("3rd Place Final")).not.toBe("final");
  });
});

describe("planKnockoutBackfill", () => {
  it("links all 32 matches when every round is fully published", () => {
    const plan = planKnockoutBackfill(ALL_PUB, ALL_OUR);
    expect(plan.warnings).toEqual([]);
    expect(plan.assignments).toHaveLength(32);
    expect(plan.assignments.every((a) => a.delta_ms === 0)).toBe(true);
    // spot-check: the count per round matches ROUND_PLAN.
    for (const { round_id, count } of ROUND_PLAN) {
      expect(plan.assignments.filter((a) => a.round_id === round_id)).toHaveLength(count);
    }
  });

  it("is incremental: links only the rounds published so far, no noise for the rest", () => {
    const r32 = ROUNDS[0];
    const plan = planKnockoutBackfill(r32.pub, ALL_OUR); // only R32 published
    expect(plan.assignments).toHaveLength(16);
    expect(plan.assignments.every((a) => a.round_id === "r32")).toBe(true);
    expect(plan.warnings).toEqual([]); // unpublished rounds are silent
  });

  it("is idempotent: already-linked matches produce no assignment", () => {
    const linked = ROUNDS.flatMap((r) =>
      r.our.map((m, i) => ({ ...m, apifootball_fixture_id: r.pub[i].fixture_id })),
    );
    const plan = planKnockoutBackfill(ALL_PUB, linked);
    expect(plan.assignments).toHaveLength(0);
  });

  it("skips a round that is only partially published (count mismatch)", () => {
    const partialR32 = ROUNDS[0].pub.slice(0, 15); // 15 of 16
    const plan = planKnockoutBackfill(partialR32, ALL_OUR);
    expect(plan.assignments).toHaveLength(0);
    expect(plan.warnings.some((w) => w.includes("r32") && w.includes("expected 16"))).toBe(true);
  });

  it("skips a single pairing whose kickoff is implausibly far off", () => {
    // Move one R32 match 3 days from any fixture → that pairing exceeds 12h.
    const our = ALL_OUR.map((m) =>
      m.id === "m-r32-1" ? { ...m, scheduled_at: iso(20, 12) } : m,
    );
    const plan = planKnockoutBackfill(ROUNDS[0].pub, our);
    expect(plan.assignments).toHaveLength(15); // 16 - 1 skipped
    expect(plan.warnings.some((w) => w.includes("m-r32-1"))).toBe(true);
  });

  it("falls back to the 16-fixture count when the R32 label is unrecognized", () => {
    const weird = ROUNDS[0].pub.map((f) => ({ ...f, round: "Knockout Phase" }));
    const plan = planKnockoutBackfill(weird, ROUNDS[0].our);
    expect(plan.assignments).toHaveLength(16);
    expect(plan.assignments.every((a) => a.round_id === "r32")).toBe(true);
  });
});
