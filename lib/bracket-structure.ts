// Hand-encoded FIFA World Cup 2026 bracket structure for the knockout phase.
//
// The api-sports.io feed only has group-stage fixtures (verified APT-1,
// 2026-05-09). The R32 → Final structure must be hand-encoded.
//
// Slot-label scheme (model = upstream-referential):
//   "winner-{group}"           — 12 slots, A through L
//   "runner-up-{group}"        — 12 slots, A through L
//   "best-3rd-vs-{group}"      — 8 slots, the 3rd-placed team each Annex-C
//                                group winner faces (A,B,D,E,G,I,K,L). The
//                                occupant is decided by FIFA's Annex C
//                                lookup (lib/annex-c.ts), never by the user
//                                dragging a team into a slot.
//   "r32-match-{1..16}-winner" — 16 R32 winners
//   "r16-match-{1..8}-winner"  — 8  R16 winners
//   "qf-match-{1..4}-winner"   — 4  QF winners
//   "sf-match-{1..2}-winner"   — 2  SF winners (→ Final)
//   "sf-match-{1..2}-loser"    — 2  SF losers  (→ 3rd-place match)
//
// **FIFA bracket fidelity:** the matchups and the round-to-round feeding
// tree below encode FIFA's published 2026 bracket exactly (master-schedule
// matches 73–104; verified against the FIFA Competition Regulations Annex C
// table mirrored on Wikipedia). Internal match_index 1..16 maps to FIFA
// matches 73..88 in order. The 8 Annex-C R32 matches pair a group winner
// with a "best-3rd-vs-{winner}" slot; the lookup that fills those slots is
// in lib/annex-c.ts. The R16/QF feeders are NOT adjacent-pair — they follow
// FIFA's real tree, so they are listed explicitly. If FIFA publishes errata
// before opening night, this file is the single place to update it.

export type SlotLabel = string;

// The 8 group winners that face a 3rd-placed team in the R32 (FIFA matches
// 74,77,79,80,81,82,85,87). Each has a "best-3rd-vs-{group}" R32 slot whose
// occupant is decided by Annex C. Winners of C,F,H,J are in fixed matches.
export const ANNEX_C_WINNER_GROUPS = [
  "A", "B", "D", "E", "G", "I", "K", "L",
] as const;

export type KnockoutMatch = {
  // Stable internal id (NOT the api-sports fixture id, which doesn't
  // exist for knockouts yet)
  id: string;
  round_id: "r32" | "r16" | "qf" | "sf" | "third_place" | "final";
  match_index: number;
  home_slot_label: SlotLabel;
  away_slot_label: SlotLabel;
};

// ----------------------------------------------------------------
// R32 — 16 matches (FIFA master-schedule 73–88, in order).
// 8 fixed matches + 8 Annex-C matches (winner vs best-3rd-vs-{winner}).
// ----------------------------------------------------------------
export const R32_MATCHES: KnockoutMatch[] = [
  { id: "r32-1",  round_id: "r32", match_index: 1,  home_slot_label: "runner-up-A", away_slot_label: "runner-up-B" },   // 73
  { id: "r32-2",  round_id: "r32", match_index: 2,  home_slot_label: "winner-E",    away_slot_label: "best-3rd-vs-E" }, // 74
  { id: "r32-3",  round_id: "r32", match_index: 3,  home_slot_label: "winner-F",    away_slot_label: "runner-up-C" },   // 75
  { id: "r32-4",  round_id: "r32", match_index: 4,  home_slot_label: "winner-C",    away_slot_label: "runner-up-F" },   // 76
  { id: "r32-5",  round_id: "r32", match_index: 5,  home_slot_label: "winner-I",    away_slot_label: "best-3rd-vs-I" }, // 77
  { id: "r32-6",  round_id: "r32", match_index: 6,  home_slot_label: "runner-up-E", away_slot_label: "runner-up-I" },   // 78
  { id: "r32-7",  round_id: "r32", match_index: 7,  home_slot_label: "winner-A",    away_slot_label: "best-3rd-vs-A" }, // 79
  { id: "r32-8",  round_id: "r32", match_index: 8,  home_slot_label: "winner-L",    away_slot_label: "best-3rd-vs-L" }, // 80
  { id: "r32-9",  round_id: "r32", match_index: 9,  home_slot_label: "winner-D",    away_slot_label: "best-3rd-vs-D" }, // 81
  { id: "r32-10", round_id: "r32", match_index: 10, home_slot_label: "winner-G",    away_slot_label: "best-3rd-vs-G" }, // 82
  { id: "r32-11", round_id: "r32", match_index: 11, home_slot_label: "runner-up-K", away_slot_label: "runner-up-L" },   // 83
  { id: "r32-12", round_id: "r32", match_index: 12, home_slot_label: "winner-H",    away_slot_label: "runner-up-J" },   // 84
  { id: "r32-13", round_id: "r32", match_index: 13, home_slot_label: "winner-B",    away_slot_label: "best-3rd-vs-B" }, // 85
  { id: "r32-14", round_id: "r32", match_index: 14, home_slot_label: "winner-J",    away_slot_label: "runner-up-H" },   // 86
  { id: "r32-15", round_id: "r32", match_index: 15, home_slot_label: "winner-K",    away_slot_label: "best-3rd-vs-K" }, // 87
  { id: "r32-16", round_id: "r32", match_index: 16, home_slot_label: "runner-up-D", away_slot_label: "runner-up-G" },   // 88
];

