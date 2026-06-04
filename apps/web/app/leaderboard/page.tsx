import { formatAddress, formatDate, getDashboardData } from "../../lib/fx-dashboard";

const numberFormatter = new Intl.NumberFormat("en-US");

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const dashboard = await getDashboardData();

  return (
    <section>
      <p className="eyebrow">Leaderboard</p>
      <h1>Trader leaderboard</h1>
      <p className="muted">
        Top wallets by owner-confirmed open f(x) position count. Snapshot: {formatDate(dashboard.generatedAt)}.
      </p>

      <div className="card-grid compact">
        <article className="card">
          <p className="muted">Open positions</p>
          <h2>{numberFormatter.format(dashboard.totals.openPositions)}</h2>
        </article>
        <article className="card">
          <p className="muted">Unique traders</p>
          <h2>{numberFormatter.format(dashboard.totals.uniqueTraders)}</h2>
        </article>
        <article className="card">
          <p className="muted">Long / short</p>
          <h2>{numberFormatter.format(dashboard.totals.longPositions)} / {numberFormatter.format(dashboard.totals.shortPositions)}</h2>
        </article>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Wallet</th>
              <th>Open positions</th>
              <th>Pools</th>
              <th>wstETH long</th>
              <th>WBTC long</th>
              <th>wstETH short</th>
              <th>WBTC short</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.traders.map((trader, index) => (
              <tr key={trader.owner}>
                <td>#{index + 1}</td>
                <td>
                  <a className="mono" href={`/traders/${trader.owner}`} title={trader.owner}>{formatAddress(trader.owner)}</a>
                </td>
                <td>{numberFormatter.format(trader.positions)}</td>
                <td>{numberFormatter.format(trader.pools)}</td>
                <td>{numberFormatter.format(trader.wstethLong)}</td>
                <td>{numberFormatter.format(trader.wbtcLong)}</td>
                <td>{numberFormatter.format(trader.wstethShort)}</td>
                <td>{numberFormatter.format(trader.wbtcShort)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
