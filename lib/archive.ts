// The archive's data layer. This replaces every Supabase read in the app.
//
// The tournament is over and the site is a frozen, public, read-only
// artifact. `data/archive-snapshot.json` (built by
// scripts/build-archive-snapshot.ts) is the entire database. Because
// nothing here touches cookies() or the network, every page prerenders to
// static HTML at build time and the deployed site runs with no database,
// no auth, and no environment variables.
//
// The exported shapes deliberately match the interfaces the old loaders
// returned (PredictionWorkspaceData, LeaderboardPayload, FinalStandings),
// so the client components below them compile unchanged.

import snapshot from "@/data/archive-snapshot.json";
import type {
  HydratedTeam,
  HydratedRound,
  HydratedMatch,
  HydratedKnockoutMatch,
  HydratedPrediction,
  HydratedFinalistPicks,
  PredictionWorkspaceData,
} from "./group-data";
import type { LeaderboardEntry, FinalStandings } from "./bracket";

export interface ArchiveMeta {
  generated_at: string;
  source_project_ref: string;
  tournament: string;
  counts: {
    players: number;
    matches_total: number;
    matches_finished: number;
    predictions_scored: number;
    exact_scores: number;
    outcome_only: number;
    penalty_bonuses: number;
  };
}

/**
 * One player's pick on a single match, as served by the static files
 * under public/match-picks/. Mirrors the old MatchPick from
 * lib/match-predictions-data.ts minus `is_self` — there is no viewer
 * identity in the archive.
 */
export interface MatchPick {
  username: string | null;
  profile_pic: string | null;
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_winning_slot_id: string | null;
  points_awarded: number | null;
}

export interface ArchivePoolEntry {
  status: string;
  method: string | null;
  notes: string | null;
  confirmed_at: string | null;
}

export interface ArchivePoolRow {
  player_id: string;
  username: string | null;
  profile_pic: string | null;
  entry: ArchivePoolEntry | null;
}

export interface ArchivePool {
  buyInUsd: number;
  potUsd: number;
  confirmedCount: number;
  roster: ArchivePoolRow[];
}

export const meta = snapshot.meta as ArchiveMeta;

/** Reality's podium: champion / runner-up / third, as ISO alpha-3 ids. */
export const finalStandings = snapshot.finalStandings as FinalStandings;

export const pool = snapshot.pool as ArchivePool;

export const leaderboardEntries = snapshot.leaderboard
  .entries as unknown as LeaderboardEntry[];

/** Every player's slug, in final leaderboard order. */
export const playerIds: string[] = leaderboardEntries.map((e) => e.user_id);

const predictionsByPlayer = snapshot.predictionsByPlayer as unknown as Record<
  string,
  HydratedPrediction[]
>;
const finalistPicksByPlayer =
  snapshot.finalistPicksByPlayer as unknown as Record<
    string,
    HydratedFinalistPicks
  >;

const NO_PICKS: HydratedFinalistPicks = {
  first_place_team_id: null,
  second_place_team_id: null,
  third_place_team_id: null,
};

/** The pool winner — the bracket shown by default on /predictions. */
export const championPlayerId: string = playerIds[0] ?? "";

/**
 * The frozen workspace for one player: shared tournament structure plus
 * that player's picks. Mirrors what loadPredictionWorkspace(user_id)
 * used to return, so PredictionsClient's props are unchanged.
 *
 * Defaults to the pool champion, which is what /predictions opens to —
 * the winning bracket is the most interesting one to land on.
 */
export function getWorkspace(
  playerId: string = championPlayerId,
): PredictionWorkspaceData {
  const t = snapshot.tournament;
  return {
    rounds: t.rounds as unknown as HydratedRound[],
    groupTeams: t.groupTeams as unknown as HydratedTeam[],
    groupMatches: t.groupMatches as unknown as HydratedMatch[],
    knockoutMatches: t.knockoutMatches as unknown as HydratedKnockoutMatch[],
    activeRoundId: t.activeRoundId,
    predictions: predictionsByPlayer[playerId] ?? [],
    finalistPicks: finalistPicksByPlayer[playerId] ?? NO_PICKS,
    slotLabelById: t.slotLabelById as Record<string, string>,
    realTeamIdBySlotLabel: t.realTeamIdBySlotLabel as Record<string, string>,
  };
}

/** Display name + avatar for a player slug, for the bracket caption. */
export function getPlayer(playerId: string) {
  return leaderboardEntries.find((e) => e.user_id === playerId) ?? null;
}

/** Team lookup for rendering the podium (flag + full name). */
export function getTeam(teamId: string | null): HydratedTeam | null {
  if (!teamId) return null;
  const teams = snapshot.tournament.groupTeams as unknown as HydratedTeam[];
  return teams.find((t) => t.id === teamId) ?? null;
}

/** Final + third-place scorelines, for the champion moment. */
export function getPodiumMatches() {
  const ko = snapshot.tournament
    .knockoutMatches as unknown as HydratedKnockoutMatch[];
  return {
    final: ko.find((m) => m.id === "m-final") ?? null,
    thirdPlace: ko.find((m) => m.id === "m-third-place") ?? null,
  };
}

/** Tournament date range, derived from the schedule. */
export function getDateRange(): { first: string; last: string } {
  const all = [
    ...(snapshot.tournament.groupMatches as unknown as HydratedMatch[]),
    ...(snapshot.tournament
      .knockoutMatches as unknown as HydratedKnockoutMatch[]),
  ].map((m) => m.scheduled_at);
  all.sort();
  return { first: all[0], last: all[all.length - 1] };
}
