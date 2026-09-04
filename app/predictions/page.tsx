import { championPlayerId } from "@/lib/archive";
import { BracketView } from "./bracket-view";

export const metadata = { title: "The Bracket — World Cup Bracket" };

// Opens on the pool champion's bracket: with no session there is no
// "your" bracket any more, and the winning one is the most interesting
// place to land. Every other player is at /predictions/[player].
export default function PredictionsPage() {
  return <BracketView playerId={championPlayerId} />;
}
