import { describe, it, expect } from "vitest";
import { resolveActiveRoundId } from "./active-round";

// Rounds arrive ordered by deadline_at ascending (group matchdays, then knockouts).
const ROUNDS = [
  { id: "group-r1" },
  { id: "group-r2" },
  { id: "group-r3" },
  { id: "r32" },
  { id: "final" },
];

// Build a flat match list: `counts` maps round id → array of statuses.
function matches(counts: Record<string, string[]>) {
  return Object.entries(counts).flatMap(([round_id, statuses]) =>
    statuses.map((status) => ({ round_id, status })),
  );
}

describe("resolveActiveRoundId", () => {
  it("returns the first round pre-tournament (all scheduled)", () => {
    const m = matches({
      "group-r1": ["scheduled", "scheduled"],
      "group-r2": ["scheduled"],
      "group-r3": ["scheduled"],
      r32: ["scheduled"],
      final: ["scheduled"],
    });
    expect(resolveActiveRoundId(ROUNDS, m)).toBe("group-r1");
  });

  it("returns the live matchday when earlier ones are finished", () => {
    const m = matches({
      "group-r1": ["finished", "finished"],
      "group-r2": ["finished"],
      "group-r3": ["finished", "scheduled"], // mixed
      r32: ["scheduled"],
      final: ["scheduled"],
    });
    expect(resolveActiveRoundId(ROUNDS, m)).toBe("group-r3");
  });

  it("advances to R32 once the group stage is fully finished", () => {
    const m = matches({
      "group-r1": ["finished"],
      "group-r2": ["finished"],
      "group-r3": ["finished"],
      r32: ["scheduled", "scheduled"],
      final: ["scheduled"],
    });
    expect(resolveActiveRoundId(ROUNDS, m)).toBe("r32");
  });

  it("treats an in_progress match as unfinished", () => {
    const m = matches({
      "group-r1": ["finished"],
      "group-r2": ["in_progress"],
      final: ["scheduled"],
    });
    expect(resolveActiveRoundId(ROUNDS, m)).toBe("group-r2");
  });

  it("does not keep a round active for cancelled matches", () => {
    const m = matches({
      "group-r1": ["finished"],
      "group-r2": ["finished", "cancelled"],
      "group-r3": ["scheduled"],
      final: ["finished"],
    });
    expect(resolveActiveRoundId(ROUNDS, m)).toBe("group-r3");
  });

  it("falls back to the last round when everything is finished", () => {
    const m = matches({
      "group-r1": ["finished"],
      "group-r2": ["finished"],
      "group-r3": ["finished"],
      r32: ["finished"],
      final: ["finished"],
    });
    expect(resolveActiveRoundId(ROUNDS, m)).toBe("final");
  });

  it("returns '' for empty rounds", () => {
    expect(resolveActiveRoundId([], [])).toBe("");
  });

  it("falls back to the last round when no matches are loaded", () => {
    expect(resolveActiveRoundId(ROUNDS, [])).toBe("final");
  });
});
