import { formatUsd, getDashboardData } from "../../lib/fx-dashboard";
import { LocalTime } from "../local-time";
import { LeaderboardTable } from "./leaderboard-table";

const numberFormatter = new Intl.NumberFormat("en-US");

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const dashboard = await getDashboardData();

  return (
    <section>
      <p className="eyebrow">Leaderboard</p>
      <h1>Trader leaderboard</h1>
      <p className="muted">
        Wallets ranked by current notional value by default. Use the filters and sortable columns to explore active
        f(x) wallets by exposure, position count, equity, debt, and risk. Snapshot: <LocalTime date={dashboard.generatedAt} />.
      </p>

      <div className="card-grid compact">
        <article className="card">
          <p className="muted">Open positions</p>
          <h2>{numberFormatter.format(dashboard.totals.openPositions)}</h2>
        </article>
        <article className="card">
          <p className="muted">Tracked wallets</p>
          <h2>{numberFormatter.format(dashboard.totals.uniqueTraders)}</h2>
        </article>
        <article className="card">
          <p className="muted">Tracked notional</p>
          <h2>{formatUsd(dashboard.totals.trackedOpenInterestUsd)}</h2>
        </article>
        <article className="card">
          <p className="muted">Current net equity</p>
          <h2>{formatUsd(dashboard.totals.equityUsd)}</h2>
        </article>
      </div>

      <LeaderboardTable traders={dashboard.traders} />
    </section>
  );
}
