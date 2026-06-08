-- ============================================================
-- 0004 — matches.winning_slot_id (knockout advancement)
-- Issue: APT-28
--
-- The knockout phase needs a single source of truth for "which side
-- advanced", because the canonical score (90+ET, per init_schema comment)
-- can't express a penalty-shootout result. Regulation winners and
-- penalty-shootout winners both land here:
--   - regulation: the higher-scoring side's slot
--   - penalty:    the slot of the side that won the shootout
-- Null for group matches, for unfinished/cancelled matches, and for a
-- tied knockout whose shootout result hasn't been ingested yet.
--
-- Consumed by:
--   - lib/scoring-runtime.ts scoreMatch (knockout outcome scoring)
--   - lib/reality.ts populateRealKnockoutSlots (advancing real teams)
--   - lib/scoring-runtime.ts scoreFinalists (champion / runner-up / 3rd)
-- Written by:
--   - app/api/cron/poll-results/route.ts (from api-football penalty data)
--   - operator, by hand, for awarded walkovers (AWD/WO)
--
-- Down migration: see _down/20260608010208_match_winning_slot_down.sql
-- ============================================================

alter table public.matches
  add column winning_slot_id text references public.bracket_slots(id);

-- A stored winner must be one of the match's two participants.
alter table public.matches
  add constraint matches_winning_slot_is_participant
  check (
    winning_slot_id is null
    or winning_slot_id = home_slot_id
    or winning_slot_id = away_slot_id
  );
