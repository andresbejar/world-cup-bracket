import { describe, it, expect } from "vitest";
import { planMatchScoring, type ScorablePrediction } from "./scoring";
import type { ActualMatch } from "./bracket";

function groupMatch(
  status: ActualMatch["status"],
  home_score: number | null,
  away_score: number | null,
): ActualMatch {
  return {
    status,
    stage: "group",
    home_slot_id: "slot-home",
    away_slot_id: "slot-away",
    home_score,
    away_score,
    winning_slot_id: null,
  };
}

function knockoutMatch(
  status: ActualMatch["status"],
  home_score: number | null,
  away_score: number | null,
  winning_slot_id: string | null,
): ActualMatch {
  return {
    status,
    stage: "knockout",
    home_slot_id: "slot-home",
    away_slot_id: "slot-away",
    home_score,
    away_score,
    winning_slot_id,
  };
}

function pred(
  user_id: string,
  home: number,
  away: number,
  winner: string | null = null,
): ScorablePrediction {
  return {
    user_id,
    match_id: "m-1",
    predicted_home_score: home,
    predicted_away_score: away,
    predicted_winning_slot_id: winner,
  };
}

describe("planMatchScoring", () => {
  it("group finished: mixed 3/1/0 plan", () => {
    const plan = planMatchScoring({
      match: groupMatch("finished", 2, 1),
      predictions: [
        pred("alice", 2, 1), // exact
        pred("bob", 3, 0), // outcome only
        pred("carol", 0, 2), // wrong outcome
      ],
    });
    expect(plan.predictionUpdates).toEqual([
      { user_id: "alice", match_id: "m-1", points_awarded: 3 },
      { user_id: "bob", match_id: "m-1", points_awarded: 1 },
      { user_id: "carol", match_id: "m-1", points_awarded: 0 },
    ]);
    expect(plan.affected_user_ids).toEqual(["alice", "bob", "carol"]);
  });

  it("idempotency: same inputs → identical plan on repeat invocation", () => {
    const input = {
      match: groupMatch("finished", 2, 1),
      predictions: [pred("alice", 2, 1), pred("bob", 3, 0)],
    };
    const first = planMatchScoring(input);
    const second = planMatchScoring(input);
    expect(second).toEqual(first);
  });

  it("status in_progress: every points_awarded is null", () => {
    const plan = planMatchScoring({
      match: groupMatch("in_progress", 1, 0),
      predictions: [pred("alice", 1, 0), pred("bob", 2, 1)],
    });
    expect(plan.predictionUpdates.every((u) => u.points_awarded === null)).toBe(
      true,
    );
  });

  it("status cancelled: every points_awarded is 0 (per design)", () => {
    const plan = planMatchScoring({
      match: groupMatch("cancelled", null, null),
      predictions: [pred("alice", 2, 1), pred("bob", 0, 0)],
    });
    expect(plan.predictionUpdates.map((u) => u.points_awarded)).toEqual([0, 0]);
  });

  it("zero predictions: empty plan, no users affected", () => {
    const plan = planMatchScoring({
      match: groupMatch("finished", 2, 1),
      predictions: [],
    });
    expect(plan.predictionUpdates).toEqual([]);
    expect(plan.affected_user_ids).toEqual([]);
  });

  it("knockout outcome scored by slot id, not score sign", () => {
    const plan = planMatchScoring({
      match: knockoutMatch("finished", 1, 0, "slot-home"),
      predictions: [
        pred("alice", 1, 0, "slot-home"), // exact + correct slot → 3
        pred("bob", 2, 1, "slot-home"), // wrong score, correct slot → 1
        pred("carol", 0, 2, "slot-away"), // wrong slot → 0
      ],
    });
    expect(plan.predictionUpdates.map((u) => u.points_awarded)).toEqual([3, 1, 0]);
  });

  it("dedupes affected_user_ids when one user has multiple predictions on the match", () => {
    // (shouldn't happen given the unique constraint, but the planner
    // shouldn't double-count regardless)
    const plan = planMatchScoring({
      match: groupMatch("finished", 2, 1),
      predictions: [pred("alice", 2, 1), pred("alice", 3, 0)],
    });
    expect(plan.affected_user_ids).toEqual(["alice"]);
    expect(plan.predictionUpdates).toHaveLength(2);
  });
});
