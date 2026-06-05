import { getOpenPositions } from "../../lib/fx-dashboard";
import { PositionsClient } from "./positions-client";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const positions = await getOpenPositions(750);
  return <PositionsClient positions={positions} />;
}
