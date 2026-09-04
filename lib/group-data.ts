// View models for the predictions workspace.
//
// Archive note: loadPredictionWorkspace() has been removed — the workspace
// is now served frozen from data/archive-snapshot.json via lib/archive.ts,
// which returns this exact PredictionWorkspaceData shape so every client
// component below it compiles unchanged. The types stay here because
// predictions-client.tsx and five card components import them.

export interface HydratedTeam {
  id: string; // ISO alpha-3
  name: string;
  code: string;
  flag_url: string | null;
  group_letter: string;
}

export interface HydratedRound {
  id: string;
  name: string;
  stage:
    | "group"
    | "r32"
    | "r16"
    | "qf"
    | "sf"
    | "third_place"
    | "final";
  matchday: number | null;
  deadline_at: string;
  locked_at: string | null;
}

export interface HydratedMatch {
  id: string;
  round_id: string;
  scheduled_at: string;
  home: HydratedTeam;
  away: HydratedTeam;
  home_slot_id: string;
  away_slot_id: string;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "in_progress" | "finished" | "cancelled";
}

export interface HydratedKnockoutMatch {
  id: string;
  round_id: string; // "r32" | "r16" | "qf" | "sf" | "final" | "third_place"
  /**
   * 1-based index within the round, used to compute downstream slot
   * labels (`r32-match-N-winner`).
   */
  match_index: number;
  scheduled_at: string;
  home_slot_id: string;
  away_slot_id: string;
  home_slot_label: string;
  away_slot_label: string;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "in_progress" | "finished" | "cancelled";
  /**
   * The slot that advanced (== home_slot_id or away_slot_id). Single
   * source of truth for the knockout outcome, incl. penalty shootouts.
   * Null until the match settles. Set by the polling cron.
   */
  winning_slot_id: string | null;
}

export interface HydratedPrediction {
  match_id: string;
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_winning_slot_id: string | null;
}


export interface HydratedFinalistPicks {
  first_place_team_id: string | null;
  second_place_team_id: string | null;
  third_place_team_id: string | null;
}

export interface PredictionWorkspaceData {
  rounds: HydratedRound[];
  groupTeams: HydratedTeam[];
  groupMatches: HydratedMatch[];
  knockoutMatches: HydratedKnockoutMatch[];
  /**
   * The round the predictions screen should open to: the earliest round
   * (in deadline order) that still has a non-finished match, falling back
   * to the last round once the tournament is over. See lib/active-round.ts.
   */
  activeRoundId: string;
  predictions: HydratedPrediction[];
  finalistPicks: HydratedFinalistPicks;
  /** bracket_slot.id → bracket_slot.slot_label, for resolving predicted_winning_slot_id. */
  slotLabelById: Record<string, string>;
  /**
   * bracket_slot.slot_label → real_team_id, for every slot whose
   * `real_team_id` has been populated. Group stage settling writes the
   * 24 group-driven R32 inputs (winner-A..L, runner-up-A..L); admins
   * land the 8 best-3rd-N slots out-of-band. As knockout matches finish,
   * the cron advances winners into the downstream slot labels
   * (`r32-match-N-winner`, etc.) via populateRealKnockoutSlots.
   */
  realTeamIdBySlotLabel: Record<string, string>;
}
