// Pure bracket primitives. Zero database access — every input arrives
// fully resolved so the caller (a Server Component, route handler, or
// scoring engine) is the only thing that knows about Supabase.
//
// CLAUDE.md mandates 100% Vitest coverage on this file. A bug here
// corrupts every user's bracket.

export interface Team {
  /** ISO 3166 alpha-3, e.g. "ARG". Acts as the canonical sort key. */
  id: string;
  /** 'A' through 'L' — only used by the caller to slice teams per group. */
  group_letter: string;
}

/**
 * A finished match-like score. Used both for user-predicted group results
 * (driving `predicted standings`) and for real match results that came
 * back from api-football. The function is agnostic about which.
 */
export interface MatchScore {
  home_team_id: string;
  away_team_id: string;
  /** Goals at full time (incl. ET). Penalty shootout goals are NOT counted. */
  home_score: number;
  away_score: number;
}

export interface GroupStanding {
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  /** 1-based position within the group after FIFA tiebreakers applied. */
  rank: number;
  /**
   * True if FIFA's first 5 tiebreakers (pts, GD, GS, H2H pts, H2H GD)
   * could not separate this team from a neighbor, so the alphabetical
   * fallback decided their relative rank. The UI surfaces this so users
   * know they should adjust their predictions.
   */
  needs_tiebreaker: boolean;
}

/**
 * Compute predicted (or real) group-stage standings for ONE group.
 *
 * Pure function. Caller iterates over groups A-L and calls 12 times.
 *
 * Tiebreaker chain (per FIFA, stopping at step 5; design doc § Group
 * Standings Algorithm):
 *   1. points (3W/1D/0L)
 *   2. goal difference (overall)
 *   3. goals scored (overall)
 *   4. head-to-head points among teams still tied
 *   5. head-to-head goal difference among teams still tied
 *   6. (FIFA's disciplinary record + drawing of lots are not predictable
 *      → we fall back to alphabetical team_id, flagged in `needs_tiebreaker`.)
 *
 * Scores from matches whose home OR away team is not in `groupTeams`
 * are ignored (defensive: a malformed input shouldn't poison results).
 */
export function computeGroupStandings(
  scores: readonly MatchScore[],
  groupTeams: readonly Team[],
): GroupStanding[] {
  const teamIds = new Set(groupTeams.map((t) => t.id));
  const relevant = scores.filter(
    (s) => teamIds.has(s.home_team_id) && teamIds.has(s.away_team_id),
  );

  const base = new Map<string, MutableStanding>();
  for (const t of groupTeams) base.set(t.id, blankStanding(t.id));
  for (const s of relevant) accumulate(base, s);

  // Stage 1: sort by overall pts/GD/GS, group adjacent ties.
  const overall = [...base.values()].sort(compareOverall);
  const tieGroups: MutableStanding[][] = [];
  for (const team of overall) {
    const last = tieGroups.at(-1);
    if (last && compareOverall(last[0], team) === 0) last.push(team);
    else tieGroups.push([team]);
  }

  // Stage 2: within each tie group of 2+, apply H2H pts/GD then alpha.
  const ranked: MutableStanding[] = [];
  for (const group of tieGroups) {
    if (group.length === 1) {
      ranked.push(group[0]);
      continue;
    }
    ranked.push(...resolveTiebreakers(group, relevant));
  }

  return ranked.map((s, i) => ({ ...s, rank: i + 1 }));
}

// ----------------------------------------------------------------------
// internals
// ----------------------------------------------------------------------

type MutableStanding = GroupStanding;

function blankStanding(team_id: string): MutableStanding {
  return {
    team_id,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 0,
    rank: 0,
    needs_tiebreaker: false,
  };
}

function accumulate(
  table: Map<string, MutableStanding>,
  score: MatchScore,
): void {
  const home = table.get(score.home_team_id)!;
  const away = table.get(score.away_team_id)!;
  home.played += 1;
  away.played += 1;
  home.goals_for += score.home_score;
  home.goals_against += score.away_score;
  away.goals_for += score.away_score;
  away.goals_against += score.home_score;
  if (score.home_score > score.away_score) {
    home.won += 1;
    away.lost += 1;
    home.points += 3;
  } else if (score.home_score < score.away_score) {
    away.won += 1;
    home.lost += 1;
    away.points += 3;
  } else {
    home.drawn += 1;
    away.drawn += 1;
    home.points += 1;
    away.points += 1;
  }
  home.goal_difference = home.goals_for - home.goals_against;
  away.goal_difference = away.goals_for - away.goals_against;
}

function compareOverall(a: GroupStanding, b: GroupStanding): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.goal_difference !== b.goal_difference) {
    return b.goal_difference - a.goal_difference;
  }
  if (a.goals_for !== b.goals_for) return b.goals_for - a.goals_for;
  return 0;
}

interface H2HStat {
  pts: number;
  gd: number;
}

