import { describe, it, expect } from "vitest";
import { deriveFinalStandings, type PodiumMatchRow } from "./scoring-runtime";

// The Final's two input slots and the third-place match's winning slot,
// mapped to the real teams advancement put there.
const teamBySlot = new Map<string, string>([
  ["final-sf-match-1-winner", "ARG"],
  ["final-sf-match-2-winner", "FRA"],
  ["third_place-sf-match-1-loser", "CRO"],
  ["third_place-sf-match-2-loser", "MAR"],
]);

const final = (winner: "home" | "away" | null, status = "finished"): PodiumMatchRow => ({
  status,
  home_slot_id: "final-sf-match-1-winner",
  away_slot_id: "final-sf-match-2-winner",
  winning_slot_id:
    winner === "home"
      ? "final-sf-match-1-winner"
      : winner === "away"
        ? "final-sf-match-2-winner"
        : null,
});

const thirdPlace = (winner: "home" | "away" | null, status = "finished"): PodiumMatchRow => ({
  status,
  home_slot_id: "third_place-sf-match-1-loser",
  away_slot_id: "third_place-sf-match-2-loser",
  winning_slot_id:
    winner === "home"
      ? "third_place-sf-match-1-loser"
      : winner === "away"
        ? "third_place-sf-match-2-loser"
        : null,
});

describe("deriveFinalStandings", () => {
  it("settles champion / runner-up / 3rd from a fully-played podium", () => {
    const s = deriveFinalStandings(final("home"), thirdPlace("home"), teamBySlot);
    expect(s).toEqual({
      first_place_team_id: "ARG",
      second_place_team_id: "FRA",
      third_place_team_id: "CRO",
    });
  });

  it("champion is the Final's winning side (away wins → runner-up flips)", () => {
    const s = deriveFinalStandings(final("away"), thirdPlace("away"), teamBySlot);
    expect(s.first_place_team_id).toBe("FRA");
    expect(s.second_place_team_id).toBe("ARG");
    expect(s.third_place_team_id).toBe("MAR");
  });

  it("partial podium: Final done, 3rd-place not → 1st/2nd known, 3rd null", () => {
    const s = deriveFinalStandings(final("home"), thirdPlace(null, "scheduled"), teamBySlot);
    expect(s.first_place_team_id).toBe("ARG");
    expect(s.second_place_team_id).toBe("FRA");
    expect(s.third_place_team_id).toBeNull();
  });

  it("Final tied/unresolved (no winning_slot_id) → 1st/2nd null", () => {
    const s = deriveFinalStandings(final(null), thirdPlace("home"), teamBySlot);
    expect(s.first_place_team_id).toBeNull();
    expect(s.second_place_team_id).toBeNull();
    expect(s.third_place_team_id).toBe("CRO");
  });

  it("nothing played yet → all null", () => {
    expect(deriveFinalStandings(null, null, teamBySlot)).toEqual({
      first_place_team_id: null,
      second_place_team_id: null,
      third_place_team_id: null,
    });
  });
});
