# Gemini Design Brief — World Cup Bracket App

Paste this into Gemini Nano Banana (gemini-2.5-flash-image) to generate mockups for review.

## Product Context

A web app where ~5–50 friends and family members compete to predict FIFA World Cup 2026 match results. Users predict scores and outcomes for all 104 matches, plus the tournament's top-3 finishers. Built for fun, not for venture-scale users. Hobby project, ships before opening night (June 11, 2026).

The product's signature interaction is **predict-the-whole-bracket-on-day-1**, then refine each round's predictions until 4 hours before that round starts.

The app's soul is **side-by-side reconciliation** of predicted-vs-real once matches finish. Users always see what they had locked in alongside what the world delivered, color-coded for hits and misses.

## Aesthetic Direction (applies to both screens)

- **Dark mode primary.** Deep charcoal background (think `#161616` or `#1A1A1A`), warm off-white ink (`#F5F2EB` or similar), one warm amber accent for active state (`#F59E0B` or `#D97706`). Country flags are full color. No corporate Tailwind blue, no purple-to-blue gradients, no SaaS teal.
- **Editorial confidence, not toy app.** Think a high-end Premier League tactics tool or a thoughtful fantasy football product, applied to friends-and-family stakes. Letterboxd-level craft.
- **Typography:** monospace for country codes and numbers (IBM Plex Mono, JetBrains Mono, or Berkeley Mono). Polished sans-serif for body (Söhne, GT America, General Sans, or Inter Tight at most). NEVER default Inter, Roboto, or Arial. The wordmark uses a confident, slightly condensed display face.
- **Spacing:** generous but disciplined. Each section has one job. Subtle warm-grey borders, not thick rules.
- **Border radius:** small, 4–6px on inputs and cards. Avoid uniform giant rounded corners.
- **No AI slop:** no decorative gradients, no emoji, no icons-in-colored-circles, no centered-everything, no 3-column feature grids, no decorative blobs/wavy dividers, no colored-left-border on cards.

## Screen 1: Desktop bracket page (1440x900)

The user is mid-tournament, currently picking Round of 16 winners.

**Header (~64px tall, full width):**
- Left: app wordmark in confident slightly-condensed type
- Center: round selector as horizontal segmented tabs:
  `Group · R1` `Group · R2` `Group · R3` `R32` `R16` (active) `QF` `SF` `Final`
- Right: leaderboard pill (`#3 of 12 · 47 pts`), 32x32 user avatar

**Main content uses full 1440px width, split 60/40:**

**LEFT 60% (~860px):** Vertical stack of 8 horizontal Round-of-16 match cards (~72px tall each). Each card shows:
- Match index in monospace caps grey: `R16 · MATCH 3`
- Two team rows side-by-side with VS in middle:
  - 24x24 flag, 3-letter monospace bold code (`ARG`), team full name
- Score inputs on the right: two number cells with subtle +/- chevrons
- **Critical:** for any predicted TIE score, a `Penalty winner` selector appears below the score inputs (radio-style toggle: `· France · Argentina`). At least ONE card in the mockup MUST show this state explicitly: e.g., `France 2 - 2 Argentina · penalty winner: Argentina`
- Far right: tiny grey deadline countdown (`locks in 3d 12h`)

Card states to show:
- 1 already-submitted match (filled scores, faint background tint indicating "saved")
- 1 currently-focused match (subtle outline + slight elevation)
- 1 tied-with-penalty-winner match (the design proof)
- The rest empty / waiting for input

**RIGHT 40% (~580px, sticky):** Miniature bracket TREE diagram showing the full knockout structure (R32 → R16 → QF → SF → Final + 3rd place). Connecting lines between rounds. Each match in the tree is a small (~40x36) rectangle showing flag + 3-letter code, stacked pairs. The user's predicted winners are bolded; non-predicted slots show `?` or are dimmed. The CURRENT round (R16) is emphasized with a subtle accent band.

Below the tree: a small `Your Champion` panel showing the user's predicted tournament winner (`ARG · Argentina · 5 pts if correct`).

## Screen 2: Predicted-vs-real card pattern (800x600 composition)

Three side-by-side mobile-width result cards (~340px wide each) showing the GREEN/YELLOW/RED states of the points system. Small heading caps above each: `GREEN · score correct` / `YELLOW · outcome correct` / `RED · wrong`.

Same match in all three (Argentina vs Brazil) but with different reconciliations:

**Card 1 (GREEN, +3 pts):**
- `YOUR PICK` label in tiny grey caps
- Match line: ARG flag + code + name + score `2`, BRA flag + code + name + score `1`
- Subtle horizontal divider
- `ACTUAL` label
- Match line: ARG `2`, BRA `1`
- Right side: `+3 pts` badge in mossy green (`#15803D`). Subtle green-tinted background, NOT a thick colored left border.

**Card 2 (YELLOW, +1 pt):**
- YOUR PICK: ARG `3`, BRA `0`
- ACTUAL: ARG `1`, BRA `0` (outcome correct, score wrong)
- `+1 pt` badge in warm gold (`#A16207`). Subtle warm tint.

**Card 3 (RED, +0 pts):**
- YOUR PICK: BRA `2`, ARG `1`
- ACTUAL: ARG `2`, BRA `0` (wrong winner)
- `+0 pts` badge in muted terracotta (`#B91C1C`). Subtle red tint.

The user's prediction stays VISIBLE alongside reality. This is a triptych — three evenly-weighted cards on the same warm off-white background, demonstrating how the product reconciles bets.

## What I want from you

Generate 3 variants of Screen 1 (desktop bracket page) and 3 variants of Screen 2 (predicted-vs-real card pattern). Vary:
- Information density (sparse vs dense)
- Hierarchy emphasis (which element pulls the eye first)
- The bracket tree treatment (tight & abstract vs more spacious)

Save them anywhere; we'll review together.

## Avoid (instant-fail)

- Generic SaaS card grid as composition
- Centered-everything layout
- Purple/violet/indigo gradients
- 3-column feature grid pattern
- Icons in colored circles as decoration
- Emoji
- Decorative blobs / wavy dividers
- Bright neon Tailwind primary colors
- Colored-left-border on cards as the only state indicator
- Generic Inter or Roboto type stack
- Thick chunky borders or huge uniform border-radius
