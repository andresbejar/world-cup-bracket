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

// ======================================================================
// Knockout cascade — resolve every downstream slot from upstream picks
// ======================================================================

export type KnockoutRoundId =
  | "r32"
  | "r16"
  | "qf"
  | "sf"
  | "final"
  | "third_place";

export interface KnockoutMatchPrediction {
  round_id: KnockoutRoundId;
  /** 1-based, used to name the downstream slot ("r32-match-3-winner"). */
  match_index: number;
  home_slot_label: string;
  away_slot_label: string;
  /**
   * Slot_label of the side the user picked to advance. Equals either
   * home_slot_label or away_slot_label, or null if no prediction yet.
   */
  predicted_winner_label: string | null;
}

/**
 * Walks the knockout tree top-down, filling each round's downstream
 * slot labels (`r32-match-N-winner`, `r16-match-N-winner`, etc.) from
 * the user's predicted winner of each match. SF also populates the
 * `-loser` labels that feed the third-place match. Final and 3rd-place
 * are terminal — the function reads their predictions but doesn't
 * write anything downstream.
 *
 * Returns a single Map<slot_label, team_id | null>. R32 input labels
 * (winner-A, runner-up-C, best-3rd-3, ...) are seeded from the
 * caller-provided `r32Slots`. Downstream labels are absent until a
 * prediction populates them; they resolve to undefined → caller treats
 * as null. A prediction whose `predicted_winner_label` references an
 * unresolved upstream slot writes null (cascade absorbs the gap).
 *
 * Pure function. Caller composes slot_id → slot_label resolution.
 */
export function computeKnockoutCascade(
  r32Slots: readonly SlotAssignment[],
  predictions: readonly KnockoutMatchPrediction[],
): Map<string, string | null> {
  const result = new Map<string, string | null>();

  for (const s of r32Slots) {
    result.set(s.slot_label, s.team_id);
  }

  const ROUND_ORDER: KnockoutRoundId[] = [
    "r32",
    "r16",
    "qf",
    "sf",
    "final",
    "third_place",
  ];

  for (const round of ROUND_ORDER) {
    for (const m of predictions) {
      if (m.round_id !== round) continue;
      if (m.predicted_winner_label == null) continue;
      const winner = result.get(m.predicted_winner_label) ?? null;
      const downstream = downstreamWinnerLabel(round, m.match_index);
      if (downstream != null) result.set(downstream, winner);
      if (round === "sf") {
        const loserLabel =
          m.predicted_winner_label === m.home_slot_label
            ? m.away_slot_label
            : m.home_slot_label;
        const loser = result.get(loserLabel) ?? null;
        result.set(`sf-match-${m.match_index}-loser`, loser);
      }
    }
  }

  return result;
}

function downstreamWinnerLabel(
  round: KnockoutRoundId,
  match_index: number,
): string | null {
  switch (round) {
    case "r32":
      return `r32-match-${match_index}-winner`;
    case "r16":
      return `r16-match-${match_index}-winner`;
    case "qf":
      return `qf-match-${match_index}-winner`;
    case "sf":
      return `sf-match-${match_index}-winner`;
    case "final":
    case "third_place":
      return null;
  }
}

// ======================================================================
// Per-match scoring
// ======================================================================

export type MatchStatus =
  | "scheduled"
  | "in_progress"
  | "finished"
  | "cancelled";

export type MatchStage = "group" | "knockout";

export interface MatchPrediction {
  predicted_home_score: number;
  predicted_away_score: number;
  /**
   * Knockout matches: the bracket_slot id the user picked to advance.
   * For tied predicted scores in a knockout, this is the user's
   * penalty-winner pick. For group matches: ignored.
   */
  predicted_winning_slot_id: string | null;
}

export interface ActualMatch {
  status: MatchStatus;
  stage: MatchStage;
  home_slot_id: string;
  away_slot_id: string;
  /**
   * Goals at full time + extra time. Penalty-shootout goals are NEVER
   * counted (per design doc § Premise 7 + matches table comment).
   * Null until the match flips to `finished`.
   */
  home_score: number | null;
  away_score: number | null;
  /**
   * Knockout matches only: the slot that advanced. Equal to home_slot_id
   * or away_slot_id. For penalty-decided knockouts this is the shootout
   * winner. Null until the knockout match is finished.
   */
  winning_slot_id: string | null;
}

