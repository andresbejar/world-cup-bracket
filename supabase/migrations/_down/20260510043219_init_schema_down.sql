-- ============================================================
-- DOWN migration for 0001_init_schema
-- Reverses everything in 20260510043219_init_schema.sql.
--
-- Apply manually via Supabase SQL Editor or:
--   psql $DATABASE_URL -f supabase/migrations/_down/20260510043219_init_schema_down.sql
--
-- This file is NOT auto-applied by `supabase db push`. Down migrations
-- are intentionally manual to prevent accidental data loss in prod.
-- ============================================================

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop table if exists public.predicted_third_place_assignments;
drop table if exists public.finalist_picks;
drop table if exists public.predictions;
drop table if exists public.users;
drop table if exists public.matches;
drop table if exists public.bracket_slots;
drop table if exists public.rounds;
drop table if exists public.teams;

drop function if exists public.set_updated_at();
