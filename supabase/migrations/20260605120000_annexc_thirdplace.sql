-- ============================================================
-- Annex C R32 fix — third-place model + knockout reset
-- Issue: APT-49
--
-- The R32 third-place flow let users assign teams to fixed slots, which
-- could produce FIFA-illegal same-group matchups (1X vs 3X). The fix:
-- users now choose WHICH 8 of the 12 groups' third-placed teams qualify
-- (a set), and FIFA's Annex C lookup (lib/annex-c.ts) deterministically
-- assigns each one's R32 opponent.
--
-- The R32→Final bracket was also re-encoded to FIFA's real tree, so every
-- knockout matchup changed. Existing knockout-stage predictions are reset;
-- group-stage predictions and finalist picks are preserved. Pre-tournament
-- (2026-06): no points materialized yet, so there is no scoring fallout.
--
-- AFTER applying this migration, regenerate + apply the seed so bracket_slots
-- and matches reflect the new structure:
--   npx tsx scripts/build-seed.ts && npx tsx scripts/apply-seed.ts
-- apply-seed prunes the now-orphaned best-3rd-{1..8} slots.
--
-- Down migration: supabase/migrations/_down/20260605120000_annexc_thirdplace_down.sql
-- ============================================================

-- 1. Reset knockout-stage predictions — the matchups changed, so a stored
--    predicted_winning_slot_id no longer refers to a real participant.
delete from public.predictions
where match_id in (
  select id from public.matches
  where round_id in ('r32', 'r16', 'qf', 'sf', 'third_place', 'final')
);

-- 2. Drop the old per-slot third-place model (its RLS policies drop with it).
drop table if exists public.predicted_third_place_assignments;

-- 3. New model: the set of groups whose 3rd-placed team the user predicts
--    will advance. At most 8 per user (enforced in the API route). The
--    team identity is derived from the user's predicted standings, so this
--    stays correct even if they later edit group predictions.
create table public.predicted_qualifying_thirds (
  user_id       uuid not null references public.users(id) on delete cascade,
  group_letter  text not null check (group_letter ~ '^[A-L]$'),
  created_at    timestamptz not null default now(),
  primary key (user_id, group_letter)
);

create index predicted_qualifying_thirds_user_idx
  on public.predicted_qualifying_thirds (user_id);

alter table public.predicted_qualifying_thirds enable row level security;

-- RLS: read-all (leaderboard transparency), write-own gated by R32's
-- deadline — mirrors the old predicted_third_place_assignments policies.
-- Insert + delete only (the API toggles membership; no in-place update).
create policy pqt_select_all on public.predicted_qualifying_thirds
  for select to authenticated, anon
  using (true);

create policy pqt_insert_own on public.predicted_qualifying_thirds
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.is_round_editable('r32')
  );

create policy pqt_delete_own on public.predicted_qualifying_thirds
  for delete to authenticated
  using (
    auth.uid() = user_id
    and public.is_round_editable('r32')
  );
