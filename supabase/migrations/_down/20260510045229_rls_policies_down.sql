-- ============================================================
-- DOWN migration for 0002_rls_policies
-- Drops every policy and helper function from 20260510045229_rls_policies.sql.
--
-- After running this, RLS is still enabled on the tables but no policies
-- exist — meaning ALL authenticated/anon access is denied. The schema
-- becomes effectively service-role-only.
-- ============================================================

-- predicted_third_place_assignments
drop policy if exists predicted_3rd_select_all on public.predicted_third_place_assignments;
drop policy if exists predicted_3rd_insert_own on public.predicted_third_place_assignments;
drop policy if exists predicted_3rd_update_own on public.predicted_third_place_assignments;
drop policy if exists predicted_3rd_delete_own on public.predicted_third_place_assignments;

-- finalist_picks
drop policy if exists finalist_picks_select_all on public.finalist_picks;
drop policy if exists finalist_picks_insert_own on public.finalist_picks;
drop policy if exists finalist_picks_update_own on public.finalist_picks;

-- predictions
drop policy if exists predictions_select_all on public.predictions;
drop policy if exists predictions_insert_own on public.predictions;
drop policy if exists predictions_update_own on public.predictions;

-- users
drop policy if exists users_select_all on public.users;
drop policy if exists users_update_own on public.users;

-- matches / bracket_slots / rounds / teams
drop policy if exists matches_select_all on public.matches;
drop policy if exists bracket_slots_select_all on public.bracket_slots;
drop policy if exists rounds_select_all on public.rounds;
drop policy if exists teams_select_all on public.teams;

-- helpers
drop function if exists public.are_finalist_picks_open();
drop function if exists public.is_round_editable(text);