/**
 * Score a single user prediction against a finished match.
 *
 *   3 pts — exact 90+ET score AND correct outcome (i.e. correct winner
 *           for knockouts, or correct draw/winner for groups)
 *   1 pt — correct outcome but score wrong
 *   0 pts — outcome wrong (regardless of any partial-score match)
 *
 * Returns null when the match has not finished yet — scoring runs only
 * on `finished`. A `cancelled` match returns 0 explicitly: the user
 * earned no points, and the row should be marked scored so the polling
 * job stops re-evaluating it.
 *
 * Group-stage outcome = the sign of (home_score - away_score) on both
 * sides. Knockout-stage outcome = whether `predicted_winning_slot_id`
 * matches `winning_slot_id`. The function never tries to derive a
 * knockout winner from the score — penalty resolution is the caller's
 * concern (it lands as `winning_slot_id`).
 */
export function computeMatchPoints(
  prediction: MatchPrediction,
  actual: ActualMatch,
): number | null {
  if (actual.status === "cancelled") return 0;
  if (actual.status !== "finished") return null;
  if (actual.home_score == null || actual.away_score == null) return null;

  const exactScore =
    prediction.predicted_home_score === actual.home_score &&
    prediction.predicted_away_score === actual.away_score;

  if (actual.stage === "group") {
    const predictedSign = signOf(
      prediction.predicted_home_score - prediction.predicted_away_score,
    );
    const actualSign = signOf(actual.home_score - actual.away_score);
    const sameOutcome = predictedSign === actualSign;
    if (exactScore && sameOutcome) return 3;
    if (sameOutcome) return 1;
    return 0;
  }

  // Knockout — outcome is decided by which slot advanced.
  if (actual.winning_slot_id == null) return null;
  const sameWinner =
    prediction.predicted_winning_slot_id === actual.winning_slot_id;
  if (exactScore && sameWinner) return 3;
  if (sameWinner) return 1;
  return 0;
}

