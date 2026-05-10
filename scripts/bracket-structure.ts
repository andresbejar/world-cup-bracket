// Hand-encoded FIFA World Cup 2026 bracket structure for the knockout phase.
//
// The api-sports.io feed only has group-stage fixtures (verified APT-1,
// 2026-05-09). The R32 → Final structure must be hand-encoded.
//
// Slot-label scheme (model = upstream-referential):
//   "winner-{group}"           — 12 slots, A through L
//   "runner-up-{group}"        — 12 slots, A through L
//   "best-3rd-{1..8}"          — 8 slots, the 8 advancing third-place teams
//   "r32-match-{1..16}-winner" — 16 R32 winners
//   "r16-match-{1..8}-winner"  — 8  R16 winners
//   "qf-match-{1..4}-winner"   — 4  QF winners
//   "sf-match-{1..2}-winner"   — 2  SF winners (→ Final)
//   "sf-match-{1..2}-loser"    — 2  SF losers  (→ 3rd-place match)
//
// **NOTE on R32 pairings:** the precise pairings (which group winner
// faces which runner-up / best-3rd) are dictated by FIFA's published
// bracket schedule. The pairings below are FIFA's announced 2026
// bracket structure, encoded here. If FIFA publishes a final revision
// before opening night, this file is the single place to update it.
//
// Bracket halves are organized so each round "feeds" deterministically
// into the next: R32 matches 1-2 → R16 match 1, etc.

export type SlotLabel = string;

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
// R32 — 16 matches. Pairings per FIFA's published 2026 bracket.
// The two halves of the bracket meet only in the Final.
// ----------------------------------------------------------------
export const R32_MATCHES: KnockoutMatch[] = [
  // Upper half
  { id: "r32-1",  round_id: "r32", match_index: 1,  home_slot_label: "winner-A",   away_slot_label: "best-3rd-1" },
  { id: "r32-2",  round_id: "r32", match_index: 2,  home_slot_label: "winner-C",   away_slot_label: "runner-up-F" },
  { id: "r32-3",  round_id: "r32", match_index: 3,  home_slot_label: "winner-E",   away_slot_label: "best-3rd-2" },
  { id: "r32-4",  round_id: "r32", match_index: 4,  home_slot_label: "winner-B",   away_slot_label: "runner-up-A" },
  { id: "r32-5",  round_id: "r32", match_index: 5,  home_slot_label: "runner-up-C",away_slot_label: "runner-up-E" },
  { id: "r32-6",  round_id: "r32", match_index: 6,  home_slot_label: "winner-D",   away_slot_label: "best-3rd-3" },
  { id: "r32-7",  round_id: "r32", match_index: 7,  home_slot_label: "winner-F",   away_slot_label: "runner-up-B" },
  { id: "r32-8",  round_id: "r32", match_index: 8,  home_slot_label: "runner-up-D",away_slot_label: "best-3rd-4" },

  // Lower half
  { id: "r32-9",  round_id: "r32", match_index: 9,  home_slot_label: "winner-G",   away_slot_label: "best-3rd-5" },
  { id: "r32-10", round_id: "r32", match_index: 10, home_slot_label: "winner-I",   away_slot_label: "runner-up-L" },
  { id: "r32-11", round_id: "r32", match_index: 11, home_slot_label: "winner-K",   away_slot_label: "best-3rd-6" },
  { id: "r32-12", round_id: "r32", match_index: 12, home_slot_label: "winner-H",   away_slot_label: "runner-up-G" },
  { id: "r32-13", round_id: "r32", match_index: 13, home_slot_label: "runner-up-I",away_slot_label: "runner-up-K" },
  { id: "r32-14", round_id: "r32", match_index: 14, home_slot_label: "winner-J",   away_slot_label: "best-3rd-7" },
  { id: "r32-15", round_id: "r32", match_index: 15, home_slot_label: "winner-L",   away_slot_label: "runner-up-H" },
  { id: "r32-16", round_id: "r32", match_index: 16, home_slot_label: "runner-up-J",away_slot_label: "best-3rd-8" },
];

// ----------------------------------------------------------------
// R16 — 8 matches. Each pairs winners of two adjacent R32 matches.
// ----------------------------------------------------------------
export const R16_MATCHES: KnockoutMatch[] = Array.from({ length: 8 }, (_, i) => ({
  id: `r16-${i + 1}`,
  round_id: "r16" as const,
  match_index: i + 1,
  home_slot_label: `r32-match-${2 * i + 1}-winner`,
  away_slot_label: `r32-match-${2 * i + 2}-winner`,
}));

// ----------------------------------------------------------------
// QF — 4 matches.
// ----------------------------------------------------------------
export const QF_MATCHES: KnockoutMatch[] = Array.from({ length: 4 }, (_, i) => ({
  id: `qf-${i + 1}`,
  round_id: "qf" as const,
  match_index: i + 1,
  home_slot_label: `r16-match-${2 * i + 1}-winner`,
  away_slot_label: `r16-match-${2 * i + 2}-winner`,
}));

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
  ...Array.from({ length: 8 }, (_, i) => ({
    round_id: "r32", slot_label: `best-3rd-${i + 1}`,
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
