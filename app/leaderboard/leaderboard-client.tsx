"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LeaderboardPayload } from "@/lib/leaderboard-data";
import type { LeaderboardEntry } from "@/lib/bracket";

// Polling cadence per design § Performance Notes: 30s while the tab is
// visible. We pause cleanly when the user backgrounds the tab — that's
// where the real savings come from over a 2-month tournament window.
const POLL_MS = 30_000;

interface Props {
  initialPayload: LeaderboardPayload;
  currentUserId: string;
}

export function LeaderboardClient({ initialPayload, currentUserId }: Props) {
  const [payload, setPayload] = useState<LeaderboardPayload>(initialPayload);
  const [paused, setPaused] = useState(false);

  const inFlight = useRef(false);
  const fetchOnce = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as LeaderboardPayload;
      setPayload(next);
    } catch (e) {
      console.error("[leaderboard] poll failed:", e);
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Visibility-aware polling. setInterval runs while visible; we
  // pause + resume on visibilitychange. On resume we kick a fresh
  // fetch immediately so the table catches up.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    function start() {
      setPaused(false);
      fetchOnce();
      timer = setInterval(fetchOnce, POLL_MS);
    }
    function stop() {
      setPaused(true);
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") stop();
      else start();
    }
    if (document.visibilityState === "visible") start();
    else stop();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearInterval(timer);
    };
  }, [fetchOnce]);

  const empty = payload.entries.length === 0;

  return (
    <>
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
            STANDINGS · {paused ? "PAUSED" : "LIVE 30s"}
          </p>
          <h1
            className="mt-1 font-display text-5xl leading-tight tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Leaderboard
          </h1>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted whitespace-nowrap">
          <span className="tabular-nums">{payload.total_players}</span>{" "}
          {payload.total_players === 1 ? "PLAYER" : "PLAYERS"}
          {payload.total_players > payload.entries.length ? (
            <span className="block text-text-dim">
              SHOWING TOP {payload.entries.length}
            </span>
          ) : null}
        </p>
      </header>

      {empty ? <EmptyState /> : null}

      {!empty ? (
        <ol className="overflow-hidden rounded-md border border-border bg-surface">
          {payload.entries.map((entry, idx) => (
            <LeaderboardRow
              key={entry.user_id}
              entry={entry}
              isYou={entry.user_id === currentUserId}
              isLast={idx === payload.entries.length - 1}
            />
          ))}
        </ol>
      ) : null}

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        Tiebreakers: total points → exact-score predictions → outcome predictions →
        earliest signup.{" "}
        {paused
          ? "Polling paused while this tab is hidden."
          : "Auto-refreshes every 30s."}
      </p>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        <Link href="/predictions" className="hover:text-text-primary">
          ← Back to your predictions
        </Link>
      </p>
    </>
  );
}

function LeaderboardRow({
  entry,
  isYou,
  isLast,
}: {
  entry: LeaderboardEntry;
  isYou: boolean;
  isLast: boolean;
}) {
  return (
    <li
      className={
        "flex items-center gap-4 px-5 py-3.5 " +
        (isLast ? "" : "border-b border-border ") +
        (isYou ? "bg-surface-high" : "")
      }
    >
      <span
        className={
          "w-9 shrink-0 font-mono text-sm font-bold tabular-nums " +
          (isYou ? "text-accent" : "text-text-muted")
        }
      >
        {entry.rank.toString().padStart(2, "0")}
      </span>
      <Avatar entry={entry} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm">
          <span
            className={
              "truncate font-semibold " +
              (isYou ? "text-text-primary" : "text-text-primary")
            }
          >
            {entry.username ?? "player"}
          </span>
          {isYou ? (
            <span className="rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-bg">
              You
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
          (isYou ? "text-accent" : "text-text-primary")
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
      <img
        src={entry.profile_pic}
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 rounded-sm bg-surface-high"
        referrerPolicy="no-referrer"
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

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface px-6 py-12 text-center">
      <p
        className="font-display text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        No predictions scored yet.
      </p>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted">
        Send this URL to family — the leaderboard fills in once matches start.
      </p>
    </div>
  );
}
