// FIFA 2026 Annex C lookup — maps a set of 8 qualifying third-placed
// groups to the deterministic R32 assignment of which group's 3rd-placed
// team faces each of the 8 Annex-C group winners.
//
// Zero database access (DB-free, same bar as lib/bracket.ts). The 495-row
// table (annex_c.json) was transcribed from FIFA's published Annex C and
// is validated by lib/annex-c.test.ts on every run (no 1X-vs-3X pair,
// targets ⊆ qualifying set, bijection over the qualifying set).
//
// See PRD_annex_c_r32.md for the data format and design rationale.

import annexCData from "./annex_c.json";
import type { GroupLetter } from "./bracket";

/**
 * The 8 group-winner slots that take a 3rd-placed opponent in the R32.
 * Winners of groups C, F, H, J are NOT here — they're in the fixed
 * (non-Annex-C) matches. See lib/bracket-structure.ts.
 */
export type WinnerSlot = "1A" | "1B" | "1D" | "1E" | "1G" | "1I" | "1K" | "1L";

export const WINNER_SLOTS = annexCData.winnerSlots as readonly WinnerSlot[];

/** A full Annex C assignment: winner slot → group letter of its 3rd-placed opponent. */
export type AnnexCAssignment = Record<WinnerSlot, GroupLetter>;

// Index the 495 combinations into a Map for O(1) lookup. The JSON keys
// are the 8 qualifying group letters concatenated in alphabetical order.
const LOOKUP: Map<string, AnnexCAssignment> = new Map(
  Object.entries(annexCData.lookup as Record<string, AnnexCAssignment>),
);

/**
 * Thrown when the qualifying-group set passed to lookupAnnexC is not a
 * valid 8-distinct-group combination, or has no Annex C entry. This is a
 * programmer error (the UI/API must validate the set is exactly 8 distinct
 * groups first), not a user-facing condition — surface it as a crash.
 */
export class AnnexCLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnexCLookupError";
  }
}

/**
 * Given the 8 groups whose 3rd-placed team qualified, return the Annex C
 * assignment { '1A': 'H', '1B': 'G', ... } where each value is the group
 * letter of the 3rd-placed team facing that winner.
 *
 * Order-independent: the input is treated as a set (sorted before lookup).
 * Throws AnnexCLookupError if the input isn't exactly 8 distinct groups
 * or has no matching Annex C row.
 */
export function lookupAnnexC(qualifyingGroups: readonly GroupLetter[]): AnnexCAssignment {
  const distinct = new Set(qualifyingGroups);
  if (qualifyingGroups.length !== 8 || distinct.size !== 8) {
    throw new AnnexCLookupError(
      `Expected 8 distinct qualifying groups, got ${qualifyingGroups.length} ` +
        `(${distinct.size} distinct): [${qualifyingGroups.join(", ")}]`,
    );
  }
  const key = [...qualifyingGroups].sort().join("");
  const result = LOOKUP.get(key);
  if (!result) {
    throw new AnnexCLookupError(`No Annex C entry for key "${key}"`);
  }
  return result;
}
