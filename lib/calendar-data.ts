// Data loader for the public ICS match feed (app/api/calendar/world-cup.ics).
//
// The feed is identical for every subscriber (scope = all matches), so there's
// no per-user data and no auth: we read the public reference tables with a
// cookie-free anon client (RLS already grants `anon` SELECT on matches /
// bracket_slots / teams / rounds). Avoiding the cookie-bound server client
// keeps the route safe to cache at the CDN for all visitors.
//
// resolveCalendarMatches is a pure transform (testable in isolation); the join
// pattern mirrors lib/group-data.ts.

import { createClient } from "@supabase/supabase-js";
import { type CalendarMatch, humanizeSlotLabel } from "./ics";

export interface RawMatchRow {
  id: string;
  round_id: string;
  home_slot_id: string;
  away_slot_id: string;
  scheduled_at: string;
  status: string;
}
export interface RawSlotRow {
  id: string;
  slot_label: string;
  real_team_id: string | null;
}
export interface RawTeamRow {
  id: string;
  code: string;
  name: string;
}
export interface RawRoundRow {
  id: string;
  name: string;
}

// Resolve each match into a calendar view model. For each side: if the slot's
// real team is known (all group matches + advanced knockouts) use its code,
// otherwise fall back to a humanized slot-label placeholder ("Winner Group A").
// Drops cancelled matches and rows with an unparseable kickoff time.
export function resolveCalendarMatches(
  matches: RawMatchRow[],
  slots: RawSlotRow[],
  teams: RawTeamRow[],
  rounds: RawRoundRow[],
): CalendarMatch[] {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const roundNameById = new Map(rounds.map((r) => [r.id, r.name]));

  const display = (slotId: string): string => {
    const slot = slotById.get(slotId);
    if (!slot) return "TBD";
    if (slot.real_team_id) {
      const team = teamById.get(slot.real_team_id);
      if (team) return team.code;
    }
    return humanizeSlotLabel(slot.slot_label);
  };

  const out: CalendarMatch[] = [];
  for (const m of matches) {
    if (m.status === "cancelled") continue;
    if (Number.isNaN(new Date(m.scheduled_at).getTime())) continue;
    out.push({
      id: m.id,
      scheduledAtIso: m.scheduled_at,
      homeName: display(m.home_slot_id),
      awayName: display(m.away_slot_id),
      roundName: roundNameById.get(m.round_id) ?? "Match",
    });
  }
  out.sort(
    (a, b) =>
      new Date(a.scheduledAtIso).getTime() -
      new Date(b.scheduledAtIso).getTime(),
  );
  return out;
}

export async function loadCalendarMatches(): Promise<CalendarMatch[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const [m, s, t, r] = await Promise.all([
    supabase
      .from("matches")
      .select("id, round_id, home_slot_id, away_slot_id, scheduled_at, status")
      .order("scheduled_at", { ascending: true }),
    supabase.from("bracket_slots").select("id, slot_label, real_team_id"),
    supabase.from("teams").select("id, code, name"),
    supabase.from("rounds").select("id, name"),
  ]);

  if (m.error) throw m.error;
  if (s.error) throw s.error;
  if (t.error) throw t.error;
  if (r.error) throw r.error;

  return resolveCalendarMatches(
    m.data ?? [],
    s.data ?? [],
    t.data ?? [],
    r.data ?? [],
  );
}
