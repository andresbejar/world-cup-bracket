"use client";

import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/bracket";

// Archive note: this used to poll /api/leaderboard every 30s with a
// visibility-aware pause. The tournament is over and the standings are
// frozen in data/archive-snapshot.json, so the entries arrive as props and
// never change. No fetch, no interval, no client state — which is also
// what lets this page prerender to static HTML.

interface Props {
  entries: LeaderboardEntry[];
  totalPlayers: number;
}

export function LeaderboardClient({ entries, totalPlayers }: Props) {
  return (
    <>
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
            FINAL STANDINGS
          </p>
          <h1
            className="mt-1 font-display text-5xl leading-tight tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Leaderboard
          </h1>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted whitespace-nowrap">
          <span className="tabular-nums">{totalPlayers}</span>{" "}
          {totalPlayers === 1 ? "PLAYER" : "PLAYERS"}
        </p>
      </header>

      <ol className="overflow-hidden rounded-md border border-border bg-surface">
        {entries.map((entry, idx) => (
          <LeaderboardRow
            key={entry.user_id}
            entry={entry}
            isChampion={idx === 0}
            isLast={idx === entries.length - 1}
          />
        ))}
      </ol>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        Tiebreakers: total points → exact-score predictions → outcome
        predictions → earliest signup. The top two finished level on 99;
        the chain settled it.
      </p>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        <Link href="/predictions" className="hover:text-text-primary">
          ← Browse the brackets
        </Link>
      </p>
    </>
  );
}

function LeaderboardRow({
  entry,
  isChampion,
  isLast,
}: {
  entry: LeaderboardEntry;
  isChampion: boolean;
  isLast: boolean;
}) {
  return (
    <li
      className={
        "flex items-center gap-4 px-5 py-3.5 " +
        (isLast ? "" : "border-b border-border ") +
        (isChampion ? "bg-surface-high" : "")
      }
    >
      <span
        className={
          "w-9 shrink-0 font-mono text-sm font-bold tabular-nums " +
          (isChampion ? "text-accent" : "text-text-muted")
        }
      >
        {entry.rank.toString().padStart(2, "0")}
      </span>
      <Avatar entry={entry} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm">
          <span className="truncate font-semibold text-text-primary">
            {entry.username ?? "player"}
          </span>
          {isChampion ? (
            <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-bg">
              Champion
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
          <span>{entry.exact_count} EXACT</span>
          <span className="mx-1.5">·</span>
          <span>{entry.outcome_count} OUTCOME</span>
          {entry.penalty_count > 0 ? (
            <>
              <span className="mx-1.5">·</span>
              <span>{entry.penalty_count} PENALTY</span>
            </>
          ) : null}
        </p>
      </div>
      <span
        className={
          "shrink-0 font-mono text-lg font-bold tabular-nums " +
          (isChampion ? "text-accent" : "text-text-primary")
        }
      >
        {entry.total_points}
      </span>
    </li>
  );
}

function Avatar({ entry }: { entry: LeaderboardEntry }) {
  if (entry.profile_pic) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={entry.profile_pic}
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 shrink-0 rounded-sm bg-surface-high"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-high font-mono text-[11px] font-bold uppercase text-text-muted tabular-nums"
    >
      {(entry.username ?? "??").slice(0, 2)}
    </div>
  );
}
