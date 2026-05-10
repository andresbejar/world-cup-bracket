"use client";

import { useMemo } from "react";
import {
  computeGroupStandings,
  GROUP_LETTERS,
  populateR32Slots,
  type GroupStandings,
  type MatchScore,
  type SlotAssignment,
  type Team,
} from "@/lib/bracket";
import { R32_MATCHES } from "@/lib/bracket-structure";
import type { HydratedMatch, HydratedTeam } from "@/lib/group-data";

// Reactive bracket-tree sidebar: pulls live group predictions from the
// parent client and recomputes standings + R32 slot occupants on every
// score change. Heavy use of useMemo so a single score edit doesn't
// re-render the whole 32-slot tree on every keystroke.

interface Props {
  groupTeams: HydratedTeam[];
  groupMatches: HydratedMatch[];
  /** match_id → predicted score; entries omitted when the user hasn't filled one. */
  predictions: ReadonlyMap<string, { home: number; away: number }>;
}

export function BracketTreeSidebar({
  groupTeams,
  groupMatches,
  predictions,
}: Props) {
  const standingsByGroup = useMemo(() => {
    const matchById = new Map(groupMatches.map((m) => [m.id, m]));
    const scoresByGroup = new Map<string, MatchScore[]>();
    for (const letter of GROUP_LETTERS) scoresByGroup.set(letter, []);
    for (const [matchId, score] of predictions) {
      const m = matchById.get(matchId);
      if (!m) continue;
      const bucket = scoresByGroup.get(m.home.group_letter);
      if (!bucket) continue;
      bucket.push({
        home_team_id: m.home.id,
        away_team_id: m.away.id,
        home_score: score.home,
        away_score: score.away,
      });
    }
    const teamsByGroup = new Map<string, Team[]>();
    for (const letter of GROUP_LETTERS) teamsByGroup.set(letter, []);
    for (const t of groupTeams) {
      teamsByGroup.get(t.group_letter)?.push({
        id: t.id,
        group_letter: t.group_letter,
      });
    }
    const result: GroupStandings[] = [];
    for (const letter of GROUP_LETTERS) {
      const teams = teamsByGroup.get(letter) ?? [];
      const scores = scoresByGroup.get(letter) ?? [];
      result.push({
        group_letter: letter,
        standings: computeGroupStandings(scores, teams),
      });
    }
    return result;
  }, [groupTeams, groupMatches, predictions]);

  const r32Slots: SlotAssignment[] = useMemo(
    () => populateR32Slots(standingsByGroup, []),
    [standingsByGroup],
  );

  const slotByLabel = useMemo(
    () => new Map(r32Slots.map((s) => [s.slot_label, s.team_id])),
    [r32Slots],
  );

  const teamCodeById = useMemo(
    () => new Map(groupTeams.map((t) => [t.id, t.code])),
    [groupTeams],
  );

  const filledCount = r32Slots.filter((s) => s.team_id != null).length;

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
            BRACKET · LIVE
          </p>
          <h3
            className="mt-1 font-display text-2xl leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Knockout tree
          </h3>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
          {filledCount}/32 SLOTS
        </span>
      </div>

      <ul className="mt-5 grid grid-cols-2 gap-2.5">
        {R32_MATCHES.map((m) => {
          const home = slotByLabel.get(m.home_slot_label);
          const away = slotByLabel.get(m.away_slot_label);
          return (
            <li
              key={m.id}
              className="rounded-sm border border-border bg-bg p-2.5"
            >
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-dim tabular-nums">
                R32 · M{m.match_index.toString().padStart(2, "0")}
              </p>
              <p className="mt-1 flex items-baseline justify-between gap-2 font-mono text-sm">
                <span className="text-[10px] uppercase tracking-[0.06em] text-text-dim">
                  {labelHint(m.home_slot_label)}
                </span>
                <span
                  className={
                    home
                      ? "font-bold tabular-nums text-text-primary"
                      : "text-text-dim"
                  }
                >
                  {home ? teamCodeById.get(home) ?? home : "—"}
                </span>
              </p>
              <p className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-sm">
                <span className="text-[10px] uppercase tracking-[0.06em] text-text-dim">
                  {labelHint(m.away_slot_label)}
                </span>
                <span
                  className={
                    away
                      ? "font-bold tabular-nums text-text-primary"
                      : "text-text-dim"
                  }
                >
                  {away ? teamCodeById.get(away) ?? away : "—"}
                </span>
              </p>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        Best-3rd slots fill once you pick them — APT-22.
      </p>
    </div>
  );
}

// Compress slot-label vocabulary into 5-6 char hints for the sidebar.
//   "winner-A"      → "W A"
//   "runner-up-C"   → "R C"
//   "best-3rd-1"    → "3RD 1"
function labelHint(label: string): string {
  const winner = /^winner-([A-L])$/.exec(label);
  if (winner) return `W ${winner[1]}`;
  const runner = /^runner-up-([A-L])$/.exec(label);
  if (runner) return `R ${runner[1]}`;
  const third = /^best-3rd-(\d)$/.exec(label);
  if (third) return `3RD ${third[1]}`;
  return label;
}
