# PRD: Annex C R32 Bracket Generation

**Owner:** Andres
**Status:** Draft
**Last updated:** 2026-06-05 (v2 — adds explicit user selection flow)

## TL;DR

The World Cup 2026 Round of 32 introduces a new constraint: 8 of 12 third-placed teams advance and are matched against group winners via FIFA's pre-defined Annex C lookup table. The current bracket predictor generates R32 matchups without using this table, which produces FIFA-noncompliant brackets (e.g. a group winner facing a 3rd-placed team from its own group). This PRD specifies the lookup data, the user-facing selection flow, the bracket-generation algorithm, and the test invariants needed to fix it.

Deliverables:
1. A "Best third-placed teams" selection screen where the user explicitly picks the 8 teams that advance.
2. A `generateR32(groupResults)` function that, given that selection plus group standings, returns a FIFA-compliant set of 16 R32 fixtures.
3. A read-only R32 view with no drag-to-slot affordances.

---

## Problem

The 2026 format breaks the previous "winner-of-X plays runner-up-of-Y" symmetry by inserting an extra knockout round. The R32 has two kinds of matches:

1. **Fixed matches** (8 of 16): predetermined by group letter, e.g. *Match 73: Runner-up A vs Runner-up B*. These don't need any logic — they're hardcoded in the FIFA schedule and structurally cannot produce a same-group rematch.

2. **Dynamic matches** (8 of 16): each pairs a specific group winner with the 3rd-placed team of *some* group, and which group depends on **which 8 of the 12 groups produced a qualifying 3rd-placed team**. There are C(12,8) = 495 possible combinations, and FIFA pre-computed the assignment for every one of them in Annex C of the Competition Regulations.

The current predictor either picks 3rd-place opponents arbitrarily or uses a naive heuristic. Both can violate the **no same-group rematch** constraint, e.g.:

- Group A produces winner Mexico and qualifying 3rd-placed Korea.
- Predictor pairs 1A (Mexico) vs 3A (Korea) in the R32.
- This is invalid — Annex C is specifically designed to prevent this.

## Goal

Make the R32 bracket generator FIFA-compliant for any group-stage outcome the user predicts.

**Success criteria:**
- For all 495 possible qualifying combinations, the generated R32 contains zero same-group matchups.
- The generated fixtures match the official Annex C assignment for each combination.
- Lookup is O(1) at runtime (in-memory map, no I/O).

## Non-goals

- No changes to group-stage prediction UI or scoring.
- No attempt to auto-derive which 8 third-placed teams qualify. FIFA's full tiebreaker chain extends past points/GD/GS into team conduct (yellow/red card disciplinary score) and current FIFA Men's Ranking — neither of which a bracket predictor can simulate. We put the choice in the user's hands instead.
- No changes to R16+ bracket structure — once R32 is correct, downstream rounds derive from R32 winners via the existing fixed bracket.
- No UI to inspect the full 495-row Annex C table. A small per-match "why this matchup?" affordance is optional (see User input flow).

---

## Background: how Annex C works

The 16 R32 matches are numbered 73–88 in FIFA's master schedule. They split as follows:

### Fixed matches (no Annex C needed)

| Match | Fixture |
|------|---------|
| 73 | Runner-up A vs Runner-up B |
| 75 | Winner F vs Runner-up C |
| 76 | Winner C vs Runner-up F |
| 78 | Runner-up E vs Runner-up I |
| 83 | Runner-up K vs Runner-up L |
| 84 | Winner H vs Runner-up J |
| 86 | Winner J vs Runner-up H |
| 88 | Runner-up D vs Runner-up G |

Note the interlocked pairs (C/F, H/J) — these are designed so that even though they involve a group winner vs a runner-up, they never produce a same-group meeting.

### Annex C matches (lookup required)

These 8 matches each pair a specific group winner with the 3rd-placed team of a group drawn from a constrained pool of 5:

| Match | Winner | 3rd-placed team from one of |
|------|--------|---------------------------|
| 74 | Winner E | A, B, C, D, F |
| 77 | Winner I | C, D, F, G, H |
| 79 | Winner A | C, E, F, H, I |
| 80 | Winner L | E, H, I, J, K |
| 81 | Winner D | B, E, F, I, J |
| 82 | Winner G | A, E, H, I, J |
| 85 | Winner B | E, F, G, I, J |
| 87 | Winner K | D, E, I, J, L |

The 8 group winners on this list (A, B, D, E, G, I, K, L) are the **winner slots** that need Annex C lookup. Note that winners of C, F, H, J are *not* on this list — they're in the fixed matches above.

For each of the 495 possible combinations of qualifying 3rd-placed groups, Annex C specifies exactly which group's 3rd-placed team fills each of these 8 slots, subject to two constraints:

