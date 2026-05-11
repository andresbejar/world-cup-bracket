"use client";

import { useState } from "react";
import { ScoreInput } from "./score-input";
import type { HydratedKnockoutMatch } from "@/lib/group-data";

// Knockout match card. Mirrors the group MatchCard layout but with two
// crucial differences driven by the no-ties-in-knockout-outcomes rule:
//
//   1. The two teams aren't fixed — they cascade from upstream
//      predictions and may be unresolved ("—") until earlier rounds
//      are picked. Score inputs disable in that state.
//
//   2. Winner derivation is automatic when the score isn't tied: the
//      side with more goals advances and `predicted_winning_slot_id`
//      is auto-set. When the user enters a tied score (e.g. 2-2),
//      the canonical 90+ET tie is resolved by penalties in real
//      football — so the card surfaces an inline penalty-winner
//      picker with two pill-radios. The user must pick one. (APT-21)

interface Props {
  match: HydratedKnockoutMatch;
  /** Resolved team codes from the cascade. Null when upstream isn't predicted yet. */
  homeTeam: string | null;
  awayTeam: string | null;
  /** Full team names if available — used in the penalty pill labels. */
  homeName: string | null;
  awayName: string | null;
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
  homeName,
  awayName,
  homeScore,
  awayScore,
  predictedWinnerSlotId,
  saveStatus,
  onChange,
}: Props) {
  const [focused, setFocused] = useState(false);
  const ready = homeTeam != null && awayTeam != null;
  const hasScore = homeScore != null && awayScore != null;
  const tied = hasScore && homeScore === awayScore;
  const filled =
    hasScore &&
    predictedWinnerSlotId != null &&
    // Tied state requires an explicit penalty pick; non-tied state
    // auto-derives, so "filled" === any winner set.
    (!tied || predictedWinnerSlotId !== null);

  // Compute the auto-derived winner from a candidate score. Used by the
  // score inputs so changing a score updates the winner side at the same
  // beat — no laggy effects, no infinite-loop risk.
  const autoWinner = (h: number, a: number): string | null => {
    if (h > a) return match.home_slot_id;
    if (a > h) return match.away_slot_id;
    // Tied: keep the user's current pick (or null on first entry).
    return predictedWinnerSlotId;
  };

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
          <KnockoutTeamRow team={homeTeam} name={homeName} />
          <KnockoutTeamRow team={awayTeam} name={awayName} />
        </div>

        <div className="flex flex-col items-end gap-1.5 self-end sm:self-auto">
          <div className="flex items-center gap-2">
            <ScoreInput
              value={homeScore ?? 0}
              onChange={(n) => {
                if (!ready) return;
                const a = awayScore ?? 0;
                onChange(n, a, autoWinner(n, a));
              }}
              ariaLabel="Home score"
            />
            <span className="font-mono text-xs text-text-dim">:</span>
            <ScoreInput
              value={awayScore ?? 0}
              onChange={(n) => {
                if (!ready) return;
                const h = homeScore ?? 0;
                onChange(h, n, autoWinner(h, n));
              }}
              ariaLabel="Away score"
            />
          </div>
          <SaveStatusLabel
            status={saveStatus}
            ready={ready}
            filled={filled}
          />
        </div>
      </div>

      {tied && ready ? (
        <PenaltyPicker
          homeTeam={homeTeam}
          homeName={homeName}
          awayTeam={awayTeam}
          awayName={awayName}
          homeSelected={predictedWinnerSlotId === match.home_slot_id}
          awaySelected={predictedWinnerSlotId === match.away_slot_id}
          onPick={(side) =>
            onChange(
              homeScore!,
              awayScore!,
              side === "home" ? match.home_slot_id : match.away_slot_id,
            )
          }
        />
      ) : null}

      {!ready ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
          Pick winners in earlier rounds to unlock this match.
        </p>
      ) : null}
    </article>
  );
}

function KnockoutTeamRow({
  team,
  name,
}: {
  team: string | null;
  name: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden className="h-5 w-7 rounded-sm bg-surface-high" />
      {team ? (
        <>
          <span className="font-mono text-sm font-bold uppercase tracking-[0.06em] text-text-primary">
            {team}
          </span>
          {name ? (
            <span className="truncate text-sm text-text-muted">{name}</span>
          ) : null}
        </>
      ) : (
        <span className="font-mono text-sm uppercase tracking-[0.06em] text-text-dim">
          —
        </span>
      )}
    </div>
  );
}

function PenaltyPicker({
  homeTeam,
  homeName,
  awayTeam,
  awayName,
  homeSelected,
  awaySelected,
  onPick,
}: {
  homeTeam: string | null;
  homeName: string | null;
  awayTeam: string | null;
  awayName: string | null;
  homeSelected: boolean;
  awaySelected: boolean;
  onPick: (side: "home" | "away") => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Penalty-shootout winner"
      className="flex flex-wrap items-center gap-3 border-t border-dashed border-border pt-3"
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted">
        Tied at 90+ET · penalty winner
      </span>
      <PenaltyPill
        team={homeTeam}
        name={homeName}
        selected={homeSelected}
        onClick={() => onPick("home")}
      />
      <PenaltyPill
        team={awayTeam}
        name={awayName}
        selected={awaySelected}
        onClick={() => onPick("away")}
      />
      <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted">
        +1 PT IF CORRECT
      </span>
    </div>
  );
}

function PenaltyPill({
  team,
  name,
  selected,
  onClick,
}: {
  team: string | null;
  name: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      role="radio"
      aria-checked={selected}
      className={
        "rounded-full border px-3 py-1 font-mono text-xs font-medium tracking-[0.04em] transition-colors duration-[var(--motion-micro)] " +
        (selected
          ? "border-accent bg-accent text-bg"
          : "border-border bg-surface-high text-text-muted hover:text-text-primary")
      }
    >
      {team ?? "—"}
      {name ? <span className="ml-1.5 normal-case">· {name}</span> : null}
    </button>
  );
}

function SaveStatusLabel({
  status,
  ready,
  filled,
}: {
  status: "idle" | "saving" | "saved" | "error";
  ready: boolean;
  filled: boolean;
}) {
  if (!ready)
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        locked
      </span>
    );
  if (status === "saving")
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
        saving…
      </span>
    );
  if (status === "saved")
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-green-correct">
        saved
      </span>
    );
  if (status === "error")
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-red-wrong">
        retry
      </span>
    );
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
      {filled ? "saved" : "—"}
    </span>
  );
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
