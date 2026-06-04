import { displayInstrument, displayPool, formatDate, formatPercent, formatUsd, getDashboardData } from "../lib/fx-dashboard";
import { LastRefreshedCounter } from "./last-refreshed";

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function BiasInstrumentRow({
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
  const longPct = (longUsd / total) * 100;
  const shortPct = (shortUsd / total) * 100;
  const net = longUsd - shortUsd;
  const dominant = net > 0 ? "long" : "short";
  const dominantPct = Math.max(longPct, shortPct);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
      <span
        style={{
          width: 6, height: 6, borderRadius: "50%", background: color,
          display: "inline-block", flexShrink: 0,
        }}
      />
      <span style={{ fontSize: "12px", fontWeight: 700, minWidth: "30px" }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: "999px", background: "rgba(148,163,184,0.10)", overflow: "hidden", display: "flex" }}>
        <span style={{ width: `${longPct}%`, background: "rgba(34,197,94,0.50)", borderRadius: "999px 0 0 999px" }} />
        <span style={{ width: `${shortPct}%`, background: "rgba(239,68,68,0.50)", borderRadius: "0 999px 999px 0" }} />
      </div>
      <span style={{ fontSize: "11px", fontWeight: 700, minWidth: "52px", textAlign: "right", color: dominant === "long" ? "#bbf7d0" : "#fecaca" }}>
        {dominantPct.toFixed(0)}% {dominant === "long" ? "L" : "S"}
      </span>
    </div>
  );
}



function formatCompactUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (absolute >= 1_000) return `${sign}$${Math.round(absolute / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(absolute).toLocaleString()}`;
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function MarketOverviewSkeleton() {
  return (
    <div className="market-terminal skeleton-terminal" aria-label="Loading market overview">
      <div className="market-hero-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="market-panel skeleton-panel" key={index}>
            <span className="skeleton-line short" />
            <span className="skeleton-line value" />
            <span className="skeleton-line" />
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketOverviewEmptyState() {
  return (
    <div className="market-terminal empty-terminal">
      <div>
        <p className="eyebrow">Market Overview</p>
        <h2>Position book snapshot</h2>
      </div>
      <p className="muted">Market data will appear after the next successful position snapshot.</p>
    </div>
  );
}

function MarketOverviewTerminal({
  openInterestUsd,
  longUsd,
  shortUsd,
  ethLongUsd,
  ethShortUsd,
  btcLongUsd,
  btcShortUsd,
  debtUsd,
  riskPositions,
  riskNotionalUsd,
  wallets,
  events,
  updatedAt,
  hasSnapshot,
}: {
  openInterestUsd: number;
  longUsd: number;
  shortUsd: number;
  ethLongUsd: number;
  ethShortUsd: number;
  btcLongUsd: number;
  btcShortUsd: number;
  debtUsd: number;
  riskPositions: number;
  riskNotionalUsd: number;
  wallets: number;
  events: number;
  updatedAt: string | null;
  hasSnapshot: boolean;
}) {
  if (!hasSnapshot) return <MarketOverviewEmptyState />;

  const positioningTotal = longUsd + shortUsd || 1;
  const longPct = (longUsd / positioningTotal) * 100;
  const shortPct = (shortUsd / positioningTotal) * 100;
  const debtUtilization = openInterestUsd > 0 ? Math.min((debtUsd / openInterestUsd) * 100, 100) : 0;
  const riskShare = openInterestUsd > 0 ? (riskNotionalUsd / openInterestUsd) * 100 : 0;

  return (
    <section className="market-terminal" aria-label="Market overview position book snapshot">
      <div className="section-header market-terminal-header">
        <div>
          <p className="eyebrow">Market Overview</p>
          <h2>Position Book Snapshot</h2>
        </div>
        <span className="terminal-chip" title="Current open-position snapshot plus indexed event history">
          live book / indexed history
        </span>
      </div>

      <div className="market-hero-grid">
        <article className="market-panel market-panel-primary" title="Estimated exposure across tracked active positions.">
          <p className="market-label">Open Interest</p>
          <h3>{formatCompactUsd(openInterestUsd)}</h3>
          <div className="market-micro-row">
            <span>tracked notional</span>
            <span className="neutral-dot">snapshot</span>
          </div>
        </article>

        <article className="market-panel market-panel-bias" title={`Long ${formatUsd(longUsd)} / Short ${formatUsd(shortUsd)} / ETH: ${formatCompactUsd(ethLongUsd)} ${formatCompactUsd(ethShortUsd)} / BTC: ${formatCompactUsd(btcLongUsd)} ${formatCompactUsd(btcShortUsd)}`}>
          <div className="panel-topline">
            <p className="market-label">Position Bias</p>
            <span className="bias-badge">{longPct.toFixed(1)}% Long Bias</span>
          </div>
          <div className="bias-values">
            <span><b>Long</b> {formatCompactUsd(longUsd)}</span>
            <span><b>Short</b> {formatCompactUsd(shortUsd)}</span>
          </div>
          <div className="dominance-track" aria-label={`Long ${longPct.toFixed(1)}%, Short ${shortPct.toFixed(1)}%`}>
            <span className="dominance-long" style={{ width: `${longPct}%` }} />
            <span className="dominance-short" style={{ width: `${shortPct}%` }} />
          </div>
          <div style={{ marginTop: "14px", borderTop: "1px solid rgba(148,163,184,0.08)", paddingTop: "8px" }}>
            <BiasInstrumentRow label="ETH" longUsd={ethLongUsd} shortUsd={ethShortUsd} color="#627eea" />
            <BiasInstrumentRow label="BTC" longUsd={btcLongUsd} shortUsd={btcShortUsd} color="#f7931a" />
          </div>
          <div className="market-micro-row" style={{ marginTop: "6px" }}>
            <span>long {longPct.toFixed(1)}%</span>
            <span>short {shortPct.toFixed(1)}%</span>
          </div>
        </article>

        <article className="market-panel" title={`Tracked debt ${formatUsd(debtUsd)} / Open interest ${formatUsd(openInterestUsd)}`}>
          <p className="market-label">Debt Utilization</p>
          <h3>{formatCompactUsd(debtUsd)}</h3>
          <div className="utilization-line">
            <span style={{ width: `${debtUtilization}%` }} />
          </div>
          <div className="market-micro-row">
            <span>{debtUtilization.toFixed(1)}% of OI</span>
            <span>tracked debt</span>
          </div>
        </article>

        <article className="market-panel market-panel-risk" title={`${formatUsd(riskNotionalUsd)} in tracked positions at or above an 80% debt ratio.`}>
          <p className="market-label">Risk Watchlist</p>
          <h3>{numberFormatter.format(riskPositions)}</h3>
          <div className="risk-copy">
            <strong>{formatCompactUsd(riskNotionalUsd)}</strong>
            <span>above 80% debt ratio</span>
          </div>
          <div className="market-micro-row">
            <span>{riskShare.toFixed(1)}% of OI</span>
            <span>watchlist notional</span>
          </div>
        </article>
      </div>

      <div className="market-status-bar" aria-label="Secondary market status">
        <span title="Known tracked wallets"><b>Wallets</b> {numberFormatter.format(wallets)}</span>
        <span title="Indexed cashflow events"><b>Events</b> {numberFormatter.format(events)}</span>
        <span title="Last current-position snapshot"><b>Updated</b> {formatTime(updatedAt)}</span>
      </div>
    </section>
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

      <MarketOverviewTerminal
        openInterestUsd={dashboard.totals.trackedOpenInterestUsd || totalOi}
        longUsd={dashboard.totals.longNotionalUsd || totalLong}
        shortUsd={dashboard.totals.shortBorrowedExposureUsd || totalShort}
        ethLongUsd={ethLong}
        ethShortUsd={ethShort}
        btcLongUsd={btcLong}
        btcShortUsd={btcShort}
        debtUsd={dashboard.totals.longDebtUsd}
        riskPositions={dashboard.totals.riskQueuePositions80}
        riskNotionalUsd={dashboard.totals.riskQueueNotional80Usd}
        wallets={dashboard.walletMaintenance.knownWallets || dashboard.totals.uniqueTraders}
        events={dashboard.totals.syncedCashflows}
        updatedAt={dashboard.generatedAt}
        hasSnapshot={dashboard.hasSnapshot}
      />

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
