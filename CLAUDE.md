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

### Best third-placed teams (retired side bet)

The "best third-placed teams" bet is **not scored** — it contributes 0 to the
leaderboard. It used to let users pick which 8 of the 12 groups' third-placed
teams advance, but it locked at R32's deadline, by which point every group match
had finished and the answer was public — a free-points leak. Now:

- **Predicted side is display-only and auto-derived.** The 8 are computed from the
  user's group predictions (`deriveBestThirdGroups` in `lib/bracket.ts`: rank-3 per
  group, sorted points → GD → goals for, top 8). The `ThirdPlaceCluster` UI is
  read-only. There is no manual picker and no `/api/third-place-assignments` route.
  The `predicted_qualifying_thirds` table is **kept but unused** (no destructive
  mid-tournament migration); `computeThirdPlacePlacementPoints` is kept (with tests)
  but no longer wired into `total_points`.
- **Real side auto-populates the bracket.** Once the group stage finishes, the
  poll-results cron derives the real 8 qualifying thirds from real standings and
  fills the 8 Annex-C `best-3rd-vs-{winner}` R32 slots
  (`populateRealBestThirdSlotsAuto` → `resolveRealQualifyingThirds` in
  `lib/reality.ts`). Real match results then flow through the existing Sports-API
  pipeline (`applyKnockoutBackfill` + `fetchFixtures`).
