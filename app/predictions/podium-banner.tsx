"use client";

import { useEffect, useState } from "react";

// Sticky alert that nags the user to submit their podium picks before
// first kickoff. The picks lock at first match start (not at the FINAL
// round's 4hr-pre-deadline), so missing the window = losing the side
// bet entirely. Family-beta testers will not internalize that timing
// from the FINAL tab alone — hence this banner.
//
// Two urgency tiers:
//   - default (>24h): low-key, surface-level border, advisory tone
//   - urgent (≤24h): accent-filled, bolder text, deadline countdown
//
// Hidden when picks are filled (3/3) or the deadline has passed.

interface Props {
  filledCount: number;
  totalCount: number;
  /** ISO 8601 timestamp of first match kickoff. Null when no group matches loaded. */
  firstKickoffAt: string | null;
  /** Click handler — jumps to the PODIUM tab. */
  onJump: () => void;
}

const URGENT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function PodiumBanner({
  filledCount,
  totalCount,
  firstKickoffAt,
  onJump,
}: Props) {
  // Tick once a minute so the countdown stays roughly accurate without
  // a render loop. 60s granularity is enough for a >hours-away deadline.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!firstKickoffAt) return null;
  if (filledCount >= totalCount) return null;

  const deadlineMs = new Date(firstKickoffAt).getTime();
  const remaining = deadlineMs - now;
  if (remaining <= 0) return null;

  const urgent = remaining <= URGENT_THRESHOLD_MS;
  const countdown = formatCountdown(remaining);
  const deadlineLabel = formatDeadline(firstKickoffAt);

  return (
    <button
      type="button"
      onClick={onJump}
      aria-label="Jump to podium picks"
      className={
        "group mb-6 flex w-full flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors duration-[var(--motion-micro)] " +
        (urgent
          ? "border-accent bg-accent/10 hover:bg-accent/15"
          : "border-accent-muted/40 bg-surface hover:bg-surface-high")
      }
    >
      <div className="flex min-w-0 flex-col">
        <span
          className={
            "font-mono text-[11px] font-bold uppercase tracking-[0.1em] " +
            (urgent ? "text-accent" : "text-text-muted")
          }
        >
          {urgent ? "PODIUM LOCKS IN " : "PODIUM SIDE BET · "}
          <span className="tabular-nums">{countdown}</span>
        </span>
        <span className="mt-0.5 text-sm text-text-primary">
          Submit your Champion / Runner-up / Third before first kickoff
          {urgent ? "" : ` (locks ${deadlineLabel})`}.
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted tabular-nums">
          {filledCount}/{totalCount} PICKED
        </span>
        <span
          className={
            "rounded-full border px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.08em] transition-colors duration-[var(--motion-micro)] " +
            (urgent
              ? "border-transparent bg-accent text-bg"
              : "border-accent-muted/60 text-text-primary group-hover:border-accent")
          }
        >
          Fix it →
        </span>
      </div>
    </button>
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "LOCKED";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days >= 1) return `${days}D ${hours.toString().padStart(2, "0")}H`;
  if (hours >= 1) return `${hours}H ${minutes.toString().padStart(2, "0")}M`;
  return `${minutes}M`;
}

function formatDeadline(iso: string): string {
  return new Date(iso)
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
}
