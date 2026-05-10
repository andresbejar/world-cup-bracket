# World Cup Bracket — Project Conventions

A web app where ~5–50 friends and family compete to predict FIFA World Cup 2026 results. Hobby project. Hard deadline: opening match June 11, 2026.

Stack: Next.js (App Router) + Supabase + shadcn/ui + Tailwind on Vercel.

## Source-of-truth documents

- **`DESIGN.md`** — design system. ALL visual, typographic, color, spacing, and motion decisions live here.
- **`designs/andresbejar-main-design-20260509-161531.md`** — product/architecture design doc. Data model, scoring rules, build order, premises.
- **`designs/andresbejar-main-eng-review-test-plan-20260509-164432.md`** — test plan from `/plan-eng-review`.

## Design system

**Always read `DESIGN.md` before making any visual or UI decisions.** All font choices, colors, spacing scales, border-radius values, motion durations, and aesthetic direction are defined there. Do not deviate without explicit user approval. In QA mode, flag any code that doesn't match `DESIGN.md`.

Quick reference:
- **Dark mode primary.** Background `#161616`, text `#F5F2EB`, accent `#F59E0B`.
- **Three fonts only:** Instrument Serif (display/h1/h2/wordmark), General Sans (body/UI), JetBrains Mono (codes/numbers/metadata).
- **Three semantic colors (muted, not neon):** `#15803D` correct, `#A16207` partial, `#B91C1C` wrong.
- **No purple gradients, no 3-column icon grids, no centered-everything, no bouncy motion.** Full anti-slop list in `DESIGN.md`.

## Architecture & scoring

The full design doc lives at `designs/andresbejar-main-design-20260509-161531.md`. Key invariants:

- **Pure functions in `lib/bracket.ts`** with zero database access — group standings, R32 cascade, match scoring, finalist scoring, third-place placement scoring, leaderboard. 100% Vitest coverage required.
- **Predictions are tied to slot IDs, not team IDs** — this is what lets reality replace predicted teams cleanly when group stage finishes.
- **Lock enforcement:** Next.js API routes are source of truth (server-side `rounds.locked_at` check). Supabase RLS is the safety-net backup.
- **Scoring is idempotent** — running twice doesn't double-count points. Polling cron retries are safe.
- **Hand-curated fixture seed**, not pulled from api-football. The API is results-only.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke `office-hours`
- Bugs, errors, "why is this broken" → invoke `investigate`
- Ship, deploy, push, create PR → invoke `ship`
- QA, test the site, find bugs → invoke `qa`
- Code review, check my diff → invoke `review`
- Update docs after shipping → invoke `document-release`
- Visual audit, design polish → invoke `design-review`
- Architecture review of a plan → invoke `plan-eng-review`
- Design plan review → invoke `plan-design-review`
- Save progress, checkpoint, resume → invoke `checkpoint`

## Testing

- **Vitest** for unit tests. 100% coverage on `lib/bracket.ts` is non-negotiable.
- **Playwright** for E2E. 5 critical paths required before production deploy: signup, bracket-build, round-lock, match-finishes-leaderboard-updates, mobile-responsive.
- See the test plan at `designs/andresbejar-main-eng-review-test-plan-20260509-164432.md`.

## Build order

This is week 0 (2026-05-09). Hard deadline is 2026-06-11 (~30 days).
- Week 0: api-football verification + git init + GitHub repo (~3h)
- Week 1: foundation, Next.js + Supabase, fixture seed, Google SSO (~15h)
- Week 2: core bracket logic + UI, lib/bracket.ts with tests, prediction screens (~22h)
- Week 3: polling cron, scoring, leaderboard, predicted-vs-real UI (~15h)
- Week 4: E2E tests, mobile pass, family beta, ship by 2026-06-04 (~12h)

Full schedule with risk-killers in the architecture design doc.
