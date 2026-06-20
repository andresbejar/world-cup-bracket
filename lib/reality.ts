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
  deriveBestThirdGroups,
  GROUP_LETTERS,
  THIRD_PLACE_WINNER_GROUPS,
  type GroupLetter,
  type GroupStanding,
  type GroupStandings,
  type MatchScore,
  type Team,
} from "./bracket";
import { lookupAnnexC, type WinnerSlot } from "./annex-c";
import { ALL_KNOCKOUT_MATCHES } from "./bracket-structure";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PopulateOutcome =
  | { ok: true; written: number; skipped?: undefined }
  | { ok: true; written: 0; skipped: string }
  | { ok: false; reason: string };

// bracket_slots.round_id and slot_label are NOT NULL, so every upsert must
// carry them — onConflict still attempts the INSERT branch, which would
// otherwise fail the NOT NULL constraint even when the row already exists.
type SlotWrite = { id: string; round_id: string; slot_label: string; real_team_id: string };

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

  const writes: SlotWrite[] = [];
  for (const letter of GROUP_LETTERS) {
    const standings = loaded.standings.get(letter) ?? [];
    const first = standings.find((s) => s.rank === 1);
    const second = standings.find((s) => s.rank === 2);
    if (first)
      writes.push({
        id: `r32-winner-${letter}`,
        round_id: "r32",
        slot_label: `winner-${letter}`,
        real_team_id: first.team_id,
      });
    if (second)
      writes.push({
        id: `r32-runner-up-${letter}`,
        round_id: "r32",
        slot_label: `runner-up-${letter}`,
        real_team_id: second.team_id,
      });
  }

  const { error: upsertErr } = await supabase
    .from("bracket_slots")
    .upsert(writes, { onConflict: "id" });
  if (upsertErr) {
    return { ok: false, reason: `slot upsert: ${upsertErr.message}` };
  }
  return { ok: true, written: writes.length };
}

// Knockout rounds whose winners (and, for SF, losers) advance into a
// downstream slot. r32→r16→qf→sf must run in this order so each round's
// writes feed the next round's inputs within a single pass. The final and
// third-place matches are terminal — they have no downstream slot; their
// results feed finalist scoring (scoreFinalists) instead.
const KNOCKOUT_ADVANCING_ROUNDS = ["r32", "r16", "qf", "sf"] as const;

/**
 * Map each producer slot label (the "{round}-match-{i}-winner" a match
 * produces, plus the SF "{sf}-match-{i}-loser") to the downstream
 * bracket_slot id that holds it. Derived from the feeding tree in
 * bracket-structure.ts so it stays correct if the tree is edited: a
 * downstream match's home/away slot label IS the producer label, and the
 * slot id is `${downstream_round}-${label}` (the seed's convention).
 *
 * Includes the R32 input labels (winner-A, etc.) too — harmless, since
 * those are produced by group results and never looked up here.
 */
function buildDownstreamSlotByProducerLabel(): Map<string, string> {
  const m = new Map<string, string>();
  for (const km of ALL_KNOCKOUT_MATCHES) {
    m.set(km.home_slot_label, `${km.round_id}-${km.home_slot_label}`);
    m.set(km.away_slot_label, `${km.round_id}-${km.away_slot_label}`);
  }
  return m;
}

/** Minimal knockout match shape needed to advance real teams. */
export interface KnockoutMatchRow {
  id: string; // DB id, e.g. "m-r32-1"
  round_id: string;
  home_slot_id: string;
  away_slot_id: string;
  status: string;
  winning_slot_id: string | null;
}

/**
 * Pure core of knockout advancement. Given the knockout match rows and the
 * current real occupant of every slot, return the set of downstream slot
 * writes ({slot id → real_team_id}) implied by the finished matches.
 *
 * For each finished match with a winning_slot_id, the team in the winning
 * slot advances into the downstream slot it feeds; for semi-finals, the
 * losing team also advances into its third-place-match slot. Processes
 * r32 → r16 → qf → sf in order, threading writes through a working copy of
 * the slot map so a round's advancement is visible to the next round in
 * the same pass. Matches whose winning input slot isn't populated yet are
 * skipped (never written as null), so partial brackets are safe and
 * re-running is deterministic.
 */
