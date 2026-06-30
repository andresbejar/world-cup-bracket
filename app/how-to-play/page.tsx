import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readPoolConfig } from "@/lib/pool/config";
import { FINALIST_POINTS } from "@/lib/bracket";
import { TopBar } from "@/app/_components/top-bar";

export const metadata = { title: "How to Play — World Cup Bracket" };

// Static rules page (APT-53). The point values are pulled from the scoring
// engine (FINALIST_POINTS) and the buy-in from the pool config so the copy
// can't drift from what the app actually does. Everything else is fixed
// copy mirroring lib/bracket.ts (computeMatchPoints,
// computeThirdPlacePlacementPoints, computeLeaderboard) and lib/lock-check.ts.

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border pt-8">
      <h2 className="font-display text-2xl text-text-primary">{title}</h2>
      <div className="mt-4 space-y-3 text-text-muted">{children}</div>
    </section>
  );
}

// A scoring line: monospace point chip on the left, plain-language rule on
// the right. `tone` maps to the muted semantic scoring colors per DESIGN.md.
function ScoreLine({
  points,
  tone = "neutral",
  children,
}: {
  points: string;
  tone?: "correct" | "partial" | "wrong" | "neutral";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "correct"
      ? "text-green-correct"
      : tone === "partial"
        ? "text-yellow-partial"
        : tone === "wrong"
          ? "text-red-wrong"
          : "text-text-primary";
  return (
    <li className="flex items-baseline gap-3">
      <span
        className={
          "w-12 shrink-0 text-right font-mono text-sm font-bold tabular-nums " +
          toneClass
        }
      >
        {points}
      </span>
      <span className="text-text-muted">{children}</span>
    </li>
  );
}

export default async function HowToPlayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("users")
    .select("username, profile_pic, total_points")
    .eq("id", user.id)
    .maybeSingle();

  const cfg = readPoolConfig();

  const username = profile?.username ?? "player";
  const avatar = profile?.profile_pic ?? null;
  const points = profile?.total_points ?? 0;

  return (
    <div className="min-h-[100svh]">
      <TopBar
        active="how-to-play"
        username={username}
        avatar={avatar}
        points={points}
        email={user.email ?? ""}
      />
      <main className="mx-auto max-w-[840px] px-4 py-12 md:px-8">
        <header className="mb-10">
          <h1 className="font-display text-3xl text-text-primary md:text-5xl">
            How to Play
          </h1>
          <p className="mt-3 max-w-[60ch] text-text-muted">
            Predict the results of all 104 World Cup matches, earn points, and
            climb the leaderboard. Here&rsquo;s everything you need to know.
          </p>
        </header>

        <div className="space-y-10">
          <Section title="The goal">
            <p>
              Before each match you predict the score. The closer you are, the
              more points you earn. Everyone is ranked on the{" "}
              <Link
                href="/leaderboard"
                className="text-text-primary underline decoration-border underline-offset-4 transition-colors duration-[var(--motion-micro)] hover:decoration-accent"
              >
                Leaderboard
              </Link>
              {" — "}whoever finishes with the most points wins.
            </p>
          </Section>

          {cfg.ok ? (
            <Section title="Buy-in">
              <p>
                Entry is{" "}
                <span className="font-mono font-bold tabular-nums text-text-primary">
                  ${cfg.config.buyInUsd}
                </span>{" "}
                into the common pool. Head to the{" "}
                <Link
                  href="/pool"
                  className="text-text-primary underline decoration-border underline-offset-4 transition-colors duration-[var(--motion-micro)] hover:decoration-accent"
                >
                  Pool
                </Link>{" "}
                page for payment instructions and to confirm you&rsquo;ve paid.
              </p>
            </Section>
          ) : null}

          <Section title="Deadlines & locking">
            <p>
              You can change your predictions as much as you like up until a
              round locks. After that, the round is frozen.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Each round (group matchdays and every knockout round) locks{" "}
                <span className="text-text-primary">
                  4 hours before its first kickoff
                </span>
                .
              </li>
              <li>
                Your podium picks (champion / runner-up / third) lock at the{" "}
                <span className="text-text-primary">
                  tournament&rsquo;s very first kickoff
                </span>{" "}
                — set them early.
              </li>
              <li>
                Your third-place qualifier picks lock with the Round of 32
                deadline.
              </li>
            </ul>
          </Section>

          <Section title="Scoring">
            <p>For every match:</p>
            <ul className="space-y-2">
              <ScoreLine points="+3" tone="correct">
                Exact score — you got both the scoreline and the result right.
              </ScoreLine>
              <ScoreLine points="+1" tone="partial">
                Correct result only — right winner (or draw), wrong score.
              </ScoreLine>
              <ScoreLine points="0" tone="wrong">
                Wrong result — no points.
              </ScoreLine>
            </ul>
            <p className="pt-2">
              In the knockout stage the &ldquo;result&rdquo; is simply which
              team advances. Penalty shootouts decide who goes through, but the
              score you&rsquo;re graded on is the one after{" "}
              <span className="text-text-primary">
                90 minutes plus extra time
              </span>{" "}
              — shootout goals don&rsquo;t count toward the scoreline.
            </p>
            <ul className="space-y-2 pt-2">
              <ScoreLine points="+1" tone="correct">
                Penalty winner — when you predict a tied knockout you also pick
                who wins the shootout. That pick is a separate bet: your
                scoreline still earns its points on its own, and a correct
                shootout pick adds one more. So an exact tied score is worth{" "}
                <span className="text-text-primary">3</span> even if you miss
                the shootout, and{" "}
                <span className="text-text-primary">4</span> if you nail it too.
              </ScoreLine>
            </ul>

            <p className="pt-4">
              On top of the matches, two season-long bets — scored
              independently of your bracket:
            </p>
            <ul className="space-y-2">
              <ScoreLine points={`+${FINALIST_POINTS.first_place}`}>
                Correctly picking the champion.
              </ScoreLine>
              <ScoreLine points={`+${FINALIST_POINTS.second_place}`}>
                Correctly picking the runner-up.
              </ScoreLine>
              <ScoreLine points={`+${FINALIST_POINTS.third_place}`}>
                Correctly picking third place.
              </ScoreLine>
              <ScoreLine points="+1">
                Each third-place team you correctly pick to qualify from the
                group stage (up to 8).
              </ScoreLine>
            </ul>
          </Section>

          <Section title="Tiebreakers">
            <p>If two players finish level on points, we break the tie by:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Most exact-score predictions</li>
              <li>Most correct results</li>
              <li>Whoever registered first</li>
            </ol>
          </Section>
        </div>
      </main>
    </div>
  );
}
