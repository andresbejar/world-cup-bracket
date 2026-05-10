"use client";

import { useState } from "react";
import { ScoreInput } from "./score-input";
import type { HydratedKnockoutMatch } from "@/lib/group-data";

// Knockout match card. Like the group MatchCard, with two key differences:
//   1. The two teams aren't fixed — they cascade from upstream predictions
//      and may be unknown ("—") until the user picks earlier rounds.
//   2. There are two winner-pick pills under the score; the user MUST
//      pick a slot to advance (knockout outcomes can't be tied). The
//      pill state drives `predicted_winning_slot_id` in the API payload.
//
// Disabled state: if either home or away team is unresolved (cascade
// upstream missing a prediction), the score inputs and winner pills
// disable. The user has to fill in earlier rounds first.

interface Props {
  match: HydratedKnockoutMatch;
  /** Resolved team codes from the cascade. Null when upstream isn't predicted yet. */
  homeTeam: string | null;
  awayTeam: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Currently-picked slot id (winner). Either home_slot_id, away_slot_id, or null. */
  predictedWinnerSlotId: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  onChange: (
    homeScore: number,
    awayScore: number,
    winnerSlotId: string | null,
  ) => void;
}

export function KnockoutCard({
  match,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  predictedWinnerSlotId,
  saveStatus,
  onChange,
}: Props) {
  const [focused, setFocused] = useState(false);
  const ready = homeTeam != null && awayTeam != null;
  const filled =
    homeScore != null && awayScore != null && predictedWinnerSlotId != null;

  return (
    <article
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      className={
        "group flex flex-col gap-3 rounded-md border px-4 py-3.5 transition-colors duration-[var(--motion-micro)] " +
        (focused
          ? "border-accent-muted bg-surface-high"
          : filled
            ? "border-accent-muted/50 bg-surface"
            : "border-border bg-surface") +
        (ready ? "" : " opacity-60")
      }
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
          {roundLabel(match.round_id)} · M
          {match.match_index.toString().padStart(2, "0")}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
          {shortDateTime(match.scheduled_at)}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <KnockoutTeamRow team={homeTeam} />
          <KnockoutTeamRow team={awayTeam} />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <ScoreInput
            value={homeScore ?? 0}
            onChange={(n) =>
              ready &&
              onChange(n, awayScore ?? 0, predictedWinnerSlotId)
            }
            ariaLabel="Home score"
          />
          <span className="font-mono text-xs text-text-dim">:</span>
          <ScoreInput
            value={awayScore ?? 0}
            onChange={(n) =>
              ready &&
              onChange(homeScore ?? 0, n, predictedWinnerSlotId)
            }
            ariaLabel="Away score"
          />
        </div>
      </div>

      {/* Winner picker — two pills. User must pick a slot to advance. */}
      <div className="flex items-center gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
          Advances:
        </p>
        <WinnerPill
          team={homeTeam}
          selected={predictedWinnerSlotId === match.home_slot_id}
          disabled={!ready}
          onClick={() =>
            ready &&
            onChange(homeScore ?? 0, awayScore ?? 0, match.home_slot_id)
          }
        />
        <WinnerPill
          team={awayTeam}
          selected={predictedWinnerSlotId === match.away_slot_id}
          disabled={!ready}
          onClick={() =>
            ready &&
            onChange(homeScore ?? 0, awayScore ?? 0, match.away_slot_id)
          }
        />
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.06em]">
          <SaveStatus status={saveStatus} ready={ready} filled={filled} />
        </span>
      </div>

      {!ready ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
          Pick winners in earlier rounds to unlock this match.
        </p>
      ) : null}
    </article>
  );
}

function KnockoutTeamRow({ team }: { team: string | null }) {
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden
        className="h-5 w-7 rounded-sm bg-surface-high"
      />
      {team ? (
        <span className="font-mono text-sm font-bold uppercase tracking-[0.06em] text-text-primary">
          {team}
        </span>
      ) : (
        <span className="font-mono text-sm uppercase tracking-[0.06em] text-text-dim">
          —
        </span>
      )}
    </div>
  );
}

function WinnerPill({
  team,
  selected,
  disabled,
  onClick,
}: {
  team: string | null;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={
        "rounded-full border px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.06em] transition-colors duration-[var(--motion-micro)] disabled:opacity-40 " +
        (selected
          ? "border-accent bg-accent text-bg"
          : "border-border bg-surface-high text-text-primary hover:border-accent-muted")
      }
    >
      {team ?? "—"}
    </button>
  );
}

function SaveStatus({
  status,
  ready,
  filled,
}: {
  status: "idle" | "saving" | "saved" | "error";
  ready: boolean;
  filled: boolean;
}) {
  if (!ready)
    return <span className="text-text-dim">locked</span>;
  if (status === "saving") return <span className="text-text-muted">saving…</span>;
  if (status === "saved") return <span className="text-green-correct">saved</span>;
  if (status === "error") return <span className="text-red-wrong">retry</span>;
  return <span className="text-text-dim">{filled ? "saved" : "—"}</span>;
}

function roundLabel(roundId: string): string {
  switch (roundId) {
    case "r32":
      return "R32";
    case "r16":
      return "R16";
    case "qf":
      return "QF";
    case "sf":
      return "SF";
    case "third_place":
      return "3RD";
    case "final":
      return "FINAL";
    default:
      return roundId.toUpperCase();
  }
}

function shortDateTime(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(/ /g, " ");
}