export function computeKnockoutAdvancement(
  matches: KnockoutMatchRow[],
  initialSlotRealTeam: Map<string, string>,
): Map<string, string> {
  const slotRealTeam = new Map(initialSlotRealTeam);
  const matchByDbId = new Map<string, KnockoutMatchRow>();
  for (const m of matches) matchByDbId.set(m.id, m);

  const downstreamByLabel = buildDownstreamSlotByProducerLabel();
  const writes = new Map<string, string>();

  const advance = (slotId: string, teamId: string) => {
    slotRealTeam.set(slotId, teamId);
    writes.set(slotId, teamId);
  };

  for (const round of KNOCKOUT_ADVANCING_ROUNDS) {
    const roundMatches = ALL_KNOCKOUT_MATCHES.filter((km) => km.round_id === round);
    for (const km of roundMatches) {
      const db = matchByDbId.get(`m-${km.id}`);
      if (!db || db.status !== "finished") continue;
      const winningSlot = db.winning_slot_id;
      if (!winningSlot) continue; // tie not yet settled by a shootout

      // Winner → downstream slot.
      const winnerTeam = slotRealTeam.get(winningSlot);
      const winnerLabel = `${km.round_id}-match-${km.match_index}-winner`;
      const winnerDest = downstreamByLabel.get(winnerLabel);
      if (winnerTeam && winnerDest) advance(winnerDest, winnerTeam);

      // SF only: loser → third-place-match slot.
      if (round === "sf") {
        const loserSlot =
          winningSlot === db.home_slot_id ? db.away_slot_id : db.home_slot_id;
        const loserTeam = slotRealTeam.get(loserSlot);
        const loserLabel = `${km.round_id}-match-${km.match_index}-loser`;
        const loserDest = downstreamByLabel.get(loserLabel);
        if (loserTeam && loserDest) advance(loserDest, loserTeam);
      }
    }
  }
  return writes;
}

/**
 * Advance real teams through the knockout bracket and persist the writes.
 * Thin I/O wrapper over computeKnockoutAdvancement: loads the knockout
 * matches + slot occupants, computes the downstream writes, upserts them.
 * Recomputes the whole tree every call, so a later result correction
 * self-heals. Idempotent.
 *
 * Depends on populateRealR32SlotsFromGroupResults (and
 * populateRealBestThirdSlots) having run — those fill the R32 input slots
 * this function reads.
 */
