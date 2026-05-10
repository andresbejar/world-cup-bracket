-- ============================================================
-- 0002 — Row-Level Security policies
-- Issue: APT-9
-- Reference: designs/andresbejar-main-design-20260509-161531.md § Lock
--            Enforcement Architecture, Premise 8
--
-- Strategy:
--   - Reference data (teams, rounds, bracket_slots, matches): read-all,
--     no client writes. Service-role populates these.
--   - User-owned data (users, predictions, finalist_picks,
--     predicted_third_place_assignments): read-all (leaderboard
--     transparency), write-own, gated by deadline checks.
--   - Service-role bypasses RLS entirely (Postgres rule, not RLS) — all
--     scoring writes, polling job writes, and admin operations work.
--
-- Down migration: see _down/20260510045229_rls_policies_down.sql
-- ============================================================

-- ------------------------------------------------------------
-- Helpers — deadline checks
-- ------------------------------------------------------------

-- True iff the round's deadline_at hasn't passed yet.
-- security definer so RLS-locked policies can call this without recursion.
create or replace function public.is_round_editable(p_round_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(now() < deadline_at, false)
  from public.rounds
  where id = p_round_id;
$$;

-- True iff the tournament hasn't started (first match hasn't kicked off).
-- Used for finalist_picks lock (locks at first match kickoff, not 4hr-pre).
create or replace function public.are_finalist_picks_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select min(scheduled_at) from public.matches),
    'infinity'::timestamptz
  ) > now();
$$;

-- ------------------------------------------------------------
-- teams — read-all, no client writes
-- ------------------------------------------------------------
create policy teams_select_all on public.teams
  for select to authenticated, anon
  using (true);

-- ------------------------------------------------------------
-- rounds — read-all, no client writes
-- ------------------------------------------------------------
create policy rounds_select_all on public.rounds
  for select to authenticated, anon
  using (true);

-- ------------------------------------------------------------
-- bracket_slots — read-all, no client writes
-- ------------------------------------------------------------
create policy bracket_slots_select_all on public.bracket_slots
  for select to authenticated, anon
  using (true);

-- ------------------------------------------------------------
-- matches — read-all, no client writes
-- ------------------------------------------------------------
create policy matches_select_all on public.matches
  for select to authenticated, anon
  using (true);

-- ------------------------------------------------------------
-- users — read-all (for leaderboard rendering), update-own
-- (Insert is handled by the on_auth_user_created trigger; no client INSERT.
--  No delete policy — banning is a soft flag, service-role only.)
-- ------------------------------------------------------------
create policy users_select_all on public.users
  for select to authenticated, anon
  using (true);

create policy users_update_own on public.users
  for update to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- Banned users can't un-ban themselves and can't change own row
    and is_banned = false
    -- total_points is a server-managed column; client cannot change it
    -- (the service-role scoring engine is the only path)
    and total_points = (select total_points from public.users u2 where u2.id = users.id)
  );

-- ------------------------------------------------------------
-- predictions — read-all (leaderboard transparency),
-- insert/update own only when the round is still editable.
-- points_awarded is server-managed; client cannot set or change it.
-- ------------------------------------------------------------
create policy predictions_select_all on public.predictions
  for select to authenticated, anon
  using (true);

create policy predictions_insert_own on public.predictions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and points_awarded is null
    and public.is_round_editable(
      (select round_id from public.matches where id = match_id)
    )
  );

create policy predictions_update_own on public.predictions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and points_awarded is null
    and public.is_round_editable(
      (select round_id from public.matches where id = match_id)
    )
  );

-- ------------------------------------------------------------
-- finalist_picks — read-all, insert/update own only before tournament starts
-- ------------------------------------------------------------
create policy finalist_picks_select_all on public.finalist_picks
  for select to authenticated, anon
  using (true);

create policy finalist_picks_insert_own on public.finalist_picks
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and points_awarded is null
    and public.are_finalist_picks_open()
  );

create policy finalist_picks_update_own on public.finalist_picks
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and points_awarded is null
    and public.are_finalist_picks_open()
  );

-- ------------------------------------------------------------
-- predicted_third_place_assignments — read-all, write-own gated by
-- R32's deadline (4hr before R32 starts is the natural cutoff —
-- after that, third-place picks are also locked).
-- ------------------------------------------------------------
create policy predicted_3rd_select_all on public.predicted_third_place_assignments
  for select to authenticated, anon
  using (true);

create policy predicted_3rd_insert_own on public.predicted_third_place_assignments
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.is_round_editable('r32')
  );

create policy predicted_3rd_update_own on public.predicted_third_place_assignments
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and public.is_round_editable('r32')
  );

create policy predicted_3rd_delete_own on public.predicted_third_place_assignments
  for delete to authenticated
  using (
    auth.uid() = user_id
    and public.is_round_editable('r32')
  );
