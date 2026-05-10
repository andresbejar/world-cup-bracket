// Smoke-test endpoint. Verifies the Supabase connection works end-to-end
// using both the user-session client and the service-role client.
//
// Used by APT-6 verification and by /qa later. Safe to leave in production —
// returns no data, only success/failure plus latency.
//
// Usage:
//   curl -s http://localhost:3000/api/healthcheck | jq

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const checks: Record<string, { ok: boolean; ms: number; note?: string }> = {};

  // 1. User-session client (respects RLS). No session = no rows, but the
  // connection should still complete cleanly.
  try {
    const t0 = Date.now();
    const supabase = await createClient();
    const { error } = await supabase.auth.getSession();
    checks.user_session_client = {
      ok: !error,
      ms: Date.now() - t0,
      note: error?.message,
    };
  } catch (e) {
    checks.user_session_client = {
      ok: false,
      ms: 0,
      note: e instanceof Error ? e.message : String(e),
    };
  }

  // 2. Service-role client (bypasses RLS). Run a trivial server-side query
  // that always works on a fresh project: select 1.
  try {
    const t0 = Date.now();
    const admin = createServiceRoleClient();
    // Postgres `select 1` via Supabase: use rpc or raw query. Cleanest path
    // for a fresh project (no tables yet) is to call the Postgres function
    // `version()` via REST — but that requires an exposed RPC. Instead, hit
    // `/rest/v1/?` to confirm the API key is valid and the URL is reachable.
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL!}/rest/v1/?select=*`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        },
        cache: "no-store",
      },
    );
    checks.service_role_reachable = {
      ok: res.ok,
      ms: Date.now() - t0,
      note: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}`,
    };
    // Suppress unused warning — admin client is constructed for the side
    // effect of validating env vars; the actual query is the fetch above.
    void admin;
  } catch (e) {
    checks.service_role_reachable = {
      ok: false,
      ms: 0,
      note: e instanceof Error ? e.message : String(e),
    };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      ok: allOk,
      ms_total: Date.now() - started,
      checks,
    },
    { status: allOk ? 200 : 503 },
  );
}
