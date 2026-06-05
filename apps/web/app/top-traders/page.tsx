import { getTopTraders } from "../../lib/fx-dashboard";
import { TopTradersClient } from "./top-traders-client";

export const dynamic = "force-dynamic";

export default async function TopTradersPage() {
  const traders = await getTopTraders();
  return <TopTradersClient traders={traders} />;
}
