-- ============================================================
-- DOWN migration for annexc_thirdplace (APT-49)
-- Reverses the schema change. NOTE: deleted knockout-stage predictions
-- and the migrated third-place picks cannot be restored — this only
-- restores table structure + policies. Re-run build-seed/apply-seed
-- against the old bracket-structure.ts to restore the old slots/matches.
-- ============================================================

drop policy if exists pqt_delete_own  on public.predicted_qualifying_thirds;
drop policy if exists pqt_insert_own  on public.predicted_qualifying_thirds;
drop policy if exists pqt_select_all  on public.predicted_qualifying_thirds;

drop table if exists public.predicted_qualifying_thirds;
drop function if exists public.enforce_max_qualifying_thirds();

-- Recreate the old per-slot third-place assignments table + policies.
create table public.predicted_third_place_assignments (
  user_id              uuid not null references public.users(id) on delete cascade,
  slot_id              text not null references public.bracket_slots(id),
  predicted_team_id    text not null references public.teams(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, slot_id),
  unique (user_id, predicted_team_id)
);

create index predicted_3rd_user_idx
  on public.predicted_third_place_assignments (user_id);

create trigger predicted_third_place_updated_at
  before update on public.predicted_third_place_assignments
  for each row execute function public.set_updated_at();

alter table public.predicted_third_place_assignments enable row level security;

create policy predicted_3rd_select_all on public.predicted_third_place_assignments
  for select to authenticated, anon
  using (true);

create policy predicted_3rd_insert_own on public.predicted_third_place_assignments
  for insert to authenticated
  with check (auth.uid() = user_id and public.is_round_editable('r32'));

create policy predicted_3rd_update_own on public.predicted_third_place_assignments
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.is_round_editable('r32'));

create policy predicted_3rd_delete_own on public.predicted_third_place_assignments
  for delete to authenticated
  using (auth.uid() = user_id and public.is_round_editable('r32'));
