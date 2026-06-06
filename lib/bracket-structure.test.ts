import { describe, it, expect } from "vitest";
import {
  R32_MATCHES,
  R16_MATCHES,
  QF_MATCHES,
  SF_MATCHES,
  ALL_KNOCKOUT_MATCHES,
  KNOCKOUT_SLOT_LABELS,
  ANNEX_C_WINNER_GROUPS,
} from "./bracket-structure";
import { THIRD_PLACE_SLOT_LABELS } from "./bracket";

const slotSet = new Set(KNOCKOUT_SLOT_LABELS.map((s) => s.slot_label));

// "winner-E" / "runner-up-C" → group letter; null for non-group slots.
function groupOf(label: string): string | null {
  const m = /^(?:winner|runner-up)-([A-L])$/.exec(label);
  return m ? m[1] : null;
}

describe("bracket-structure (FIFA 2026 tree)", () => {
  it("has the right match counts", () => {
    expect(R32_MATCHES).toHaveLength(16);
    expect(R16_MATCHES).toHaveLength(8);
    expect(QF_MATCHES).toHaveLength(4);
    expect(SF_MATCHES).toHaveLength(2);
    expect(ALL_KNOCKOUT_MATCHES).toHaveLength(32); // 16+8+4+2+1+1
  });

  it("declares 64 knockout slots including the 8 Annex-C third slots", () => {
    expect(KNOCKOUT_SLOT_LABELS).toHaveLength(64);
    for (const g of ANNEX_C_WINNER_GROUPS) {
      expect(slotSet.has(`best-3rd-vs-${g}`)).toBe(true);
    }
    // bracket.ts's THIRD_PLACE_SLOT_LABELS must match the structure's slots.
    for (const label of THIRD_PLACE_SLOT_LABELS) {
      expect(slotSet.has(label)).toBe(true);
    }
  });

  it("every match references only declared slots (referential integrity)", () => {
    for (const m of ALL_KNOCKOUT_MATCHES) {
      expect(slotSet.has(m.home_slot_label)).toBe(true);
      expect(slotSet.has(m.away_slot_label)).toBe(true);
    }
  });

  it("R32 match_index is 1..16 with no gaps", () => {
    expect(R32_MATCHES.map((m) => m.match_index).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  });

  it("no fixed R32 match pairs two teams from the same group", () => {
    for (const m of R32_MATCHES) {
      const h = groupOf(m.home_slot_label);
      const a = groupOf(m.away_slot_label);
      if (h && a) expect(h).not.toBe(a);
    }
  });

  it("the 8 Annex-C R32 matches pair a winner with a best-3rd-vs slot", () => {
    const annexMatches = R32_MATCHES.filter((m) =>
      m.away_slot_label.startsWith("best-3rd-vs-"),
    );
    expect(annexMatches).toHaveLength(8);
    for (const m of annexMatches) {
      // home is winner-{X}, away is best-3rd-vs-{X} — same winner group.
      const winnerGroup = groupOf(m.home_slot_label);
      expect(winnerGroup).not.toBeNull();
      expect(m.away_slot_label).toBe(`best-3rd-vs-${winnerGroup}`);
    }
  });

  it("R16 consumes each of the 16 R32 winners exactly once", () => {
    const inputs = R16_MATCHES.flatMap((m) => [
      m.home_slot_label,
      m.away_slot_label,
    ]);
    expect(inputs.sort()).toEqual(
      Array.from({ length: 16 }, (_, i) => `r32-match-${i + 1}-winner`).sort(),
    );
  });

  it("QF consumes each of the 8 R16 winners exactly once", () => {
    const inputs = QF_MATCHES.flatMap((m) => [
      m.home_slot_label,
      m.away_slot_label,
    ]);
    expect(inputs.sort()).toEqual(
      Array.from({ length: 8 }, (_, i) => `r16-match-${i + 1}-winner`).sort(),
    );
  });
});
