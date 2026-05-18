import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/app/_components/top-bar";
import { isAdminUserId } from "@/lib/auth-guard";
import { readPoolConfig, enabledMethods } from "@/lib/pool/config";
import { loadPoolState } from "@/lib/pool/queries";
import { loadLeaderboard } from "@/lib/leaderboard-data";
import { PoolClient } from "./pool-client";
import { paymentLinkFor } from "@/lib/pool/links";

export const metadata = { title: "Prize Pool — World Cup Bracket" };

export default async function PoolPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const cfg = readPoolConfig();
  const isAdmin = isAdminUserId(user.id);

  const { data: profile } = await supabase
    .from("users")
    .select("username, profile_pic, total_points")
    .eq("id", user.id)
    .maybeSingle();

  if (!cfg.ok) {
    return (
      <div className="min-h-[100svh]">
        <TopBar
          active="leaderboard"
          username={profile?.username ?? "player"}
          avatar={profile?.profile_pic ?? null}
          points={profile?.total_points ?? 0}
          email={user.email ?? ""}
        />
        <main className="mx-auto max-w-[640px] px-4 py-12 md:px-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
            PRIZE POOL
          </p>
          <h1
            className="mt-1 font-display text-5xl leading-tight tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Not set up yet
          </h1>
          <p className="mt-4 text-sm text-text-muted">
            The prize pool hasn&rsquo;t been configured for this tournament.
            Set <code className="font-mono text-text-primary">POOL_BUY_IN_USD</code>{" "}
            (and at least one payment-method handle) in the environment to
            enable it.
          </p>
        </main>
      </div>
    );
  }

  const [poolState, leaderboard] = await Promise.all([
    loadPoolState(supabase),
    loadLeaderboard(1),
  ]);

  const methods = enabledMethods(cfg.config);
  const linkCtx = {
    handles: cfg.config.methods,
    paypalPoolUrl: cfg.config.paypalPoolUrl,
  };
  const methodLinks = methods.map((m) => ({
    method: m,
    link: paymentLinkFor(m, linkCtx, cfg.config.buyInUsd),
  }));

  const yourEntry =
    poolState.roster.find((r) => r.user_id === user.id)?.entry ?? null;
  const totalPool = poolState.confirmedCount * cfg.config.buyInUsd;
  const projectedPool =
    (poolState.confirmedCount + poolState.claimedCount) * cfg.config.buyInUsd;
  const currentLeader = leaderboard.entries[0] ?? null;

  return (
    <div className="min-h-[100svh]">
      <TopBar
        active="leaderboard"
        username={profile?.username ?? "player"}
        avatar={profile?.profile_pic ?? null}
        points={profile?.total_points ?? 0}
        email={user.email ?? ""}
      />
      <main className="mx-auto max-w-[840px] px-4 py-12 md:px-8">
        <PoolClient
          buyInUsd={cfg.config.buyInUsd}
          deadline={cfg.config.deadline}
          methodLinks={methodLinks}
          yourEntry={yourEntry}
          roster={poolState.roster}
          confirmedCount={poolState.confirmedCount}
          claimedCount={poolState.claimedCount}
          unpaidCount={poolState.unpaidCount}
          totalUsers={poolState.totalUsers}
          totalPool={totalPool}
          projectedPool={projectedPool}
          currentLeader={currentLeader}
          currentUserId={user.id}
          isAdmin={isAdmin}
        />
      </main>
    </div>
  );
}
