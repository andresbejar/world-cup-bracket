// Prize pool queries (APT-48). Returns the roster + totals for the
// /pool page and the leaderboard-header summary.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoolEntry } from "./types";

export interface PoolRosterRow {
  user_id: string;
  username: string | null;
  profile_pic: string | null;
  entry: PoolEntry | null;
}

export interface PoolState {
  /** Every non-banned user, joined with their pool_entries row (if any),
   *  sorted: confirmed first, then claimed, then unpaid. Within each
   *  bucket, by username for stable display. */
  roster: PoolRosterRow[];
  confirmedCount: number;
  claimedCount: number;
  unpaidCount: number;
  totalUsers: number;
}

export async function loadPoolState(
  supabase: SupabaseClient,
): Promise<PoolState> {
  const [{ data: users, error: usersErr }, { data: entries, error: entriesErr }] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, username, profile_pic")
        .eq("is_banned", false),
      supabase
        .from("pool_entries")
        .select(
          "user_id, status, method, notes, claimed_at, confirmed_at, confirmed_by",
        ),
    ]);
  if (usersErr) throw usersErr;
  if (entriesErr) throw entriesErr;

  const entryByUser = new Map<string, PoolEntry>();
  for (const e of entries ?? []) {
    entryByUser.set(e.user_id as string, e as unknown as PoolEntry);
  }

  const roster: PoolRosterRow[] = (users ?? []).map((u) => ({
    user_id: u.id as string,
    username: (u.username as string | null) ?? null,
    profile_pic: (u.profile_pic as string | null) ?? null,
    entry: entryByUser.get(u.id as string) ?? null,
  }));

  roster.sort((a, b) => {
    const aRank = rank(a.entry);
    const bRank = rank(b.entry);
    if (aRank !== bRank) return aRank - bRank;
    return (a.username ?? "~").localeCompare(b.username ?? "~");
  });

  let confirmedCount = 0;
  let claimedCount = 0;
  for (const row of roster) {
    if (row.entry?.status === "confirmed") confirmedCount += 1;
    else if (row.entry?.status === "claimed") claimedCount += 1;
  }
  return {
    roster,
    confirmedCount,
    claimedCount,
    unpaidCount: roster.length - confirmedCount - claimedCount,
    totalUsers: roster.length,
  };
}

function rank(entry: PoolEntry | null): number {
  if (entry?.status === "confirmed") return 0;
  if (entry?.status === "claimed") return 1;
  return 2;
}

/** Lightweight summary for the leaderboard header — avoids loading the
 *  full roster when only the totals matter. */
export interface PoolSummary {
  confirmedCount: number;
  claimedCount: number;
  totalUsers: number;
}

export async function loadPoolSummary(
  supabase: SupabaseClient,
): Promise<PoolSummary> {
  const [{ count: totalUsers }, { data: entries, error }] = await Promise.all([
    supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("is_banned", false),
    supabase.from("pool_entries").select("status"),
  ]);
  if (error) throw error;
  let confirmedCount = 0;
  let claimedCount = 0;
  for (const e of entries ?? []) {
    if (e.status === "confirmed") confirmedCount += 1;
    else if (e.status === "claimed") claimedCount += 1;
  }
  return {
    confirmedCount,
    claimedCount,
    totalUsers: totalUsers ?? 0,
  };
}
