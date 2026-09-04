# World Cup Bracket

A friends-and-family prediction pool for the 2026 FIFA World Cup. Sixteen
people predicted the scoreline of all 104 matches, from the group stage to
the final, and the app scored every pick against reality within minutes of
each final whistle.

**→ [Live archive](https://world-cup-bracket-sooty.vercel.app)**

> **This is an archive.** The tournament finished in July 2026. The site is
> now a frozen, read-only snapshot: no sign-in, no new predictions, no
> database. It runs entirely as static HTML.

---

## How it went

Spain beat Argentina in the final; England took third. In the pool, the top
two finished level on 99 points and were separated only by the tiebreaker
chain.

|  |  |
|---|---|
| Matches scored | 104 |
| Players | 16 |
| Predictions scored | 1,584 |
| Exact scorelines called | 141 |
| Prize pool | $640, settled |

---

## Stack

Next.js (App Router) · Supabase (Postgres, RLS, Google OAuth) · Tailwind ·
Vercel. Vitest for unit tests, Playwright for E2E.

## The parts worth reading

**Scoring is pure functions.** [`lib/bracket.ts`](lib/bracket.ts) has zero
database access — group standings, the R32 cascade, match scoring, the
podium side-bet, and the leaderboard with its full tiebreaker chain are all
pure and exhaustively tested. Everything that touches Postgres lives in a
thin runtime layer above it. That split is why the scoring rules could be
verified independently at wind-down (see below) instead of taken on faith.

**Predictions bind to bracket slots, not teams.** A knockout pick refers to
`winner-group-C` or `r32-match-7-winner`, never to a team id. When the
group stage settled, reality populated those slots and every downstream
prediction resolved automatically — no migration, no rewriting user data.
This is the single best design decision in the repo.

**Scoring is idempotent.** Running it twice never double-counts, which is
what made the polling cron safe to retry and safe to overlap with its own
backstop.

**The polling endpoint throttled itself.** Rather than polling a paid
results API on a fixed schedule, `/api/cron/poll-results` first asked a
cheap database question — is any unfinished match inside its expected-end
window, or does any finished match still have unscored predictions? — and
returned `{idle:true}` without spending quota if not. That kept a
5-minute cadence inside a ~100-request/day free tier.

**Locking is enforced server-side, with RLS as the backstop.** API routes
were the source of truth for whether a match was still editable; the
row-level security policies enforced the same rule independently at the
database, so a leaked key still could not rewrite a locked pick.

## Two things that went wrong

Both are more instructive than the features.

**FIFA's Annex C.** The 32-team knockout bracket has a constraint that is
easy to miss: no group winner may face a third-placed team from its own
group, and which four of the twelve third-placed teams advance changes the
entire mapping. The first implementation got this wrong. The fix
([`lib/annex-c.ts`](lib/annex-c.ts), [`PRD_annex_c_r32.md`](PRD_annex_c_r32.md))
encodes the official table and is verified against all 495 possible
combinations.

**The 1,000-row cap.** Once the pool crossed 1,000 scored predictions, the
leaderboard's exact/outcome breakdown silently started undercounting —
PostgREST caps a response at 1,000 rows by default, and the query wasn't
paginated. Totals stayed correct because they were computed per user,
which is exactly what made the discrepancy visible. The plain-English
writeup that went out to the players is at
[`docs/leaderboard-counts-explainer.md`](docs/leaderboard-counts-explainer.md).
The pagination helper and its regression test are still in the codebase.

## How the archive works

At decommission, [`scripts/build-archive-snapshot.ts`](scripts/build-archive-snapshot.ts)
froze the final database into [`data/archive-snapshot.json`](data/archive-snapshot.json)
and downloaded every avatar locally. The pages read that file, so nothing
calls `cookies()` and Next prerenders all 24 routes to static HTML at build
time. The site therefore needs no server, no database, and no environment
variables — which is why the Supabase projects could be deleted outright
rather than left running.

Before the snapshot was taken,
[`scripts/export-score-verification.ts`](scripts/export-score-verification.ts)
recomputed all 1,584 stored point values independently against
`lib/bracket.ts` and found zero mismatches. That is the provenance record
for the numbers above.

That is also why this repo still contains Supabase code the deployed site
never runs: it is the record of the live system, not dead scaffolding.

## Repo map

```
lib/bracket.ts       pure scoring, standings, leaderboard  (fully tested)
lib/reality.ts       advancing real results into the bracket
lib/annex-c.ts       FIFA Annex C third-place mapping
lib/scoring-runtime.ts   the DB-touching layer above lib/bracket.ts
lib/archive.ts       the archive's data layer (reads the snapshot)
app/                 App Router pages + the bracket workspace UI
scripts/             operator tooling (seeding, rescoring, backfill, snapshot)
supabase/migrations/ schema + RLS policies
```

## Docs

- [`DESIGN.md`](DESIGN.md) — the design system: type scale, colour tokens,
  motion rules, and an explicit anti-pattern list.
- [`CLAUDE.md`](CLAUDE.md) — engineering conventions and the operational
  runbooks from when this was live.
- [`designs/`](designs/) — the original architecture and review docs.

## Licence

No licence — published for reading, not reuse. The participants' names and
predictions are real.
