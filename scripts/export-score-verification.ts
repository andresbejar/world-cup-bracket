// Operator tool: export a full per-match, per-user score breakdown as CSV.
//
// Transparency artifact for players: every scored prediction on every finished
// match, showing the real result, the player's prediction, whether they got the
// outcome/exact score, the stored points, and an INDEPENDENTLY RECOMPUTED points
// value using the same lib/bracket.ts scoring function the app runs. If any
// stored value disagrees with the recomputed one, the row is flagged and the
// script exits non-zero — so this doubles as a scoring-integrity check.
//
// Usage:
//   npx tsx scripts/export-score-verification.ts [outfile.csv]
// Default outfile: score-verification.csv
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import {
  computeMatchPoints,
  type ActualMatch,
  type MatchPrediction,
} from "../lib/bracket";

config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAGE = 1000;

/** CSV-escape: wrap in quotes if it contains comma/quote/newline; double quotes. */
function cell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const outfile = process.argv[2] ?? "score-verification.csv";

  // --- reference data -------------------------------------------------------
  const { data: rounds } = await admin
    .from("rounds")
    .select("id, name, stage");
  const roundById = new Map(
    (rounds ?? []).map((r) => [r.id as string, r as { name: string; stage: string }]),
  );

  const { data: teams } = await admin.from("teams").select("id, code");
  const codeByTeam = new Map(
    (teams ?? []).map((t) => [t.id as string, t.code as string]),
  );

  const { data: slots } = await admin
    .from("bracket_slots")
    .select("id, slot_label, real_team_id");
  const teamBySlot = new Map<string, string>(); // slot_id -> team code (or label)
  for (const s of slots ?? []) {
    const code = s.real_team_id ? codeByTeam.get(s.real_team_id as string) : null;
    teamBySlot.set(s.id as string, code ?? (s.slot_label as string));
  }

  const { data: matches } = await admin
    .from("matches")
    .select(
      "id, round_id, home_slot_id, away_slot_id, home_score, away_score, status, winning_slot_id, scheduled_at",
    )
    .in("status", ["finished", "cancelled"]);
  const matchById = new Map((matches ?? []).map((m) => [m.id as string, m]));

  const { data: users } = await admin
    .from("users")
    .select("id, username, is_banned");
  const userById = new Map(
    (users ?? []).map((u) => [
      u.id as string,
      { username: u.username as string | null, banned: u.is_banned as boolean },
    ]),
  );

  // --- all scored predictions (paginated — same lesson as the leaderboard) ---
  type PredRow = {
    user_id: string;
    match_id: string;
    predicted_home_score: number;
    predicted_away_score: number;
    predicted_winning_slot_id: string | null;
    points_awarded: number | null;
  };
  const preds: PredRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("predictions")
      .select(
        "user_id, match_id, predicted_home_score, predicted_away_score, predicted_winning_slot_id, points_awarded",
      )
      .not("points_awarded", "is", null)
      .order("user_id", { ascending: true })
      .order("match_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as PredRow[];
    preds.push(...rows);
    if (rows.length < PAGE) break;
  }

  // --- build rows -----------------------------------------------------------
  const header = [
    "player",
    "round",
    "stage",
    "match",
    "kickoff_utc",
    "match_status",
    "predicted_score",
    "predicted_to_advance",
    "real_score",
    "real_advanced",
    "outcome_correct",
    "exact_score",
    "points_stored",
    "points_recomputed",
    "stored_matches_rule",
  ];
  const lines: string[] = [header.join(",")];

  let mismatches = 0;
  let rowCount = 0;

  // Sort for a stable, human-friendly file: by kickoff, then player.
  const sorted = preds
    .map((p) => ({ p, m: matchById.get(p.match_id) }))
    .filter((x) => x.m != null)
    .sort((a, b) => {
      const ka = a.m!.scheduled_at as string;
      const kb = b.m!.scheduled_at as string;
      if (ka !== kb) return ka.localeCompare(kb);
      const ua = userById.get(a.p.user_id)?.username ?? "";
      const ub = userById.get(b.p.user_id)?.username ?? "";
      return ua.localeCompare(ub, undefined, { sensitivity: "base" });
    });

  for (const { p, m } of sorted) {
    const user = userById.get(p.user_id);
    if (!user || user.banned) continue; // skip banned/unknown
    const round = roundById.get(m!.round_id as string);
    const stageRaw = round?.stage ?? "group";
    const isGroup = stageRaw === "group";

    const homeTeam = teamBySlot.get(m!.home_slot_id as string) ?? "?";
    const awayTeam = teamBySlot.get(m!.away_slot_id as string) ?? "?";

    const actual: ActualMatch = {
      status: m!.status as ActualMatch["status"],
      stage: isGroup ? "group" : "knockout",
      home_slot_id: m!.home_slot_id as string,
      away_slot_id: m!.away_slot_id as string,
      home_score: m!.home_score as number | null,
      away_score: m!.away_score as number | null,
      winning_slot_id: isGroup ? null : (m!.winning_slot_id as string | null),
    };
    const prediction: MatchPrediction = {
      predicted_home_score: p.predicted_home_score,
      predicted_away_score: p.predicted_away_score,
      predicted_winning_slot_id: p.predicted_winning_slot_id,
    };

    const recomputed = computeMatchPoints(prediction, actual);
    const stored = p.points_awarded;
    const matchesRule = recomputed === stored;
    if (!matchesRule) mismatches += 1;

    // Human-readable derived columns.
    const exact =
      actual.home_score != null &&
      actual.away_score != null &&
      p.predicted_home_score === actual.home_score &&
      p.predicted_away_score === actual.away_score;

    let outcomeCorrect = "";
    if (m!.status === "cancelled") {
      outcomeCorrect = "n/a (cancelled)";
    } else if (isGroup && actual.home_score != null && actual.away_score != null) {
      const ps = Math.sign(p.predicted_home_score - p.predicted_away_score);
      const as = Math.sign(actual.home_score - actual.away_score);
      outcomeCorrect = ps === as ? "yes" : "no";
    } else if (!isGroup) {
      outcomeCorrect =
        p.predicted_winning_slot_id != null &&
        p.predicted_winning_slot_id === actual.winning_slot_id
          ? "yes"
          : actual.winning_slot_id == null
            ? "pending"
            : "no";
    }

    const predWinner = p.predicted_winning_slot_id
      ? teamBySlot.get(p.predicted_winning_slot_id) ?? ""
      : "";
    const realWinner = actual.winning_slot_id
      ? teamBySlot.get(actual.winning_slot_id) ?? ""
      : "";
    const realScore =
      m!.home_score != null && m!.away_score != null
        ? `${m!.home_score}-${m!.away_score}`
        : "";

    lines.push(
      [
        cell(user.username),
        cell(round?.name ?? m!.round_id),
        cell(stageRaw),
        cell(`${homeTeam} vs ${awayTeam}`),
        cell(m!.scheduled_at as string),
        cell(m!.status as string),
        cell(`${p.predicted_home_score}-${p.predicted_away_score}`),
        cell(predWinner),
        cell(realScore),
        cell(realWinner),
        cell(outcomeCorrect),
        cell(exact ? "yes" : "no"),
        cell(stored),
        cell(recomputed),
        cell(matchesRule ? "yes" : "MISMATCH"),
      ].join(","),
    );
    rowCount += 1;
  }

  writeFileSync(resolve(process.cwd(), outfile), lines.join("\n") + "\n");

  console.log(`Wrote ${rowCount} rows to ${outfile}`);
  console.log(`Finished/cancelled matches covered: ${matchById.size}`);
  if (mismatches === 0) {
    console.log(
      "✓ Integrity check PASSED: every stored point value matches the published scoring rule (recomputed independently).",
    );
  } else {
    console.error(
      `✗ Integrity check FAILED: ${mismatches} row(s) where stored points != recomputed points. See 'stored_matches_rule' column.`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
