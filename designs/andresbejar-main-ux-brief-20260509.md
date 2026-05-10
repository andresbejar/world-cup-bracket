---
name: world-cup-bracket-ux-brief
description: UX brief for designer — group rankings, group results, and knockout bracket screens
type: design-brief
---

# UX Brief — World Cup Bracket (3 screens)

For: designer creating mocks
From: Andres
Date: 2026-05-09
Project: World Cup Bracket — family-and-friends prediction pool for FIFA 2026
Source design doc: `andresbejar-main-design-20260509-161531.md` (read first for product context)

## Product north star (what to keep in mind on every screen)

- **The soul of the product is "predicted vs. real."** Every screen where match data appears should show the user's locked-in prediction next to reality, color-coded green / yellow / red. Reality should never erase what the user committed to.
  - Green = exact score correct (3 pts)
  - Yellow = outcome correct, score wrong (1 pt)
  - Red = outcome wrong (0 pts)
- **Audience: family and friends, ~5–50 people, varying soccer literacy.** Casual-feeling, not gambler-feeling. Whisper-loud points labels, no badges, no glow effects.
- **Desktop-first at 1440px.** Mobile (390px) is a polish-pass, single-column collapse — designer should sketch the desktop layout primarily, with a note for the mobile reflow.
- **Stack visual language:** shadcn/ui + Tailwind. Tasteful, restrained, neutral palette + accent. The World Cup itself supplies the drama.
- **States to design for every screen:**
  1. **Pre-tournament** (before June 11) — predictions only, no real data
  2. **Round in progress / locked** — predictions frozen, some real results in
  3. **Round finished** — full predicted-vs-real reconciliation
  4. **Empty / partial input** — user hasn't predicted yet
  5. **Locked-out** (past deadline, user didn't predict) — show 0-pt state cleanly

## Common scoring legend (reusable component)

A small inline legend the designer should treat as a shared atom:

```
█ +3 exact   █ +1 outcome   █ 0
green        yellow         red
```

Show this once per page near the top — not on every match card. The colors should do the work.

---

## Screen 1: Group Rankings

### What it is
A predicted standings table for each of the 12 groups (A–L), 4 teams each. Same view should also be able to render *real* standings once group stage starts — toggle or side-by-side.

### User goals
- "What does my predicted group table look like, given the scores I entered?"
- "How is the real group shaking out vs. what I predicted?"
- "Who's tied? What tiebreaker is in play?"

### Data per row
- Position (1–4, with cut-line: top 2 advance, 3rd-place ranked across all groups for the 8 R32 slots)
- Team flag + name + 3-letter code
- **GP** Games played (0–3)
- **W / D / L**
- **GF** Goals for
- **GA** Goals against
- **GD** Goal difference (signed, +/-)
- **Pts** Total points (3 win / 1 draw)

### FIFA tiebreaker order (must be visible, not buried)
The standings sort by: Pts → GD → GF → H2H Pts → H2H GD → (alphabetical fallback, flagged in UI).

When a tiebreaker beyond Pts decides a position, surface it. Suggested treatment: a small chip or footnote on the tied rows ("tied on Pts; GD breaks it") so users understand why team X is above team Y. The alphabetical fallback case must visually nudge the user: *"You have a tie that FIFA would resolve with disciplinary record / drawing of lots — adjust your predictions to break it."*

### Layout decisions for the designer
- **All 12 groups on one page, or one group at a time?** Recommend a 3×4 or 4×3 grid of compact group tables on desktop, single-column on mobile. Each table is small (4 rows). Lets the user scan their whole prediction at once. Open to alternatives.
- **Predicted vs. real toggle.** Once group stage starts, user wants both views. Three options for the designer to consider:
  1. Page-level toggle (Predicted / Real / Diff)
  2. Per-group inline switch
  3. Two stacked tables side-by-side (predicted on left, real on right) — most direct "reality check" but takes width
- **Highlight the cut-line.** Top 2 advance → bold separator after row 2. 3rd place → distinct treatment (these compete across all 12 groups for 8 R32 slots; surface a small "3rd-place pool" affordance that links to Screen 3's third-place dropdowns).
- **Status of the user's predictions.** Show whether each group's predictions are: Complete / Partial / Empty.

### Edge cases
- Empty state (no predictions): show 0-0-0 rows or a "Predict matchday 1 to populate" CTA.
- Mid-tournament: real GP can be 1, 2, or 3 — the column must accommodate.
- Tournament-over state: lock indicator + final standings.

---

## Screen 2: Group Stage Results

### What it is
The 72 group-stage matches with predicted scores and real scores side-by-side. The user enters predictions here and watches reality land alongside them as games finish.

### User goals
- "Enter my predictions for matchday 1 / 2 / 3."
- "How did my predictions stack up against what actually happened?"
- "What's still editable? What's locked?"

### Two distinct modes — designer should treat as one screen with two states
1. **Input mode** (round still editable): score inputs visible, Save state, deadline countdown.
2. **Reconciliation mode** (round locked or finished): predictions frozen, real scores rendered alongside, color-coding applied, points awarded shown.

### Data per match row
- Date / kickoff time (user's local TZ, with UTC tooltip)
- Home team flag + name (+ code)
- Predicted score (input or static)
- Real score (empty until kickoff; live-updates after final whistle)
- Away team flag + name (+ code)
- Match status: Scheduled / In progress / Finished
- Points awarded (only after finished; "+3", "+1", or "0")
- Deadline countdown until round locks (only in input mode)

### Layout — table or cards? Designer's call, with a recommendation
**Recommended:** a table grouped by matchday (3 sections: Matchday 1, 2, 3), with each group's 6 matches shown in a compact row format. Reasons:
- 72 matches is too many for cards on desktop without scroll fatigue
- Tabular form makes "did I predict this?" scannable
- Predicted vs. real reads naturally as adjacent columns

**Alternative to consider:** matchday tabs with cards inside, if the designer feels a table is too cold for the casual audience.

### Critical UX details

- **Score input pattern.** Two number inputs flanking a fixed "—" or ":". Mobile-friendly (numeric keypad). Tab order should flow home → away → next match's home (let users rip through 6 matches per group fast).
- **Predicted vs. real visual treatment.**
  - Before kickoff: only predicted score is rendered, label it lightly ("Your pick").
  - After kickoff, before final whistle: predicted score + a "Live" or "In progress" pill, no real score yet (premise: scoring runs at final whistle, not live).
  - After final whistle: predicted score + real score side-by-side, full color treatment, points chip.
- **Color treatment.** The cell background or a left-border accent should carry the green/yellow/red — *not* the score text itself (preserves legibility). Whatever the designer picks, the same token applies to Screen 3.
- **Deadline / lock affordance.** Each matchday section shows: "Locks in 3d 4h" → "Locks in 4h" → "Locked." Locked rows visually disable inputs. Round-lock is per-matchday (matchday 1 locks before matchday 1 starts, matchday 2 has its own deadline, etc.).
- **Save state.** Auto-save on blur or debounce; designer should specify a "Saved" / "Saving…" / "Couldn't save" indicator near the matchday header. Don't make users hunt for a Save button.
- **Empty / unpredicted match in reconciliation mode.** If the user didn't predict a match before lock, show a "—" with "0 pts (no pick)" so the cost is visible without scolding.

### Edge cases
- A match is rescheduled after lock → predicted score still attached, new kickoff time shown.
- Real score arrives but is wrong (manually corrected later) → designer doesn't need to handle, but the UI should re-render cleanly when scores change.

---

## Screen 3: Knockout Stage Brackets

### What it is
The traditional 32-team single-elimination bracket: R32 → R16 → QF → SF → Final, plus the 3rd-place playoff. The user predicts winners (and scores) per match, and watches reality cascade through the bracket as games finish.

### The hard design problem (call this out for the designer)

**A 32-team bracket is too big to show entirely on one 1440px screen with full match detail.** Designer needs to solve the tension between:
- **Overview:** see the whole tournament shape, who you have advancing where, the visual drama of the bracket.
- **Detail:** enter/edit predicted scores, view real scores, see points earned, see the team identity behind each slot.

### Recommended pattern (open to alternatives)

**Two-pane layout on desktop, 60/40 split:**
- **Left pane (60%): zoomable bracket diagram.** All 31 knockout matches visible at once at default zoom, simplified — each match card shows just team flags + team codes + predicted-vs-real score chip. Selected match is highlighted (border accent, slight scale).
- **Right pane (40%): match detail panel.** When a match is selected (click), this pane fills with: full team names, kickoff time, score input (or static predicted score if locked), real score, points earned, deadline countdown. This is where the actual prediction work happens.

**Why this works:**
- The user always sees the whole tournament — predictions don't get hidden in tabs.
- The right pane gives a focused, generous space for the work — score inputs aren't cramped into 80px-wide cards.
- Click-to-select is natural; keyboard nav (arrow keys between adjacent matches) is a stretch goal.
- Mobile reflow: bracket goes behind a tab/modal, match detail fills the screen by default with a "View bracket" button.

**Alternative patterns the designer should consider:**
1. **Round-by-round tabs.** R32 / R16 / QF / SF / Final tabs, each shows that round's matches as cards. Loses the bracket-shape drama, gains simplicity.
2. **Vertical scrolling bracket.** Top-to-bottom: R32 → Final. Mobile-friendly, but loses the iconic "tree" silhouette that makes brackets feel like brackets.
3. **Horizontal scrolling bracket with mini-map.** Like a strategy game minimap — a small overview in a corner, main area shows zoomed-in section.

I lean toward the recommended two-pane, but I want the designer to push back if they see something better.

### Bracket card (the small one in the diagram view)

Per-match card content at default zoom:
- Two rows, one per team
- Each row: flag + team code + predicted score + real score (when available)
- Color accent on the row of the predicted winner
- Slot label fallback: when teams haven't been determined yet (e.g. "Winner Group A", "3rd-place Slot 5"), show the slot label in muted italics
- Status pill if relevant (Scheduled / Live / Finished)

The designer should aim to make this card readable at ~120×80px and still tell the predicted-vs-real story.

### Match detail panel (the big one in the right pane)

When a match is selected, the panel shows:
- Round label (R32 / R16 / etc.) + match number
- Kickoff date/time, venue (if in seed data), deadline countdown
- Team A: flag, full name, predicted score input, real score
- Team B: flag, full name, predicted score input, real score
- **Knockout outcome picker:** a winner selector (premise: knockouts must pick a winning team — no draws in outcome). Two pill-radios under the score inputs, must be filled even if predicted score is tied.
- **Penalty winner inline:** if predicted score is tied (e.g. 2-2), show a `Penalty winner` selector below the score row (per design doc).
- Points earned (after finished): chip with "+3" / "+1" / "0" and the legend mini-explanation.
- Locked indicator if past deadline.
- Cascade hint: if changing this prediction will alter downstream slot identities, show a quiet line: *"Changes flow to QF Match 3 →"*. Don't shove a modal in the user's face.

### Reality cascade visualization (subtle, important)

When a real result lands and the bracket fills with actual teams (e.g. Group A's real winner is now in R32 Match 1):
- The slot label ("Winner Group A") fades out, real team flag fades in.
- If user predicted that team, no shake — they were right, just paint the row green.
- If user predicted a different team, the row should *gracefully* show the disagreement — recommended: predicted team in muted strikethrough above the real team, rather than animating a swap. Calm, factual.

### Third-place slot picks (R32 only)

The 8 R32 slots that take third-place teams need the dropdown UI from the design doc (see "UI Notes — Third-Place Slot Picks" in the source). The designer should:
- Place the dropdowns inline on the relevant 8 R32 cards.
- Keep the `+1 pt` affordance whisper-loud (small monospace, ~11px, neutral grey).
- Post-group-stage, swap the `+1 pt` label for the green/red color treatment used elsewhere.
- Disabled state: explanatory line below the cluster — "Finish your group-stage predictions to unlock these picks."

### Edge cases
- All 4 paths blank (user hasn't predicted) → bracket shows entirely slot labels. Don't make this look broken.
- User predicted, then group stage finishes and reality differs → see "reality cascade visualization" above.
- A predicted team got eliminated in groups → that team can't appear in their R16 prediction; visually mark stale predictions in upstream rounds (designer's call on treatment, but it must be obvious so users go fix them).
- Final + 3rd-place playoff → two terminal matches, designer should give them a slightly elevated visual treatment (slightly larger cards, accent).

---

## Cross-screen consistency

- **Color tokens** for predicted-vs-real (green / yellow / red) must be identical across all three screens. Define them as design tokens.
- **Match card** atom is reused on Screen 2 (table row), Screen 3 (bracket diagram), and the right-pane detail. Same data shape, different densities.
- **Lock / deadline countdown** treatment is the same component everywhere it appears.
- **Points chip** ("+3" / "+1" / "0") is one atom, used on every screen post-match.
- **Team representation** is consistent: flag + 3-letter code in dense views, flag + full name in detail views.

## Deliverables I'd love from the designer

1. **High-fidelity desktop mocks (1440px)** for all three screens, in each of the 5 states listed at the top.
2. **Mobile sketches (390px)** — looser, just to confirm the reflow strategy works.
3. **Component library**: match card (3 densities), points chip, scoring legend, deadline countdown, predicted-vs-real row, group table.
4. **Color tokens + type scale** spec.
5. **A short Loom or doc** explaining any non-obvious choices, especially on Screen 3 (bracket overview vs. detail tradeoff).

## Open design questions for the designer

1. Screen 1: is the "all 12 groups on one page" grid actually scannable, or does it overwhelm? Show me both.
2. Screen 2: table vs. cards — which feels more right for casual family users? Show me your pick + a short rationale.
3. Screen 3: do you agree with the two-pane bracket+detail pattern, or do you have a better answer to the overview-vs-detail tension?
4. How do we visualize the cascade reactivity (group prediction changes → R32 teams shuffle) without making it feel chaotic?
5. Where does the leaderboard live in this app's nav — sidebar, top tab, separate page? (Out of scope for this brief, but it affects the shell.)

---

*If anything in the source design doc contradicts this brief, the design doc wins — flag it and we'll reconcile.*
