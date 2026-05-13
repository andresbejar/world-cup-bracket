import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadPredictionWorkspace } from "@/lib/group-data";
import { TopBar } from "@/app/_components/top-bar";
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
        active="predictions"
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
