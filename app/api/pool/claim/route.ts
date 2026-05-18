import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth-guard";
import { readPoolConfig } from "@/lib/pool/config";
import { isPaymentMethod } from "@/lib/pool/types";

// POST /api/pool/claim
// Body: { method: PaymentMethod, notes?: string }
//
// User self-reports they've paid the buy-in via `method`. Upserts the
// caller's row in pool_entries with status='claimed'. The admin then
// confirms receipt via /api/admin/pool/confirm.
//
// Rejected when the row is already 'confirmed' — at that point the user
// should not be downgrading their own status (RLS blocks updates too,
// but the route returns a clean 409 instead of an opaque RLS error).

const NOTES_MAX_LEN = 280;

export async function POST(request: NextRequest) {
  const cfg = readPoolConfig();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: "prize pool not configured" },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const guard = await requireActiveUser(supabase);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { user } = guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const r = (body as Record<string, unknown> | null) ?? {};
  if (!isPaymentMethod(r.method)) {
    return NextResponse.json(
      { error: "method must be venmo | zelle | cashapp | paypal | other" },
      { status: 400 },
    );
  }
  // For methods with no env handle configured, refuse — prevents users
  // from claiming via a method we don't actually accept.
  if (r.method !== "other") {
    const handle = cfg.config.methods[r.method];
    if (!handle) {
      return NextResponse.json(
        { error: `${r.method} is not enabled for this pool` },
        { status: 400 },
      );
    }
  }
  let notes: string | null = null;
  if (r.notes !== undefined && r.notes !== null) {
    if (typeof r.notes !== "string") {
      return NextResponse.json(
        { error: "notes must be a string" },
        { status: 400 },
      );
    }
    const trimmed = r.notes.trim();
    if (trimmed.length > NOTES_MAX_LEN) {
      return NextResponse.json(
        { error: `notes must be ≤ ${NOTES_MAX_LEN} chars` },
        { status: 400 },
      );
    }
    notes = trimmed.length > 0 ? trimmed : null;
  }

  // Block re-claims once the admin has confirmed — RLS would also block
  // this, but a 409 is friendlier than the opaque RLS rejection.
  const { data: existing, error: lookupErr } = await supabase
    .from("pool_entries")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupErr) {
    console.error("[api/pool/claim] lookup failed:", lookupErr);
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (existing?.status === "confirmed") {
    return NextResponse.json(
      { error: "payment already confirmed — contact admin to change" },
      { status: 409 },
    );
  }

  const { error } = await supabase.from("pool_entries").upsert(
    {
      user_id: user.id,
      status: "claimed",
      method: r.method,
      notes,
      claimed_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("[api/pool/claim] upsert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/pool/claim — user retracts their own claim ("clicked by
// mistake"). Only works while still 'claimed'; RLS enforces this too.
export async function DELETE(_request: NextRequest) {
  const supabase = await createClient();
  const guard = await requireActiveUser(supabase);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { user } = guard;
  const { error } = await supabase
    .from("pool_entries")
    .delete()
    .eq("user_id", user.id)
    .eq("status", "claimed");
  if (error) {
    console.error("[api/pool/claim] delete failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
