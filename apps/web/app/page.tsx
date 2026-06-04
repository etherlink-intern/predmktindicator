import { displayInstrument, displayPool, formatDate, formatPercent, formatUsd, getDashboardData } from "../lib/fx-dashboard";
import { LastRefreshedCounter } from "./last-refreshed";

const numberFormatter = new Intl.NumberFormat("en-US");

export const dynamic = "force-dynamic";

function ExposureBar({
  label,
  longUsd,
  shortUsd,
  color,
}: {
  label: string;
  longUsd: number;
  shortUsd: number;
  color: string;
}) {
  const total = longUsd + shortUsd || 1;
  const longShare = longUsd / total;
  const shortShare = shortUsd / total;
  const longWidth = longShare * 300;
  const shortWidth = shortShare * 300;
  const net = longUsd - shortUsd;
  const netLabel = net > 0 ? "Net long" : net < 0 ? "Net short" : "Flat";
  const netColor = net > 0 ? "#22c55e" : net < 0 ? "#ef4444" : "#94a3b8";

  return (
    <div style={{ marginTop: "16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "6px",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "14px" }}>{label}</span>
        <span style={{ color: netColor, fontWeight: 700, fontSize: "14px" }}>
          {netLabel} {formatUsd(Math.abs(net))}
        </span>
      </div>
      <svg
        width="100%"
        height="48"
        viewBox="0 0 600 48"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block" }}
      >
        {/* Background track */}
        <rect x="0" y="14" width="600" height="20" rx="10" fill="rgba(148,163,184,0.08)" />

        {/* Long bar (right from center) */}
        <rect
          x="300"
          y="14"
          width={Math.min(longPct * 3, 300)}
          height="20"
          rx="10"
          fill={color}
          opacity="0.85"
        />

        {/* Short bar (left from center) */}
        <rect
          x={300 - Math.min(shortPct * 3, 300)}
          y="14"
          width={Math.min(shortPct * 3, 300)}
          height="20"
          rx="10"
          fill="#ef4444"
          opacity="0.85"
        />

        {/* Center line */}
        <line x1="300" y1="8" x2="300" y2="40" stroke="rgba(148,163,184,0.4)" strokeWidth="1.5" />

        {/* Long label */}
        <text x={300 + Math.min(longPct * 3, 300) / 2} y="10" textAnchor="middle" fill="#bbf7d0" fontSize="11" fontWeight={700}>
          Long {formatUsd(longUsd)}
        </text>

        {/* Short label */}
        <text x={300 - Math.min(shortPct * 3, 300) / 2} y="10" textAnchor="middle" fill="#fecaca" fontSize="11" fontWeight={700}>
          Short {formatUsd(shortUsd)}
        </text>
      </svg>
    </div>
  );
}

export default async function HomePage() {
  const dashboard = await getDashboardData();
  const snapshotCards = [
    ["Open positions", numberFormatter.format(dashboard.totals.openPositions), "Active position NFTs confirmed on-chain"],
    ["Active wallets", numberFormatter.format(dashboard.totals.uniqueTraders), "Wallets that currently own tracked positions"],
    ["Indexed events", numberFormatter.format(dashboard.totals.syncedEvents), "Synced transfers, cashflows, and pool snapshots from Envio"],
    ["Current equity", formatUsd(dashboard.totals.equityUsd), "Estimated current equity across tracked positions"],
    ["Last updated", formatDate(dashboard.generatedAt), "Most recent dashboard refresh"]
  ];

  // Compute per-instrument exposure from pool data
  const ethLong = dashboard.pools
    .filter((p) => p.side === "long" && displayInstrument(p.collateral) === "ETH")
    .reduce((s, p) => s + p.collateralValueUsd, 0);
  const ethShort = dashboard.pools
    .filter((p) => p.side === "short" && displayInstrument(p.collateral) === "ETH")
    .reduce((s, p) => s + p.debtValueUsd, 0);
  const btcLong = dashboard.pools
    .filter((p) => p.side === "long" && displayInstrument(p.collateral) === "BTC")
    .reduce((s, p) => s + p.collateralValueUsd, 0);
  const btcShort = dashboard.pools
    .filter((p) => p.side === "short" && displayInstrument(p.collateral) === "BTC")
    .reduce((s, p) => s + p.debtValueUsd, 0);

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
    ],
    [
      "Event history",
      `${numberFormatter.format(dashboard.totals.syncedCashflows)} cashflows`,
      `${numberFormatter.format(dashboard.totals.syncedTransfers)} transfers and ${numberFormatter.format(dashboard.totals.syncedSnapshots)} pool snapshots synced.`
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
      <LastRefreshedCounter generatedAt={dashboard.generatedAt} />

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
          <p className="eyebrow">Global exposure</p>
          <h2>Long vs short by instrument</h2>
        </div>
      </div>

      <article className="card" style={{ padding: "20px 24px" }}>
        <ExposureBar
          label="ETH / wstETH"
          longUsd={ethLong}
          shortUsd={ethShort}
          color="#627eea"
        />
        <ExposureBar
          label="BTC / WBTC"
          longUsd={btcLong}
          shortUsd={btcShort}
          color="#f7931a"
        />
      </article>

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
