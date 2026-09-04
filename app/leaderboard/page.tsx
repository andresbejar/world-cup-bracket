import Link from "next/link";
import { leaderboardEntries, pool, meta } from "@/lib/archive";
import { TopBar } from "@/app/_components/top-bar";
import { LeaderboardClient } from "./leaderboard-client";

export const metadata = { title: "Final Standings — World Cup Bracket" };

export default function LeaderboardPage() {
  return (
    <div className="min-h-[100svh]">
      <TopBar active="leaderboard" />
      <main className="mx-auto max-w-[840px] px-4 py-12 md:px-8">
        <Link
          href="/pool"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent-muted/40 bg-surface px-4 py-3 transition-colors duration-[var(--motion-micro)] hover:bg-surface-high"
        >
          <span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-accent">
              PRIZE POOL
            </span>
            <span className="ml-2 font-display text-xl text-text-primary">
              ${pool.potUsd.toLocaleString()}
            </span>
            <span className="ml-2 font-mono text-[11px] text-text-muted tabular-nums">
              {pool.confirmedCount} PAID IN · SETTLED
            </span>
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted">
            Open pool →
          </span>
        </Link>
        <LeaderboardClient
          entries={leaderboardEntries}
          totalPlayers={meta.counts.players}
        />
      </main>
    </div>
  );
}
