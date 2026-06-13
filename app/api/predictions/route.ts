import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth-guard";
import {
  checkMatchLock,
  validateKnockoutPrediction,
} from "@/lib/lock-check";

// POST /api/predictions
// Body: { match_id, predicted_home_score, predicted_away_score,
//         predicted_winning_slot_id? }
// Upserts on (user_id, match_id).
//
// Source of truth for lock enforcement (design doc § Lock Enforcement
// Architecture). Supabase RLS mirrors these checks as a safety net.
// We always operate as the authenticated user, never service-role,
// so RLS still applies even if our checks miss something.
export async function POST(request: NextRequest) {
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
  const parsed = parseBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Look up the match → its round so we can both lock-check and
  // tie-validate. The match's own `scheduled_at` is the per-match lock
  // boundary; the round still carries the admin `locked_at` override.
  // One join via Supabase REST; trivial overhead.
  const { data: match, error: matchErr } = await supabase
    .from("matches")
    .select("id, round_id, scheduled_at, rounds(stage, locked_at, deadline_at)")
    .eq("id", parsed.match_id)
    .maybeSingle();
  if (matchErr) {
    console.error("[api/predictions] match lookup failed:", matchErr);
    return NextResponse.json({ error: matchErr.message }, { status: 500 });
  }
  if (!match) {
    return NextResponse.json({ error: "unknown match_id" }, { status: 404 });
  }

  // Supabase types the joined relation either as a single object or as
  // an array; normalize.
  const round = Array.isArray(match.rounds) ? match.rounds[0] : match.rounds;
  if (!round) {
    return NextResponse.json(
      { error: "match has no associated round" },
      { status: 500 },
    );
  }

  // Per-match lock: this match freezes at its own kickoff, independent of
  // the other matches in the round. The round's admin `locked_at` still
  // hard-locks every match in the round.
  const lock = checkMatchLock(
    { round_locked_at: round.locked_at, kickoff_at: match.scheduled_at },
    Date.now(),
  );
  if (!lock.editable) {
    return NextResponse.json(
      {
        error:
          lock.reason === "locked"
            ? "round is locked — admin closed predictions"
            : "this match has kicked off — predictions are frozen",
        reason: lock.reason,
      },
      { status: 403 },
    );
  }

  const stage: "group" | "knockout" = round.stage === "group" ? "group" : "knockout";
  const tieCheck = validateKnockoutPrediction({
    stage,
    home_score: parsed.predicted_home_score,
    away_score: parsed.predicted_away_score,
    predicted_winning_slot_id: parsed.predicted_winning_slot_id,
  });
  if (!tieCheck.ok) {
    return NextResponse.json({ error: tieCheck.error }, { status: 400 });
  }

  const { error } = await supabase.from("predictions").upsert(
    {
      user_id: user.id,
      match_id: parsed.match_id,
      predicted_home_score: parsed.predicted_home_score,
      predicted_away_score: parsed.predicted_away_score,
      predicted_winning_slot_id: parsed.predicted_winning_slot_id ?? null,
    },
    { onConflict: "user_id,match_id" },
  );
  if (error) {
    console.error("[api/predictions] upsert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

interface ParsedBody {
  match_id: string;
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_winning_slot_id?: string | null;
}

function parseBody(raw: unknown): ParsedBody | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "expected object body" };
  const r = raw as Record<string, unknown>;
  const match_id = r.match_id;
  if (typeof match_id !== "string" || match_id.length === 0) {
    return { error: "match_id required" };
  }
  const home = r.predicted_home_score;
  const away = r.predicted_away_score;
  if (!Number.isInteger(home) || (home as number) < 0 || (home as number) > 20) {
    return { error: "predicted_home_score must be int 0-20" };
  }
  if (!Number.isInteger(away) || (away as number) < 0 || (away as number) > 20) {
    return { error: "predicted_away_score must be int 0-20" };
  }
  let winning: string | null | undefined = undefined;
  if (r.predicted_winning_slot_id !== undefined) {
    const v = r.predicted_winning_slot_id;
    if (v !== null && (typeof v !== "string" || v.length === 0)) {
      return { error: "predicted_winning_slot_id must be string or null" };
    }
    winning = v as string | null;
  }
  return {
    match_id,
    predicted_home_score: home as number,
    predicted_away_score: away as number,
    predicted_winning_slot_id: winning,
  };
}
