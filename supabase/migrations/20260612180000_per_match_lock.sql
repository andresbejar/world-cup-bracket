-- ============================================================
-- 0005 — Per-match prediction lock (lock at kickoff, not per-round)
-- Issue: APT (per-match locking)
-- Reference: designs/andresbejar-main-design-20260509-161531.md § Lock
--            Enforcement Architecture
--
-- Pool members missed deadlines because a whole matchday's predictions
-- froze at one round-level cutoff (`rounds.deadline_at`, 4h before the
-- round's first match), even for matches days away. We move the
-- predictions soft-lock to each match's own kickoff (`matches.scheduled_at`).
--
-- This is the RLS safety-net half (the Next.js API route in
-- app/api/predictions/route.ts is the source of truth — it now calls
-- checkMatchLock). Like is_round_editable, is_match_editable gates only
-- on time, not the admin `locked_at`; the API stays authoritative for the
-- hard lock.
--
-- Unchanged: is_round_editable stays — predicted_third_place_assignments
-- still locks at R32's deadline.
--
-- Down migration: see _down/20260612180000_per_match_lock_down.sql
-- ============================================================

-- True iff this match's kickoff hasn't passed yet.
-- security definer so RLS-locked policies can call this without recursion.
create or replace function public.is_match_editable(p_match_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(now() < scheduled_at, false)
  from public.matches
  where id = p_match_id;
$$;

-- Repoint the predictions write policies from round-level to match-level.
-- Drop + recreate so the WITH CHECK expression changes cleanly.
drop policy if exists predictions_insert_own on public.predictions;
create policy predictions_insert_own on public.predictions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and points_awarded is null
    and public.is_match_editable(match_id)
  );

drop policy if exists predictions_update_own on public.predictions;
create policy predictions_update_own on public.predictions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and points_awarded is null
    and public.is_match_editable(match_id)
  );

-- PostgREST caches the schema; nudge it to pick up the new function.
notify pgrst, 'reload schema';
