"use client";

import { useMemo } from "react";
import type { HydratedTeam } from "@/lib/group-data";

// The 8 R32 best-3rd-N slots, picked manually by the user from the
// 12 teams their group-stage predictions ranked third in each group.
// This stands in for FIFA's ~495-permutation tiebreaker table — turning
// a tedious lookup into a stakes-bearing side bet (+1 pt per correct pick).

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface SlotMeta {
  /** bracket_slot.id, e.g. "r32-best-3rd-3" — what we POST to the API. */
  slot_id: string;
  /** "best-3rd-1" through "best-3rd-8" — display index. */
  slot_label: string;
}

interface Props {
  slots: SlotMeta[];
  /** The 12 teams the user's group predictions ranked 3rd, indexed by group letter. */
  predictedThirds: HydratedTeam[];
  /** slot_id → predicted team_id (only entries the user has picked). */
  picks: ReadonlyMap<string, string>;
  saveStatus: ReadonlyMap<string, SaveStatus>;
  /** True once all 72 group-stage matches have been predicted; gates the cluster. */
  groupPredictionsComplete: boolean;
  onChange: (slot_id: string, team_id: string | null) => void;
}

export function ThirdPlaceCluster({
  slots,
  predictedThirds,
  picks,
  saveStatus,
  groupPredictionsComplete,
  onChange,
}: Props) {
  // Build the "which team is already taken by which slot" map so we can
  // disable duplicates across dropdowns.
  const slotByTeam = useMemo(() => {
    const m = new Map<string, string>();
    for (const [slot_id, team_id] of picks) m.set(team_id, slot_id);
    return m;
  }, [picks]);

  const filledCount = picks.size;
  const disabled = !groupPredictionsComplete;

  return (
    <section
      aria-label="Third-place R32 slot picks"
      className="mb-6 rounded-md border border-border bg-surface px-5 py-4"
    >
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
            BEST-3RD R32 SLOTS · SIDE BET
          </p>
          <h3
            className="mt-1 font-display text-2xl leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Third-place placements
          </h3>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums whitespace-nowrap">
          {filledCount}/8 PICKED
        </span>
      </header>

      <ul className="mt-5 grid grid-cols-1 gap-2 md:grid-cols-2">
        {slots.map((slot, idx) => {
          const picked = picks.get(slot.slot_id) ?? "";
          const status = saveStatus.get(slot.slot_id) ?? "idle";
          return (
            <li key={slot.slot_id} className="flex items-center gap-3">
              <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted tabular-nums">
                3RD-{idx + 1}
              </span>
              <div className="relative flex-1">
                <select
                  value={picked}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange(slot.slot_id, e.target.value || null)
                  }
                  aria-label={`Best-3rd slot ${idx + 1} team pick`}
                  className={
                    "w-full appearance-none rounded-sm border bg-bg px-3 py-2 pr-8 font-mono text-sm text-text-primary outline-none transition-colors duration-[var(--motion-micro)] focus:border-accent-muted disabled:cursor-not-allowed disabled:opacity-40 " +
                    (picked
                      ? "border-accent-muted/50"
                      : "border-border")
                  }
                >
                  <option value="">
                    {disabled ? "—" : "Pick a 3rd-place team"}
                  </option>
                  {predictedThirds.map((team) => {
                    const takenBy = slotByTeam.get(team.id);
                    const takenElsewhere =
                      takenBy != null && takenBy !== slot.slot_id;
                    return (
                      <option
                        key={team.id}
                        value={team.id}
                        disabled={takenElsewhere}
                      >
                        {takenElsewhere
                          ? `${team.code} — ${team.name} · already picked`
                          : `${team.code} — ${team.name} · Group ${team.group_letter}`}
                      </option>
                    );
                  })}
                </select>
                {/* Chevron */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-xs text-text-dim"
                >
                  ▾
                </span>
              </div>
              <span
                className={
                  "shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] tabular-nums " +
                  (saveStatusClass(status) ?? "text-text-muted")
                }
              >
                {saveStatusLabel(status, !!picked)}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        {disabled
          ? "Finish your group-stage predictions to unlock these picks."
          : "+1 PT IF CORRECT · whichever group's 3rd-place lands in each slot per FIFA's bracket structure."}
      </p>
    </section>
  );
}

function saveStatusLabel(status: SaveStatus, hasPick: boolean): string {
  if (status === "saving") return "saving…";
  if (status === "saved") return "saved";
  if (status === "error") return "retry";
  return hasPick ? "+1 PT" : "+1 PT";
}

function saveStatusClass(status: SaveStatus): string | null {
  if (status === "saved") return "text-green-correct";
  if (status === "error") return "text-red-wrong";
  return null;
}
