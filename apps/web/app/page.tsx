import { formatDate, getDashboardData } from "../lib/fx-dashboard";

const numberFormatter = new Intl.NumberFormat("en-US");

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dashboard = await getDashboardData();
  const cards = [
    ["Open positions", numberFormatter.format(dashboard.totals.openPositions)],
    ["Unique traders", numberFormatter.format(dashboard.totals.uniqueTraders)],
    ["Tracked pools", `${dashboard.totals.pools}/4`],
    ["Snapshot freshness", formatDate(dashboard.generatedAt)]
  ];

  return (
    <section>
      <p className="eyebrow">f(x) Protocol</p>
      <h1>Live f(x) trader profiles</h1>
      <p className="muted">
        Current-position dashboard built from the verified f(x) position-pool contracts. The snapshot scans every
        position ID with <code>getPosition</code> and confirms owners with <code>ownerOf</code>.
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
                  <th>Unique owners</th>
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