function resolveTiebreakers(
  tied: MutableStanding[],
  scores: readonly MatchScore[],
): MutableStanding[] {
  const tiedIds = new Set(tied.map((t) => t.team_id));
  const h2h = new Map<string, H2HStat>();
  for (const t of tied) h2h.set(t.team_id, { pts: 0, gd: 0 });

  for (const s of scores) {
    if (!tiedIds.has(s.home_team_id) || !tiedIds.has(s.away_team_id)) continue;
    const home = h2h.get(s.home_team_id)!;
    const away = h2h.get(s.away_team_id)!;
    home.gd += s.home_score - s.away_score;
    away.gd += s.away_score - s.home_score;
    if (s.home_score > s.away_score) home.pts += 3;
    else if (s.home_score < s.away_score) away.pts += 3;
    else {
      home.pts += 1;
      away.pts += 1;
    }
  }

  const sorted = [...tied].sort((a, b) => {
    const ha = h2h.get(a.team_id)!;
    const hb = h2h.get(b.team_id)!;
    if (ha.pts !== hb.pts) return hb.pts - ha.pts;
    if (ha.gd !== hb.gd) return hb.gd - ha.gd;
    // Alphabetical fallback — flagged below.
    return a.team_id.localeCompare(b.team_id);
  });

  // Flag any team whose H2H stats match a neighbor's: alpha decided rank.
  for (let i = 0; i < sorted.length; i++) {
    const here = h2h.get(sorted[i].team_id)!;
    const tiedWithNeighbor =
      (i > 0 &&
        sameH2H(here, h2h.get(sorted[i - 1].team_id)!)) ||
      (i < sorted.length - 1 &&
        sameH2H(here, h2h.get(sorted[i + 1].team_id)!));
    if (tiedWithNeighbor) sorted[i].needs_tiebreaker = true;
  }

  return sorted;
}

function sameH2H(a: H2HStat, b: H2HStat): boolean {
  return a.pts === b.pts && a.gd === b.gd;
}

// ======================================================================
// R32 slot population
// ======================================================================

export const GROUP_LETTERS = [
  "A", "B", "C", "D", "E", "F",
  "G", "H", "I", "J", "K", "L",
] as const;

export type GroupLetter = (typeof GROUP_LETTERS)[number];

export interface GroupStandings {
  group_letter: GroupLetter;
  /** Output of computeGroupStandings, ranked. */
  standings: readonly GroupStanding[];
}

export interface ThirdPlacePick {
  /** "best-3rd-1" through "best-3rd-8". */
  slot_label: string;
  /** ISO alpha-3 team_id, or null if the user hasn't filled this slot. */
  team_id: string | null;
}

export type SlotSource =
  | "group_winner"
  | "group_runner_up"
  | "third_place_pick";

export interface SlotAssignment {
  slot_label: string;
  team_id: string | null;
  source: SlotSource;
}

export const THIRD_PLACE_SLOT_LABELS = Array.from(
  { length: 8 },
  (_, i) => `best-3rd-${i + 1}`,
) as readonly string[];

/**
 * Thrown by populateR32Slots when the third-place picks contain the
 * same team_id in two different slots. The UI prevents duplicates at
 * input time; this is a server-side defense for malformed payloads.
 */
export class DuplicateThirdPlacePickError extends Error {
  constructor(
    readonly team_id: string,
    readonly slot_labels: readonly string[],
  ) {
    super(
      `team_id ${team_id} assigned to multiple third-place slots: ${slot_labels.join(", ")}`,
    );
    this.name = "DuplicateThirdPlacePickError";
  }
}

/**
 * Build the 32 R32 slot occupants from a user's predicted group standings
 * and third-place dropdown picks.
 *
 * - 24 deterministic slots: rank 1 of each group → "winner-{X}", rank 2
 *   → "runner-up-{X}". Pulled straight from the standings; no FIFA map
 *   knowledge needed here (the R32 *pairings* live in lib/bracket-structure;
 *   this function only emits slot occupants).
 * - 8 user-driven slots: third-place picks fill "best-3rd-1" through
 *   "best-3rd-8". A null team_id (or missing pick) keeps the slot
 *   unfilled; downstream knockout matches that reference it must show
 *   a disabled state.
 *
 * Throws DuplicateThirdPlacePickError if the same team_id appears in
 * more than one third-place pick.
 *
 * Order of returned slots is deterministic:
 *   winner-A..L, runner-up-A..L, best-3rd-1..8.
 */
export function populateR32Slots(
  groups: readonly GroupStandings[],
  thirdPlacePicks: readonly ThirdPlacePick[],
): SlotAssignment[] {
  const groupMap = new Map<string, readonly GroupStanding[]>();
  for (const g of groups) groupMap.set(g.group_letter, g.standings);

  const assignments: SlotAssignment[] = [];

  for (const letter of GROUP_LETTERS) {
    const standings = groupMap.get(letter);
    assignments.push({
      slot_label: `winner-${letter}`,
      team_id: standings?.find((s) => s.rank === 1)?.team_id ?? null,
      source: "group_winner",
    });
  }
  for (const letter of GROUP_LETTERS) {
    const standings = groupMap.get(letter);
    assignments.push({
      slot_label: `runner-up-${letter}`,
      team_id: standings?.find((s) => s.rank === 2)?.team_id ?? null,
      source: "group_runner_up",
    });
  }

  // Third-place picks — keyed by slot_label so caller order doesn't matter.
  const pickByLabel = new Map<string, string | null>();
  for (const pick of thirdPlacePicks) {
    pickByLabel.set(pick.slot_label, pick.team_id);
  }

  // Detect duplicate team picks across the 8 slots.
  const slotsByTeam = new Map<string, string[]>();
  for (const label of THIRD_PLACE_SLOT_LABELS) {
    const team_id = pickByLabel.get(label);
    if (team_id == null) continue;
    const existing = slotsByTeam.get(team_id);
    if (existing) existing.push(label);
    else slotsByTeam.set(team_id, [label]);
  }
  for (const [team_id, labels] of slotsByTeam) {
    if (labels.length > 1) {
      throw new DuplicateThirdPlacePickError(team_id, labels);
    }
  }

  for (const label of THIRD_PLACE_SLOT_LABELS) {
    assignments.push({
      slot_label: label,
      team_id: pickByLabel.get(label) ?? null,
      source: "third_place_pick",
    });
  }

  return assignments;
}
