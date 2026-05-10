# Design System — World Cup Bracket

Created by `/design-consultation` on 2026-05-09.
Visual reference: `/tmp/worldcup-design-preview.html` (preview), and approved mockups in `~/.gstack/projects/world-cup-bracket/designs/`.

## Product Context

- **What this is:** A web app where ~5–50 friends and family compete to predict FIFA World Cup 2026 match results across all 104 games.
- **Who it's for:** Family members and friends. Mix of soccer-literate and casual. Hobby stakes, not money — bragging rights and a small prize.
- **Space / industry:** Sports prediction / bracket pools. Adjacent to The Athletic, ESPN bracket games, fantasy football tools.
- **Project type:** Web app. Desktop-first (1440px), with responsive mobile fallback. Includes prediction screens, a global leaderboard, and post-match predicted-vs-real reconciliation cards.
- **Stack:** Next.js (App Router) + Supabase + shadcn/ui + Tailwind, on Vercel.

## Aesthetic Direction

- **Direction:** **Editorial Sports Data.** Confidence of a thoughtful magazine applied to a stats app.
- **Decoration level:** **Minimal, with warmth.** No decorative blobs, no gradient backgrounds, no hero-section flourish. Type and warm color do all the work.
- **Mood:** Quiet, deliberate, a little serious. Like a well-made fantasy football tool that takes the league as seriously as the user does. Not toy-like. Not corporate-saas. The drama comes from the matches, not the chrome.
- **Reference points:** Letterboxd's craft. The Athletic's quiet confidence. Considered fantasy-football tools. NOT generic shadcn install. NOT ESPN-style data flood.

## Typography

Three free fonts. Editorial-leaning without being precious. All available via Google Fonts or Fontshare with no licensing cost.

- **Display / Wordmark / h1, h2:** **Instrument Serif** (regular, italic). Google Fonts.
  - Why: editorial energy, warm. Carries the wordmark and large headers. Italic adds character.
  - Constraint: never use for body, UI labels, or anything below 24px. Display only.
- **Body / buttons / h3-h6 / UI:** **General Sans** (400, 500, 600, 700). Fontshare.
  - Why: more character than Inter, polished enough to disappear when reading. Pairs well with shadcn defaults.
- **Mono / country codes / numbers / metadata:** **JetBrains Mono** (regular, bold). Google Fonts.
  - Why: gold standard for tabular monospace. Used for ALL numerals (scores, ranks, points), country 3-letter codes, deadline countdowns, the `+1 pt` affordance, and any data label. Bold for codes, regular for metadata.
  - **Always enable `tabular-nums`** for numerical columns (leaderboard, scores, point counts).

### Loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet">
```

For Next.js: use `next/font/google` for Instrument Serif and JetBrains Mono. Load General Sans via `<link>` in `app/layout.tsx` head (Fontshare not yet supported by `next/font`).

### Type scale (modular, 1.25 ratio)

| Token | Size | Use |
|---|---|---|
| xs | 12px | Captions, metadata, footnote |
| sm | 14px | Default UI text, table cells, labels |
| base | 16px | Body, paragraphs |
| lg | 20px | Subheadings, h3 |
| xl | 24px | h2 (sans variant) |
| 2xl | 32px | Section headers (Instrument Serif) |
| 3xl | 48px | Page titles (Instrument Serif) |
| 4xl | 64px | Hero / wordmark (Instrument Serif) |

### Forbidden

- **Inter, Roboto, Arial, Helvetica, Open Sans, Lato, Montserrat, Poppins** as primary. They're either default or overused. Geist Sans is also discouraged — it's becoming the new default.
- Mixing more than these three fonts. Three is the cap.

## Color

**Approach: restrained.** One warm amber accent, three muted semantic colors, warm-tinted neutrals. Country flags carry the visual variety.

### CSS variables

```css
:root {
  /* Surfaces & ink */
  --bg:           #161616;  /* warm deep charcoal, NOT pure black */
  --surface:      #1F1F1E;  /* card backgrounds, input cells */
  --surface-high: #28282A;  /* elevated state — focused inputs, modals */
  --border:       #2A2A28;  /* subtle warm-grey edges */

  --text-primary: #F5F2EB;  /* warm off-white, NOT pure white */
  --text-muted:   #8A8580;  /* tertiary info, countdowns */
  --text-dim:     #5C5853;  /* placeholders, disabled */

  /* Brand & accent */
  --accent:        #F59E0B;  /* warm amber — used SPARINGLY for active/focus */
  --accent-muted:  #92400E;  /* accent on dark surface */

  /* Semantic — predicted vs real scoring */
  --green-correct:  #15803D;  /* mossy. +3 pts (exact score) */
  --yellow-partial: #A16207;  /* warm gold. +1 pt (outcome only) */
  --red-wrong:      #B91C1C;  /* deep terracotta. 0 pts (wrong) */
}
```

### Rules

- **Country flags render in their full color.** They are the visual variety in the app — UI chrome stays out of the way.
- **The accent is amber, not blue.** Never default to Tailwind blue, indigo, violet, teal, or cyan as accent.
- **Semantic colors are muted, not neon.** `#15803D` not `#22C55E`. `#A16207` not `#EAB308`. `#B91C1C` not `#EF4444`. Match the editorial restraint.
- **Warm off-white ink (`#F5F2EB`) instead of pure white** is a deliberate choice. Don't "fix" it to `#FFFFFF`. The warmth is the system.
- **Dark mode is the default and primary.** No light mode in v1. If added later, design surfaces and ink fresh — don't auto-invert.

