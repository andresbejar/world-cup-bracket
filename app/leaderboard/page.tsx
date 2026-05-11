import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadLeaderboard } from "@/lib/leaderboard-data";
import { SignOutButton } from "@/app/predictions/sign-out-button";
import { LeaderboardClient } from "./leaderboard-client";

export const metadata = { title: "Leaderboard — World Cup Bracket" };

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const [{ data: profile }, initialData] = await Promise.all([
    supabase
      .from("users")
      .select("username, profile_pic, total_points")
      .eq("id", user.id)
      .maybeSingle(),
    loadLeaderboard(),
  ]);

  const username = profile?.username ?? "player";
  const avatar = profile?.profile_pic ?? null;
  const points = profile?.total_points ?? 0;

  return (
    <div className="min-h-[100svh]">
      <TopBar
        username={username}
        avatar={avatar}
        points={points}
        email={user.email ?? ""}
      />
      <main className="mx-auto max-w-[840px] px-4 py-12 md:px-8">
        <LeaderboardClient
          initialPayload={initialData}
          currentUserId={user.id}
        />
      </main>
    </div>
  );
}

function TopBar({
  username,
  avatar,
  points,
  email,
}: {
  username: string;
  avatar: string | null;
  points: number;
  email: string;
}) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-5 md:px-8">
        <Link href="/predictions" className="font-display text-2xl leading-none">
          <span style={{ fontFamily: "var(--font-display)" }}>
            World Cup{" "}
            <em
              className="not-italic"
              style={{ fontStyle: "italic", color: "var(--accent)" }}
            >
              Bracket
            </em>
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/leaderboard"
            className="hidden font-mono text-xs uppercase tracking-[0.08em] text-accent sm:block"
            aria-current="page"
          >
            <span className="tabular-nums">{points.toString().padStart(3, "0")}</span> PTS
          </Link>
          <div className="flex items-center gap-3 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-3">
            {avatar ? (
              <Image
                src={avatar}
                alt=""
                width={28}
                height={28}
                className="rounded-full"
                unoptimized
              />
            ) : (
              <div
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-high font-mono text-[10px] uppercase text-text-muted"
              >
                {username.slice(0, 2)}
              </div>
            )}
            <span className="text-sm" title={email}>
              {username}
            </span>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
