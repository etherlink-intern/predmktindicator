import { formatDate, formatPercent, formatUsd, getDashboardData } from "../lib/fx-dashboard";

const numberFormatter = new Intl.NumberFormat("en-US");

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dashboard = await getDashboardData();
  const snapshotCards = [
    ["Open positions", numberFormatter.format(dashboard.totals.openPositions), "Owner-confirmed active position NFTs"],
    ["Active wallets", numberFormatter.format(dashboard.totals.uniqueTraders), "Unique current owners in the latest snapshot"],
    ["Current equity", formatUsd(dashboard.totals.equityUsd), "App-specific mark-to-oracle collateral minus debt"],
    ["Snapshot freshness", formatDate(dashboard.generatedAt), "Latest current-position sync time"]
  ];

  const globalTrackers = [
    [
      "Tracked open interest",
      formatUsd(dashboard.totals.trackedOpenInterestUsd),
      "xPOSITION long notional plus sPOSITION borrowed exposure, computed from our current snapshot."
    ],
    [
      "xPOSITION long notional",
      formatUsd(dashboard.totals.longNotionalUsd),
      "Long-pool collateral notional marked with the pool oracle."
    ],
    [
      "sPOSITION borrowed exposure",
      formatUsd(dashboard.totals.shortBorrowedExposureUsd),
      "Short-pool borrowed wstETH/WBTC exposure marked from current pool state."
    ],
    [
      "Long fxUSD debt",
      formatUsd(dashboard.totals.longDebtUsd),
      "fxUSD debt attached to current xPOSITIONs; not the protocol fxUSD totalSupply()."
    ],
    [
      "80%+ risk queue",
      `${numberFormatter.format(dashboard.totals.riskQueuePositions80)} positions`,
      `${formatUsd(dashboard.totals.riskQueueNotional80Usd)} tracked notional at or above 80% debt ratio.`
    ],
    [
      "Known wallets",
      numberFormatter.format(dashboard.walletMaintenance.knownWallets),
      dashboard.walletMaintenance.lastMaintainedAt
        ? `Wallet-maintenance set updated ${formatDate(dashboard.walletMaintenance.lastMaintainedAt)}.`
        : "Maintenance table not seeded yet."
    ]
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
        {snapshotCards.map(([label, value, detail]) => (
          <article className="card" key={label}>
            <p className="muted">{label}</p>
            <h2>{value}</h2>
            <p className="muted small">{detail}</p>
          </article>
        ))}
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Global trackers</p>
          <h2>Position book and wallet-maintenance state</h2>
        </div>
      </div>

      <div className="card-grid compact">
        {globalTrackers.map(([label, value, detail]) => (
          <article className="card" key={label}>
            <p className="muted">{label}</p>
            <h2>{value}</h2>
            <p className="muted small">{detail}</p>
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
