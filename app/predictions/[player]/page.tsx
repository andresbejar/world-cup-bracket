import { notFound } from "next/navigation";
import { playerIds, getPlayer } from "@/lib/archive";
import { BracketView } from "../bracket-view";

// One prerendered page per player -- 16 static routes, no request-time
// params, so the whole archive stays static.
export function generateStaticParams() {
  return playerIds.map((player) => ({ player }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ player: string }>;
}) {
  const { player } = await params;
  const entry = getPlayer(player);
  return {
    title: `${entry?.username ?? player}'s bracket — World Cup Bracket`,
  };
}

export default async function PlayerBracketPage({
  params,
}: {
  params: Promise<{ player: string }>;
}) {
  const { player } = await params;
  if (!playerIds.includes(player)) notFound();
  return <BracketView playerId={player} />;
}
