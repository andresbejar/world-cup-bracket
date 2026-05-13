import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadPredictionWorkspace } from "@/lib/group-data";
import { SignOutButton } from "./sign-out-button";
import { PredictionsClient } from "./predictions-client";

export const metadata = { title: "Predictions — World Cup Bracket" };

export default async function PredictionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const [{ data: profile }, workspace] = await Promise.all([
    supabase
      .from("users")
      .select("username, profile_pic, total_points")
      .eq("id", user.id)
      .maybeSingle(),
    loadPredictionWorkspace(user.id),
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
      <PredictionsClient
        rounds={workspace.rounds}
        groupTeams={workspace.groupTeams}
        groupMatches={workspace.groupMatches}
        knockoutMatches={workspace.knockoutMatches}
        initialPredictions={workspace.predictions}
        initialThirdPlacePicks={workspace.thirdPlacePicks}
        initialFinalistPicks={workspace.finalistPicks}
        slotLabelById={workspace.slotLabelById}
        realTeamIdBySlotLabel={workspace.realTeamIdBySlotLabel}
      />
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
        <p
          className="font-display text-2xl leading-none"
          style={{ fontFamily: "var(--font-display)" }}
        >
          World Cup{" "}
          <em
            className="not-italic"
            style={{ fontStyle: "italic", color: "var(--accent)" }}
          >
            Bracket
          </em>
        </p>
        <div className="flex items-center gap-4">
          <Link
            href="/leaderboard"
            className="hidden font-mono text-xs uppercase tracking-[0.08em] text-text-muted transition-colors duration-[var(--motion-micro)] hover:text-text-primary sm:block"
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
