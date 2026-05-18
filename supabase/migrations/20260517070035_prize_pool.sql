-- ============================================================
-- 0003 — Prize pool tracker (tracker-only, manual confirm)
-- Issue: APT-48
--
-- Friends-and-family buy-in. App stores who reported paying via which
-- method; the admin confirms receipts manually. No funds custody.
--
-- State model:
--   absent row     → user hasn't reported paying yet
--   status=claimed → user said they paid; admin hasn't confirmed
--   status=confirmed → admin confirmed receipt; counts toward total
--
-- Admin confirmations go through the service-role client and bypass RLS
-- (matches app/api/admin/moderate/route.ts pattern, APT-40).
--
-- Down migration: see _down/20260517070035_prize_pool_down.sql
-- ============================================================

create type public.payment_method as enum (
  'venmo', 'zelle', 'cashapp', 'paypal', 'other'
);

create type public.pool_entry_status as enum ('claimed', 'confirmed');

create table public.pool_entries (
  user_id        uuid primary key references public.users(id) on delete cascade,
  status         public.pool_entry_status not null default 'claimed',
  method         public.payment_method not null,
  notes          text,
  claimed_at     timestamptz not null default now(),
  confirmed_at   timestamptz,
  confirmed_by   uuid references public.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- A confirmed row must record who confirmed it and when.
  check (
    (status = 'claimed'   and confirmed_at is null and confirmed_by is null)
    or
    (status = 'confirmed' and confirmed_at is not null and confirmed_by is not null)
  )
);

create index pool_entries_status_idx on public.pool_entries (status);

create trigger pool_entries_updated_at
  before update on public.pool_entries
  for each row execute function public.set_updated_at();

alter table public.pool_entries enable row level security;

-- Read-all so the roster is visible to all participants (transparency
-- matches the leaderboard policy — everyone can see who's paid in).
create policy pool_entries_select_all on public.pool_entries
  for select to authenticated, anon
  using (true);

-- Users can insert their own row (initial claim).
create policy pool_entries_insert_own on public.pool_entries
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and status = 'claimed'
    and confirmed_at is null
    and confirmed_by is null
  );

-- Users can update their own row ONLY while still 'claimed'. Once the
-- admin confirms, the row is read-only to the user (admin-write only via
-- the service-role client).
create policy pool_entries_update_own on public.pool_entries
  for update to authenticated
  using (auth.uid() = user_id and status = 'claimed')
  with check (
    auth.uid() = user_id
    and status = 'claimed'
    and confirmed_at is null
    and confirmed_by is null
  );

-- Users can delete their own row only while still 'claimed' (e.g. they
-- clicked "I paid" by mistake). Confirmed rows are admin-only.
create policy pool_entries_delete_own on public.pool_entries
  for delete to authenticated
  using (auth.uid() = user_id and status = 'claimed');
