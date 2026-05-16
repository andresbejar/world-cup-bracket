import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { slugifyUsername } from "@/lib/username";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error_description");
  const next = url.searchParams.get("next") ?? "/predictions";

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/sign-in?error=${encodeURIComponent(errorParam)}`, request.url),
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
    code,
  );
  if (exchangeError) {
    return NextResponse.redirect(
      new URL(
        `/sign-in?error=${encodeURIComponent(exchangeError.message)}`,
        request.url,
      ),
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await ensureProfileDefaults(user);
  }

  return NextResponse.redirect(new URL(next, request.url));
}

// On first sign-in, fill username (slug + 4-char suffix) and profile_pic
// from Google session metadata. The DB trigger already inserted the row
// with email; we only update when fields are still null. Idempotent on
// repeat sign-ins.
async function ensureProfileDefaults(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const admin = createServiceRoleClient();

  const { data: existing, error: readError } = await admin
    .from("users")
    .select("username, profile_pic")
    .eq("id", user.id)
    .maybeSingle();
  if (readError) {
    console.error("[auth/callback] read user failed:", readError);
    return;
  }
  if (!existing) {
    // The on-auth-user-created trigger should have inserted this row.
    // If it's missing the OAuth flow can still proceed; the user can
    // re-sign-in or admin-fix later. Don't block the callback.
    console.warn("[auth/callback] no public.users row for", user.id);
    return;
  }
  if (existing.username && existing.profile_pic) return;

  const meta = (user.user_metadata ?? {}) as {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
  };
  const displayName = meta.full_name ?? meta.name ?? user.email ?? "player";
  const avatar = meta.avatar_url ?? meta.picture ?? null;

  const patch: { username?: string; profile_pic?: string | null } = {};
  if (!existing.username) {
    patch.username = await pickAvailableUsername(admin, displayName);
  }
  if (!existing.profile_pic && avatar) {
    patch.profile_pic = avatar;
  }
  if (Object.keys(patch).length === 0) return;

  const { error: updateError } = await admin
    .from("users")
    .update(patch)
    .eq("id", user.id);
  if (updateError) {
    console.error("[auth/callback] profile defaults update failed:", updateError);
  }
}

function randomSuffix(): string {
  // 4 hex chars from crypto.getRandomValues — collision-resistant enough
  // for a 5–50 person pool.
  const buf = new Uint8Array(2);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

type AdminClient = ReturnType<typeof createServiceRoleClient>;

async function pickAvailableUsername(
  admin: AdminClient,
  displayName: string,
): Promise<string> {
  // slugifyUsername returns null when the Google name slugifies to
  // something the lib/username validator rejects (empty, too short,
  // blocklisted slur after leet-normalization). Fall back to "player"
  // so the auto-flow always produces a renderable name; the user can
  // rename on /profile. This is the "if Google profile name fails,
  // prompt user for one" path from APT-40's AC — the prompt surface is
  // the profile page reachable via the top-bar avatar.
  const base = slugifyUsername(displayName) ?? "player";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    const { data, error } = await admin
      .from("users")
      .select("id")
      .eq("username", candidate)
      .maybeSingle();
    if (error) {
      console.error("[auth/callback] username probe failed:", error);
      break;
    }
    if (!data) return candidate;
  }
  // Last resort: timestamp suffix.
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}
