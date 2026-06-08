-- ============================================================
-- DOWN migration for match_winning_slot (APT-28)
-- Drops the winning_slot_id column and its participant CHECK.
-- Any recorded knockout/penalty winners are lost; they re-derive on the
-- next polling tick from api-football once the column is re-added.
-- ============================================================

alter table public.matches
  drop constraint if exists matches_winning_slot_is_participant;

alter table public.matches
  drop column if exists winning_slot_id;
