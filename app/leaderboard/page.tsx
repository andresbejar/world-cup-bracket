import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadLeaderboard } from "@/lib/leaderboard-data";
import { TopBar } from "@/app/_components/top-bar";
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
        active="leaderboard"
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
