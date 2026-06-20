import { describe, it, expect } from "vitest";
import {
  type RawMatchRow,
  type RawRoundRow,
  type RawSlotRow,
  type RawTeamRow,
  resolveCalendarMatches,
} from "./calendar-data";

const rounds: RawRoundRow[] = [
  { id: "group-r1", name: "Group Stage · Matchday 1" },
  { id: "r32", name: "Round of 32" },
];

const teams: RawTeamRow[] = [
  { id: "ARG", code: "ARG", name: "Argentina" },
  { id: "BRA", code: "BRA", name: "Brazil" },
];

const slots: RawSlotRow[] = [
  { id: "slot-arg", slot_label: "team-ARG", real_team_id: "ARG" },
  { id: "slot-bra", slot_label: "team-BRA", real_team_id: "BRA" },
  { id: "slot-w-a", slot_label: "winner-A", real_team_id: null },
  { id: "slot-ru-b", slot_label: "runner-up-B", real_team_id: null },
];

describe("resolveCalendarMatches", () => {
  it("uses team codes when the slot's real team is known", () => {
    const matches: RawMatchRow[] = [
      {
        id: "m-1",
        round_id: "group-r1",
        home_slot_id: "slot-arg",
        away_slot_id: "slot-bra",
        scheduled_at: "2026-06-28T19:00:00+00:00",
        status: "scheduled",
      },
    ];
    const [resolved] = resolveCalendarMatches(matches, slots, teams, rounds);
    expect(resolved.homeName).toBe("ARG");
    expect(resolved.awayName).toBe("BRA");
    expect(resolved.roundName).toBe("Group Stage · Matchday 1");
  });

  it("humanizes slot labels when the real team is unknown", () => {
    const matches: RawMatchRow[] = [
      {
        id: "m-r32-1",
        round_id: "r32",
        home_slot_id: "slot-w-a",
        away_slot_id: "slot-ru-b",
        scheduled_at: "2026-06-30T19:00:00+00:00",
        status: "scheduled",
      },
    ];
    const [resolved] = resolveCalendarMatches(matches, slots, teams, rounds);
    expect(resolved.homeName).toBe("Winner Group A");
    expect(resolved.awayName).toBe("Runner-up Group B");
  });

  it("drops cancelled matches and unparseable dates, and sorts by kickoff", () => {
    const matches: RawMatchRow[] = [
      {
        id: "m-late",
        round_id: "group-r1",
        home_slot_id: "slot-arg",
        away_slot_id: "slot-bra",
        scheduled_at: "2026-06-28T22:00:00+00:00",
        status: "scheduled",
      },
      {
        id: "m-early",
        round_id: "group-r1",
        home_slot_id: "slot-arg",
        away_slot_id: "slot-bra",
        scheduled_at: "2026-06-28T16:00:00+00:00",
        status: "scheduled",
      },
      {
        id: "m-cancelled",
        round_id: "group-r1",
        home_slot_id: "slot-arg",
        away_slot_id: "slot-bra",
        scheduled_at: "2026-06-28T19:00:00+00:00",
        status: "cancelled",
      },
      {
        id: "m-bad-date",
        round_id: "group-r1",
        home_slot_id: "slot-arg",
        away_slot_id: "slot-bra",
        scheduled_at: "nonsense",
        status: "scheduled",
      },
    ];
    const resolved = resolveCalendarMatches(matches, slots, teams, rounds);
    expect(resolved.map((m) => m.id)).toEqual(["m-early", "m-late"]);
  });
});
