import { describe, it, expect } from "vitest";
import { ALL_KNOCKOUT_MATCHES } from "./bracket-structure";
import seed from "../supabase/seed/fixtures.json";

// Guards the generated fixture seed against a regression to placeholder
// kickoff times — the APT bug where every knockout match in a round shared
// one timestamp (all 16 R32 matches read "Jun 28, 12pm"). build-seed.ts now
// sources real per-match FIFA times; these assertions fail loudly if a future
// regen ever collapses a round back to a single time or drops a match.

type SeedMatch = { id: string; round_id: string; scheduled_at: string };
const matches = seed.matches as SeedMatch[];
const byId = new Map(matches.map((m) => [m.id, m]));

// Distinct kickoffs FIFA actually schedules per knockout round.
const EXPECTED_DISTINCT: Record<string, number> = {
  r32: 16,
  r16: 8,
  qf: 4,
  sf: 2,
  third_place: 1,
  final: 1,
};

describe("knockout fixture schedule", () => {
  it("every knockout match has a real, parseable kickoff", () => {
    for (const km of ALL_KNOCKOUT_MATCHES) {
      const m = byId.get(`m-${km.id}`);
      expect(m, `missing seed match for ${km.id}`).toBeDefined();
      expect(m!.scheduled_at).toBeTruthy();
      expect(Number.isNaN(Date.parse(m!.scheduled_at))).toBe(false);
    }
  });

  it("each round spreads across distinct kickoff times (no placeholder collapse)", () => {
    for (const [round, expected] of Object.entries(EXPECTED_DISTINCT)) {
      const times = new Set(
        matches.filter((m) => m.round_id === round).map((m) => m.scheduled_at),
      );
      expect(times.size, `round ${round} distinct kickoffs`).toBe(expected);
    }
  });

  it("knockout kickoffs fall in the real FIFA window (Jun 28 – Jul 19, 2026)", () => {
    const start = Date.parse("2026-06-28T00:00:00Z");
    const end = Date.parse("2026-07-20T00:00:00Z");
    for (const km of ALL_KNOCKOUT_MATCHES) {
      const t = Date.parse(byId.get(`m-${km.id}`)!.scheduled_at);
      expect(t).toBeGreaterThanOrEqual(start);
      expect(t).toBeLessThan(end);
    }
  });
});
