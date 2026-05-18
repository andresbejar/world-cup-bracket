import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadLeaderboard } from "@/lib/leaderboard-data";
import { readPoolConfig } from "@/lib/pool/config";
import { loadPoolSummary } from "@/lib/pool/queries";
import { TopBar } from "@/app/_components/top-bar";
import { LeaderboardClient } from "./leaderboard-client";

export const metadata = { title: "Leaderboard — World Cup Bracket" };

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const cfg = readPoolConfig();
  const [{ data: profile }, initialData, poolSummary] = await Promise.all([
    supabase
      .from("users")
      .select("username, profile_pic, total_points")
      .eq("id", user.id)
      .maybeSingle(),
    loadLeaderboard(),
    cfg.ok ? loadPoolSummary(supabase) : Promise.resolve(null),
  ]);

  const username = profile?.username ?? "player";
  const avatar = profile?.profile_pic ?? null;
  const points = profile?.total_points ?? 0;

  const poolBanner =
    cfg.ok && poolSummary ? (
      <Link
        href="/pool"
        className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent-muted/40 bg-surface px-4 py-3 transition-colors duration-[var(--motion-micro)] hover:bg-surface-high"
      >
        <span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-accent">
            PRIZE POOL
          </span>
          <span className="ml-2 font-display text-xl text-text-primary">
            ${(poolSummary.confirmedCount * cfg.config.buyInUsd).toLocaleString()}
          </span>
          <span className="ml-2 font-mono text-[11px] text-text-muted tabular-nums">
            {poolSummary.confirmedCount}/{poolSummary.totalUsers} CONFIRMED
            {poolSummary.claimedCount > 0
              ? ` · ${poolSummary.claimedCount} AWAITING`
              : null}
          </span>
        </span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted">
          Open pool →
        </span>
      </Link>
    ) : null;

  return (
    <div className="min-h-[100svh]">
      <TopBar
        active="leaderboard"
        username={username}
        avatar={avatar}
        points={points}
        email={user.email ?? ""}
      />
      <main className="mx-auto max-w-[840px] px-4 py-12 md:px-8">
        {poolBanner}
        <LeaderboardClient
          initialPayload={initialData}
          currentUserId={user.id}
        />
      </main>
    </div>
  );
}