1. **No same-group meeting:** if Group X qualifies a 3rd-placed team, that team never plays 1X.
2. **Pool constraint:** each match's 3rd-placed team must come from the constrained pool above.

---

## User input flow

We capture group-stage scores, but FIFA's tiebreaker chain extends beyond points/GD/GS into team conduct (yellow/red card disciplinary score) and the FIFA Men's Ranking — neither of which the predictor can simulate. The honest fix is to put the decision in the user's hands rather than fake a tiebreaker we can't actually run.

### Screen: "Best third-placed teams"

After all group-stage matches are predicted, present a selection screen listing all 12 third-placed teams.

**Sort order:** Apply points → GD → GS using the user's predicted scores, descending. This is display-only — it surfaces FIFA's first three tiebreakers as visual context so the user knows what's roughly leading. The remaining tiebreakers (conduct, FIFA ranking) are explicitly the user's call.

**Each row shows:**
- Group letter prefix (e.g. "3A")
- Team name
- Points and goal difference for the user's predicted scores
- Tappable checkbox state on the left

Goals scored is omissible at the row level — it's a third-tier tiebreaker and adds clutter. Surface it in a per-row expand if needed, not in the default density.

**Default selection:** none. Render all 12 rows in the unselected state. We do not pre-select the top 8 by computed tiebreakers, because a pre-selection implies the system is making the call. The user makes the call.

**"Below the cutoff" divider:** render a thin separator between rows 8 and 9 of the *sort order*, anchored to the deterministic ranking. It does not move as the user toggles. The label is a visual hint about where the score-based tiebreakers would land — not a system recommendation.

**Counter:** persistent "N of 8 selected" indicator. The confirm button is enabled only at exactly N = 8 — disabled at 7, disabled at 9. No auto-deselect of the oldest pick; the user explicitly deselects to fall below 8 before selecting another.

**No ranking input:** the user selects a set, not an ordering. No drag-to-reorder, no 1-through-8 priority affordance, no per-row rank number. Annex C only consumes the set.

### Downstream contract

The screen produces:

```typescript
interface ThirdPlaceSelection {
  selectedGroups: Group[];  // length 8, user-selected set of group letters
}
```

`selectedGroups` is the sole input to `lookupAnnexC` from this screen, and feeds the `qualifyingThirdPlacedGroups` field of `GroupResults` (see Data model below).

### Validation

- **UI gate:** confirm button disabled unless `selectedGroups.length === 8`.
- **Backend assertion:** `generateR32` throws if `qualifyingThirdPlacedGroups.length !== 8` or contains duplicates. This is a programmer error (UI should have prevented it), not a user error — surface it as a crash report, not a friendly message.
- On confirm, run `generateR32` and route to the R32 view.

### R32 view: read-only at the slot level

Every R32 match shows real team names. **There is no drag-to-slot, no swap, no "force this matchup" affordance anywhere in this view.** The only way to change R32 fixtures is to go back and change either the group standings or the third-placed selection.

This is the single most important UI rule in the spec. If a user can drag a team into a specific R32 slot, the original bug returns — somebody will eventually drag a same-group team in.

### Optional: "Why this matchup?" affordance

Each of the 8 annex-C-driven R32 matches can carry a small "ⓘ" icon that reveals the constraint pool, e.g.:

> Winner of Group A faces the 3rd-placed team from one of Groups C, E, F, H, or I — chosen by FIFA's Annex C lookup based on which 4 groups didn't qualify a 3rd-placed team.

Default to off; surface in a tooltip or details disclosure. Educational, not load-bearing — skip in v1 if it adds scope.

---

## Data file: `annex_c.json`

I've already parsed the 495 rows from FIFA's official table into `annex_c.json`. Schema:

```json
{
  "winnerSlots": ["1A", "1B", "1D", "1E", "1G", "1I", "1K", "1L"],
  "lookup": {
    "ABCDEFGH": {
      "1A": "H",
      "1B": "G",
      "1D": "B",
      "1E": "C",
      "1G": "A",
      "1I": "F",
      "1K": "D",
      "1L": "E"
    },
    "ABCDEFGI": { "1A": "C", "1B": "G", "1D": "B", ... },
    ...
  },
  "rows": [
    { "row": 1, "qualifyingGroups": ["E","F","G","H","I","J","K","L"], "matchups": {...} },
    ...
  ]
}
```

### Key format

The lookup key is the 8 qualifying group letters concatenated in **alphabetical order**. Example: if Groups A, B, C, D, E, F, G, H qualify a 3rd-placed team, the key is `"ABCDEFGH"`. Always sort before lookup — this is the single most likely source of bugs.

### Value semantics

Each value is a `{winnerSlot: groupLetter}` map. The key is a winner slot (e.g. `"1A"`), and the value is the **group letter** of the 3rd-placed team facing that winner (e.g. `"H"` means 1A plays 3H).

