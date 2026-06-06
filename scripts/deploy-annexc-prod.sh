#!/usr/bin/env bash
#
# One-shot prod deploy for the Annex C R32 fix (APT-49).
#
# Sequence:
#   0. Preflight + safety gate
#   1. Checkpoint prod (supabase db dump: schema + data)
#   2. Apply the annexc_thirdplace migration to prod   (supabase db push)
#   3. Re-seed prod                                     (build-seed + apply-seed)
#   4. Verify                                           (verify-annexc-deploy.ts)
#
# This DROPS predicted_third_place_assignments and DELETES all knockout-stage
# predictions on prod (group + finalist picks are preserved). Pre-tournament,
# so no points are materialized yet.
#
# Usage:
#   bash scripts/deploy-annexc-prod.sh --dry-run   # checkpoint + verify only, no writes
#   bash scripts/deploy-annexc-prod.sh             # full deploy (asks for confirmation)
#
# Prereqs: PR merged to main, .env.local pointing at PROD, `supabase` CLI
# linked + logged in, APIFOOTBALL_* in .env.local (for build-seed).

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BK="backups/annexc-${TS}"
EXPECTED_REF="xuqonbzvkgfqhkkypdja"   # prod project ref

say() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
die() { printf '\033[31mABORT: %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- 0. preflight
say "0. Preflight"

ENV_URL="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)"
echo "  .env.local target: $ENV_URL"
case "$ENV_URL" in
  *"$EXPECTED_REF"*) echo "  ✓ points at prod ($EXPECTED_REF)";;
  *) die ".env.local does not point at prod ($EXPECTED_REF). Refusing.";;
esac

LINKED_REF="$(cat supabase/.temp/project-ref 2>/dev/null || echo '')"
[ "$LINKED_REF" = "$EXPECTED_REF" ] || die "supabase not linked to prod (linked: '${LINKED_REF:-none}'). Run: supabase link --project-ref $EXPECTED_REF"
echo "  ✓ supabase linked to $LINKED_REF"

git fetch origin main --quiet
if ! git show "origin/main:supabase/migrations/20260605120000_annexc_thirdplace.sql" >/dev/null 2>&1; then
  die "the annexc_thirdplace migration is not on origin/main yet — merge the PR first."
fi
echo "  ✓ migration is on origin/main (PR merged)"

command -v supabase >/dev/null || die "supabase CLI not found"

# ---------------------------------------------------------------- 1. checkpoint
say "1. Checkpoint prod → $BK/"
mkdir -p "$BK"
# Schema + data dumps via the CLI (avoids the raw-pg_dump pooler/password
# pitfalls noted in CLAUDE.md). Prefer Supabase PITR for restores if enabled.
supabase db dump --linked -f "$BK/schema.sql"
supabase db dump --linked --data-only -f "$BK/data.sql"
[ -s "$BK/schema.sql" ] && [ -s "$BK/data.sql" ] || die "checkpoint dump is empty — not proceeding"
echo "  ✓ schema.sql ($(wc -l <"$BK/schema.sql" | tr -d ' ') lines), data.sql ($(wc -l <"$BK/data.sql" | tr -d ' ') lines)"
echo "  Restore (if needed): psql \"\$SUPABASE_DB_URL\" < $BK/schema.sql && psql \"\$SUPABASE_DB_URL\" < $BK/data.sql"

if [ "$DRY_RUN" = "1" ]; then
  say "DRY RUN — checkpoint done. Verifying CURRENT prod state (pre-migration):"
  npx tsx scripts/verify-annexc-deploy.ts || true
  echo
  echo "Dry run complete. No migration or seed applied. Re-run without --dry-run to deploy."
  exit 0
fi

# ---------------------------------------------------------------- safety gate
say "CONFIRM"
echo "About to, on PROD ($EXPECTED_REF):"
echo "  • DROP predicted_third_place_assignments"
echo "  • DELETE all knockout-stage predictions (group + finalist preserved)"
echo "  • apply the annexc_thirdplace migration + re-point R32→Final matches"
echo "  Checkpoint saved at: $BK"
printf 'Type EXACTLY "DEPLOY ANNEXC" to proceed: '
read -r REPLY
[ "$REPLY" = "DEPLOY ANNEXC" ] || die "confirmation not given"

# ---------------------------------------------------------------- 2. migrate
say "2. Apply migration to prod (supabase db push)"
supabase db push

# ---------------------------------------------------------------- 3. reseed
say "3. Re-seed prod"
npm run seed:build
npm run seed:apply

# ---------------------------------------------------------------- 4. verify
say "4. Verify"
npx tsx scripts/verify-annexc-deploy.ts

say "DONE"
echo "Next: load the live site, confirm the R32 tab + reset banner, and message the pool."
echo "Checkpoint retained at $BK (safe to delete once you've confirmed prod is healthy)."
