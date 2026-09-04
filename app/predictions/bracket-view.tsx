import { getWorkspace, getPlayer } from "@/lib/archive";
import { TopBar } from "@/app/_components/top-bar";
import { PredictionsClient } from "./predictions-client";
import { PlayerSwitcher } from "./player-switcher";

// Shared by /predictions (the champion's bracket) and
// /predictions/[player] (everyone else's). Both are fully prerendered --
// the archive must not depend on request-time params, or the pages fall
// back to dynamic rendering and the site stops being static.

export function BracketView({ playerId }: { playerId: string }) {
  const workspace = getWorkspace(playerId);
  const entry = getPlayer(playerId);

  return (
    <div className="min-h-[100svh]">
      <TopBar active="predictions" />
      <PlayerSwitcher current={playerId} />
      <PredictionsClient
        rounds={workspace.rounds}
        groupTeams={workspace.groupTeams}
        groupMatches={workspace.groupMatches}
        knockoutMatches={workspace.knockoutMatches}
        initialActiveRoundId={workspace.activeRoundId}
        initialPredictions={workspace.predictions}
        initialFinalistPicks={workspace.finalistPicks}
        slotLabelById={workspace.slotLabelById}
        realTeamIdBySlotLabel={workspace.realTeamIdBySlotLabel}
        ownerLabel={entry?.username ?? playerId}
        ownerPoints={entry?.total_points ?? 0}
        ownerRank={entry?.rank ?? 0}
      />
    </div>
  );
}