The `rows` array is included for human inspection / debugging — production code should use `lookup`.

### Invariants the file guarantees

Validated during parse (`parse_annex_c.py`):

- Exactly 495 unique lookup keys.
- For every row, every matchup target is one of the qualifying groups (you can't pair a winner with a 3rd-placed team from a group that didn't qualify a 3rd-placed team).
- For every row, the 8 matchup targets are exactly the 8 qualifying groups (bijection — each qualifying 3rd-placed team plays exactly once).
- For every row, no `1X` is paired with `3X`.

---

## Implementation plan

### Module structure

```
src/
  brackets/
    annexC.ts            // loads JSON, exports lookup function
    annexC.test.ts       // unit tests (see below)
    fixedR32Matches.ts   // the 8 hardcoded fixtures
    generateR32.ts       // the main bracket-generation function
    generateR32.test.ts  // integration tests
data/
  annex_c.json
```

### Core function signatures

```typescript
type Group = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';
type WinnerSlot = '1A' | '1B' | '1D' | '1E' | '1G' | '1I' | '1K' | '1L';

// Returns { '1A': 'H', '1B': 'G', ... } for the given qualifying set.
// Throws if qualifyingGroups doesn't contain exactly 8 distinct groups.
function lookupAnnexC(qualifyingGroups: Group[]): Record<WinnerSlot, Group>;

interface R32Match {
  matchNumber: number;        // 73..88
  home: TeamRef;
  away: TeamRef;
}

interface GroupResults {
  // For each group, the team that finished 1st, 2nd, 3rd, 4th.
  // Derived from the user's predicted scores via standard standings logic.
  groups: Record<Group, [Team, Team, Team, Team]>;
  // User selection from the "Best third-placed teams" screen (length 8, no duplicates).
  qualifyingThirdPlacedGroups: Group[];
}

function generateR32(results: GroupResults): R32Match[];  // length 16
```

### Algorithm for `generateR32`

```
1. Build the 8 fixed matches from fixedR32Matches.ts using `results.groups[X][0]`
   (winner) and `results.groups[X][1]` (runner-up) directly.

2. Take `results.qualifyingThirdPlacedGroups` (user selection from the "Best
   third-placed teams" screen — see User input flow), assert length 8 and
   no duplicates, sort alphabetically, and concatenate into the 8-char
   lookup key.

3. Call `lookupAnnexC(qualifyingThirdPlacedGroups)` to get the assignment map.

4. For each of the 8 annex-C-driven matches (74, 77, 79, 80, 81, 82, 85, 87):
   - Read the winner from `results.groups[winnerLetter][0]`.
   - Read the 3rd-placed team from `results.groups[assignedGroup][2]`.
   - Emit the match.

5. Sort the resulting 16 matches by matchNumber and return.
```

### Loading and indexing the lookup at startup

```typescript
import annexCData from '../../data/annex_c.json';

const LOOKUP: Map<string, Record<WinnerSlot, Group>> = new Map(
  Object.entries(annexCData.lookup),
);

export function lookupAnnexC(qualifyingGroups: Group[]): Record<WinnerSlot, Group> {
  if (qualifyingGroups.length !== 8) {
    throw new Error(`Expected 8 qualifying groups, got ${qualifyingGroups.length}`);
  }
  const key = [...qualifyingGroups].sort().join('');
  const result = LOOKUP.get(key);
  if (!result) {
    throw new Error(`No Annex C entry for key "${key}"`);
  }
  return result;
}
```

---

## Test cases (TDD)

Write these tests **first**, before touching the generation code. They double as the spec.

### Unit tests: `lookupAnnexC`

1. **Boundary: first 8 groups**
   Input: `['A','B','C','D','E','F','G','H']` → key `"ABCDEFGH"` → returns
   `{ '1A':'H', '1B':'G', '1D':'B', '1E':'C', '1G':'A', '1I':'F', '1K':'D', '1L':'E' }`.

2. **Boundary: last 8 groups**
   Input: `['E','F','G','H','I','J','K','L']` → key `"EFGHIJKL"` → returns
   `{ '1A':'E', '1B':'J', '1D':'I', '1E':'F', '1G':'H', '1I':'G', '1K':'L', '1L':'K' }`.

3. **Order-independence**
   `lookupAnnexC(['H','A','D','B','G','F','C','E'])` returns the same result as
   `lookupAnnexC(['A','B','C','D','E','F','G','H'])`.

4. **Wrong length throws**
   `lookupAnnexC(['A','B','C'])` throws.

5. **Duplicate groups throws** (or sort+lookup returns wrong key — pick a behavior and assert)
   `lookupAnnexC(['A','A','B','C','D','E','F','G'])` either throws or doesn't find the key.

### Invariant test: all 495 combinations

Iterate every entry in `annexCData.lookup`:

