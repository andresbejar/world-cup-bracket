"use client";

import { useState } from "react";
import { ScoreInput } from "./score-input";
import { shortDateTime } from "@/lib/match-display";
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
  /**
   * Reality-merge annotation: when reality replaces a slot's team, this is
   * the team the user originally predicted there. Null when reality and
   * prediction agree (or when reality hasn't landed yet for this slot).
   */
  homePredictedCode: string | null;
  awayPredictedCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Currently-picked slot id (winner). Either home_slot_id, away_slot_id, or null. */
  predictedWinnerSlotId: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  /** Per-match lock (admin locked_at or kickoff passed) — freezes the steppers. */
  locked: boolean;
  /** "LOCKS IN …" countdown to this match's kickoff; null once locked. */
  lockHint: string | null;
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
  homePredictedCode,
  awayPredictedCode,
  homeScore,
  awayScore,
  predictedWinnerSlotId,
  saveStatus,
  locked,
  lockHint,
  onChange,
}: Props) {
  const [focused, setFocused] = useState(false);
  const ready = homeTeam != null && awayTeam != null;
  const editable = ready && !locked;
  const hasScore = homeScore != null && awayScore != null;
  const tied = hasScore && homeScore === awayScore;
  // A non-tied score auto-derives the winner; a tied score only gets one
  // after the explicit penalty pick — so "filled" === score + winner set.
  const filled = hasScore && predictedWinnerSlotId != null;

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
      <header className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
          {roundLabel(match.round_id)} · M
          {match.match_index.toString().padStart(2, "0")} ·{" "}
          {shortDateTime(match.scheduled_at)}
          {!locked && lockHint ? (
            <span className="text-accent"> · {lockHint}</span>
          ) : null}
        </p>
        <SaveStatusLabel
          status={saveStatus}
          ready={ready}
          filled={filled}
          locked={locked}
        />
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <KnockoutTeamRow
            team={homeTeam}
            name={homeName}
            predictedCode={homePredictedCode}
          />
          <ScoreInput
            value={homeScore}
            disabled={!editable}
            onChange={(n) => {
              if (!editable) return;
              const a = awayScore ?? 0;
              onChange(n, a, autoWinner(n, a));
            }}
            // Match-key prefix keeps the accessible name unique per card
            // (unresolved cards would otherwise all read "home score")
            // while still ending in "score" for the e2e selector contract.
            ariaLabel={`${roundLabel(match.round_id)} M${match.match_index} ${homeTeam ?? "home"} score`}
          />
        </div>
        <div className="flex items-center gap-3">
          <KnockoutTeamRow
            team={awayTeam}
            name={awayName}
            predictedCode={awayPredictedCode}
          />
          <ScoreInput
            value={awayScore}
            disabled={!editable}
            onChange={(n) => {
              if (!editable) return;
              const h = homeScore ?? 0;
              onChange(h, n, autoWinner(h, n));
            }}
            ariaLabel={`${roundLabel(match.round_id)} M${match.match_index} ${awayTeam ?? "away"} score`}
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
          disabled={locked}
          onPick={(side) => {
            if (locked) return;
            onChange(
              homeScore!,
              awayScore!,
              side === "home" ? match.home_slot_id : match.away_slot_id,
            );
          }}
        />
      ) : null}

      {!ready && !locked ? (
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
  predictedCode,
}: {
  team: string | null;
  name: string | null;
  predictedCode: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div aria-hidden className="h-5 w-7 shrink-0 rounded-sm bg-surface-high" />
      {team ? (
        <>
          <span className="font-mono text-sm font-bold uppercase tracking-[0.06em] text-text-primary">
            {team}
          </span>
          {name ? (
            <span className="truncate text-sm text-text-muted">{name}</span>
          ) : null}
          {predictedCode ? (
            <span
              className="ml-1 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim"
              title={`Your prediction: ${predictedCode}`}
            >
              · you predicted {predictedCode}
            </span>
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
  disabled,
  onPick,
}: {
  homeTeam: string | null;
  homeName: string | null;
  awayTeam: string | null;
  awayName: string | null;
  homeSelected: boolean;
  awaySelected: boolean;
  disabled: boolean;
  onPick: (side: "home" | "away") => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Penalty-shootout winner"
      className="flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-3 sm:gap-3"
    >
      <span className="w-full font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted sm:w-auto">
        Tied at 90+ET · penalty winner
      </span>
      <PenaltyPill
        team={homeTeam}
        name={homeName}
        selected={homeSelected}
        disabled={disabled}
        onClick={() => onPick("home")}
      />
      <PenaltyPill
        team={awayTeam}
        name={awayName}
        selected={awaySelected}
        disabled={disabled}
        onClick={() => onPick("away")}
      />
      <span className="w-full font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted sm:ml-auto sm:w-auto">
        +1 PT IF CORRECT
      </span>
    </div>
  );
}

function PenaltyPill({
  team,
  name,
  selected,
  disabled,
  onClick,
}: {
  team: string | null;
  name: string | null;
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
      role="radio"
      aria-checked={selected}
      // min-h-[44px] enforces the DESIGN.md § Accessibility touch-target
      // floor on mobile. Visual padding stays compact via the inner span,
      // so desktop rhythm isn't disturbed.
      className={
        "inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 font-mono text-xs font-medium tracking-[0.04em] transition-colors duration-[var(--motion-micro)] " +
        (selected
          ? "border-accent bg-accent text-bg"
          : disabled
            ? "border-border bg-surface-high text-text-dim"
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
  locked,
}: {
  status: "idle" | "saving" | "saved" | "error";
  ready: boolean;
  filled: boolean;
  locked: boolean;
}) {
  // Both flavors of frozen: the round itself is locked, or the matchup
  // hasn't resolved from upstream picks yet.
  if (locked || !ready)
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
