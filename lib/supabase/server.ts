// Server-side Supabase client. Use in Server Components, Route Handlers,
// Server Actions, and Middleware.
//
// This client respects RLS using the user's session (read from cookies).
// For admin operations that need to bypass RLS, use createServiceRoleClient().

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll() called from a Server Component is fine to ignore;
            // middleware refreshes the session on every navigation.
          }
        },
      },
    },
  );
}

// Service-role client. Bypasses RLS. NEVER expose to the browser.
// Use ONLY for: scoring engine writes, cron polling job, admin endpoints.
export function createServiceRoleClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. This client is server-only.",
    );
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
