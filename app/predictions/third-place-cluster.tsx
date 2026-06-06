"use client";

import type { HydratedTeam } from "@/lib/group-data";

// "Best third-placed teams" selector. The user picks WHICH 8 of the 12
// groups' third-placed teams advance to the R32. FIFA's Annex C lookup
// (lib/annex-c.ts) then deterministically assigns each one its R32
// opponent — so there is deliberately NO way to drag a team into a
// specific slot here. That assignment is what guarantees no group winner
// ever faces a 3rd-placed team from its own group.
//
// Two render modes:
//   - Pre-resolution: 12 checkboxes, exactly 8 selectable. Rows are
//     sorted by the user's predicted points → GD → GS (display-only), with
//     a "below the cutoff" divider after the 8th row anchored to that
//     ranking (it does not move as the user toggles).
//   - Post-resolution: once FIFA's real qualifying set is known, each row
//     shows whether the user's pick qualified (+1) or not.

type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface ThirdPlaceRow {
  group_letter: string;
  team: HydratedTeam;
  points: number;
  goal_difference: number;
  goals_for: number;
}

interface Props {
  /** The 12 predicted third-placed teams, pre-sorted points→GD→GS desc. */
  rows: ThirdPlaceRow[];
  /** Group letters the user has selected to qualify. */
  selected: ReadonlySet<string>;
  /** group_letter → save status. */
  saveStatus: ReadonlyMap<string, SaveStatus>;
  /** True once all 72 group-stage matches are predicted; gates the selector. */
  groupPredictionsComplete: boolean;
  /**
   * FIFA's real 8 qualifying third-placed team_ids, or null until group
   * stage has settled. When set, the selector switches to results mode.
   */
  realQualifyingThirdTeamIds: ReadonlySet<string> | null;
  onToggle: (group_letter: string, selected: boolean) => void;
}

const MAX = 8;

export function ThirdPlaceCluster({
  rows,
  selected,
  saveStatus,
  groupPredictionsComplete,
  realQualifyingThirdTeamIds,
  onToggle,
}: Props) {
  const resolved = realQualifyingThirdTeamIds != null;
  const count = selected.size;
  const atCapacity = count >= MAX;

  const correctCount = resolved
    ? rows.reduce((acc, r) => {
        const picked = selected.has(r.group_letter);
        const qualified = realQualifyingThirdTeamIds!.has(r.team.id);
        return picked && qualified ? acc + 1 : acc;
      }, 0)
    : 0;

  const disabled = resolved || !groupPredictionsComplete;
  const valid = count === MAX;

  return (
    <section
      aria-label="Best third-placed teams"
      className="mb-6 rounded-md border border-border bg-surface px-5 py-4"
    >
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
            BEST THIRD-PLACED TEAMS · SIDE BET
          </p>
          <h3
            className="mt-1 font-display text-2xl leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Which 8 thirds advance?
          </h3>
        </div>
        <span
          className={
            "font-mono text-[10px] uppercase tracking-[0.06em] tabular-nums whitespace-nowrap " +
            (resolved
              ? "text-text-dim"
              : valid
                ? "text-green-correct"
                : "text-accent")
          }
        >
          {resolved
            ? `${correctCount}/8 CORRECT`
            : `${count} OF 8 SELECTED`}
        </span>
      </header>

      <ul className="mt-5 flex flex-col gap-2">
        {rows.map((row, idx) => {
          const picked = selected.has(row.group_letter);
          const status = saveStatus.get(row.group_letter) ?? "idle";
          const showCutoff = !resolved && idx === MAX;

          if (resolved) {
            const qualified = realQualifyingThirdTeamIds!.has(row.team.id);
            const correct = picked && qualified;
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
                    (correct
                      ? "border-green-correct/40"
                      : picked
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
                    {picked ? "you picked" : qualified ? "advanced" : ""}
                  </span>
                </div>
                <span
                  className={
                    "w-10 shrink-0 text-right font-mono text-[10px] font-bold uppercase tracking-[0.06em] tabular-nums " +
                    (correct ? "text-green-correct" : "text-text-dim")
                  }
                >
                  {correct ? "+1" : picked ? "0" : ""}
                </span>
              </li>
            );
          }

          const lockOut = disabled || (!picked && atCapacity);
          return (
            <li
              key={row.group_letter}
              className={cutoffClass(showCutoff)}
            >
              <label
                className={
                  "flex items-center gap-3 rounded-sm border px-3 py-2 transition-colors duration-[var(--motion-micro)] " +
                  (picked
                    ? "border-accent-muted/50 bg-surface-high"
                    : "border-border bg-bg") +
                  (lockOut
                    ? " cursor-not-allowed opacity-40"
                    : " cursor-pointer hover:border-accent-muted")
                }
                style={{ minHeight: 44 }}
              >
                <input
                  type="checkbox"
                  checked={picked}
                  disabled={lockOut}
                  onChange={(e) => onToggle(row.group_letter, e.target.checked)}
                  aria-label={`Select 3rd-placed team of Group ${row.group_letter} (${row.team.name}) to advance`}
                  className="h-4 w-4 shrink-0 accent-[var(--color-accent,#F59E0B)]"
                />
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
                  {status === "saving"
                    ? "…"
                    : status === "error"
                      ? "retry"
                      : `${row.points}PT ${fmtGd(row.goal_difference)}`}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        {resolved
          ? `FIFA's 8 best thirds are set. You scored ${correctCount} of 8 here.`
          : !groupPredictionsComplete
            ? "Finish your group-stage predictions to unlock these picks."
            : valid
              ? "Locked in 8 · FIFA's Annex C decides each one's R32 opponent (+1 PT per correct qualifier)."
              : `Select exactly 8 of 12 · ${MAX - count} to go. The bracket fills in once you've picked 8.`}
      </p>
    </section>
  );
}

function cutoffClass(showCutoff: boolean): string {
  // Thin separator above the 9th sorted row — a visual hint of where the
  // score-based tiebreakers would land. Anchored to the ranking, not the
  // selection (it never moves as the user toggles).
  return showCutoff ? "border-t border-dashed border-border pt-2 mt-1" : "";
}

function fmtGd(gd: number): string {
  return gd > 0 ? `+${gd}` : `${gd}`;
}
