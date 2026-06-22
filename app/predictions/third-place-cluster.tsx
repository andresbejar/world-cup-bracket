"use client";

import type { HydratedTeam } from "@/lib/group-data";

// "Best third-placed teams" — read-only, auto-derived display.
//
// This used to be a manual side bet where the user picked which 8 of the 12
// groups' third-placed teams advance. That bet was retired: it locked at
// R32's deadline, by which point every group match had finished and the
// answer was public — a free-points leak. It now contributes 0 to the
// leaderboard (see lib/scoring-runtime.ts) and is purely informational.
//
// The 8 that advance are derived automatically from current real standings:
// the 12 thirds are ranked by points → GD → goals for, and the top 8 (the
// `derived` set) qualify. FIFA's Annex C then assigns each its R32 opponent
// (no same-group rematch).
//
// Two render modes:
//   - Pre-resolution: the 12 thirds, ranked, with the top-8 highlighted and
//     a "below the cutoff" divider after the 8th row.
//   - Post-resolution: once FIFA's real qualifying set is settled, each
//     derived row shows whether it officially advanced. No points.

export interface ThirdPlaceRow {
  group_letter: string;
  team: HydratedTeam;
  points: number;
  goal_difference: number;
  goals_for: number;
}

interface Props {
  /** The 12 third-placed teams by current real standings, pre-sorted points→GD→GS desc. */
  rows: ThirdPlaceRow[];
  /** Group letters whose 3rd-placed team is auto-derived to advance (top 8). */
  derived: ReadonlySet<string>;
  /**
   * FIFA's real 8 qualifying third-placed team_ids, or null until group
   * stage has settled. When set, the display switches to results mode.
   */
  realQualifyingThirdTeamIds: ReadonlySet<string> | null;
}

const MAX = 8;

export function ThirdPlaceCluster({
  rows,
  derived,
  realQualifyingThirdTeamIds,
}: Props) {
  const resolved = realQualifyingThirdTeamIds != null;

  // How many of the derived top-8 actually advanced (informational only).
  const matchedCount = resolved
    ? rows.reduce((acc, r) => {
        const isDerived = derived.has(r.group_letter);
        const qualified = realQualifyingThirdTeamIds!.has(r.team.id);
        return isDerived && qualified ? acc + 1 : acc;
      }, 0)
    : 0;

  return (
    <section
      aria-label="Best third-placed teams"
      className="mb-6 rounded-md border border-border bg-surface px-5 py-4"
    >
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
            BEST THIRD-PLACED TEAMS · NOT SCORED
          </p>
          <h3
            className="mt-1 font-display text-2xl leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Who advances on points
          </h3>
        </div>
        <span
          aria-live="polite"
          className="font-mono text-[10px] uppercase tracking-[0.06em] tabular-nums whitespace-nowrap text-text-dim"
        >
          {resolved ? `${matchedCount}/8 MATCHED` : "TOP 8 BY CURRENT STANDINGS"}
        </span>
      </header>

      <ul className="mt-5 flex flex-col gap-2">
        {rows.map((row, idx) => {
          const isDerived = derived.has(row.group_letter);
          const showCutoff = idx === MAX;

          if (resolved) {
            const qualified = realQualifyingThirdTeamIds!.has(row.team.id);
            const hit = isDerived && qualified;
            return (
              <li
                key={row.group_letter}
                className={cutoffClass(showCutoff) + " flex items-center gap-3"}
              >
                <span className="w-10 shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted tabular-nums">
                  3{row.group_letter}
                </span>
                <div
                  className={
                    "flex flex-1 items-center gap-2 rounded-sm border bg-bg px-3 py-2 " +
                    (hit
                      ? "border-green-correct/40"
                      : isDerived
                        ? "border-red-wrong/40"
                        : "border-border opacity-60")
                  }
                >
                  <span className="font-mono text-sm font-bold uppercase tracking-[0.06em] text-text-primary">
                    {row.team.code}
                  </span>
                  <span className="truncate text-sm text-text-muted">
                    {row.team.name}
                  </span>
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
                    {isDerived
                      ? qualified
                        ? "advanced"
                        : "missed"
                      : qualified
                        ? "advanced"
                        : ""}
                  </span>
                </div>
              </li>
            );
          }

          return (
            <li key={row.group_letter} className={cutoffClass(showCutoff)}>
              <div
                className={
                  "flex items-center gap-3 rounded-sm border px-3 py-2 " +
                  (isDerived
                    ? "border-accent-muted/50 bg-surface-high"
                    : "border-border bg-bg opacity-50")
                }
                style={{ minHeight: 44 }}
              >
                <span className="w-8 shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted tabular-nums">
                  3{row.group_letter}
                </span>
                <span className="font-mono text-sm font-bold uppercase tracking-[0.06em] text-text-primary">
                  {row.team.code}
                </span>
                <span className="truncate text-sm text-text-muted">
                  {row.team.name}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
                  {`${row.points}PT ${fmtGd(row.goal_difference)}`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        {resolved
          ? `FIFA's 8 best thirds are set · ${matchedCount} of the top 8 by standings advanced (not scored).`
          : "Top 8 third-placed teams by current standings advance · Annex C sets each one's R32 opponent · not scored."}
      </p>
    </section>
  );
}

function cutoffClass(showCutoff: boolean): string {
  // Thin separator above the 9th sorted row — the points-based cutoff
  // between the 8 that advance and the 4 that don't.
  return showCutoff ? "border-t border-dashed border-border pt-2 mt-1" : "";
}

function fmtGd(gd: number): string {
  return gd > 0 ? `+${gd}` : `${gd}`;
}
