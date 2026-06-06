// Reality phase — turns finished group matches into the R32 slot
// real_team_ids. The 24 group-driven slots (winner-{A..L} +
// runner-up-{A..L}) are written automatically once every group match is
// finished. The 8 "best-3rd-vs-{winner}" slots additionally require
// FIFA's real qualifying set (which 8 of the 12 third-placed teams
// advance) — that set depends on disciplinary/ranking tiebreakers we
// can't simulate, so it's supplied out-of-band by an admin and applied
// FIFA-compliantly via Annex C in populateRealBestThirdSlots. Until then
// those slots stay null and computeThirdPlacePlacementPoints returns null
// (no third-place bonus materializes; re-runs are safe).
//
// All writes are upserts so re-running mid-tournament is a no-op.

import {
  computeGroupStandings,
  GROUP_LETTERS,
  THIRD_PLACE_WINNER_GROUPS,
  type GroupLetter,
  type GroupStanding,
  type MatchScore,
  type Team,
} from "./bracket";
import { lookupAnnexC, type WinnerSlot } from "./annex-c";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PopulateOutcome =
  | { ok: true; written: number; skipped?: undefined }
  | { ok: true; written: 0; skipped: string }
  | { ok: false; reason: string };

/**
 * Compute real group standings for all 12 groups from finished group
 * matches. Returns a `skipped` outcome (no standings) if any group match
 * is still unfinished — we never write partial standings.
 */
async function loadRealStandingsByGroup(
  supabase: SupabaseClient,
):
  | Promise<
      | { ok: true; standings: Map<string, GroupStanding[]> }
      | { ok: true; standings: null; skipped: string }
      | { ok: false; reason: string }
    > {
  const { data: matches, error: matchErr } = await supabase
    .from("matches")
    .select("id, round_id, home_slot_id, away_slot_id, home_score, away_score, status")
    .like("round_id", "group-%");
  if (matchErr) return { ok: false, reason: `matches: ${matchErr.message}` };
  if (!matches || matches.length === 0) {
    return { ok: true, standings: null, skipped: "no group matches loaded" };
  }
  const finished = matches.filter((m) => m.status === "finished");
  if (finished.length < matches.length) {
    return {
      ok: true,
      standings: null,
      skipped: `${finished.length}/${matches.length} group matches finished`,
    };
  }

  const { data: groupSlots, error: slotErr } = await supabase
    .from("bracket_slots")
    .select("id, real_team_id")
    .like("id", "team-%");
  if (slotErr) return { ok: false, reason: `group slots: ${slotErr.message}` };
  const slotToTeam = new Map<string, string>();
  for (const s of groupSlots ?? []) {
    if (s.real_team_id) slotToTeam.set(s.id, s.real_team_id);
  }

  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id, group_letter");
  if (teamsErr) return { ok: false, reason: `teams: ${teamsErr.message}` };
  const groupLetterByTeam = new Map<string, string>();
  const teamsByGroup = new Map<string, Team[]>();
  for (const letter of GROUP_LETTERS) teamsByGroup.set(letter, []);
  for (const t of teams ?? []) {
    const id = t.id as string;
    const letter = t.group_letter as string;
    groupLetterByTeam.set(id, letter);
    teamsByGroup.get(letter)?.push({ id, group_letter: letter });
  }

  const scoresByGroup = new Map<string, MatchScore[]>();
  for (const letter of GROUP_LETTERS) scoresByGroup.set(letter, []);
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

  const standings = new Map<string, GroupStanding[]>();
  for (const letter of GROUP_LETTERS) {
    standings.set(
      letter,
      computeGroupStandings(
        scoresByGroup.get(letter) ?? [],
        teamsByGroup.get(letter) ?? [],
      ),
    );
  }
  return { ok: true, standings };
}

/**
 * After every group-stage match has flipped to `finished`, compute the
 * real group standings and write `bracket_slots.real_team_id` for the 24
 * group-driven R32 slots (12 winners + 12 runners-up). The 8 best-3rd-vs
 * slots are handled by populateRealBestThirdSlots once the qualifying set
 * is known. Idempotent.
 */
export async function populateRealR32SlotsFromGroupResults(
  supabase: SupabaseClient,
): Promise<PopulateOutcome> {
  const loaded = await loadRealStandingsByGroup(supabase);
  if (loaded.ok === false) return loaded;
  if (loaded.standings === null) {
    return { ok: true, written: 0, skipped: loaded.skipped };
  }

  const writes: { id: string; real_team_id: string }[] = [];
  for (const letter of GROUP_LETTERS) {
    const standings = loaded.standings.get(letter) ?? [];
    const first = standings.find((s) => s.rank === 1);
    const second = standings.find((s) => s.rank === 2);
    if (first) writes.push({ id: `r32-winner-${letter}`, real_team_id: first.team_id });
    if (second) writes.push({ id: `r32-runner-up-${letter}`, real_team_id: second.team_id });
  }

  const { error: upsertErr } = await supabase
    .from("bracket_slots")
    .upsert(writes, { onConflict: "id" });
  if (upsertErr) {
    return { ok: false, reason: `slot upsert: ${upsertErr.message}` };
  }
  return { ok: true, written: writes.length };
}

/**
 * Given FIFA's real qualifying set (the 8 groups whose 3rd-placed team
 * advanced — admin-supplied, since the final tiebreakers can't be
 * simulated), assign each qualifying team to its R32 slot via Annex C and
 * write `bracket_slots.real_team_id` for the 8 "best-3rd-vs-{winner}"
 * slots. This is the real-side mirror of populateR32Slots: it guarantees
 * the same FIFA-compliant, no-same-group-rematch placement.
 *
 * Throws (via lookupAnnexC) if realQualifyingGroups isn't exactly 8
 * distinct groups. Idempotent. Bails (skipped) until group stage is
 * fully finished, since it needs real 3rd-place standings.
 */
export async function populateRealBestThirdSlots(
  supabase: SupabaseClient,
  realQualifyingGroups: readonly GroupLetter[],
): Promise<PopulateOutcome> {
  const assignment = lookupAnnexC(realQualifyingGroups);

  const loaded = await loadRealStandingsByGroup(supabase);
  if (loaded.ok === false) return loaded;
  if (loaded.standings === null) {
    return { ok: true, written: 0, skipped: loaded.skipped };
  }

  const writes: { id: string; real_team_id: string }[] = [];
  for (const g of THIRD_PLACE_WINNER_GROUPS) {
    const assignedGroup = assignment[`1${g}` as WinnerSlot];
    const standings = loaded.standings.get(assignedGroup) ?? [];
    const third = standings.find((s) => s.rank === 3);
    if (third) {
      writes.push({ id: `r32-best-3rd-vs-${g}`, real_team_id: third.team_id });
    }
  }

  const { error: upsertErr } = await supabase
    .from("bracket_slots")
    .upsert(writes, { onConflict: "id" });
  if (upsertErr) {
    return { ok: false, reason: `slot upsert: ${upsertErr.message}` };
  }
  return { ok: true, written: writes.length };
}