export async function populateRealKnockoutSlots(
  supabase: SupabaseClient,
): Promise<PopulateOutcome> {
  const { data: matches, error: matchErr } = await supabase
    .from("matches")
    .select("id, round_id, home_slot_id, away_slot_id, status, winning_slot_id")
    .not("round_id", "like", "group-%");
  if (matchErr) return { ok: false, reason: `matches: ${matchErr.message}` };

  const { data: slots, error: slotErr } = await supabase
    .from("bracket_slots")
    .select("id, round_id, slot_label, real_team_id");
  if (slotErr) return { ok: false, reason: `slots: ${slotErr.message}` };

  const slotRealTeam = new Map<string, string>();
  const slotMeta = new Map<string, { round_id: string; slot_label: string }>();
  for (const s of slots ?? []) {
    if (s.real_team_id) slotRealTeam.set(s.id as string, s.real_team_id as string);
    slotMeta.set(s.id as string, {
      round_id: s.round_id as string,
      slot_label: s.slot_label as string,
    });
  }

  const writes = computeKnockoutAdvancement(
    (matches ?? []) as KnockoutMatchRow[],
    slotRealTeam,
  );

  if (writes.size === 0) {
    return { ok: true, written: 0, skipped: "no knockout advancement yet" };
  }

  // Carry round_id/slot_label (both NOT NULL) so the upsert's INSERT branch
  // is valid even though every target row already exists in the seed.
  const rows: SlotWrite[] = [];
  for (const [id, real_team_id] of writes) {
    const meta = slotMeta.get(id);
    if (!meta) return { ok: false, reason: `unknown downstream slot: ${id}` };
    rows.push({ id, round_id: meta.round_id, slot_label: meta.slot_label, real_team_id });
  }
  const { error: upsertErr } = await supabase
    .from("bracket_slots")
    .upsert(rows, { onConflict: "id" });
  if (upsertErr) return { ok: false, reason: `slot upsert: ${upsertErr.message}` };
  return { ok: true, written: rows.length };
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

  const writes: SlotWrite[] = [];
  for (const g of THIRD_PLACE_WINNER_GROUPS) {
    const assignedGroup = assignment[`1${g}` as WinnerSlot];
    const standings = loaded.standings.get(assignedGroup) ?? [];
    const third = standings.find((s) => s.rank === 3);
    if (third) {
      writes.push({
        id: `r32-best-3rd-vs-${g}`,
        round_id: "r32",
        slot_label: `best-3rd-vs-${g}`,
        real_team_id: third.team_id,
      });
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

/** Parse the REAL_QUALIFYING_THIRDS override ("A,B,D,E,G,I,K,L"). Returns
 * null when unset/blank; an error string when set but not exactly 8 distinct
 * A-L letters. */
function parseQualifyingThirdsOverride(
  raw: string | undefined,
): { groups: GroupLetter[] } | { error: string } | null {
  if (raw == null || raw.trim() === "") return null;
  const letters = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  const distinct = new Set(letters);
  const allValid = letters.every((l) =>
    (GROUP_LETTERS as readonly string[]).includes(l),
  );
  if (letters.length !== 8 || distinct.size !== 8 || !allValid) {
    return {
      error: `REAL_QUALIFYING_THIRDS must be exactly 8 distinct group letters A-L, got "${raw}"`,
    };
  }
  return { groups: letters as GroupLetter[] };
}

export type RealThirdsResolution =
  | { ok: true; source: "override" | "derived"; groups: GroupLetter[] }
  | { ok: true; pending: string }
  | { ok: false; reason: string };

/**
 * Resolve which 8 groups' third-placed teams qualify, WITHOUT writing
 * anything. The `REAL_QUALIFYING_THIRDS` env override ("A,B,D,...") wins
 * when set; otherwise the set is auto-derived from real group standings
 * (points → GD → goals for, via deriveBestThirdGroups). Returns a
 * `pending` outcome (not an error) when the group stage isn't fully
 * finished, or when the 8th/9th thirds are a true tie that FIFA breaks
 * with disciplinary record / drawing of lots (unsimulatable) and no
 * override is set — the caller should hold and surface that an override is
 * needed. Shared by the cron driver and scripts/preview-real-thirds.ts.
 */
export async function resolveRealQualifyingThirds(
  supabase: SupabaseClient,
): Promise<RealThirdsResolution> {
  const override = parseQualifyingThirdsOverride(
    process.env.REAL_QUALIFYING_THIRDS,
  );
  if (override && "error" in override) {
    return { ok: false, reason: override.error };
  }
  if (override) {
    return { ok: true, source: "override", groups: override.groups };
  }

  const loaded = await loadRealStandingsByGroup(supabase);
  if (loaded.ok === false) return loaded;
  if (loaded.standings === null) {
    return { ok: true, pending: loaded.skipped };
  }

  const groupStandings: GroupStandings[] = GROUP_LETTERS.map((letter) => ({
    group_letter: letter,
    standings: loaded.standings.get(letter) ?? [],
  }));
  const derived = deriveBestThirdGroups(groupStandings);
  if (derived.boundaryTie) {
    return {
      ok: true,
      pending:
        "8th/9th best third-placed teams tied on points/GD/GF — set REAL_QUALIFYING_THIRDS to resolve",
    };
  }
  if (derived.groups.length !== 8) {
    return {
      ok: true,
      pending: `only ${derived.groups.length} third-placed teams ranked — group stage not fully settled`,
    };
  }
  return { ok: true, source: "derived", groups: derived.groups };
}

/**
 * Determine the 8 real qualifying third-placed groups and populate their
 * R32 slots — the automatic driver invoked by the polling cron. Delegates
 * the decision to resolveRealQualifyingThirds (override → auto-derive →
 * hold on tie/unsettled), then the Annex-C placement + upsert to
 * populateRealBestThirdSlots. Bails (skipped) until settled. Idempotent.
 */
export async function populateRealBestThirdSlotsAuto(
  supabase: SupabaseClient,
): Promise<PopulateOutcome> {
  const resolved = await resolveRealQualifyingThirds(supabase);
  if (resolved.ok === false) return resolved;
  if ("pending" in resolved) {
    return { ok: true, written: 0, skipped: resolved.pending };
  }
  return populateRealBestThirdSlots(supabase, resolved.groups);
}
