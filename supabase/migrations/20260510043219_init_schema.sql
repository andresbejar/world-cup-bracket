-- ============================================================
-- 0001 — Initial schema for World Cup Bracket
-- Issue: APT-8
-- Reference: designs/andresbejar-main-design-20260509-161531.md § Data Model
--
-- All tables enable RLS at creation (locked down by default).
-- Policies are added in the next migration (APT-9).
--
-- Down migration: see supabase/migrations/_down/20260510043219_init_schema_down.sql
-- ============================================================

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------

-- Generic updated_at trigger function used by several tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- teams: 48 national teams in the World Cup 2026
-- Seeded from a hand-curated JSON (APT-4). `id` is ISO 3166 alpha-3
-- which is OUR canonical 3-letter code (api-sports's `team.code` is
-- unreliable — it has duplicates like AUS/AUS for Australia/Austria).
-- ------------------------------------------------------------
create table public.teams (
  id            text primary key,
  name          text not null,
  code          text not null unique,
  flag_url      text,
  group_letter  text not null check (group_letter ~ '^[A-L]$'),
  apifootball_team_id  bigint unique
);

alter table public.teams enable row level security;

-- ------------------------------------------------------------
-- rounds: group matchdays + knockout stages
-- ------------------------------------------------------------
create table public.rounds (
  id           text primary key,
  name         text not null,
  stage        text not null check (stage in ('group','r32','r16','qf','sf','third_place','final')),
  matchday     int  check (matchday is null or matchday in (1,2,3)),
  deadline_at  timestamptz not null,
  locked_at    timestamptz
);

create index rounds_stage_idx on public.rounds (stage);
alter table public.rounds enable row level security;

-- ------------------------------------------------------------
-- bracket_slots: stable slot identities that knockout matches reference
--
-- For group rounds: one bracket_slot per match-team-side (so a group
-- match's home_slot_id and away_slot_id reference slots whose
-- real_team_id is pre-filled at seed time).
--
-- For knockout rounds: slot_label encodes the upstream relationship
-- ('winner-group-A', 'r32-match-1-winner', 'best-3rd-slot-1', etc).
-- real_team_id is null until that upstream stage finishes IRL, at
-- which point the polling job populates it.
-- ------------------------------------------------------------
create table public.bracket_slots (
  id            text primary key,
  round_id      text not null references public.rounds(id),
  slot_label    text not null,
  real_team_id  text references public.teams(id),
  unique (round_id, slot_label)
);

create index bracket_slots_round_idx on public.bracket_slots (round_id);
alter table public.bracket_slots enable row level security;

-- ------------------------------------------------------------
-- matches: 104 total (72 group + 32 knockout)
-- home_score/away_score store the canonical 90+ET total
-- (api-sports's goals.home / goals.away — never includes penalty shootout).
-- ------------------------------------------------------------
create table public.matches (
  id            text primary key,
  round_id      text not null references public.rounds(id),
  home_slot_id  text not null references public.bracket_slots(id),
  away_slot_id  text not null references public.bracket_slots(id),
  scheduled_at  timestamptz not null,
  home_score    int check (home_score is null or (home_score >= 0 and home_score <= 30)),
  away_score    int check (away_score is null or (away_score >= 0 and away_score <= 30)),
  status        text not null default 'scheduled'
                  check (status in ('scheduled','in_progress','finished','cancelled')),
  source        text not null default 'manual' check (source in ('api','manual')),
  apifootball_fixture_id  bigint unique,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index matches_round_idx     on public.matches (round_id);
create index matches_status_idx    on public.matches (status);
create index matches_scheduled_idx on public.matches (scheduled_at);
alter table public.matches enable row level security;

-- ------------------------------------------------------------
-- users: app-owned profile, 1:1 with auth.users
-- username is nullable on first insert; users complete profile on first
-- sign-in. Materialized total_points avoids hot-path leaderboard queries.
-- ------------------------------------------------------------
create table public.users (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null,
  username            text unique,
  profile_pic         text,
  favorite_team_id    text references public.teams(id),
  total_points        int  not null default 0,
  is_banned           boolean not null default false,
  created_at          timestamptz not null default now()
);

create index users_total_points_idx on public.users (total_points desc) where is_banned = false;
alter table public.users enable row level security;

-- Auto-create public.users row when an auth.users row is created.
-- Username is left null so the user picks one on first sign-in (APT-7).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- predictions: one row per (user, match)
-- predicted_winning_slot_id is only used for knockout-stage predictions
-- (which slot the user thinks will produce the winner).
-- points_awarded is null until the match flips to finished.
-- ------------------------------------------------------------
create table public.predictions (
  id                          bigserial primary key,
  user_id                     uuid not null references public.users(id) on delete cascade,
  match_id                    text not null references public.matches(id),
  predicted_home_score        int  not null check (predicted_home_score between 0 and 20),
  predicted_away_score        int  not null check (predicted_away_score between 0 and 20),
  predicted_winning_slot_id   text references public.bracket_slots(id),
  points_awarded              int,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (user_id, match_id)
);

create index predictions_user_idx  on public.predictions (user_id);
create index predictions_match_idx on public.predictions (match_id);

create trigger predictions_updated_at
  before update on public.predictions
  for each row execute function public.set_updated_at();

alter table public.predictions enable row level security;

-- ------------------------------------------------------------
-- finalist_picks: champion / 2nd / 3rd. One row per user.
-- All three teams must be distinct (or null while still being filled).
-- Lock deadline = first match kickoff (enforced in API route, not schema).
-- ------------------------------------------------------------
create table public.finalist_picks (
  user_id                  uuid primary key references public.users(id) on delete cascade,
  first_place_team_id      text references public.teams(id),
  second_place_team_id     text references public.teams(id),
  third_place_team_id      text references public.teams(id),
  points_awarded           int,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (first_place_team_id  is null or first_place_team_id  != second_place_team_id),
  check (first_place_team_id  is null or first_place_team_id  != third_place_team_id),
  check (second_place_team_id is null or second_place_team_id != third_place_team_id)
);

create trigger finalist_picks_updated_at
  before update on public.finalist_picks
  for each row execute function public.set_updated_at();

alter table public.finalist_picks enable row level security;

-- ------------------------------------------------------------
-- predicted_third_place_assignments: only for the 8 R32 slots that
-- take a third-place team. Each pick is worth +1 pt if the predicted
-- team matches the team FIFA actually places in that slot.
-- A team can only be picked for one slot per user.
-- ------------------------------------------------------------
create table public.predicted_third_place_assignments (
  user_id              uuid not null references public.users(id) on delete cascade,
  slot_id              text not null references public.bracket_slots(id),
  predicted_team_id    text not null references public.teams(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, slot_id),
  unique (user_id, predicted_team_id)
);

create index predicted_3rd_user_idx on public.predicted_third_place_assignments (user_id);

create trigger predicted_third_place_updated_at
  before update on public.predicted_third_place_assignments
  for each row execute function public.set_updated_at();

alter table public.predicted_third_place_assignments enable row level security;

-- ------------------------------------------------------------
-- Notes
-- ------------------------------------------------------------
-- RLS is enabled on every table but no policies exist yet. Until
-- APT-9 lands, NO client-side reads or writes will succeed; the
-- service-role key is the only path to data. This is intentional
-- defense-in-depth.
