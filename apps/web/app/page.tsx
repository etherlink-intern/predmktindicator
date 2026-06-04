import { displayInstrument, displayPool, formatDate, formatPercent, formatUsd, getDashboardData } from "../lib/fx-dashboard";
import { LastRefreshedCounter } from "./last-refreshed";

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function ExposureBiasRow({
  label,
  longUsd,
  shortUsd,
}: {
  label: string;
  longUsd: number;
  shortUsd: number;
}) {
  const total = longUsd + shortUsd || 1;
  const longPct = (longUsd / total) * 100;
  const shortPct = (shortUsd / total) * 100;
  const net = longUsd - shortUsd;
  const dominant = net > 0 ? "long" : "short";
  const dominantPct = Math.max(longPct, shortPct);
  const ratio = shortUsd > 0 ? (longUsd / shortUsd).toFixed(1) : "∞";

  return (
    <div
      style={{
        padding: "12px 0",
        borderBottom: "1px solid rgba(148,163,184,0.10)",
      }}
    >
      {/* Row 1: label + net */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: label === "ETH" ? "#627eea" : "#f7931a",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 700, fontSize: "13px", letterSpacing: "0.02em" }}>
            {label}
          </span>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: dominant === "long" ? "#22c55e" : "#ef4444",
            }}
          >
            {formatUsd(Math.abs(net))}
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "var(--muted)",
              fontWeight: 600,
            }}
          >
            {dominant === "long" ? "Net long" : "Net short"}
          </span>
        </div>
      </div>

      {/* Bias bar — fills proportionally to show dominance */}
      <div
        style={{
          position: "relative",
          height: 20,
          background: "rgba(148,163,184,0.06)",
          borderRadius: 3,
          overflow: "hidden",
          marginBottom: "6px",
        }}
      >
        {/* Long fill (left) */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${longPct}%`,
            background: "rgba(34,197,94,0.35)",
            transition: "width 0.3s",
          }}
        />
        {/* Short fill (right) */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            height: "100%",
            width: `${shortPct}%`,
            background: "rgba(239,68,68,0.35)",
            transition: "width 0.3s",
          }}
        />
        {/* 50/50 tick */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: 1,
            height: "100%",
            background: "rgba(148,163,184,0.15)",
          }}
        />
        {/* Dominant label overlay */}
        <div
          style={{
            position: "absolute",
            top: 0,
            height: "100%",
            display: "flex",
            alignItems: "center",
            paddingLeft: dominant === "long" ? "8px" : undefined,
            paddingRight: dominant === "short" ? "8px" : undefined,
            left: dominant === "long" ? 0 : undefined,
            right: dominant === "short" ? 0 : undefined,
            justifyContent: dominant === "long" ? "flex-start" : "flex-end",
            width: "100%",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: dominant === "long" ? "rgba(187,247,208,0.9)" : "rgba(254,202,202,0.9)",
            }}
          >
            {dominantPct.toFixed(1)}% {dominant === "long" ? "LONG" : "SHORT"}
          </span>
        </div>
      </div>

      {/* Row 2: detail metrics */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          fontSize: "11px",
          color: "var(--muted)",
          flexWrap: "wrap",
        }}
      >
        <span>
          Long <b style={{ color: "rgba(187,247,208,0.85)" }}>{formatUsd(longUsd)}</b> ({longPct.toFixed(1)}%)
        </span>
        <span>
          Short <b style={{ color: "rgba(254,202,202,0.85)" }}>{formatUsd(shortUsd)}</b> ({shortPct.toFixed(1)}%)
        </span>
        <span>
          Ratio <b style={{ color: "#e2e8f0" }}>{ratio}x</b>
        </span>
      </div>
    </div>
  );
}

export default async function HomePage() {
  const dashboard = await getDashboardData();

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

  const totalOi = ethLong + ethShort + btcLong + btcShort;
  const totalLong = ethLong + btcLong;
  const totalShort = ethShort + btcShort;

  const snapshotCards = [
    ["Open positions", numberFormatter.format(dashboard.totals.openPositions), "Active position NFTs confirmed on-chain"],
    ["Active wallets", numberFormatter.format(dashboard.totals.uniqueTraders), "Wallets that currently own tracked positions"],
    ["Indexed events", numberFormatter.format(dashboard.totals.syncedEvents), "Synced transfers, cashflows, and pool snapshots from Envio"],
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

      <div className="card-grid" style={{ marginTop: "16px" }}>
        {snapshotCards.map(([label, value, detail]) => (
          <article className="card" key={label}>
            <p className="muted">{label}</p>
            <h2>{value}</h2>
            <p className="muted small">{detail}</p>
          </article>
        ))}
      </div>

      {/* Global Exposure Widget */}
      <div className="section-header">
        <div>
          <p className="eyebrow">Positioning & crowding</p>
          <h2>Global exposure by instrument</h2>
        </div>
      </div>

      <article
        className="card"
        style={{
          padding: "4px 20px 8px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 0 4px",
            borderBottom: "1px solid rgba(148,163,184,0.10)",
            fontSize: "10px",
            color: "var(--muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <span>Instrument</span>
          <span style={{ textAlign: "right" }}>Net exposure</span>
        </div>

        <ExposureBiasRow label="ETH" longUsd={ethLong} shortUsd={ethShort} />
        <ExposureBiasRow label="BTC" longUsd={btcLong} shortUsd={btcShort} />

        {/* Footer summary */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            paddingTop: "10px",
            fontSize: "11px",
            color: "var(--muted)",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <span>
            Total OI: <b style={{ color: "#e2e8f0" }}>{formatUsd(totalOi)}</b>
          </span>
          <span>
            Long: <b style={{ color: "rgba(187,247,208,0.85)" }}>{formatUsd(totalLong)}</b> ({(totalLong / totalOi * 100).toFixed(1)}%)
          </span>
          <span>
            Short: <b style={{ color: "rgba(254,202,202,0.85)" }}>{formatUsd(totalShort)}</b> ({(totalShort / totalOi * 100).toFixed(1)}%)
          </span>
          <span>
            Ratio: <b style={{ color: "#e2e8f0" }}>{(totalLong / (totalShort || 1)).toFixed(1)}x</b>
          </span>
        </div>
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
