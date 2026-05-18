-- ============================================================
-- DOWN migration for 0003_prize_pool (APT-48)
-- Drops all policies, table, indexes, and enums introduced in
-- 20260517070035_prize_pool.sql.
-- ============================================================

drop policy if exists pool_entries_delete_own  on public.pool_entries;
drop policy if exists pool_entries_update_own  on public.pool_entries;
drop policy if exists pool_entries_insert_own  on public.pool_entries;
drop policy if exists pool_entries_select_all  on public.pool_entries;

drop table if exists public.pool_entries;

drop type if exists public.pool_entry_status;
drop type if exists public.payment_method;
