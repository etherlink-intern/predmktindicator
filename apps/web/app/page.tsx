import { formatDate, formatPercent, formatUsd, getDashboardData } from "../lib/fx-dashboard";

const numberFormatter = new Intl.NumberFormat("en-US");

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dashboard = await getDashboardData();
  const cards = [
    ["Open positions", numberFormatter.format(dashboard.totals.openPositions)],
    ["Unique traders", numberFormatter.format(dashboard.totals.uniqueTraders)],
    ["Net current equity", formatUsd(dashboard.totals.equityUsd)],
    ["Snapshot freshness", formatDate(dashboard.generatedAt)]
  ];

  return (
    <section>
      <p className="eyebrow">f(x) Protocol</p>
      <h1>Live f(x) trader profiles</h1>
      <p className="muted">
        Current-position dashboard built from the verified f(x) position-pool contracts. The snapshot scans every
        position ID with <code>getPosition</code>, confirms owners with <code>ownerOf</code>, and values positions from live
        pool oracle prices. Realized historical PnL is intentionally not shown until manager events are indexed from
        chain.
      </p>

      <div className="card-grid">
        {cards.map(([label, value]) => (
          <article className="card" key={label}>
            <p className="muted">{label}</p>
            <h2>{value}</h2>
          </article>
        ))}
      </div>

      {!dashboard.hasSnapshot ? (
        <div className="card warning">
          <h2>No current-position snapshot found</h2>
          <p className="muted">Run the f(x) current-position sync job to populate the dashboard.</p>
        </div>
      ) : (
        <>
          <div className="section-header">
            <div>
              <p className="eyebrow">Pool matrix</p>
              <h2>Open positions by pool</h2>
            </div>
            <a className="button" href="/leaderboard">View trader leaderboard</a>
          </div>

          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>Side</th>
                  <th>Collateral</th>
                  <th>Open positions</th>
                  <th>Owners</th>
                  <th>Current equity</th>
                  <th>Debt value</th>
                  <th>Avg debt ratio</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.pools.map((pool) => (
                  <tr key={pool.poolName}>
                    <td>{pool.poolName}</td>
                    <td><span className={`pill ${pool.side}`}>{pool.side}</span></td>
                    <td>{pool.collateral}</td>
                    <td>{numberFormatter.format(pool.positions)}</td>
                    <td>{numberFormatter.format(pool.uniqueOwners)}</td>
                    <td>{formatUsd(pool.equityUsd)}</td>
                    <td>{formatUsd(pool.debtValueUsd)}</td>
                    <td>{formatPercent(pool.avgDebtRatio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
