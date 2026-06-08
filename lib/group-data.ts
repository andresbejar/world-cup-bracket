// Server-side data fetcher for the predictions workspace.
//
// Pulls every team, every group bracket_slot, every group/knockout
// match, every round, plus the user's existing predictions in a single
// hop. The total payload is small (~50KB) so the client component can
// hold the full bracket in memory and react locally to score changes
// without needing a server roundtrip per keystroke.

import { createClient } from "@/lib/supabase/server";

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
  predictions: HydratedPrediction[];
  /** Group letters the user predicts will produce a qualifying 3rd-placed team (≤8). */
  qualifyingThirdGroups: string[];
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

export async function loadPredictionWorkspace(
  user_id: string,
): Promise<PredictionWorkspaceData> {
  const supabase = await createClient();

  const [
    { data: rounds, error: roundsErr },
    { data: teams, error: teamsErr },
    { data: slots, error: slotsErr },
    { data: matches, error: matchesErr },
    { data: predictions, error: predErr },
    { data: thirdPlace, error: thirdPlaceErr },
    { data: finalist, error: finalistErr },
  ] = await Promise.all([
    supabase
      .from("rounds")
      .select("id, name, stage, matchday, deadline_at, locked_at")
      .order("deadline_at", { ascending: true }),
    supabase
      .from("teams")
      .select("id, name, code, flag_url, group_letter")
      .order("group_letter", { ascending: true })
      .order("code", { ascending: true }),
    supabase.from("bracket_slots").select("id, slot_label, real_team_id"),
    supabase
      .from("matches")
      .select(
        "id, round_id, home_slot_id, away_slot_id, scheduled_at, home_score, away_score, status, winning_slot_id",
      )
      .order("scheduled_at", { ascending: true }),
    supabase
      .from("predictions")
      .select(
        "match_id, predicted_home_score, predicted_away_score, predicted_winning_slot_id",
      )
      .eq("user_id", user_id),
    supabase
      .from("predicted_qualifying_thirds")
      .select("group_letter")
      .eq("user_id", user_id),
    supabase
      .from("finalist_picks")
      .select("first_place_team_id, second_place_team_id, third_place_team_id")
      .eq("user_id", user_id)
      .maybeSingle(),
  ]);

  if (roundsErr) throw roundsErr;
  if (teamsErr) throw teamsErr;
  if (slotsErr) throw slotsErr;
  if (matchesErr) throw matchesErr;
  if (predErr) throw predErr;
  if (thirdPlaceErr) throw thirdPlaceErr;
  if (finalistErr) throw finalistErr;

  const teamById = new Map<string, HydratedTeam>(
    (teams ?? []).map((t) => [
      t.id,
      {
        id: t.id,
        name: t.name,
        code: t.code,
        flag_url: t.flag_url,
        group_letter: t.group_letter,
      },
    ]),
  );

  const slotToTeamId = new Map<string, string>();
  const slotLabelById: Record<string, string> = {};
  const realTeamIdBySlotLabel: Record<string, string> = {};
  for (const s of slots ?? []) {
    if (s.real_team_id) {
      slotToTeamId.set(s.id, s.real_team_id);
      realTeamIdBySlotLabel[s.slot_label] = s.real_team_id;
    }
    slotLabelById[s.id] = s.slot_label;
  }

  const groupMatches: HydratedMatch[] = [];
  const knockoutMatches: HydratedKnockoutMatch[] = [];
  for (const m of matches ?? []) {
    if (m.round_id.startsWith("group-")) {
      const homeTeamId = slotToTeamId.get(m.home_slot_id);
      const awayTeamId = slotToTeamId.get(m.away_slot_id);
      if (!homeTeamId || !awayTeamId) continue;
      const home = teamById.get(homeTeamId);
      const away = teamById.get(awayTeamId);
      if (!home || !away) continue;
      groupMatches.push({
        id: m.id,
        round_id: m.round_id,
        scheduled_at: m.scheduled_at,
        home,
        away,
        home_slot_id: m.home_slot_id,
        away_slot_id: m.away_slot_id,
        home_score: m.home_score,
        away_score: m.away_score,
        status: m.status,
      });
    } else {
      // Knockout match — slot teams resolve client-side via the cascade.
      const homeLabel = slotLabelById[m.home_slot_id];
      const awayLabel = slotLabelById[m.away_slot_id];
      if (!homeLabel || !awayLabel) continue;
      knockoutMatches.push({
        id: m.id,
        round_id: m.round_id,
        match_index: knockoutMatchIndex(m.id),
        scheduled_at: m.scheduled_at,
        home_slot_id: m.home_slot_id,
        away_slot_id: m.away_slot_id,
        home_slot_label: homeLabel,
        away_slot_label: awayLabel,
        home_score: m.home_score,
        away_score: m.away_score,
        status: m.status,
        winning_slot_id: m.winning_slot_id,
      });
    }
  }

  return {
    rounds: rounds ?? [],
    groupTeams: [...teamById.values()],
    groupMatches,
    knockoutMatches,
    predictions: predictions ?? [],
    qualifyingThirdGroups: (thirdPlace ?? []).map(
      (r) => r.group_letter as string,
    ),
    finalistPicks: finalist ?? {
      first_place_team_id: null,
      second_place_team_id: null,
      third_place_team_id: null,
    },
    slotLabelById,
    realTeamIdBySlotLabel,
  };
}

// Knockout match ids in the seed look like "m-r32-1", "m-r16-3", "m-final",
// "m-third-place". This pulls the trailing index (1 for the singletons).
function knockoutMatchIndex(id: string): number {
  const m = /-(\d+)$/.exec(id);
  return m ? parseInt(m[1], 10) : 1;
}
