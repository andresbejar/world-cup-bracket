// Reality phase — turns finished group matches into the 24 R32 slot
// real_team_ids (winner-{A..L} + runner-up-{A..L}). The 8 best-3rd
// slots are FIFA's 495-permutation tiebreaker territory and are set
// out-of-band by an admin once FIFA publishes the official mapping;
// the scoring engine treats them as null until that happens, and
// computeThirdPlacePlacementPoints returns null too (no third-place
// bonus materializes yet — re-runs are safe).
//
// All writes are upserts so re-running mid-tournament is a no-op.

import {
  computeGroupStandings,
  GROUP_LETTERS,
  type MatchScore,
  type Team,
} from "./bracket";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PopulateOutcome =
  | { ok: true; written: number; skipped?: undefined }
  | { ok: true; written: 0; skipped: string }
  | { ok: false; reason: string };

/**
 * After every group-stage match has flipped to `finished`, compute the
 * real group standings and write `bracket_slots.real_team_id` for the
 * 24 group-driven R32 slots (12 winners + 12 runners-up). The 8
 * best-3rd slots are left to admin override — see the doc-block.
 *
 * Idempotent: re-running once R32 has started is a no-op (the upsert
 * writes the same value).
 */
export async function populateRealR32SlotsFromGroupResults(
  supabase: SupabaseClient,
): Promise<PopulateOutcome> {
  // Load every group match. If any are not yet finished, bail — we
  // don't want to write partial standings.
  const { data: matches, error: matchErr } = await supabase
    .from("matches")
    .select(
      "id, round_id, home_slot_id, away_slot_id, home_score, away_score, status",
    )
    .like("round_id", "group-%");
  if (matchErr) return { ok: false, reason: `matches: ${matchErr.message}` };
  if (!matches || matches.length === 0) {
    return { ok: true, written: 0, skipped: "no group matches loaded" };
  }
  const finished = matches.filter((m) => m.status === "finished");
  if (finished.length < matches.length) {
    return {
      ok: true,
      written: 0,
      skipped: `${finished.length}/${matches.length} group matches finished`,
    };
  }

  // Resolve slot_id → real_team_id for the team-XYZ group slots so we
  // can map each match's home/away to a team_id for standings input.
  const { data: groupSlots, error: slotErr } = await supabase
    .from("bracket_slots")
    .select("id, real_team_id")
    .like("id", "team-%");
  if (slotErr) return { ok: false, reason: `group slots: ${slotErr.message}` };
  const slotToTeam = new Map<string, string>();
  for (const s of groupSlots ?? []) {
    if (s.real_team_id) slotToTeam.set(s.id, s.real_team_id);
  }

  // Pull team → group letter so we can group standings inputs.
  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id, group_letter");
  if (teamsErr) return { ok: false, reason: `teams: ${teamsErr.message}` };
  const groupLetterByTeam = new Map<string, string>();
  for (const t of teams ?? []) {
    groupLetterByTeam.set(t.id as string, t.group_letter as string);
  }

  // Bucket scores by group.
  const scoresByGroup = new Map<string, MatchScore[]>();
  const teamsByGroup = new Map<string, Team[]>();
  for (const letter of GROUP_LETTERS) {
    scoresByGroup.set(letter, []);
    teamsByGroup.set(letter, []);
  }
  for (const t of teams ?? []) {
    const letter = groupLetterByTeam.get(t.id as string);
    if (letter) {
      teamsByGroup.get(letter)?.push({
        id: t.id as string,
        group_letter: letter,
      });
    }
  }
  for (const m of finished) {
    const home = slotToTeam.get(m.home_slot_id as string);
    const away = slotToTeam.get(m.away_slot_id as string);
    if (!home || !away) continue;
    const letter = groupLetterByTeam.get(home);
    if (!letter) continue;
    if (m.home_score == null || m.away_score == null) continue;
    scoresByGroup.get(letter)?.push({
      home_team_id: home,
      away_team_id: away,
      home_score: m.home_score as number,
      away_score: m.away_score as number,
    });
  }

  // Compute standings + build the 24 writes.
  const writes: { id: string; real_team_id: string }[] = [];
  for (const letter of GROUP_LETTERS) {
    const teamsInGroup = teamsByGroup.get(letter) ?? [];
    const scores = scoresByGroup.get(letter) ?? [];
    const standings = computeGroupStandings(scores, teamsInGroup);
    const first = standings.find((s) => s.rank === 1);
    const second = standings.find((s) => s.rank === 2);
    if (first) {
      writes.push({
        id: `r32-winner-${letter}`,
        real_team_id: first.team_id,
      });
    }
    if (second) {
      writes.push({
        id: `r32-runner-up-${letter}`,
        real_team_id: second.team_id,
      });
    }
  }

  // Upsert by primary key — idempotent re-runs.
  const { error: upsertErr } = await supabase
    .from("bracket_slots")
    .upsert(writes, { onConflict: "id" });
  if (upsertErr) {
    return { ok: false, reason: `slot upsert: ${upsertErr.message}` };
  }

  return { ok: true, written: writes.length };
}
