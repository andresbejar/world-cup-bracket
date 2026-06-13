# Deploy runbook — per-match prediction locking

Ship the change that locks predictions **per match at its own kickoff** instead
of per round at one shared deadline.

## What's in this change

- **Migration** `supabase/migrations/20260612180000_per_match_lock.sql` —
  **RLS-only**: adds `is_match_editable(match_id)` and repoints the two
  `predictions` write policies from round-level (`is_round_editable`) to
  match-level. No new tables/columns → **no `seed:apply` needed**. Self-issues
  `notify pgrst, 'reload schema'`.
- **App code** — `lib/lock-check.ts` (`checkMatchLock`), `app/api/predictions`
  (server enforcement), `app/predictions/*` (per-card lock + "NEXT LOCK IN …"
  / "LOCKS IN …" UI), and tests (`lib/lock-check.test.ts`, `e2e/round-lock.spec.ts`).

Two Supabase projects must be migrated:

| Role | Project ref | Env file | Notes |
|------|-------------|----------|-------|
| **Test** | `rbeipshgilggjjmdaznr` (`wc-bracket-test`) | `.env.test` | Drives Playwright CI. Migrate first. |
| **Prod** | `xuqonbzvkgfqhkkypdja` | `.env.local` | Live tournament DB. Has a known history drift — see Part C. |

**Deploy order:** branch + PR → migrate **test** → CI green → migrate **prod** →
merge → Vercel auto-deploys.

---

## Part A — Push the branch & open the PR

You're currently on `main` with the change uncommitted. Branch, stage **only**
these files (the repo has unrelated untracked scripts — don't sweep them in),
commit, push, and open the PR.

```bash
cd world-cup-bracket
git checkout -b feat/per-match-lock

# Stage exactly the per-match-lock change
git add \
  lib/lock-check.ts lib/lock-check.test.ts \
  app/api/predictions/route.ts \
  app/predictions/predictions-client.tsx \
  app/predictions/match-card.tsx \
  app/predictions/knockout-card.tsx \
  e2e/round-lock.spec.ts \
  supabase/migrations/20260612180000_per_match_lock.sql \
  supabase/migrations/_down/20260612180000_per_match_lock_down.sql \
  docs/per-match-lock-deploy.md

git status   # confirm confirm-payment.ts / emergency-prediction.ts are NOT staged

git commit -m "feat: lock predictions per match at kickoff, not per round

Each match freezes at its own kickoff (matches.scheduled_at) instead of
the whole round locking at one shared deadline. Adds checkMatchLock +
is_match_editable RLS; UI shows per-match LOCKS IN … and a NEXT LOCK
countdown. Admin round locked_at still hard-locks the round.
"

git push -u origin feat/per-match-lock

# Open the PR
gh pr create --fill --base main
# or with an explicit title/body:
# gh pr create --base main \
#   --title "feat: lock predictions per match at kickoff" \
#   --body "Locks each match at its own kickoff instead of per-round. See docs/per-match-lock-deploy.md for the migration steps."
```

> ⚠️ **Don't merge yet.** CI (Playwright) runs against the **test** project,
> which needs the migration applied first (Part B) or the happy-path specs 500
> on the old round-level RLS.

---

## Part B — Migrate the test project (for green CI)

The CLI is normally linked to the test project. Confirm, then push.

```bash
supabase migration list     # expect only 20260612180000 with a blank "Remote" column
supabase db push            # applies it to wc-bracket-test (prompts for the TEST DB password)
```

If `migration list` shows you're not on the test project, link first:
`supabase link --project-ref rbeipshgilggjjmdaznr`.

Re-run the PR's Playwright job (push a commit or `gh run rerun`) — it should now
go green, exercising the per-match RLS.

---

## Part C — Migrate prod (before merging)

```bash
# 1. Point the CLI at prod
supabase link --project-ref xuqonbzvkgfqhkkypdja

# 2. Checkpoint first — schema dump into gitignored backups/
mkdir -p backups
supabase db dump --file backups/pre-per-match-lock-$(date +%Y%m%d).sql

# 3. Check history state — look for DRIFT
supabase migration list
```

**Read the list:**

- Only `20260612180000` pending and every other row pairs Local↔Remote → no
  drift, go to step 4.
- A **remote-only** row `20260518053721` with a blank Local (the prize-pool
  out-of-band timestamp) → `db push` will refuse with *"Remote migration
  versions not found in local migrations directory."* Repair the **history
  table only** (does not touch schema):

  ```bash
  supabase migration repair --status applied  20260517070035
  supabase migration repair --status reverted 20260518053721
  supabase migration list   # confirm only 20260612180000 is now pending
  ```

```bash
# 4. Apply
supabase db push          # prompts for the PROD DB password
```

No `seed:apply` — this migration adds no data.

---

## Part D — Verify on prod

```bash
supabase db dump --schema public --file /tmp/prod-after.sql
grep -n "is_match_editable" /tmp/prod-after.sql
grep -n "predictions_insert_own\|predictions_update_own" /tmp/prod-after.sql   # should call is_match_editable
```

Or in the SQL editor:

```sql
select proname from pg_proc where proname = 'is_match_editable';                 -- 1 row
select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy
  where polrelid = 'public.predictions'::regclass;                               -- WITH CHECK calls is_match_editable(match_id)
```

Then **merge the PR** — Vercel auto-deploys the new app code (per-match API + UI).

---

## Notes & safety

- **No breakage window** (unlike the Annex C deploy): this migration only
  *replaces* the predictions policies (round→match) and *adds* a function — it
  removes nothing the currently-live app reads. Until the new code deploys, the
  old app keeps enforcing its stricter round-level lock in its API layer, and
  the new per-match RLS is equal-or-more-permissive with the old API still the
  gatekeeper. Still migrate-before-merge so CI is honest and prod never lags the
  new code.
- **DB password gotchas:** if a password has special chars, URL-encode it; set
  `SUPABASE_DB_PASSWORD` to skip the interactive prompt.
- **Re-link back to test** when you resume local work:
  `supabase link --project-ref rbeipshgilggjjmdaznr`.
- **Heads-up to the pool:** deploying immediately re-opens every
  not-yet-kicked-off match and removes the old 4-hour buffer (edits allowed
  until kickoff).

## Rollback

Run the body of `supabase/migrations/_down/20260612180000_per_match_lock_down.sql`
via the SQL editor / psql against the affected project — it reverts the two
predictions policies to `is_round_editable` and drops `is_match_editable`.
