import { describe, it, expect } from "vitest";
import {
  computeGroupStandings,
  type MatchScore,
  type Team,
} from "./bracket";

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
