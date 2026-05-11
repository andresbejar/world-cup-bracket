"use client";

import { useMemo } from "react";
import type { HydratedTeam } from "@/lib/group-data";

// Tournament-wide podium bet. Independent of the bracket cascade — a
// user can predict "Argentina wins it all" here even if their cascade
// has Brazil winning the Final. Both bets pay out independently.
//
// One row per user in `finalist_picks` with three nullable columns:
//   first_place_team_id (5 pts)
//   second_place_team_id (3 pts)
//   third_place_team_id (1 pt)

type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface FinalistPicksState {
  first_place_team_id: string | null;
  second_place_team_id: string | null;
  third_place_team_id: string | null;
}

interface Props {
  /** All 48 teams in the tournament. */
  teams: HydratedTeam[];
  picks: FinalistPicksState;
  saveStatus: SaveStatus;
  onChange: (next: FinalistPicksState) => void;
}

interface PodiumRow {
  key: keyof FinalistPicksState;
  label: string;
  points: string;
  blurb: string;
}

const ROWS: PodiumRow[] = [
  {
    key: "first_place_team_id",
    label: "Champion",
    points: "+5 PTS",
    blurb: "Winner of the Final",
  },
  {
    key: "second_place_team_id",
    label: "Runner-up",
    points: "+3 PTS",
    blurb: "Loser of the Final",
  },
  {
    key: "third_place_team_id",
    label: "Third place",
    points: "+1 PT",
    blurb: "Winner of the third-place playoff",
  },
];

export function FinalistPicks({
  teams,
  picks,
  saveStatus,
  onChange,
}: Props) {
  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) => a.code.localeCompare(b.code));
  }, [teams]);

  // Map each currently-picked team_id → which podium position has it.
  const positionByTeam = useMemo(() => {
    const m = new Map<string, keyof FinalistPicksState>();
    for (const row of ROWS) {
      const id = picks[row.key];
      if (id) m.set(id, row.key);
    }
    return m;
  }, [picks]);

  const filledCount = ROWS.filter((r) => picks[r.key] != null).length;

  function handlePick(key: keyof FinalistPicksState, team_id: string | null) {
    onChange({
      ...picks,
      [key]: team_id,
    });
  }

  return (
    <section
      aria-label="Champion, runner-up, and third-place picks"
      className="mt-6 rounded-md border border-border bg-surface px-5 py-4"
    >
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
            TOURNAMENT-WIDE BET · INDEPENDENT
          </p>
          <h3
            className="mt-1 font-display text-2xl leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Your podium picks
          </h3>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums whitespace-nowrap">
          {filledCount}/3 PICKED
        </span>
      </header>

      <ul className="mt-5 space-y-2.5">
        {ROWS.map((row) => {
          const picked = picks[row.key] ?? "";
          return (
            <li
              key={row.key}
              className="flex flex-wrap items-center gap-3"
            >
              <div className="flex w-32 shrink-0 flex-col">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-text-primary">
                  {row.label}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
                  {row.blurb}
                </span>
              </div>
              <div className="relative flex-1 min-w-[180px]">
                <select
                  value={picked}
                  onChange={(e) =>
                    handlePick(row.key, e.target.value || null)
                  }
                  aria-label={`${row.label} pick`}
                  className={
                    "w-full appearance-none rounded-sm border bg-bg px-3 py-2 pr-8 font-mono text-sm text-text-primary outline-none transition-colors duration-[var(--motion-micro)] focus:border-accent-muted " +
                    (picked
                      ? "border-accent-muted/50"
                      : "border-border")
                  }
                >
                  <option value="">Pick a team</option>
                  {sortedTeams.map((team) => {
                    const otherPosition = positionByTeam.get(team.id);
                    const takenElsewhere =
                      otherPosition != null && otherPosition !== row.key;
                    return (
                      <option
                        key={team.id}
                        value={team.id}
                        disabled={takenElsewhere}
                      >
                        {takenElsewhere
                          ? `${team.code} — ${team.name} · ${labelFor(otherPosition)} already`
                          : `${team.code} — ${team.name}`}
                      </option>
                    );
                  })}
                </select>
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-xs text-text-dim"
                >
                  ▾
                </span>
              </div>
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted tabular-nums">
                {row.points}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        <span>Locks at first match kickoff. Independent of your bracket.</span>
        <SaveStatusLabel status={saveStatus} hasAny={filledCount > 0} />
      </p>
    </section>
  );
}

function labelFor(key: keyof FinalistPicksState | undefined): string {
  if (key === "first_place_team_id") return "Champion";
  if (key === "second_place_team_id") return "Runner-up";
  if (key === "third_place_team_id") return "3rd";
  return "";
}

function SaveStatusLabel({
  status,
  hasAny,
}: {
  status: SaveStatus;
  hasAny: boolean;
}) {
  if (status === "saving") return <span className="text-text-muted">saving…</span>;
  if (status === "saved") return <span className="text-green-correct">saved</span>;
  if (status === "error") return <span className="text-red-wrong">retry</span>;
  return <span>{hasAny ? "saved" : "—"}</span>;
}