### Forbidden palette moves

- Purple-to-blue gradients
- Tailwind default blue (`#3B82F6`) or indigo (`#6366F1`) as primary or accent
- Pure white (`#FFFFFF`) as primary text on dark
- Pure black (`#000000`) as background
- Bright neon semantic colors

## Spacing

**Base unit: 4px. Density: comfortable.** The bracket should feel like there's room to think, not crammed.

| Token | Value | Use |
|---|---|---|
| 2xs | 4px | Hairline gaps between adjacent meta items |
| xs | 8px | Tight gaps inside compact components |
| sm | 12px | Default gap between paired items (team flag + code) |
| md | 16px | Standard component padding |
| lg | 24px | Section padding |
| xl | 32px | Page-level padding |
| 2xl | 48px | Section-to-section vertical rhythm |
| 3xl | 64px | Major section breaks, hero padding |
| 4xl | 96px | Page bottom margin, major dividers |

## Layout

**Approach: hybrid.** Grid-disciplined for app screens (the prediction page is a workspace), more editorial for marketing-adjacent surfaces (sign-in, leaderboard hero, profile).

### Bracket page (the canonical workspace)

- **Desktop primary:** 1440px target, 60/40 split. Left 60% (~860px) holds the active round's prediction cards in a vertical stack. Right 40% (~580px) is a sticky bracket-tree diagram showing the full knockout structure.
- **Tablet (768–1199px):** stack vertically — cards above, full-width bracket tree below (not sticky).
- **Mobile (<768px):** single column, prediction cards full-width. Bracket tree behind a tab/modal toggle accessible from the round selector.

### Other surfaces

- **Leaderboard:** centered table, max-width ~840px. Avatars + monospace ranks + tabular points.
- **Sign-in / first-run:** centered card, generous whitespace, single CTA. Editorial.
- **Profile:** form layout, label-above-input, generous spacing.

### Container

- **Max content width:** 1200px for marketing surfaces, 1440px for the bracket workspace.
- **Page padding:** `--space-xl` (32px) on desktop, `--space-md` (16px) on mobile.

## Border Radius

Hierarchical. Different elements get different radii on purpose. **Not uniform.**

| Token | Value | Use |
|---|---|---|
| sm | 4px | Score cells, small inputs, tiny buttons |
| md | 6px | Cards, match rows, buttons, dropdowns |
| lg | 8px | Dialogs, modals, toasts |
| full | 9999px | Pills (round selector tabs, badges), avatars |

### Forbidden

- Uniform 16px+ radius on every element. The "everything is bubbly" look is AI slop.
- Different radii on supposedly-same-component instances.

## Motion

**Approach: minimal-functional.** No scroll-driven animation, no playful bounces, no celebrations. Turning pages of a notebook, not opening a toy box.

