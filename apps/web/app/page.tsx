import { displayInstrument, displayPool, formatDate, formatPercent, formatUsd, getDashboardData } from "../lib/fx-dashboard";

const numberFormatter = new Intl.NumberFormat("en-US");

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dashboard = await getDashboardData();
  const snapshotCards = [
    ["Open positions", numberFormatter.format(dashboard.totals.openPositions), "Active position NFTs confirmed on-chain"],
    ["Active wallets", numberFormatter.format(dashboard.totals.uniqueTraders), "Wallets that currently own tracked positions"],
    ["Current equity", formatUsd(dashboard.totals.equityUsd), "Estimated current equity across tracked positions"],
    ["Last updated", formatDate(dashboard.generatedAt), "Most recent dashboard refresh"]
  ];

  const globalTrackers = [
    [
      "Tracked open interest",
      formatUsd(dashboard.totals.trackedOpenInterestUsd),
      "Estimated exposure across tracked active positions."
    ],
    [
      "Long-side exposure",
      formatUsd(dashboard.totals.longNotionalUsd),
      "Estimated current exposure for tracked long positions."
    ],
    [
      "Short-side exposure",
      formatUsd(dashboard.totals.shortBorrowedExposureUsd),
      "Estimated current exposure for tracked short positions."
    ],
    [
      "Tracked debt",
      formatUsd(dashboard.totals.longDebtUsd),
      "Debt attached to tracked active positions."
    ],
    [
      "Risk watchlist",
      `${numberFormatter.format(dashboard.totals.riskQueuePositions80)} positions`,
      `${formatUsd(dashboard.totals.riskQueueNotional80Usd)} in tracked positions at or above an 80% debt ratio.`
    ],
    [
      "Tracked wallets",
      numberFormatter.format(dashboard.walletMaintenance.knownWallets),
      dashboard.walletMaintenance.lastMaintainedAt
        ? `Tracked wallet list refreshed ${formatDate(dashboard.walletMaintenance.lastMaintainedAt)}.`
        : "Wallet tracking is initializing."
    ]
  ];

  return (
    <section>
      <p className="eyebrow">f(x) Protocol</p>
      <h1>Live f(x) trader profiles</h1>
      <p className="muted">
        Explore current f(x) Protocol positions by wallet using public on-chain data. Values are snapshot estimates
        from verified contracts and oracle prices; they are not realized profit/loss or financial advice.
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
          <p className="eyebrow">Market overview</p>
          <h2>Position book snapshot</h2>
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
          <h2>Snapshot is being prepared</h2>
          <p className="muted">Position data will appear after the next dashboard refresh.</p>
        </div>
      ) : (
        <>
          <div className="section-header">
            <div>
              <p className="eyebrow">Pool overview</p>
              <h2>Open positions by pool</h2>
            </div>
            <a className="button" href="/leaderboard">View trader leaderboard</a>
          </div>

          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Instrument</th>
                  <th>Open positions</th>
                  <th>Owners</th>
                  <th>Current equity</th>
                  <th>Debt value</th>
                  <th>Avg debt ratio</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.pools.map((pool) => (
                  <tr key={`${pool.side}-${displayInstrument(pool.collateral)}`}>
                    <td>{displayPool(pool.poolName)}</td>
                    <td><span className={`pill ${pool.side}`}>{pool.side}</span></td>
                    <td>{displayInstrument(pool.collateral)}</td>
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