- **`REAL_QUALIFYING_THIRDS` override** (Vercel prod env, e.g. `"A,B,D,E,G,I,K,L"`):
  set this **only** when the 8th/9th best thirds are a true tie that FIFA breaks by
  disciplinary record / drawing of lots (which we can't simulate). On such a tie with
  no override, the cron holds and logs that an override is needed rather than guessing.
  Empty/unset = pure auto-derive. Preview with `npx tsx scripts/preview-real-thirds.ts`
  (read-only dry-run). After deploy, `npx tsx scripts/recompute-totals.ts` flushes any
  stale total (hygiene; normally a no-op since the real set was never settled).

## Score polling (APT-60)

`POST /api/cron/poll-results` pulls results from api-sports and runs scoring. It's
**self-throttling**: each call first checks whether any not-yet-finished match is
in its expected-end window (`lib/poll-window.ts` `isInPollWindow` — kickoff+1h45m
through a per-stage cap; group 2h15m, knockout 3h45m for ET+penalties). If none,
it returns `{idle:true}` without touching api-football. It also runs when a
`finished` match still has unscored predictions (so a missed scoring self-heals
even once the match leaves its window). We never poll the live phase — only the
final result matters. `?full=1` bypasses the gate and forces a complete sweep
(fetch + score all + reality advancement).

**Execution model:** runs **synchronously** and returns real counts (`200`) or
`500` on a hard error. Each tick stays fast because (a) scoring is **incremental**
— only matches with unscored predictions, capped at `SCORE_LIMIT` per tick (a
backlog drains across ticks; `?full=1` is uncapped), and (b) the per-user
`total_points` recompute is **parallelized** in bounded batches
(`lib/scoring-runtime.ts`, via `lib/chunk.ts`). An earlier version ran the sweep
in a fire-and-forget `after()` to dodge the pinger's 30s cap, but the heavy
scoring loop got truncated after the quick match-upsert — results updated, scores
didn't. Synchronous + incremental avoids that and surfaces failures to the pinger.

Two triggers, by design:

- **Primary — external pinger (cron-job.org).** Always-on, hits the endpoint
  every 5 min, 24/7. Because the endpoint self-throttles, idle ticks cost ~zero
  api-football quota; during a match window each tick is one fetch, so scores land
  within ~5 min of the final whistle. This replaces per-match GitHub scheduling,
  which was unreliable (GitHub drops scheduled runs under load). One api-sports
  free-tier request per active tick keeps daily usage well under the ~100/day cap.

  Configure in the cron-job.org dashboard (config lives outside git):
  - URL: `https://<PROD_URL>/api/cron/poll-results`  · Method: `POST`
  - Header: `Authorization: Bearer <CRON_SECRET>` (same secret the route validates)
  - Interval: every 5 minutes

- **Backstop — `.github/workflows/poll-results.yml`.** Coarse (every 3h) GitHub
  Actions run that calls the endpoint with `?full=1`. Insurance if the pinger is
  down, and the steady cadence that runs backfill/reality between rounds.

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

### E2E test database (APT-52)

The E2E suite mutates `matches.status` / `rounds.locked_at`, so it runs against a **dedicated test Supabase project** — never prod. Once the tournament is live (2026-06-11) an e2e run against prod could flip real result rows and recompute leaderboards. Two backstops enforce the split:

- `e2e/helpers.ts` `assertTestDatabase()` — every admin-client construction hard-refuses the prod project ref. Routed through `adminClient()` and `e2e/global-setup.ts`.
- `playwright.config.ts` loads `.env.test` (test project) before `.env.local`; CI maps `TEST_SUPABASE_URL` / `TEST_SUPABASE_ANON_KEY` / `TEST_SUPABASE_SERVICE_ROLE_KEY` into the standard env names.

`.env.test` = e2e test project. `.env.local` = prod app + operator scripts (`reset-match-results.ts`, `dev-login.ts` keep targeting prod).

**Build-time gotcha:** Next inlines `NEXT_PUBLIC_*` at **build** time (server/middleware bundle included), so the running app's Supabase target is baked by `next build`, not by runtime env. A build made against `.env.local` (prod) served by `next start` would make the app talk to prod while `global-setup` mints its session in the test DB — the project-scoped auth cookie wouldn't match and `/predictions` bounces to `/sign-in`. To prevent this, `playwright.config.ts`'s `webServer` runs `next build && next start` **locally** (rebuilding against the loaded `.env.test`); CI skips the rebuild because its workflow already runs `npm run build` with the `TEST_SUPABASE_*` env in a separate step. Net: just run `npm run e2e` — the build is handled for you.

**One-time provisioning of the test project:**

```bash
# 1. Create a free Supabase project (e.g. wc-bracket-test) in the dashboard.
# 2. Apply schema + seed (clean project → migrations apply fresh, no repair):
supabase link --project-ref <test-ref>
supabase db push
NEXT_PUBLIC_SUPABASE_URL=<test-url> SUPABASE_SERVICE_ROLE_KEY=<test-service-key> \
  npm run seed:apply
# 3. Set CI secrets:
gh secret set TEST_SUPABASE_URL
gh secret set TEST_SUPABASE_ANON_KEY
gh secret set TEST_SUPABASE_SERVICE_ROLE_KEY
# 4. Create local .env.test with the same three values (see .env.example).
```

**Ongoing:** when a new migration lands, run `supabase db push` against the test project too — it is not auto-migrated by CI the way prod is. If the test DB ever gets dirty from an interrupted run, re-run `npm run seed:apply` (idempotent) against it.

## Backups & Recovery

Daily encrypted `pg_dump` of the `public` schema runs at 05:13 UTC via `.github/workflows/backup.yml`. Output is GPG-symmetric-encrypted (AES-256) and uploaded as a private workflow artifact with 30-day retention. Two repo secrets required: `SUPABASE_DB_URL` (direct connection, port 5432) and `BACKUP_GPG_PASSPHRASE` (also save to a password manager — losing it loses the backups).

If a bad migration or accidental DELETE corrupts data mid-tournament:

```bash
# 1. Find the most recent successful backup run.
gh run list --workflow=backup.yml --status=success --limit=5

# 2. Download the encrypted artifact (substitute the run ID).
gh run download <run-id> --name "supabase-backup-<run-id>"

# 3. Decrypt with the passphrase from your password manager.
gpg --batch --pinentry-mode loopback --passphrase "$BACKUP_GPG_PASSPHRASE" \
  --decrypt supabase-*.sql.gpg > restore.sql

# 4. Inspect — confirm the right rows are present before applying.
grep -c "INSERT INTO public.predictions" restore.sql

# 5a. Full restore (re-creates public schema; --clean DROPs first).
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 < restore.sql

# 5b. Surgical restore (preferred — paste only the rows you need into psql).
```

If Supabase Point-in-Time Recovery is enabled on the project (Pro plan), prefer that over the dump: it captures every WAL segment and rewinds with no manual SQL. The dump is the cheap fallback. Either way, **never** restore over a live tournament DB without checkpointing the current state first (`pg_dump` it again, then restore).

### Phantom "FINAL" match results

If the app shows bogus FINAL cards before kickoff (e.g. `MEX 2-1 RSA` on a match that hasn't been played), the DB has stranded match rows. Historically these came from an E2E run (`scoring-loop.spec`) interrupted before its `afterAll` restore ran against the shared prod DB; as of APT-52 e2e runs against a dedicated test project (see "E2E test database" above), so prod should no longer be polluted this way. The UI also guards against it via `hasRealResult()` (`lib/match-display.ts`), which won't render a `finished` status on a future-dated match, but any stranded rows still need scrubbing.

Run the operator scrub against the live DB:

```bash
npx tsx scripts/reset-match-results.ts
```

It reads `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`, lists the stranded matches, resets each future-dated "played" row back to `scheduled` (null scores), and clears any prediction scoring it stamped. The future-date predicate makes it safe to run any time — it can never wipe a legitimately-finished past match. **Safety gate:** once any match has kicked off (tournament is live) it refuses and no-ops, since a future-dated "played" row could then be a real reschedule; fix those by hand. The same self-heal also runs automatically at E2E `global-setup`, so a fresh test run cleans up after a prior interrupted one.

## Build order

This is week 0 (2026-05-09). Hard deadline is 2026-06-11 (~30 days).
- Week 0: api-football verification + git init + GitHub repo (~3h)
- Week 1: foundation, Next.js + Supabase, fixture seed, Google SSO (~15h)
- Week 2: core bracket logic + UI, lib/bracket.ts with tests, prediction screens (~22h)
- Week 3: polling cron, scoring, leaderboard, predicted-vs-real UI (~15h)
- Week 4: E2E tests, mobile pass, family beta, ship by 2026-06-04 (~12h)

Full schedule with risk-killers in the architecture design doc.
