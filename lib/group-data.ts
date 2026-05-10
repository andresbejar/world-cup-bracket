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

export interface HydratedPrediction {
  match_id: string;
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_winning_slot_id: string | null;
}

export interface PredictionWorkspaceData {
  rounds: HydratedRound[];
  groupTeams: HydratedTeam[];
  groupMatches: HydratedMatch[];
  predictions: HydratedPrediction[];
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
    supabase
      .from("bracket_slots")
      .select("id, real_team_id")
      .like("id", "team-%"),
    supabase
      .from("matches")
      .select(
        "id, round_id, home_slot_id, away_slot_id, scheduled_at, home_score, away_score, status",
      )
      .like("round_id", "group-%")
      .order("scheduled_at", { ascending: true }),
    supabase
      .from("predictions")
      .select(
        "match_id, predicted_home_score, predicted_away_score, predicted_winning_slot_id",
      )
      .eq("user_id", user_id),
  ]);

  if (roundsErr) throw roundsErr;
  if (teamsErr) throw teamsErr;
  if (slotsErr) throw slotsErr;
  if (matchesErr) throw matchesErr;
  if (predErr) throw predErr;

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
  for (const s of slots ?? []) {
    if (s.real_team_id) slotToTeamId.set(s.id, s.real_team_id);
  }

  const groupMatches: HydratedMatch[] = [];
  for (const m of matches ?? []) {
    const homeTeamId = slotToTeamId.get(m.home_slot_id);
    const awayTeamId = slotToTeamId.get(m.away_slot_id);
    if (!homeTeamId || !awayTeamId) continue; // group slot missing — skip
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
  }

  return {
    rounds: rounds ?? [],
    groupTeams: [...teamById.values()],
    groupMatches,
    predictions: predictions ?? [],
  };
}