| Phase | Duration | Easing | Use |
|---|---|---|---|
| Enter | 150ms | ease-out | Tab changes, modal entrances, card mounts |
| Exit | 100ms | ease-in | Dismissals, tab leaves |
| Move | 200ms | ease-in-out | Score input transitions, value changes, state updates |
| Micro | 50ms | linear | Hover, focus rings, active press feedback |

### Forbidden

- Scroll-jacking, parallax, heavy entrance choreography
- Bounce / overshoot easing (`cubic-bezier(0.68, -0.55, 0.265, 1.55)` and friends)
- Celebration animations (confetti, points-counting-up, success checkmarks zooming)
- Anything that takes longer than 400ms

## Component Vocabulary

These are the recurring patterns. Build them in `lib/ui/` (or extend shadcn primitives) — don't reinvent per-page.

- **Match row:** horizontal card, two team rows, score input on the right, optional inline penalty-winner picker for tied knockout scores.
- **Round selector pills:** horizontal scrolling row, monospace caps text, active fills with `--accent`.
- **Predicted-vs-real card:** triptych pattern (green / yellow / red) on result pages. User's prediction stays visible alongside reality.
- **Bracket tree:** miniature diagram, 40x36px slot rectangles, connecting lines, current round emphasized with subtle accent band.
- **Leaderboard row:** rank (mono tabular) + avatar (square `--surface-high`) + name (semibold) + favorite team (mono caps) + streak metadata + points (mono tabular bold, right-aligned).
- **Lock countdown:** mono caps text, `--text-muted`, format `LOCKS IN 3D 12H`.
- **`+1 pt` affordance:** mono, 11px, `--text-muted`. Whisper-loud. Same family as countdown text. Never use trophy/star icons or gold tinting to draw attention.

## Accessibility

- **WCAG AA minimum.** `--text-primary` on `--bg` = 13.5:1 (passes AAA). Test all combinations.
- **Touch targets:** 44x44px minimum on mobile. Score cells already meet this.
- **Keyboard navigation:** every interactive element reachable via Tab. Focus rings use `--accent` at 2px offset, never invisible.
- **Screen readers:** aria-labels on icon-only buttons, semantic HTML (use `<button>`, `<table>`, `<nav>`), live regions on the leaderboard for score updates.
- **Color independence:** never communicate state through color alone. The green/yellow/red triptych has explicit `+3 pts` / `+1 pt` / `0 pts` text labels.

## AI Slop Anti-Patterns (forbidden)

The product fails the "did a real designer make this?" test if any of these appear:

- Purple/violet/indigo gradient backgrounds
- 3-column feature grid with icons-in-colored-circles
- Centered-everything layouts
- Uniform large border-radius on every element
- Decorative blobs, floating circles, wavy SVG dividers
- Emoji as design elements (rockets in headings, emoji as bullet points, sparkles)
- Colored-left-border on cards as the only state indicator
- Generic hero copy: "Welcome to...", "Unlock the power of...", "Your all-in-one..."
- Trophy / star / lightning / sparkle icons to mark "premium" features
- Cookie-cutter section rhythm (hero → 3 features → testimonials → CTA)
- Bouncy / spring / overshoot motion

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-09 | Initial design system created | `/design-consultation` synthesized from prior /office-hours, /plan-eng-review, /plan-design-review sessions |
| 2026-05-09 | Dark mode primary, no light mode v1 | Sports-data-app convention; ships faster; family already used to dark UIs |
| 2026-05-09 | Instrument Serif chosen over sans for display | Editorial confidence over enterprise-dashboard feel. Restricted to wordmark + h1/h2 to avoid legibility issues |
| 2026-05-09 | Warm off-white (`#F5F2EB`) for primary text | Quiet but constant signal that this isn't a generic shadcn install. Pairs with `#161616` background warmth |
| 2026-05-09 | Three-color scoring system muted, not neon | Match editorial restraint. `#15803D` not Tailwind green-500 |
| 2026-05-09 | Predicted-vs-real triptych as documented design pattern | First-class UI motif, not just an interaction note. The soul of the product |
| 2026-05-09 | Penalty-winner inline picker | Knockout-stage tied scores need explicit winner picks; surfaces only when score is tied |
| 2026-05-09 | `+1 pt` affordance "whisper-loud" treatment | Same visual family as deadline countdown; if it screams, the side-bet feels like a leaderboard mechanic |
