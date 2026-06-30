import { describe, it, expect } from "vitest";
import {
  computeFinalistPoints,
  computeGroupStandings,
  computeKnockoutCascade,
  computeLeaderboard,
  computeMatchPoints,
  computeThirdPlacePlacementPoints,
  deriveBestThirdGroups,
  populateR32Slots,
  GROUP_LETTERS,
  type ActualMatch,
  type FinalistPicks,
  type FinalStandings,
  type GroupLetter,
  type GroupStanding,
  type GroupStandings,
  type KnockoutMatchPrediction,
  type LeaderboardUser,
  type MatchPrediction,
  type MatchScore,
  type MatchStatus,
  type ScoredPrediction,
  type SlotAssignment,
  type Team,
} from "./bracket";
import { R32_MATCHES } from "./bracket-structure";

const teamsA: Team[] = [
  { id: "ARG", group_letter: "A" },
  { id: "BRA", group_letter: "A" },
  { id: "CHI", group_letter: "A" },
  { id: "DEN", group_letter: "A" },
];

function score(
  home: string,
  hf: number,
  away: string,
  af: number,
): MatchScore {
  return {
    home_team_id: home,
    away_team_id: away,
    home_score: hf,
    away_score: af,
  };
}

describe("computeGroupStandings", () => {
  it("happy path: 4 teams, 6 matches, clear ranking", () => {
    // ARG wins all 3 → 9pts. BRA beats CHI and DEN → 6. CHI beats DEN → 3. DEN → 0.
    const scores: MatchScore[] = [
      score("ARG", 2, "BRA", 0),
      score("ARG", 2, "CHI", 1),
      score("ARG", 3, "DEN", 0),
      score("BRA", 1, "CHI", 0),
      score("BRA", 2, "DEN", 0),
      score("CHI", 1, "DEN", 0),
    ];
    const out = computeGroupStandings(scores, teamsA);
    expect(out.map((s) => [s.team_id, s.rank, s.points])).toEqual([
      ["ARG", 1, 9],
      ["BRA", 2, 6],
      ["CHI", 3, 3],
      ["DEN", 4, 0],
    ]);
    expect(out.every((s) => s.played === 3)).toBe(true);
    expect(out.every((s) => s.needs_tiebreaker === false)).toBe(true);
    const arg = out[0];
    expect(arg).toMatchObject({
      won: 3,
      drawn: 0,
      lost: 0,
      goals_for: 7,
      goals_against: 1,
      goal_difference: 6,
    });
  });

  it("tied points → goal difference breaks the tie", () => {
    // ARG and BRA both 2W 1L = 6pts. ARG GD +6, BRA GD +3.
    const scores: MatchScore[] = [
      score("ARG", 5, "CHI", 0), // ARG W
      score("ARG", 2, "DEN", 0), // ARG W
      score("ARG", 1, "BRA", 2), // BRA W (ARG L)
      score("CHI", 2, "BRA", 1), // CHI W (BRA L)
      score("BRA", 3, "DEN", 0), // BRA W
      score("DEN", 1, "CHI", 0), // DEN W
    ];
    const out = computeGroupStandings(scores, teamsA);
    expect(out[0].team_id).toBe("ARG");
    expect(out[1].team_id).toBe("BRA");
    expect(out[0].points).toBe(6);
    expect(out[1].points).toBe(6);
    expect(out[0].goal_difference).toBe(6);
    expect(out[1].goal_difference).toBe(3);
    expect(out.every((s) => s.needs_tiebreaker === false)).toBe(true);
  });

  it("tied GD → goals scored breaks the tie", () => {
    // ARG and BRA both 2W 1L = 6pts, both GD +3, but ARG scored 8 vs BRA's 5.
    const scores: MatchScore[] = [
      score("ARG", 1, "BRA", 0), // ARG beat BRA
      score("ARG", 7, "CHI", 4), // ARG beat CHI big
      score("DEN", 1, "ARG", 0), // DEN beat ARG
      score("BRA", 3, "CHI", 0), // BRA beat CHI
      score("BRA", 2, "DEN", 1), // BRA beat DEN
      score("CHI", 2, "DEN", 0), // CHI beat DEN
    ];
    const out = computeGroupStandings(scores, teamsA);
    expect(out[0].team_id).toBe("ARG");
    expect(out[1].team_id).toBe("BRA");
    expect(out[0].points).toBe(6);
    expect(out[1].points).toBe(6);
    expect(out[0].goal_difference).toBe(3);
    expect(out[1].goal_difference).toBe(3);
    expect(out[0].goals_for).toBe(8);
    expect(out[1].goals_for).toBe(5);
    expect(out.every((s) => s.needs_tiebreaker === false)).toBe(true);
  });

  it("tied GS → head-to-head points break the tie", () => {
    // 3-team group: A and B identical on pts/GD/GS, but A beat B 2-1.
    // C is the also-ran.
    const teams: Team[] = [
      { id: "AAA", group_letter: "A" },
      { id: "BBB", group_letter: "A" },
      { id: "CCC", group_letter: "A" },
    ];
    const scores: MatchScore[] = [
      score("AAA", 2, "BBB", 1), // A beats B 2-1
      score("AAA", 0, "CCC", 1), // A loses to C
      score("BBB", 1, "CCC", 0), // B beats C
    ];
    const out = computeGroupStandings(scores, teams);
    // A: 1W1L pts=3, GS=2, GD=0
    // B: 1W1L pts=3, GS=2, GD=0
    // C: 1W1L pts=3, GS=1, GD=0  → separated by GS
    // A above B by H2H pts (A won the head-to-head 2-1).
    expect(out.map((s) => s.team_id)).toEqual(["AAA", "BBB", "CCC"]);
    expect(out[0].points).toBe(out[1].points);
    expect(out[0].goal_difference).toBe(out[1].goal_difference);
    expect(out[0].goals_for).toBe(out[1].goals_for);
    expect(out[0].needs_tiebreaker).toBe(false);
    expect(out[1].needs_tiebreaker).toBe(false);
  });

  it("tied H2H pts → head-to-head GD breaks the tie", () => {
    // 4-team group. A, B, C all tie overall (6pts, GD+4, GS=9).
    // Their inter-matches form a 3-cycle with asymmetric scores so
    // H2H pts are 3 each but H2H GD splits them.
    const scores: MatchScore[] = [
      score("ARG", 5, "BRA", 0), // A beats B 5-0  → A H2H pts +3
      score("BRA", 1, "CHI", 0), // B beats C 1-0  → B H2H pts +3
      score("ARG", 0, "CHI", 2), // C beats A as the AWAY side — exercises that branch
      score("ARG", 4, "DEN", 3), // A beats D 4-3
      score("BRA", 8, "DEN", 0), // B beats D 8-0
      score("CHI", 7, "DEN", 4), // C beats D 7-4
    ];
    const out = computeGroupStandings(scores, teamsA);
    // Top 3 all 6pts/GD+4/GS=9. H2H pts equal at 3.
    // H2H GD: ARG = +5 + (-2) = +3; CHI = +1 + (+2) = +3?? recompute.
    //   ARG h2h matches: vs BRA (5-0) +5; vs CHI (0-2) -2 → +3
    //   BRA h2h matches: vs ARG (0-5) -5; vs CHI (1-0) +1 → -4
    //   CHI h2h matches: vs ARG (2-0) +2; vs BRA (0-1) -1 → +1
    // Order: ARG (+3) > CHI (+1) > BRA (-4). DEN last.
    expect(out.map((s) => s.team_id)).toEqual(["ARG", "CHI", "BRA", "DEN"]);
    expect(out[0].points).toBe(6);
    expect(out[1].points).toBe(6);
    expect(out[2].points).toBe(6);
    expect(out[0].goals_for).toBe(9);
    expect(out[1].goals_for).toBe(9);
    expect(out[2].goals_for).toBe(9);
    expect(out[0].needs_tiebreaker).toBe(false);
    expect(out[1].needs_tiebreaker).toBe(false);
    expect(out[2].needs_tiebreaker).toBe(false);
    expect(out[3].team_id).toBe("DEN");
  });

  it("still tied at step 5 → alphabetical fallback flagged", () => {
    // ARG and BRA mirror each other completely: drew 1-1 head-to-head,
    // identical results vs CHI and DEN.
    const scores: MatchScore[] = [
      score("ARG", 1, "BRA", 1),
      score("ARG", 2, "CHI", 0),
      score("ARG", 0, "DEN", 1),
      score("BRA", 2, "CHI", 0),
      score("BRA", 0, "DEN", 1),
      score("CHI", 0, "DEN", 0),
    ];
    const out = computeGroupStandings(scores, teamsA);
    // DEN beat ARG and BRA + drew CHI → 7pts, group winner.
    // ARG and BRA both 1W 1D 1L = 4pts, GS=3, GA=2, GD=+1.
    // H2H: drew 1-1 → h2h pts equal, h2h gd 0 each. Alpha resolves: ARG < BRA.
    expect(out[0].team_id).toBe("DEN");
    expect(out[1].team_id).toBe("ARG");
    expect(out[2].team_id).toBe("BRA");
    expect(out[1].needs_tiebreaker).toBe(true);
    expect(out[2].needs_tiebreaker).toBe(true);
    expect(out[1].points).toBe(out[2].points);
    expect(out[1].goal_difference).toBe(out[2].goal_difference);
    expect(out[1].goals_for).toBe(out[2].goals_for);
    expect(out[0].needs_tiebreaker).toBe(false);
    // CHI is alone at 1pt → no flag.
    expect(out.find((s) => s.team_id === "CHI")?.needs_tiebreaker).toBe(false);
  });

  it("empty predictions → every team 0pts in alphabetical order, all flagged", () => {
    const out = computeGroupStandings([], teamsA);
    expect(out.map((s) => s.team_id)).toEqual(["ARG", "BRA", "CHI", "DEN"]);
    expect(out.every((s) => s.points === 0)).toBe(true);
    expect(out.every((s) => s.played === 0)).toBe(true);
    expect(out.every((s) => s.needs_tiebreaker === true)).toBe(true);
    expect(out.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
  });

  it("partial predictions reflect only the matches that exist", () => {
    // Only 2 of 6 matches predicted. Standings should reflect what's known.
    const scores: MatchScore[] = [
      score("ARG", 3, "BRA", 0), // ARG +3
      score("CHI", 2, "DEN", 1), // CHI +1
    ];
    const out = computeGroupStandings(scores, teamsA);
    const arg = out.find((s) => s.team_id === "ARG")!;
    const chi = out.find((s) => s.team_id === "CHI")!;
    const bra = out.find((s) => s.team_id === "BRA")!;
    const den = out.find((s) => s.team_id === "DEN")!;
    expect(arg).toMatchObject({ played: 1, won: 1, points: 3, goal_difference: 3 });
    expect(chi).toMatchObject({ played: 1, won: 1, points: 3, goal_difference: 1 });
    expect(bra).toMatchObject({ played: 1, won: 0, lost: 1, points: 0 });
    expect(den).toMatchObject({ played: 1, won: 0, lost: 1, points: 0 });
    // ARG (GD+3) ranks above CHI (GD+1) ranks above the loser pair.
    expect(out.map((s) => s.team_id).slice(0, 2)).toEqual(["ARG", "CHI"]);
  });

  it("ignores scores referencing teams outside the group", () => {
    // A defensive guard — a malformed input from the caller (e.g. a match
    // wired to the wrong group) shouldn't poison the table.
    const scores: MatchScore[] = [
      score("ARG", 2, "BRA", 1),
      score("ARG", 5, "ZZZ", 0), // ZZZ not in groupTeams → drop
      score("ZZZ", 9, "DEN", 0), // dropped
    ];
    const out = computeGroupStandings(scores, teamsA);
    const arg = out.find((s) => s.team_id === "ARG")!;
    expect(arg.played).toBe(1);
    expect(arg.goals_for).toBe(2);
    expect(out.find((s) => s.team_id === "DEN")?.played).toBe(0);
  });

  it("draws accumulate 1pt to each side", () => {
    // Specifically exercises the drawn branch in accumulate(), making
    // sure the 'else' (draw) path is covered even if every other test
    // only saw wins/losses.
    const teams: Team[] = [
      { id: "AAA", group_letter: "A" },
      { id: "BBB", group_letter: "A" },
    ];
    const out = computeGroupStandings(
      [score("AAA", 2, "BBB", 2)],
      teams,
    );
    expect(out[0].drawn).toBe(1);
    expect(out[1].drawn).toBe(1);
    expect(out[0].points).toBe(1);
    expect(out[1].points).toBe(1);
    // Tied on everything → alpha breaks → both flagged.
    expect(out[0].needs_tiebreaker).toBe(true);
    expect(out[1].needs_tiebreaker).toBe(true);
  });
});

// ----------------------------------------------------------------------
// populateR32Slots
// ----------------------------------------------------------------------

function fakeGroup(letter: string): GroupStandings {
  // Synthetic team codes: A1, A2, A3, A4 for group A — ranks 1..4 in order.
  const standings: GroupStanding[] = [1, 2, 3, 4].map((rank) => ({
    team_id: `${letter}${rank}`,
    played: 3,
    won: 4 - rank,
    drawn: 0,
    lost: rank - 1,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: (4 - rank) * 3,
    rank,
    needs_tiebreaker: false,
  }));
  return { group_letter: letter as GroupStandings["group_letter"], standings };
}

function allGroups(): GroupStandings[] {
  return GROUP_LETTERS.map((l) => fakeGroup(l));
}

// The qualifying set {A..H} → Annex C key "ABCDEFGH". Used across the
// tests below; its expected assignment is asserted in lib/annex-c.test.ts.
const QUAL_ABCDEFGH: GroupLetter[] = ["A", "B", "C", "D", "E", "F", "G", "H"];

describe("populateR32Slots", () => {
  it("happy path: 12 groups + 8 qualifying thirds → 32 populated slots", () => {
    const out = populateR32Slots(allGroups(), QUAL_ABCDEFGH);
    expect(out).toHaveLength(32);
    expect(out.every((s) => s.team_id !== null)).toBe(true);
    // First 12 are winners, in alpha order.
    expect(out.slice(0, 12).map((s) => [s.slot_label, s.team_id])).toEqual([
      ["winner-A", "A1"],
      ["winner-B", "B1"],
      ["winner-C", "C1"],
      ["winner-D", "D1"],
      ["winner-E", "E1"],
      ["winner-F", "F1"],
      ["winner-G", "G1"],
      ["winner-H", "H1"],
      ["winner-I", "I1"],
      ["winner-J", "J1"],
      ["winner-K", "K1"],
      ["winner-L", "L1"],
    ]);
    // Next 12 are runners-up.
    expect(out.slice(12, 24).map((s) => s.team_id)).toEqual([
      "A2", "B2", "C2", "D2", "E2", "F2",
      "G2", "H2", "I2", "J2", "K2", "L2",
    ]);
    // Last 8 are the Annex-C third-place slots. Each "best-3rd-vs-{winner}"
    // holds the rank-3 team of the group Annex C assigned (key ABCDEFGH:
    // 1A→H, 1B→G, 1D→B, 1E→C, 1G→A, 1I→F, 1K→D, 1L→E).
    expect(out.slice(24).map((s) => [s.slot_label, s.team_id])).toEqual([
      ["best-3rd-vs-A", "H3"],
      ["best-3rd-vs-B", "G3"],
      ["best-3rd-vs-D", "B3"],
      ["best-3rd-vs-E", "C3"],
      ["best-3rd-vs-G", "A3"],
      ["best-3rd-vs-I", "F3"],
      ["best-3rd-vs-K", "D3"],
      ["best-3rd-vs-L", "E3"],
    ]);
    expect(out.slice(0, 12).every((s) => s.source === "group_winner")).toBe(true);
    expect(out.slice(12, 24).every((s) => s.source === "group_runner_up")).toBe(true);
    expect(out.slice(24).every((s) => s.source === "third_place_pick")).toBe(true);
  });

  it("full bracket realism: 16 R32 matches, every team once, all cross-group", () => {
    const slots = populateR32Slots(allGroups(), QUAL_ABCDEFGH);
    const byLabel = new Map(slots.map((s) => [s.slot_label, s.team_id]));

    expect(R32_MATCHES).toHaveLength(16);
    const seen = new Set<string>();
    for (const m of R32_MATCHES) {
      const home = byLabel.get(m.home_slot_label);
      const away = byLabel.get(m.away_slot_label);
      expect(home).not.toBeNull();
      expect(away).not.toBeNull();
      // Synthetic team_id's first char is its group letter — assert the
      // two sides of every match come from different groups.
      expect(home![0]).not.toBe(away![0]);
      seen.add(home!);
      seen.add(away!);
    }
    expect(seen.size).toBe(32); // every team appears exactly once
  });

  it("Mexico/Korea: a group winner never faces its own group's 3rd", () => {
    // winner-A's R32 match is winner-A vs best-3rd-vs-A. With group A
    // qualifying, Annex C guarantees the 3rd-placed side is NOT A3.
    const out = populateR32Slots(allGroups(), QUAL_ABCDEFGH);
    const byLabel = new Map(out.map((s) => [s.slot_label, s.team_id]));
    const m = R32_MATCHES.find((x) => x.home_slot_label === "winner-A")!;
    expect(byLabel.get(m.home_slot_label)).toBe("A1");
    expect(byLabel.get(m.away_slot_label)).not.toBe("A3");
  });

  it("fewer than 8 qualifying groups → third-place slots null (renderable mid-selection)", () => {
    const out = populateR32Slots(allGroups(), ["A", "B", "C"] as GroupLetter[]);
    const thirds = out.filter((s) => s.source === "third_place_pick");
    expect(thirds).toHaveLength(8);
    expect(thirds.every((s) => s.team_id === null)).toBe(true);
    // winners/runners still populated mid-selection.
    expect(out.find((s) => s.slot_label === "winner-A")?.team_id).toBe("A1");
  });

  it("duplicate group in the set → third slots null (not 8 distinct), no throw", () => {
    const dup = ["A", "A", "B", "C", "D", "E", "F", "G"] as GroupLetter[];
    const out = populateR32Slots(allGroups(), dup);
    expect(
      out
        .filter((s) => s.source === "third_place_pick")
        .every((s) => s.team_id === null),
    ).toBe(true);
  });

  it("empty qualifying set → all 8 third-place slots null", () => {
    const out = populateR32Slots(allGroups(), []);
    const thirds = out.filter((s) => s.source === "third_place_pick");
    expect(thirds).toHaveLength(8);
    expect(thirds.every((s) => s.team_id === null)).toBe(true);
  });

  it("assigned group has no standings → that third slot null, others resolve", () => {
    // Drop group H. With set {A..H}, Annex C maps 1A→H, so best-3rd-vs-A
    // can't resolve and comes out null; the rest still fill.
    const groups = allGroups().filter((g) => g.group_letter !== "H");
    const out = populateR32Slots(groups, QUAL_ABCDEFGH);
    expect(out.find((s) => s.slot_label === "best-3rd-vs-A")?.team_id).toBeNull();
    expect(out.find((s) => s.slot_label === "best-3rd-vs-B")?.team_id).toBe("G3");
  });

  it("missing group standings → that group's winner + runner-up slots are null", () => {
    const groups = allGroups().filter((g) => g.group_letter !== "F");
    const out = populateR32Slots(groups, []);
    expect(out.find((s) => s.slot_label === "winner-F")?.team_id).toBeNull();
    expect(out.find((s) => s.slot_label === "runner-up-F")?.team_id).toBeNull();
    expect(out.find((s) => s.slot_label === "winner-A")?.team_id).toBe("A1");
  });
});

// ----------------------------------------------------------------------
// computeMatchPoints
// ----------------------------------------------------------------------

function groupMatch(
  status: MatchStatus,
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
  status: MatchStatus,
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
  predicted_home_score: number,
  predicted_away_score: number,
  predicted_winning_slot_id: string | null = null,
): MatchPrediction {
  return {
    predicted_home_score,
    predicted_away_score,
    predicted_winning_slot_id,
  };
}

describe("computeMatchPoints", () => {
  it("group: exact score → 3 pts", () => {
    expect(computeMatchPoints(pred(2, 1), groupMatch("finished", 2, 1))).toBe(3);
  });

  it("group: outcome correct, score wrong → 1 pt", () => {
    expect(computeMatchPoints(pred(3, 0), groupMatch("finished", 2, 1))).toBe(1);
    expect(computeMatchPoints(pred(0, 3), groupMatch("finished", 1, 2))).toBe(1);
  });

  it("group: predicted tie, actual tie, different score → 1 pt", () => {
    expect(computeMatchPoints(pred(2, 2), groupMatch("finished", 1, 1))).toBe(1);
    expect(computeMatchPoints(pred(0, 0), groupMatch("finished", 3, 3))).toBe(1);
  });

  it("group: outcome wrong → 0 pts", () => {
    // Predicted home win, actual away win.
    expect(computeMatchPoints(pred(2, 1), groupMatch("finished", 1, 2))).toBe(0);
    // Predicted draw, actual home win.
    expect(computeMatchPoints(pred(1, 1), groupMatch("finished", 2, 1))).toBe(0);
    // Predicted home win, actual draw.
    expect(computeMatchPoints(pred(1, 0), groupMatch("finished", 1, 1))).toBe(0);
  });

  it("knockout: 90+ET score from regulation only — penalty goals never count", () => {
    // The matches table only stores 90+ET goals (schema § Premise 7).
    // A 2-2 actual that went to penalties scores fully — exact tied score
    // AND the right penalty winner → 3 (exact) + 1 (penalty bonus) = 4.
    const match = knockoutMatch("finished", 2, 2, "slot-home");
    expect(computeMatchPoints(pred(2, 2, "slot-home"), match)).toBe(4);
    // Same 2-2 score, but user picked the wrong penalty winner. The exact
    // tied scoreline still scores its 3 — the shootout pick is a separate
    // bet, so a wrong call costs only the +1 → 3 pts.
    expect(computeMatchPoints(pred(2, 2, "slot-away"), match)).toBe(3);
  });

  it("knockout: tied prediction — scoreline (3) and shootout pick (+1) are independent", () => {
    // Reality: 1-1 at 90+ET, home advanced on penalties.
    const match = knockoutMatch("finished", 1, 1, "slot-home");
    // Exact tie + right shootout winner → 3 + 1 = 4.
    expect(computeMatchPoints(pred(1, 1, "slot-home"), match)).toBe(4);
    // Exact tie + WRONG shootout winner → the scoreline still pays 3; only
    // the +1 is forfeited. (This is the case the old gate wrongly zeroed.)
    expect(computeMatchPoints(pred(1, 1, "slot-away"), match)).toBe(3);
    // Right shootout winner but wrong tied score (2-2 vs 1-1) → 0 score +
    // 1 penalty bonus = 1.
    expect(computeMatchPoints(pred(2, 2, "slot-home"), match)).toBe(1);
    // Wrong score AND wrong shootout winner → 0.
    expect(computeMatchPoints(pred(2, 2, "slot-away"), match)).toBe(0);
  });

  it("knockout: tied prediction — advancer-based +1 pays even without a shootout", () => {
    // Reality: 2-1 at 90+ET, home advanced in regulation (no penalties).
    const match = knockoutMatch("finished", 2, 1, "slot-home");
    // User predicted a 1-1 tie with home advancing. Scoreline wrong (1-1 vs
    // 2-1) → 0, but home did go through → +1. Total 1 (advancer-based bonus).
    expect(computeMatchPoints(pred(1, 1, "slot-home"), match)).toBe(1);
  });

  it("knockout: decisive prediction is outcome-gated 3/1/0 — no penalty pick", () => {
    // Reality: 2-1 at 90+ET, home advanced in regulation (no shootout).
    const match = knockoutMatch("finished", 2, 1, "slot-home");
    // Exact decisive score + right advancer → 3 (decisive predictions make
    // no penalty pick, so the +1 is never on the table).
    expect(computeMatchPoints(pred(2, 1, "slot-home"), match)).toBe(3);
    // Right advancer, wrong score → 1.
    expect(computeMatchPoints(pred(3, 1, "slot-home"), match)).toBe(1);
    // Wrong advancer → 0.
    expect(computeMatchPoints(pred(1, 2, "slot-away"), match)).toBe(0);
  });

  it("knockout: outcome scored by slot id, not by score sign", () => {
    // Actual: home 1, away 0, home advanced.
    const match = knockoutMatch("finished", 1, 0, "slot-home");
    // User picked home to win, score wrong → 1 pt.
    expect(computeMatchPoints(pred(2, 1, "slot-home"), match)).toBe(1);
    // User picked away → wrong outcome regardless of any matching score
    // sign assumptions → 0 pts.
    expect(computeMatchPoints(pred(0, 2, "slot-away"), match)).toBe(0);
    // Exact score AND correct slot → 3 pts.
    expect(computeMatchPoints(pred(1, 0, "slot-home"), match)).toBe(3);
  });

  it("knockout: finished but missing winning_slot_id → null (defensive)", () => {
    // Invariant violation — a finished knockout must have a winner.
    // Function returns null rather than guessing.
    const match = knockoutMatch("finished", 2, 2, null);
    expect(computeMatchPoints(pred(2, 2, "slot-home"), match)).toBeNull();
  });

  it("match cancelled → 0 pts (NOT null), so the row gets marked scored", () => {
    expect(computeMatchPoints(pred(2, 1), groupMatch("cancelled", null, null))).toBe(0);
    expect(
      computeMatchPoints(
        pred(0, 0, "slot-home"),
        knockoutMatch("cancelled", null, null, null),
      ),
    ).toBe(0);
  });

  it("match status not yet finished → null (don't score)", () => {
    expect(computeMatchPoints(pred(2, 1), groupMatch("scheduled", null, null))).toBeNull();
    expect(
      computeMatchPoints(pred(2, 1), groupMatch("in_progress", 1, 0)),
    ).toBeNull();
  });

  it("status finished but scores missing → null (defensive)", () => {
    // Should never happen for a real finished match, but the guard
    // protects against partial polling-job writes.
    expect(computeMatchPoints(pred(2, 1), groupMatch("finished", null, 1))).toBeNull();
    expect(computeMatchPoints(pred(2, 1), groupMatch("finished", 2, null))).toBeNull();
  });
});

// ----------------------------------------------------------------------
// computeFinalistPoints
// ----------------------------------------------------------------------

function picks(
  first: string | null,
  second: string | null,
  third: string | null,
): FinalistPicks {
  return {
    first_place_team_id: first,
    second_place_team_id: second,
    third_place_team_id: third,
  };
}

function standings(
  first: string | null,
  second: string | null,
  third: string | null,
): FinalStandings {
  return {
    first_place_team_id: first,
    second_place_team_id: second,
    third_place_team_id: third,
  };
}

describe("computeFinalistPoints", () => {
  it("all three correct → 9 pts (5 + 3 + 1)", () => {
    expect(
      computeFinalistPoints(
        picks("ARG", "BRA", "FRA"),
        standings("ARG", "BRA", "FRA"),
      ),
    ).toBe(9);
  });

  it("champion correct only → 5 pts", () => {
    expect(
      computeFinalistPoints(
        picks("ARG", "GER", "ESP"),
        standings("ARG", "BRA", "FRA"),
      ),
    ).toBe(5);
  });

  it("champion wrong, 2nd place correct → 3 pts (no chained credit)", () => {
    // The user picked GER as champion but actual is ARG. Their 2nd-place
    // pick BRA matches reality. They get 3 pts for 2nd ONLY — no consolation
    // credit for "champion landed at 2nd".
    expect(
      computeFinalistPoints(
        picks("GER", "BRA", "ESP"),
        standings("ARG", "BRA", "FRA"),
      ),
    ).toBe(3);
  });

  it("3rd place correct only → 1 pt", () => {
    expect(
      computeFinalistPoints(
        picks("GER", "ESP", "FRA"),
        standings("ARG", "BRA", "FRA"),
      ),
    ).toBe(1);
  });

  it("all three wrong → 0 pts", () => {
    expect(
      computeFinalistPoints(
        picks("GER", "ESP", "ITA"),
        standings("ARG", "BRA", "FRA"),
      ),
    ).toBe(0);
  });

  it("standings not yet resolved (nulls) → 0 pts even if user didn't pick", () => {
    // Pre-Final state. A null=null match must NOT score.
    expect(
      computeFinalistPoints(
        picks(null, null, null),
        standings(null, null, null),
      ),
    ).toBe(0);
    // Final played but third-place playoff hasn't — Champion/2nd score, 3rd doesn't.
    expect(
      computeFinalistPoints(
        picks("ARG", "BRA", "FRA"),
        standings("ARG", "BRA", null),
      ),
    ).toBe(8);
  });
});

// ----------------------------------------------------------------------
// computeThirdPlacePlacementPoints
// ----------------------------------------------------------------------

describe("computeThirdPlacePlacementPoints", () => {
  // FIFA's real 8 qualifying third-placed teams.
  const real = ["TUN", "MEX", "JPN", "ECU", "POL", "USA", "MAR", "CMR"];

  it("all 8 predicted correctly → 8 pts", () => {
    expect(computeThirdPlacePlacementPoints(real, real)).toBe(8);
  });

  it("none of the predicted teams qualified → 0 pts", () => {
    expect(
      computeThirdPlacePlacementPoints(
        ["ARG", "BRA", "FRA", "GER", "ESP", "ENG", "ITA", "PRT"],
        real,
      ),
    ).toBe(0);
  });

  it("partial — 3 of the 8 predicted teams are in the real set → 3 pts", () => {
    expect(
      computeThirdPlacePlacementPoints(
        ["TUN", "BRA", "JPN", "GER", "ESP", "USA", "ITA", "PRT"],
        real,
      ),
    ).toBe(3);
  });

  it("real set not yet known (group stage unsettled) → returns null", () => {
    expect(computeThirdPlacePlacementPoints(real, null)).toBeNull();
  });

  it("incomplete predicted set (fewer than 8) → counts the overlap", () => {
    expect(computeThirdPlacePlacementPoints(["TUN", "JPN", "USA"], real)).toBe(3);
  });

  it("duplicate predicted team is counted once", () => {
    expect(computeThirdPlacePlacementPoints(["TUN", "TUN", "JPN"], real)).toBe(2);
  });

  it("empty predicted set → 0", () => {
    expect(computeThirdPlacePlacementPoints([], real)).toBe(0);
  });
});

// ----------------------------------------------------------------------
// deriveBestThirdGroups
// ----------------------------------------------------------------------

describe("deriveBestThirdGroups", () => {
  // Build a group whose 3rd-placed team has the given (points, GD, GF).
  // deriveBestThirdGroups only reads the rank-3 standing.
  function groupWithThird(
    letter: string,
    points: number,
    gd: number,
    gf: number,
  ): GroupStandings {
    const mk = (
      rank: number,
      p: number,
      d: number,
      f: number,
    ): GroupStanding => ({
      team_id: `${letter}${rank}`,
      played: 3,
      won: 0,
      drawn: 0,
      lost: 0,
      goals_for: f,
      goals_against: 0,
      goal_difference: d,
      points: p,
      rank,
      needs_tiebreaker: false,
    });
    return {
      group_letter: letter as GroupLetter,
      standings: [mk(1, 9, 9, 9), mk(2, 7, 5, 7), mk(3, points, gd, gf), mk(4, 0, -9, 0)],
    };
  }

  it("returns the 8 groups whose 3rd-placed team ranks highest by points", () => {
    // A..L get descending third-place points 12..1 → top 8 are A..H.
    const groups = GROUP_LETTERS.map((l, i) =>
      groupWithThird(l, 12 - i, 0, 0),
    );
    const { groups: out, boundaryTie } = deriveBestThirdGroups(groups);
    expect([...out].sort()).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(boundaryTie).toBe(false);
  });

  it("orders by GD then goals-for when points tie at the boundary", () => {
    // A-G clearly in (10 pts). H/I/J tie on 5 pts; H wins on GF over I, J
    // loses on GD → 8th is H, excluding I and J.
    const groups = [
      ...["A", "B", "C", "D", "E", "F", "G"].map((l) =>
        groupWithThird(l, 10, 0, 0),
      ),
      groupWithThird("H", 5, 3, 4),
      groupWithThird("I", 5, 3, 2),
      groupWithThird("J", 5, 1, 9),
      groupWithThird("K", 0, 0, 0),
      groupWithThird("L", 0, 0, 0),
    ];
    const { groups: out, boundaryTie } = deriveBestThirdGroups(groups);
    expect(out).toContain("H");
    expect(out).not.toContain("I");
    expect(out).not.toContain("J");
    expect(boundaryTie).toBe(false);
  });

  it("high points beat alphabetical order — late groups can qualify", () => {
    const groups = [
      groupWithThird("A", 0, 0, 0),
      groupWithThird("B", 0, 0, 0),
      ...["C", "D", "E", "F", "G", "H", "I", "J"].map((l) =>
        groupWithThird(l, 6, 0, 0),
      ),
      groupWithThird("K", 9, 0, 0),
      groupWithThird("L", 9, 0, 0),
    ];
    const { groups: out } = deriveBestThirdGroups(groups);
    expect(out).toContain("K");
    expect(out).toContain("L");
    expect(out).not.toContain("A");
    expect(out).not.toContain("B");
  });

  it("flags boundaryTie when 8th and 9th thirds tie on points/GD/GF", () => {
    // A-G high, then H and I identical at the cutoff.
    const groups = [
      ...["A", "B", "C", "D", "E", "F", "G"].map((l) =>
        groupWithThird(l, 10, 0, 0),
      ),
      groupWithThird("H", 5, 2, 3),
      groupWithThird("I", 5, 2, 3),
      groupWithThird("J", 1, 0, 0),
      groupWithThird("K", 0, 0, 0),
      groupWithThird("L", 0, 0, 0),
    ];
    const { boundaryTie } = deriveBestThirdGroups(groups);
    expect(boundaryTie).toBe(true);
  });

  it("all 12 thirds identical → boundaryTie true, first 8 alphabetical", () => {
    const groups = GROUP_LETTERS.map((l) => groupWithThird(l, 3, 0, 0));
    const { groups: out, boundaryTie } = deriveBestThirdGroups(groups);
    expect(boundaryTie).toBe(true);
    expect([...out].sort()).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
  });

  it("incomplete input (fewer than 8 thirds) → returns what exists, no tie", () => {
    const groups: GroupStandings[] = [
      groupWithThird("A", 6, 0, 0),
      groupWithThird("B", 5, 0, 0),
      groupWithThird("C", 4, 0, 0),
      // remaining groups have no rank-3 standing yet
      ...["D", "E", "F", "G", "H", "I", "J", "K", "L"].map((l) => ({
        group_letter: l as GroupLetter,
        standings: [] as GroupStanding[],
      })),
    ];
    const { groups: out, boundaryTie } = deriveBestThirdGroups(groups);
    expect([...out].sort()).toEqual(["A", "B", "C"]);
    expect(boundaryTie).toBe(false);
  });
});

// ----------------------------------------------------------------------
// computeLeaderboard
// ----------------------------------------------------------------------

function user(
  id: string,
  total_points: number,
  created_at = "2026-05-15T10:00:00Z",
): LeaderboardUser {
  return {
    id,
    username: id.toLowerCase(),
    profile_pic: null,
    total_points,
    created_at,
  };
}

function exactPred(user_id: string, count: number): ScoredPrediction[] {
  return Array.from({ length: count }, () => ({
    user_id,
    points_awarded: 3,
  }));
}
function outcomePred(user_id: string, count: number): ScoredPrediction[] {
  return Array.from({ length: count }, () => ({
    user_id,
    points_awarded: 1,
  }));
}
function wrongPred(user_id: string, count: number): ScoredPrediction[] {
  return Array.from({ length: count }, () => ({
    user_id,
    points_awarded: 0,
  }));
}

describe("computeLeaderboard", () => {
  it("happy path: 10 users with mixed scores → ranked correctly by total_points", () => {
    const users: LeaderboardUser[] = [];
    const preds: ScoredPrediction[] = [];
    // Distinct totals from 90 down to 0 in steps of 10.
    for (let i = 0; i < 10; i++) {
      const id = `u${i}`;
      users.push(user(id, (9 - i) * 10));
      preds.push(...exactPred(id, 9 - i));
    }
    // Shuffle the input order to make sure sort is doing the work.
    users.sort(() => 0.1 - Math.random());

    const out = computeLeaderboard(users, preds);
    expect(out).toHaveLength(10);
    expect(out.map((e) => e.user_id)).toEqual([
      "u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9",
    ]);
    expect(out.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(out[0].total_points).toBe(90);
    expect(out[0].exact_count).toBe(9);
    expect(out.at(-1)?.total_points).toBe(0);
  });

  it("full tiebreaker chain: total → exact → outcome → registration time", () => {
    // Four users tied on total_points = 30.
    //   alice: 10 exact (30 pts via predictions, materialized)
    //   bob:   9 exact + 3 outcome
    //   carol: 9 exact + 3 outcome (later signup)
    //   dave:  9 exact + 2 outcome + 4 wrong → tied total but lower outcome_count
    // Plus eve at 25 to verify higher pts ranks above the cluster.
    const users: LeaderboardUser[] = [
      user("eve",   25, "2026-05-12T00:00:00Z"),
      user("alice", 30, "2026-05-15T10:00:00Z"),
      user("bob",   30, "2026-05-15T11:00:00Z"),
      user("carol", 30, "2026-05-15T11:00:01Z"), // 1 second later than bob
      user("dave",  30, "2026-05-14T00:00:00Z"), // earliest
    ];
    const preds: ScoredPrediction[] = [
      ...exactPred("alice", 10),
      ...exactPred("bob", 9),
      ...outcomePred("bob", 3),
      ...exactPred("carol", 9),
      ...outcomePred("carol", 3),
      ...exactPred("dave", 9),
      ...outcomePred("dave", 2),
      ...wrongPred("dave", 4),
      ...exactPred("eve", 8),
    ];

    const out = computeLeaderboard(users, preds);
    // Within the 30-pt tie:
    //   alice: 10 exact, 0 outcome     → rank 1 (most exact)
    //   bob:   9 exact, 3 outcome      → rank 2 (earlier signup than carol)
    //   carol: 9 exact, 3 outcome      → rank 3
    //   dave:  9 exact, 2 outcome      → rank 4 (lowest outcome_count)
    // Then eve at 25 → rank 5.
    expect(out.map((e) => e.user_id)).toEqual([
      "alice", "bob", "carol", "dave", "eve",
    ]);
    expect(out.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(out[0].exact_count).toBe(10);
    expect(out[1].exact_count).toBe(9);
    expect(out[1].outcome_count).toBe(3);
    expect(out[3].outcome_count).toBe(2);
  });

  it("all-zeros pre-tournament → ranked by registration order (earliest first)", () => {
    const users: LeaderboardUser[] = [
      user("zelda",   0, "2026-05-10T12:00:00Z"),
      user("alice",   0, "2026-05-10T08:00:00Z"),
      user("bob",     0, "2026-05-10T10:00:00Z"),
    ];
    const out = computeLeaderboard(users, []);
    expect(out.map((e) => e.user_id)).toEqual(["alice", "bob", "zelda"]);
    expect(out.every((e) => e.total_points === 0)).toBe(true);
    expect(out.every((e) => e.exact_count === 0)).toBe(true);
    expect(out.every((e) => e.outcome_count === 0)).toBe(true);
    expect(out.every((e) => e.penalty_count === 0)).toBe(true);
    expect(out.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("predictions for unknown users are dropped (defensive)", () => {
    // A stale prediction whose user got deleted shouldn't crash or
    // poison anyone else's stats.
    const users = [user("alice", 10, "2026-05-15T10:00:00Z")];
    const preds: ScoredPrediction[] = [
      ...exactPred("alice", 3),
      ...exactPred("ghost", 99), // unknown user_id
    ];
    const out = computeLeaderboard(users, preds);
    expect(out).toHaveLength(1);
    expect(out[0].exact_count).toBe(3);
  });

  it("penalty-bonus predictions (4 pts) count as exact-scoreline hits and penalty hits", () => {
    const users = [user("alice", 8, "2026-05-15T10:00:00Z")];
    const preds: ScoredPrediction[] = [
      { user_id: "alice", points_awarded: 4 }, // exact tie + shootout winner
      ...exactPred("alice", 1), // a plain exact
      ...outcomePred("alice", 1),
    ];
    const out = computeLeaderboard(users, preds);
    expect(out[0].exact_count).toBe(2); // the 4-pointer + the plain exact
    expect(out[0].outcome_count).toBe(1);
    expect(out[0].penalty_count).toBe(1); // only the 4-pointer
  });

  it("predictions with null points_awarded are ignored (not yet scored)", () => {
    const users = [user("alice", 6, "2026-05-15T10:00:00Z")];
    const preds: ScoredPrediction[] = [
      ...exactPred("alice", 2),
      { user_id: "alice", points_awarded: null },
      { user_id: "alice", points_awarded: null },
    ];
    const out = computeLeaderboard(users, preds);
    expect(out[0].exact_count).toBe(2);
    expect(out[0].outcome_count).toBe(0);
  });
});

// ----------------------------------------------------------------------
// computeKnockoutCascade
// ----------------------------------------------------------------------

function r32Assignment(
  slot_label: string,
  team_id: string | null,
): SlotAssignment {
  // The cascade ignores `source` — only slot_label + team_id matter.
  return { slot_label, team_id, source: "group_winner" };
}

function ko(
  round_id: KnockoutMatchPrediction["round_id"],
  match_index: number,
  home_slot_label: string,
  away_slot_label: string,
  predicted_winner_label: string | null,
): KnockoutMatchPrediction {
  return {
    round_id,
    match_index,
    home_slot_label,
    away_slot_label,
    predicted_winner_label,
  };
}

describe("computeKnockoutCascade", () => {
  it("seeds R32 slot labels from input; downstream slots absent without predictions", () => {
    const seed: SlotAssignment[] = [
      r32Assignment("winner-A", "ARG"),
      r32Assignment("runner-up-A", "BRA"),
      r32Assignment("best-3rd-1", "TUN"),
    ];
    const out = computeKnockoutCascade(seed, []);
    expect(out.get("winner-A")).toBe("ARG");
    expect(out.get("runner-up-A")).toBe("BRA");
    expect(out.get("best-3rd-1")).toBe("TUN");
    expect(out.has("r32-match-1-winner")).toBe(false);
    expect(out.has("r16-match-1-winner")).toBe(false);
  });

  it("R32 prediction populates the corresponding R32-match-N-winner slot", () => {
    const seed: SlotAssignment[] = [
      r32Assignment("winner-A", "ARG"),
      r32Assignment("best-3rd-1", "TUN"),
    ];
    const out = computeKnockoutCascade(seed, [
      ko("r32", 1, "winner-A", "best-3rd-1", "winner-A"),
    ]);
    expect(out.get("r32-match-1-winner")).toBe("ARG");
  });

  it("end-to-end cascade: predictions through Final fill every downstream slot", () => {
    // Synthetic minimal cascade: only cover the chain that feeds Final
    // match — R32-1, R32-2, R16-1, QF-1, SF-1, SF-2, Final, 3rd-place.
    const seed: SlotAssignment[] = [
      r32Assignment("winner-A", "ARG"),
      r32Assignment("best-3rd-1", "TUN"),
      r32Assignment("winner-C", "BRA"),
      r32Assignment("runner-up-F", "FRA"),
    ];
    // R32-1: ARG vs TUN, ARG advances
    // R32-2: BRA vs FRA, BRA advances
    // R16-1: r32-1-winner (ARG) vs r32-2-winner (BRA), ARG advances
    // QF-1: r16-1-winner (ARG) vs r16-2-winner (null) → outside-of-test, skip
    // SF-1: synthetic — ARG vs (null), ARG advances
    // Final: ARG vs (sf-2-winner null), ARG champion
    // 3rd-place: sf-1-loser (null) vs sf-2-loser (null) — null vs null
    const out = computeKnockoutCascade(seed, [
      ko("r32", 1, "winner-A", "best-3rd-1", "winner-A"),
      ko("r32", 2, "winner-C", "runner-up-F", "winner-C"),
      ko(
        "r16",
        1,
        "r32-match-1-winner",
        "r32-match-2-winner",
        "r32-match-1-winner",
      ),
      ko(
        "sf",
        1,
        "qf-match-1-winner",
        "qf-match-2-winner",
        "qf-match-1-winner",
      ),
      ko(
        "final",
        1,
        "sf-match-1-winner",
        "sf-match-2-winner",
        "sf-match-1-winner",
      ),
    ]);
    expect(out.get("r32-match-1-winner")).toBe("ARG");
    expect(out.get("r32-match-2-winner")).toBe("BRA");
    expect(out.get("r16-match-1-winner")).toBe("ARG");
    // QF-1's prediction not provided → r16-1 cascades up but qf-1-winner missing.
    expect(out.has("qf-match-1-winner")).toBe(false);
    // SF references qf-match-1-winner which is unresolved → SF picks null.
    expect(out.get("sf-match-1-winner")).toBeNull();
    // Final references sf-match-1-winner which is null → Final winner null too.
    expect(out.get("r32-match-1-winner")).toBe("ARG"); // sanity
  });

  it("predicted-winner whose upstream is null cascades null downstream", () => {
    // User predicted r16-1 winner is r32-match-1-winner, but they didn't
    // predict R32-1. The R16 winner slot resolves to null.
    const seed: SlotAssignment[] = [
      r32Assignment("winner-A", "ARG"),
      r32Assignment("best-3rd-1", "TUN"),
    ];
    const out = computeKnockoutCascade(seed, [
      ko(
        "r16",
        1,
        "r32-match-1-winner",
        "r32-match-2-winner",
        "r32-match-1-winner",
      ),
    ]);
    expect(out.get("r16-match-1-winner")).toBeNull();
  });

  it("SF predictions populate both winner and loser slots", () => {
    const seed: SlotAssignment[] = [];
    // Both qf-match-1-winner and qf-match-2-winner resolve via prior
    // cascade — synthesize them by seeding the cascade with their team
    // ids via earlier rounds.
    const preds: KnockoutMatchPrediction[] = [
      // Synthetic r32 + r16 + qf populating qf-match-1-winner
      ko("r32", 1, "x", "y", "x"),
      ko("r16", 1, "r32-match-1-winner", "r32-match-2-winner", "r32-match-1-winner"),
      ko("qf", 1, "r16-match-1-winner", "r16-match-2-winner", "r16-match-1-winner"),
      ko("qf", 2, "r16-match-3-winner", "r16-match-4-winner", "r16-match-3-winner"),
      // SF-1: qf-1-winner vs qf-2-winner, qf-1 advances
      ko("sf", 1, "qf-match-1-winner", "qf-match-2-winner", "qf-match-1-winner"),
    ];
    const out = computeKnockoutCascade(
      [r32Assignment("x", "ARG"), r32Assignment("y", "TUN")],
      preds,
    );
    // r32-1 winner → ARG, propagates through r16-1 and qf-1.
    expect(out.get("qf-match-1-winner")).toBe("ARG");
    expect(out.get("sf-match-1-winner")).toBe("ARG");
    // qf-2 had no upstream r32-3 predictions, so qf-match-2-winner is null
    expect(out.get("qf-match-2-winner")).toBeNull();
    // SF loser side = qf-match-2-winner (the side ARG didn't pick) = null
    expect(out.get("sf-match-1-loser")).toBeNull();
  });

  it("SF loser slot picks the OPPOSITE side from the predicted winner", () => {
    const seed: SlotAssignment[] = [
      r32Assignment("winner-A", "ARG"),
      r32Assignment("winner-C", "BRA"),
    ];
    // Cascade ARG via the home side and BRA via away of a single SF match
    const preds: KnockoutMatchPrediction[] = [
      ko("r32", 1, "winner-A", "x", "winner-A"),
      ko("r32", 2, "winner-C", "y", "winner-C"),
      ko("r16", 1, "r32-match-1-winner", "r32-match-2-winner", "r32-match-1-winner"),
      ko("r16", 2, "anything", "anything-else", null), // skip
      ko("qf", 1, "r16-match-1-winner", "r16-match-2-winner", "r16-match-1-winner"),
      ko("qf", 2, "winner-C", "y", "winner-C"), // hack to populate qf-2-winner with BRA via fake home
      ko("sf", 1, "qf-match-1-winner", "qf-match-2-winner", "qf-match-2-winner"),
      // ↑ SF-1 picks qf-2-winner (BRA) as winner; loser = qf-1-winner (ARG)
    ];
    const out = computeKnockoutCascade(seed, preds);
    expect(out.get("sf-match-1-winner")).toBe("BRA");
    expect(out.get("sf-match-1-loser")).toBe("ARG");
  });

  it("Final and 3rd-place are terminal — no downstream writes", () => {
    const seed: SlotAssignment[] = [];
    const preds: KnockoutMatchPrediction[] = [
      ko("final", 1, "sf-match-1-winner", "sf-match-2-winner", "sf-match-1-winner"),
      ko(
        "third_place",
        1,
        "sf-match-1-loser",
        "sf-match-2-loser",
        "sf-match-1-loser",
      ),
    ];
    const out = computeKnockoutCascade(seed, preds);
    // Neither writes any downstream label.
    expect(out.has("final-match-1-winner")).toBe(false);
    expect(out.has("third_place-match-1-winner")).toBe(false);
    // The pure function still resolves what it can — both predictions
    // reference upstream labels that aren't seeded → null lookup, no writes.
    expect(out.size).toBe(0);
  });
});
