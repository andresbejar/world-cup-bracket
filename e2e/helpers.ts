import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Shared e2e utilities. Specs that need to inspect seed data (match
// IDs, slot labels, team mappings) go through here instead of duplicating
// the supabase admin client setup per file.

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "helpers.adminClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface GroupMatchRow {
  id: string;
  round_id: string;
  home_slot_id: string;
  away_slot_id: string;
  home_team_id: string;
  away_team_id: string;
  home_code: string;
  away_code: string;
  group_letter: string;
}

/**
 * Returns all 72 group-stage matches with their resolved team_ids + 3-letter
 * codes. Stable across runs (seed is hand-curated, never re-randomized).
 * Specs that drive predictions use this to know which teams play whom
 * without depending on DOM ordering.
 */
export async function listGroupMatches(): Promise<GroupMatchRow[]> {
  const admin = adminClient();
  const { data: matches, error: mErr } = await admin
    .from("matches")
    .select("id, round_id, home_slot_id, away_slot_id")
    .like("round_id", "group-%")
    .order("scheduled_at", { ascending: true });
  if (mErr) throw mErr;
  if (!matches || matches.length === 0) {
    throw new Error("listGroupMatches: seed has no group matches");
  }

  const slotIds = new Set<string>();
  for (const m of matches) {
    slotIds.add(m.home_slot_id);
    slotIds.add(m.away_slot_id);
  }
  const { data: slots, error: sErr } = await admin
    .from("bracket_slots")
    .select("id, real_team_id")
    .in("id", [...slotIds]);
  if (sErr) throw sErr;
  const teamBySlot = new Map(
    (slots ?? []).map((s) => [s.id as string, s.real_team_id as string]),
  );

  const teamIds = new Set<string>();
  for (const t of teamBySlot.values()) teamIds.add(t);
  const { data: teams, error: tErr } = await admin
    .from("teams")
    .select("id, code, group_letter")
    .in("id", [...teamIds]);
  if (tErr) throw tErr;
  const teamById = new Map(
    (teams ?? []).map((t) => [
      t.id as string,
      { code: t.code as string, group_letter: t.group_letter as string },
    ]),
  );

  return matches.map((m) => {
    const home_team_id = teamBySlot.get(m.home_slot_id as string)!;
    const away_team_id = teamBySlot.get(m.away_slot_id as string)!;
    const home = teamById.get(home_team_id)!;
    const away = teamById.get(away_team_id)!;
    return {
      id: m.id as string,
      round_id: m.round_id as string,
      home_slot_id: m.home_slot_id as string,
      away_slot_id: m.away_slot_id as string,
      home_team_id,
      away_team_id,
      home_code: home.code,
      away_code: away.code,
      group_letter: home.group_letter,
    };
  });
}

export interface KnockoutMatchRow {
  id: string;
  round_id: string;
  match_index: number;
  home_slot_id: string;
  away_slot_id: string;
}

/**
 * All 32 knockout matches (R32 → Final + 3rd-place playoff). Each row
 * has its match_index so callers can pick a winning side without DOM
 * gymnastics.
 */
export async function listKnockoutMatches(): Promise<KnockoutMatchRow[]> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("matches")
    .select("id, round_id, home_slot_id, away_slot_id")
    .not("round_id", "like", "group-%")
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => {
    const idxMatch = /-(\d+)$/.exec(m.id as string);
    return {
      id: m.id as string,
      round_id: m.round_id as string,
      match_index: idxMatch ? parseInt(idxMatch[1], 10) : 1,
      home_slot_id: m.home_slot_id as string,
      away_slot_id: m.away_slot_id as string,
    };
  });
}

/**
 * The 8 group letters a spec selects as the "best third-placed teams"
 * qualifying set. Posted to /api/third-place-assignments as
 * { group_letter, selected: true }; Annex C derives the R32 opponents.
 */
export const QUALIFYING_THIRD_GROUPS = [
  "A", "B", "C", "D", "E", "F", "G", "H",
] as const;