```typescript
for (const [key, matchups] of Object.entries(annexCData.lookup)) {
  for (const [slot, third] of Object.entries(matchups)) {
    const winnerGroup = slot[1];  // '1A' -> 'A'
    expect(winnerGroup).not.toBe(third);  // no same-group rematch, ever
  }
  // Every assigned 3rd-placed group must actually be qualifying
  const qualifyingSet = new Set(key.split(''));
  for (const third of Object.values(matchups)) {
    expect(qualifyingSet.has(third)).toBe(true);
  }
}
```

This is the single most important test. If it ever fails, the JSON file is corrupt.

### Integration test: the Mexico/Korea scenario

Construct a `GroupResults` where:
- Group A: 1st = Mexico, 2nd = Czech Republic, 3rd = Korea, 4th = South Africa
- Korea is in the qualifying 3rd-placed set.

Call `generateR32(results)`. Assert:
- The match containing Mexico does **not** contain Korea.
- Korea appears in exactly one R32 match.
- Mexico (1A) appears in match 79 (per fixed schedule).
- Korea (3A) appears in whichever match Annex C dictates given the full qualifying set.

### Integration test: full bracket realism check

Generate a plausible scenario (e.g. use FIFA rankings as a proxy for group results). Assert:
- Exactly 16 matches returned.
- Match numbers are 73, 74, ..., 88 with no gaps.
- Every team appears exactly once.
- For every match, the two teams come from different groups.

### UI tests: "Best third-placed teams" screen

1. **Initial state is empty.**
   Render screen with predicted standings. All 12 rows show unselected. Counter reads "0 of 8 selected". Confirm button disabled.

2. **Sort order is points → GD → GS, anchored.**
   Toggling selection state does not reorder rows. The "below the cutoff" divider stays between the 8th and 9th rows of the sort order regardless of selection.

3. **Confirm button gating.**
   Disabled at 0, 1, ..., 7 selected. Enabled at exactly 8. Disabled again at 9, 10, etc. (No auto-deselect on the 9th tap — user must explicitly deselect.)

4. **Selection survives back-navigation.**
   If the user confirms, then navigates back from the R32 view to change the selection, the previous 8 picks remain checked.

5. **Confirm wires to `generateR32`.**
   On confirm, the screen passes `selectedGroups` into `GroupResults.qualifyingThirdPlacedGroups` and routes to the R32 view with the generated bracket.

### UI tests: R32 view is read-only

1. **No drag handles.** Assert no draggable affordances on any team element. (`draggable="false"` or absence of drag listeners.)
2. **No slot-swap controls.** No "edit matchup" buttons, no team picker per slot.
3. **Round-trip integrity.** The 16 rendered matches match exactly what `generateR32` returned, by match number.

---

## Out of scope

- **Auto-deriving the qualifying 8 from predicted scores.** We deliberately don't do this — see User input flow rationale. The user selects.
- **R16+ bracket.** The downstream rounds (R16, QF, SF, F) follow a fixed bracket map keyed on R32 match numbers — already implemented and unaffected.
- **Full Annex C inspector UI.** A 495-row table viewer is overkill. A per-match "ⓘ why this matchup" tooltip (optional, see User input flow) is the most surfacing the user needs.
- **Caching.** 495 entries is tiny; no caching layer needed beyond the in-memory Map.

---

## Open questions

1. **Lookup-key format on the wire.** I've used the concatenated string `"ABCDEFGH"` as the map key inside `annex_c.json` for human readability. If preferred, swap for a bitmask integer (12 bits) — saves bytes but loses inspectability. Current choice favors debugability.

2. **Fail-loud vs fail-quiet on lookup miss.** Spec says throw. Alternative is to fall back to a deterministic but arbitrary assignment and log a warning. I'd push back on the alternative — silently emitting a wrong bracket is worse than crashing.

3. **Should the "below the cutoff" divider show or stay hidden until the user has predicted all group scores?** Currently the spec assumes group scores are complete by the time this screen appears (it's the next step after group prediction). If a user can reach this screen with incomplete predictions, the sort order becomes meaningless. Recommend: hard-block entry to this screen until every group match has a predicted score.

4. **Ship the "ⓘ why this matchup?" affordance in v1, or defer?** Educational value is real, but scope creep is real too. Suggest deferring to v1.1 unless implementation is trivial.

---

## Appendix: source of the lookup data

The 495 rows in `annex_c.json` were transcribed from the public Annex C table published in the FIFA 2026 Competition Regulations and mirrored on the [Wikipedia article](https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage) for the 2026 knockout stage. The parser (`parse_annex_c.py`) validates the table on every regeneration against four invariants (495 unique keys, each row's targets ⊆ qualifying groups, each row's targets is a bijection over qualifying groups, no 1X-vs-3X pairs). If FIFA publishes errata, re-run the parser; the JSON will fail validation if data drift occurs.
