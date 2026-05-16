import type { SupabaseClient } from "@supabase/supabase-js";

// Auth guards used by every API route. Pulled out of the per-route
// handlers so the ban check is mechanical to add and impossible to forget.
//
// Two layers:
//   - requireActiveUser: there's a session + the user isn't banned.
//     Banned writes get 403 with a clear message the UI can surface.
//   - requireAdmin: the caller's auth.uid() appears in the ADMIN_USER_IDS
//     env list. Env-only (no users.role column) keeps the surface area
//     tiny — admins are configured at deploy time, not runtime.
//
// Banned users keep read access (leaderboard already filters them out;
// they can still view the workspace) but every write path rejects.

export type AuthGuardError = {
  error: string;
  status: 401 | 403;
};

export type AuthGuardOk = {
  user: { id: string; email?: string | null };
};

export type AuthGuardResult = AuthGuardOk | AuthGuardError;

export async function requireActiveUser(
  supabase: SupabaseClient,
): Promise<AuthGuardResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "unauthenticated", status: 401 };
  }
  // Pulls through RLS (users_select_all). One extra round-trip on every
  // write — cheap (single-row by PK) and consistent across all routes.
  const { data: profile, error } = await supabase
    .from("users")
    .select("is_banned")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[auth-guard] profile lookup failed:", error);
    return { error: "profile lookup failed", status: 401 };
  }
  if (profile?.is_banned === true) {
    return {
      error: "account is banned — predictions disabled",
      status: 403,
    };
  }
  return { user: { id: user.id, email: user.email ?? null } };
}

/**
 * Pure helper — returns true when the given user_id appears in the
 * ADMIN_USER_IDS env list. Empty/missing env list = no admins.
 *
 * Format: comma-separated UUIDs, whitespace ignored. Example:
 *   ADMIN_USER_IDS="abc...123, def...456"
 */
export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const raw = process.env.ADMIN_USER_IDS ?? "";
  if (!raw.trim()) return false;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.includes(userId);
}

export async function requireAdmin(
  supabase: SupabaseClient,
): Promise<AuthGuardResult> {
  const base = await requireActiveUser(supabase);
  if ("error" in base) return base;
  if (!isAdminUserId(base.user.id)) {
    return { error: "forbidden", status: 403 };
  }
  return base;
}
