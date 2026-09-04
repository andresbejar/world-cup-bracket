"use client";

import { useRouter } from "next/navigation";
import { leaderboardEntries } from "@/lib/archive";

// Whose bracket am I looking at? The live app had exactly one answer —
// yours. The archive has no session, so rather than showing a single
// anonymous bracket this lets a visitor page through all 16 and compare
// what each player predicted against what actually happened.
//
// Ranked order, so the champion's bracket is the first thing offered.

export function PlayerSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const entry = leaderboardEntries.find((e) => e.user_id === current);

  return (
    <div className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-8">
        <label
          htmlFor="player-switch"
          className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted"
        >
          Viewing bracket
        </label>
        <select
          id="player-switch"
          value={current}
          onChange={(e) => router.push(`/predictions/${e.target.value}`)}
          className="min-h-[44px] rounded-md border border-border bg-bg px-3 text-sm text-text-primary"
        >
          {leaderboardEntries.map((e) => (
            <option key={e.user_id} value={e.user_id}>
              {e.rank.toString().padStart(2, "0")} · {e.username} · {e.total_points} pts
            </option>
          ))}
        </select>
        {entry ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
            {entry.exact_count} EXACT · {entry.outcome_count} OUTCOME
            {entry.rank === 1 ? " · CHAMPION" : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
