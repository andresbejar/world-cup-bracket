"use client";

import type { ReactNode } from "react";

// Predicted-vs-real triptych — DESIGN.md § Component Vocabulary calls
// this "the soul of the product". Replaces the editable MatchCard /
// KnockoutCard once a match flips to status='finished'.
//
// Pure presentational — caller does all the prediction/cascade resolution
// and passes raw bits in. We just render the comparison.

type Severity = "exact" | "partial" | "wrong";

interface MatchLine {
  homeCode: string;
  awayCode: string;
  /** Goals at 90+ET. Null when the user never picked. */
  homeScore: number | null;
  awayScore: number | null;
  /**
   * Knockout matches only — the 3-letter code of whichever side advanced
   * (via regulation or penalties). Null for group matches and for unfilled
   * predictions. When non-null AND scores are tied, we annotate ON PENS.
   */
  winnerCode: string | null;
}

interface Props {
  /** "GROUP A · M03 · MAR 15 14:00" — left meta line. */
  meta: string;
  homeName: string | null;
  awayName: string | null;
  predicted: MatchLine | null;
  actual: MatchLine;
  /**
   * `computeMatchPoints` output: 3 (exact + outcome), 1 (outcome only),
   * 0 (wrong), or null when there's no prediction to score.
   */
  pointsAwarded: number | null;
  /** Optional footer slot (e.g. the "view everyone's picks" CTA). */
  footer?: ReactNode;
}

export function PredictedVsRealCard({
  meta,
  homeName,
  awayName,
  predicted,
  actual,
  pointsAwarded,
  footer,
}: Props) {
  const severity = severityOf(pointsAwarded);

  // Subtle gradient tint — DESIGN.md "NOT thick colored left border".
  // Mixes the semantic color at ~6% opacity into surface at the leading
  // edge, fading to neutral surface. Same hue family as the points badge.
  const tintColor = severity ? COLOR_VAR[severity] : null;
  const cardStyle = tintColor
    ? {
        backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${tintColor} 8%, var(--surface)) 0%, var(--surface) 65%)`,
      }
    : undefined;

  return (
    <article
      className="relative flex flex-col gap-3 rounded-md border border-border px-4 py-3.5 sm:px-5 sm:py-4"
      style={cardStyle}
      aria-label={`Finished match — ${actual.homeCode} versus ${actual.awayCode}`}
    >
      <header className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
          {meta}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
          FINAL
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <TriptychRow
          label="YOUR PICK"
          line={predicted}
          fallbackHomeName={homeName}
          fallbackAwayName={awayName}
          emptyMessage="You didn't predict this match."
        />
        <div className="h-px w-full bg-border/60" aria-hidden />
        <TriptychRow
          label="ACTUAL"
          line={actual}
          fallbackHomeName={homeName}
          fallbackAwayName={awayName}
          emptyMessage=""
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        {footer ?? <span />}
        <PointsBadge pointsAwarded={pointsAwarded} severity={severity} />
      </div>
    </article>
  );
}

function TriptychRow({
  label,
  line,
  fallbackHomeName,
  fallbackAwayName,
  emptyMessage,
}: {
  label: string;
  line: MatchLine | null;
  fallbackHomeName: string | null;
  fallbackAwayName: string | null;
  emptyMessage: string;
}) {
  if (!line) {
    return (
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">
          {label}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-dim">
          {emptyMessage || "—"}
        </span>
      </div>
    );
  }
  const tied =
    line.homeScore != null &&
    line.awayScore != null &&
    line.homeScore === line.awayScore;
  const penNote =
    tied && line.winnerCode ? ` · ${line.winnerCode} ON PENS` : "";
  const scoreText =
    line.homeScore != null && line.awayScore != null
      ? `${line.homeScore} - ${line.awayScore}`
      : "—";
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">
        {label}
      </span>
      <TeamSide code={line.homeCode} name={fallbackHomeName} />
      <span className="ml-auto font-mono text-sm font-bold tabular-nums text-text-primary">
        {scoreText}
      </span>
      <TeamSide code={line.awayCode} name={fallbackAwayName} align="right" />
      {penNote ? (
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
          {penNote}
        </span>
      ) : null}
    </div>
  );
}

function TeamSide({
  code,
  name,
  align = "left",
}: {
  code: string;
  name: string | null;
  align?: "left" | "right";
}) {
  const direction = align === "right" ? "flex-row-reverse" : "flex-row";
  return (
    <span className={`flex min-w-0 items-center gap-2 ${direction}`}>
      <span className="font-mono text-sm font-bold uppercase tracking-[0.06em] text-text-primary">
        {code}
      </span>
      {name ? (
        <span className="hidden truncate text-xs text-text-dim sm:inline">
          {name}
        </span>
      ) : null}
    </span>
  );
}

function PointsBadge({
  pointsAwarded,
  severity,
}: {
  pointsAwarded: number | null;
  severity: Severity | null;
}): ReactNode {
  if (pointsAwarded == null || severity == null) {
    return (
      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
        no pick · 0 pts
      </span>
    );
  }
  const label =
    pointsAwarded === 3
      ? "+3 pts · exact"
      : pointsAwarded === 1
        ? "+1 pt · outcome"
        : "0 pts";
  return (
    <span
      className={
        "font-mono text-[11px] font-bold uppercase tracking-[0.06em] tabular-nums " +
        COLOR_CLASS[severity]
      }
    >
      {label}
    </span>
  );
}

function severityOf(points: number | null): Severity | null {
  if (points == null) return null;
  if (points >= 3) return "exact";
  if (points >= 1) return "partial";
  return "wrong";
}

const COLOR_VAR: Record<Severity, string> = {
  exact: "var(--green-correct)",
  partial: "var(--yellow-partial)",
  wrong: "var(--red-wrong)",
};

const COLOR_CLASS: Record<Severity, string> = {
  exact: "text-green-correct",
  partial: "text-yellow-partial",
  wrong: "text-red-wrong",
};