function signOf(n: number): -1 | 0 | 1 {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

// ======================================================================
// Finalist side-bet scoring (Champion / 2nd / 3rd)
// ======================================================================

/**
 * The user's tournament-wide podium picks. Independent of the bracket
 * cascade — a user can predict "Argentina wins it all" here even if
 * their bracket has Brazil winning the Final. Both bets pay out
 * independently per design § Scoring.
 */
export interface FinalistPicks {
  first_place_team_id: string | null;
  second_place_team_id: string | null;
  third_place_team_id: string | null;
}

/**
 * Reality-side podium. Any field is null until that match has finished
 * (the Final settles 1st + 2nd; the third-place playoff settles 3rd).
 */
export interface FinalStandings {
  first_place_team_id: string | null;
  second_place_team_id: string | null;
  third_place_team_id: string | null;
}

export const FINALIST_POINTS = {
  first_place: 5,
  second_place: 3,
  third_place: 1,
} as const;

/**
 * Score the user's three podium picks. Each position is scored
 * independently — there is no "chained" credit for picking a champion
 * who actually finished 2nd. A user only earns the 3-point 2nd-place
 * bonus if their `second_place_team_id` matches the actual runner-up.
 *
 * Returns 0 when none match. Safe to call before the Final has finished
 * — unresolved standings are nulls and never match a non-null pick.
 */
export function computeFinalistPoints(
  picks: FinalistPicks,
  finalStandings: FinalStandings,
): number {
  let total = 0;
  if (
    picks.first_place_team_id != null &&
    picks.first_place_team_id === finalStandings.first_place_team_id
  ) {
    total += FINALIST_POINTS.first_place;
  }
  if (
    picks.second_place_team_id != null &&
    picks.second_place_team_id === finalStandings.second_place_team_id
  ) {
    total += FINALIST_POINTS.second_place;
  }
  if (
    picks.third_place_team_id != null &&
    picks.third_place_team_id === finalStandings.third_place_team_id
  ) {
    total += FINALIST_POINTS.third_place;
  }
  return total;
}

// ======================================================================
// Third-place R32 slot placement scoring (the FIFA-literacy bet)
// ======================================================================

export interface PredictedThirdPlaceAssignment {
  /** "best-3rd-1" .. "best-3rd-8". */
  slot_label: string;
  /** Team_id the user thinks FIFA will place in this slot. */
  team_id: string | null;
}

export interface BracketSlot {
  slot_label: string;
  /** Team_id FIFA actually placed here, or null if upstream not done. */
  real_team_id: string | null;
}

/**
 * Score the user's 8 third-place R32 slot picks against reality. Each
 * correct slot is worth 1 pt (max 8). A pick is "correct" only if the
 * team_id the user assigned to a given slot literally equals the team
 * FIFA placed in that slot once group stage completes — picking a team
 * whose group didn't qualify a 3rd-place team means that team can't be
 * in any best-3rd slot, so it scores 0 there. No partial credit.
 *
 * Returns null when any of the 8 third-place R32 slots is still
 * unpopulated (real_team_id null). Group stage settles all 8 in one
 * shot, so partial-population means the polling job is mid-flight and
 * we shouldn't score yet.
 *
 * `realR32Slots` may include the full 32-slot R32 set; the function
 * filters to the 8 third-place ones.
 */
export function computeThirdPlacePlacementPoints(
  predictedAssignments: readonly PredictedThirdPlaceAssignment[],
  realR32Slots: readonly BracketSlot[],
): number | null {
  const thirdPlaceSet = new Set<string>(THIRD_PLACE_SLOT_LABELS);
  const realByLabel = new Map<string, string | null>();
  for (const slot of realR32Slots) {
    if (thirdPlaceSet.has(slot.slot_label)) {
      realByLabel.set(slot.slot_label, slot.real_team_id);
    }
  }

  // Group stage finishes all 8 best-3rd slots at once. If any are
  // still null, the polling job hasn't finished settling group stage —
  // return null so the caller knows not to materialize points yet.
  for (const label of THIRD_PLACE_SLOT_LABELS) {
    if (realByLabel.get(label) == null) return null;
  }

  const pickByLabel = new Map<string, string | null>();
  for (const p of predictedAssignments) {
    pickByLabel.set(p.slot_label, p.team_id);
  }

  let total = 0;
  for (const label of THIRD_PLACE_SLOT_LABELS) {
    const pick = pickByLabel.get(label);
    if (pick != null && pick === realByLabel.get(label)) total += 1;
  }
  return total;
}

// ======================================================================
// Leaderboard aggregation
// ======================================================================

export interface LeaderboardUser {
  id: string;
  username: string | null;
  profile_pic: string | null;
  /**
   * Pre-materialized total points (kept fresh by the scoring engine —
   * APT-27, APT-29). The leaderboard function trusts this value and
   * does not recompute from raw rows.
   */
  total_points: number;
  /** ISO 8601 timestamp. Used as the final tiebreaker (earliest first). */
  created_at: string;
}

export interface ScoredPrediction {
  user_id: string;
  /** Output of computeMatchPoints. Null = match not finished yet. */
  points_awarded: number | null;
}

export interface LeaderboardEntry {
  user_id: string;
  username: string | null;
  profile_pic: string | null;
  total_points: number;
  /** Predictions with a 3-point exact-score result. */
  exact_count: number;
  /** Predictions with a 1-point outcome-only result. */
  outcome_count: number;
  rank: number;
}

/**
 * Build the ranked leaderboard.
 *
 * Tiebreaker chain (design doc § Open Question 2, confirmed):
 *   1. total_points (descending)
 *   2. number of 3-point exact-score predictions (descending)
 *   3. number of 1-point outcome-only predictions (descending)
 *   4. registration time (ascending — earliest signup wins)
 *
 * Strict ordinal ranking: distinct ranks even when stats tie, because
 * created_at breaks any final tie deterministically.
 */
export function computeLeaderboard(
  users: readonly LeaderboardUser[],
  predictions: readonly ScoredPrediction[],
): LeaderboardEntry[] {
  // Aggregate per-user exact / outcome counts from the scored predictions.
  const counts = new Map<string, { exact: number; outcome: number }>();
  for (const u of users) counts.set(u.id, { exact: 0, outcome: 0 });
  for (const p of predictions) {
    const bucket = counts.get(p.user_id);
    if (!bucket) continue; // prediction for an unknown user — defensive drop
    if (p.points_awarded === 3) bucket.exact += 1;
    else if (p.points_awarded === 1) bucket.outcome += 1;
  }

  const entries: LeaderboardEntry[] = users.map((u) => {
    const c = counts.get(u.id)!;
    return {
      user_id: u.id,
      username: u.username,
      profile_pic: u.profile_pic,
      total_points: u.total_points,
      exact_count: c.exact,
      outcome_count: c.outcome,
      rank: 0,
    };
  });

  entries.sort((a, b) => {
    if (a.total_points !== b.total_points) return b.total_points - a.total_points;
    if (a.exact_count !== b.exact_count) return b.exact_count - a.exact_count;
    if (a.outcome_count !== b.outcome_count) {
      return b.outcome_count - a.outcome_count;
    }
    // Final fallback: earliest registration wins.
    const ua = users.find((u) => u.id === a.user_id)!;
    const ub = users.find((u) => u.id === b.user_id)!;
    return ua.created_at.localeCompare(ub.created_at);
  });

  for (let i = 0; i < entries.length; i++) entries[i].rank = i + 1;
  return entries;
}
