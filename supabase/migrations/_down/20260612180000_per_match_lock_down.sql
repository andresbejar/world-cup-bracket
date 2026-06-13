-- ============================================================
-- DOWN migration for 0005_per_match_lock
-- Reverts the predictions write policies to the round-level lock
-- (is_round_editable) and drops the per-match helper.
-- ============================================================

drop policy if exists predictions_insert_own on public.predictions;
create policy predictions_insert_own on public.predictions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and points_awarded is null
    and public.is_round_editable(
      (select round_id from public.matches where id = match_id)
    )
  );

drop policy if exists predictions_update_own on public.predictions;
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

drop function if exists public.is_match_editable(text);

notify pgrst, 'reload schema';