// ----------------------------------------------------------------
// R16 — 8 matches (FIFA 89–96). Feeders follow FIFA's real tree
// (NOT adjacent R32 pairs). Each references "r32-match-{idx}-winner",
// where idx is the internal index of the producing FIFA match above.
// ----------------------------------------------------------------
export const R16_MATCHES: KnockoutMatch[] = [
  { id: "r16-1", round_id: "r16", match_index: 1, home_slot_label: "r32-match-2-winner",  away_slot_label: "r32-match-5-winner" },  // 89: W74 v W77
  { id: "r16-2", round_id: "r16", match_index: 2, home_slot_label: "r32-match-1-winner",  away_slot_label: "r32-match-3-winner" },  // 90: W73 v W75
  { id: "r16-3", round_id: "r16", match_index: 3, home_slot_label: "r32-match-4-winner",  away_slot_label: "r32-match-6-winner" },  // 91: W76 v W78
  { id: "r16-4", round_id: "r16", match_index: 4, home_slot_label: "r32-match-7-winner",  away_slot_label: "r32-match-8-winner" },  // 92: W79 v W80
  { id: "r16-5", round_id: "r16", match_index: 5, home_slot_label: "r32-match-11-winner", away_slot_label: "r32-match-12-winner" }, // 93: W83 v W84
  { id: "r16-6", round_id: "r16", match_index: 6, home_slot_label: "r32-match-9-winner",  away_slot_label: "r32-match-10-winner" }, // 94: W81 v W82
  { id: "r16-7", round_id: "r16", match_index: 7, home_slot_label: "r32-match-14-winner", away_slot_label: "r32-match-16-winner" }, // 95: W86 v W88
  { id: "r16-8", round_id: "r16", match_index: 8, home_slot_label: "r32-match-13-winner", away_slot_label: "r32-match-15-winner" }, // 96: W85 v W87
];

// ----------------------------------------------------------------
// QF — 4 matches (FIFA 97–100). Feeders per FIFA's real tree.
// ----------------------------------------------------------------
export const QF_MATCHES: KnockoutMatch[] = [
  { id: "qf-1", round_id: "qf", match_index: 1, home_slot_label: "r16-match-1-winner", away_slot_label: "r16-match-2-winner" }, // 97:  W89 v W90
  { id: "qf-2", round_id: "qf", match_index: 2, home_slot_label: "r16-match-5-winner", away_slot_label: "r16-match-6-winner" }, // 98:  W93 v W94
  { id: "qf-3", round_id: "qf", match_index: 3, home_slot_label: "r16-match-3-winner", away_slot_label: "r16-match-4-winner" }, // 99:  W91 v W92
  { id: "qf-4", round_id: "qf", match_index: 4, home_slot_label: "r16-match-7-winner", away_slot_label: "r16-match-8-winner" }, // 100: W95 v W96
];

// ----------------------------------------------------------------
// SF — 2 matches.
// ----------------------------------------------------------------
export const SF_MATCHES: KnockoutMatch[] = [
  {
    id: "sf-1",
    round_id: "sf",
    match_index: 1,
    home_slot_label: "qf-match-1-winner",
    away_slot_label: "qf-match-2-winner",
  },
  {
    id: "sf-2",
    round_id: "sf",
    match_index: 2,
    home_slot_label: "qf-match-3-winner",
    away_slot_label: "qf-match-4-winner",
  },
];

// ----------------------------------------------------------------
// Third-place + Final
// ----------------------------------------------------------------
export const THIRD_PLACE_MATCH: KnockoutMatch = {
  id: "third-place",
  round_id: "third_place",
  match_index: 1,
  home_slot_label: "sf-match-1-loser",
  away_slot_label: "sf-match-2-loser",
};

export const FINAL_MATCH: KnockoutMatch = {
  id: "final",
  round_id: "final",
  match_index: 1,
  home_slot_label: "sf-match-1-winner",
  away_slot_label: "sf-match-2-winner",
};

export const ALL_KNOCKOUT_MATCHES: KnockoutMatch[] = [
  ...R32_MATCHES,
  ...R16_MATCHES,
  ...QF_MATCHES,
  ...SF_MATCHES,
  THIRD_PLACE_MATCH,
  FINAL_MATCH,
];

// ----------------------------------------------------------------
// All knockout slot labels needed in bracket_slots
// ----------------------------------------------------------------
export const KNOCKOUT_SLOT_LABELS: { round_id: string; slot_label: string }[] = [
  // R32 slots — what feeds INTO each R32 match
  ...["A","B","C","D","E","F","G","H","I","J","K","L"].map(g => ({
    round_id: "r32", slot_label: `winner-${g}` as const,
  })),
  ...["A","B","C","D","E","F","G","H","I","J","K","L"].map(g => ({
    round_id: "r32", slot_label: `runner-up-${g}` as const,
  })),
  ...ANNEX_C_WINNER_GROUPS.map(g => ({
    round_id: "r32", slot_label: `best-3rd-vs-${g}`,
  })),
  // R16 slots
  ...Array.from({ length: 16 }, (_, i) => ({
    round_id: "r16", slot_label: `r32-match-${i + 1}-winner`,
  })),
  // QF slots
  ...Array.from({ length: 8 }, (_, i) => ({
    round_id: "qf", slot_label: `r16-match-${i + 1}-winner`,
  })),
  // SF slots
  ...Array.from({ length: 4 }, (_, i) => ({
    round_id: "sf", slot_label: `qf-match-${i + 1}-winner`,
  })),
  // Final + 3rd-place slots
  { round_id: "final", slot_label: "sf-match-1-winner" },
  { round_id: "final", slot_label: "sf-match-2-winner" },
  { round_id: "third_place", slot_label: "sf-match-1-loser" },
  { round_id: "third_place", slot_label: "sf-match-2-loser" },
];
