import { describe, it, expect } from "vitest";
import {
  R32_MATCHES,
  R16_MATCHES,
  QF_MATCHES,
  SF_MATCHES,
  THIRD_PLACE_MATCH,
  FINAL_MATCH,
  ALL_KNOCKOUT_MATCHES,
  KNOCKOUT_SLOT_LABELS,
  ANNEX_C_WINNER_GROUPS,
  BRACKET_DISPLAY_ORDER,
} from "./bracket-structure";
import { THIRD_PLACE_SLOT_LABELS, THIRD_PLACE_WINNER_GROUPS } from "./bracket";

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

  it("SF consumes each of the 4 QF winners exactly once", () => {
    const inputs = SF_MATCHES.flatMap((m) => [
      m.home_slot_label,
      m.away_slot_label,
    ]);
    expect(inputs.sort()).toEqual(
      Array.from({ length: 4 }, (_, i) => `qf-match-${i + 1}-winner`).sort(),
    );
  });

  it("Final consumes the two SF winners; 3rd-place consumes the two SF losers", () => {
    // Guards against an inverted winner/loser feed (Final pulling a loser
    // slot, or the 3rd-place match pulling a winner slot).
    expect([FINAL_MATCH.home_slot_label, FINAL_MATCH.away_slot_label].sort()).toEqual([
      "sf-match-1-winner",
      "sf-match-2-winner",
    ]);
    expect(
      [THIRD_PLACE_MATCH.home_slot_label, THIRD_PLACE_MATCH.away_slot_label].sort(),
    ).toEqual(["sf-match-1-loser", "sf-match-2-loser"]);
  });

  it("THIRD_PLACE_WINNER_GROUPS (bracket.ts) stays in sync with ANNEX_C_WINNER_GROUPS", () => {
    // Two const arrays in two files; drift would silently mis-place the
    // 3rd-placed teams. Keep them identical.
    expect([...THIRD_PLACE_WINNER_GROUPS]).toEqual([...ANNEX_C_WINNER_GROUPS]);
  });
});

describe("BRACKET_DISPLAY_ORDER (bracket visualization layout)", () => {
  const SOURCE = {
    r32: R32_MATCHES,
    r16: R16_MATCHES,
    qf: QF_MATCHES,
    sf: SF_MATCHES,
  } as const;

  it("each round's display order is a permutation of its source array (none dropped/duplicated)", () => {
    for (const round of ["r32", "r16", "qf", "sf"] as const) {
      const displayIds = BRACKET_DISPLAY_ORDER[round].map((m) => m.id).sort();
      const sourceIds = SOURCE[round].map((m) => m.id).sort();
      expect(displayIds).toEqual(sourceIds);
    }
  });

  // The whole point of the layout: the U-shaped connectors assume the two
  // feeders of child at display position `i` sit at parent display positions
  // 2i and 2i+1. This asserts that invariant for every round transition, so a
  // future edit to the FIFA tree can't silently re-break the alignment.
  it("child at display position i is fed by parent display positions 2i and 2i+1", () => {
    const displayPos = (round: "r32" | "r16" | "qf" | "sf") => {
      const pos = new Map<string, number>();
      BRACKET_DISPLAY_ORDER[round].forEach((m, i) => {
        pos.set(`${round}-match-${m.match_index}-winner`, i);
      });
      return pos;
    };
    const checks: {
      children: typeof R16_MATCHES;
      parent: "r32" | "r16" | "qf";
    }[] = [
      { children: BRACKET_DISPLAY_ORDER.r16, parent: "r32" },
      { children: BRACKET_DISPLAY_ORDER.qf, parent: "r16" },
      { children: BRACKET_DISPLAY_ORDER.sf, parent: "qf" },
    ];
    for (const { children, parent } of checks) {
      const pos = displayPos(parent);
      children.forEach((child, i) => {
        const feeders = [child.home_slot_label, child.away_slot_label]
          .map((label) => pos.get(label))
          .sort((a, b) => (a ?? 0) - (b ?? 0));
        expect(feeders).toEqual([2 * i, 2 * i + 1]);
      });
    }

    // SF → Final: the single Final block (display position 0) is fed by the
    // two SF winners at display positions 0 and 1.
    const sfPos = displayPos("sf");
    const finalFeeders = [
      FINAL_MATCH.home_slot_label,
      FINAL_MATCH.away_slot_label,
    ]
      .map((label) => sfPos.get(label))
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(finalFeeders).toEqual([0, 1]);
  });
});
