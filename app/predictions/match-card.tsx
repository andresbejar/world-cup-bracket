"use client";

import Image from "next/image";
import { useState } from "react";
import { ScoreInput } from "./score-input";
import { shortDateTime } from "@/lib/match-display";
import type { HydratedMatch } from "@/lib/group-data";

// Match card per DESIGN.md § Component Vocabulary. Meta + save status
// on a header line, then two stacked team rows, each ending in its own
// score stepper — team and score share a row so the pairing is
// unambiguous at any viewport width. Filled cards get a subtle
// confirmation tint (border picks up `--accent-muted`). Focus state
// pulls the card into `--surface-high` with the accent-muted border so
// the active match is unambiguous on a dense matchday view.

interface Props {
  match: HydratedMatch;
  matchIndex: number;
  homeScore: number | null;
  awayScore: number | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  /** Round lock (admin locked_at or past deadline_at) — freezes the steppers. */
  locked: boolean;
  onChange: (homeScore: number, awayScore: number) => void;
}

export function MatchCard({
  match,
  matchIndex,
  homeScore,
  awayScore,
  saveStatus,
  locked,
  onChange,
}: Props) {
  const [focused, setFocused] = useState(false);
  const filled = homeScore != null && awayScore != null;

  return (
    <article
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      className={
        "group relative flex flex-col gap-3 rounded-md border px-4 py-3.5 transition-colors duration-[var(--motion-micro)] sm:px-5 sm:py-4 " +
        (focused
          ? "border-accent-muted bg-surface-high"
          : filled
            ? "border-accent-muted/50 bg-surface"
            : "border-border bg-surface")
      }
    >
      <header className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
          M{matchIndex.toString().padStart(2, "0")} &middot; Group{" "}
          {match.home.group_letter} &middot; {shortDateTime(match.scheduled_at)}
        </p>
        <SaveStatusLabel status={saveStatus} hasValue={filled} locked={locked} />
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <TeamRow team={match.home} />
          <ScoreInput
            value={homeScore}
            disabled={locked}
            onChange={(n) => {
              if (locked) return;
              onChange(n, awayScore ?? 0);
            }}
            ariaLabel={`${match.home.code} score`}
          />
        </div>
        <div className="flex items-center gap-3">
          <TeamRow team={match.away} />
          <ScoreInput
            value={awayScore}
            disabled={locked}
            onChange={(n) => {
              if (locked) return;
              onChange(homeScore ?? 0, n);
            }}
            ariaLabel={`${match.away.code} score`}
          />
        </div>
      </div>
    </article>
  );
}

function TeamRow({
  team,
}: {
  team: { id: string; name: string; code: string; flag_url: string | null };
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {team.flag_url ? (
        <Image
          src={team.flag_url}
          alt=""
          width={28}
          height={20}
          className="h-5 w-7 shrink-0 rounded-sm object-cover"
          unoptimized
        />
      ) : (
        <div aria-hidden className="h-5 w-7 shrink-0 rounded-sm bg-surface-high" />
      )}
      <span className="font-mono text-sm font-bold uppercase tracking-[0.06em] text-text-primary">
        {team.code}
      </span>
      <span className="truncate text-sm text-text-muted">{team.name}</span>
    </div>
  );
}

function SaveStatusLabel({
  status,
  hasValue,
  locked,
}: {
  status: "idle" | "saving" | "saved" | "error";
  hasValue: boolean;
  locked: boolean;
}) {
  // Lock wins over everything — once the client knows the round is
  // frozen there is nothing to save or retry.
  if (locked) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        locked
      </span>
    );
  }
  if (status === "idle") {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        {hasValue ? "saved" : "—"}
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
        saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-green-correct">
        saved
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-red-wrong">
      retry
    </span>
  );
}
