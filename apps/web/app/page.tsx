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
      <div className="card-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="card skeleton" key={index}>
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
      <div className="section-header">
        <div>
          <p className="eyebrow">Market Overview</p>
          <h2>Position Book Snapshot</h2>
        </div>
        <span className="small muted" style={{ fontWeight: 600 }}>live book / indexed history</span>
      </div>

      <div className="card-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <article className="card-hero" style={{ gridColumn: "1" }} title="Estimated exposure across tracked active positions.">
          <p className="metric-label" style={{ marginBottom: 4 }}>Open Interest</p>
          <div className="metric-value">{formatCompactUsd(openInterestUsd)}</div>
          <div className="metric-detail">tracked notional / snapshot</div>
        </article>

        <article className="card-hero" style={{ gridColumn: "2 / span 2" }} title={`Long ${formatUsd(longUsd)} / Short ${formatUsd(shortUsd)}`}>
          <p className="metric-label" style={{ marginBottom: 4 }}>Position Bias</p>
          <div className="metric-value">{formatCompactUsd(longUsd)} <span className="muted small" style={{ fontWeight: 400 }}>long</span></div>
          <div style={{ height: 6, borderRadius: 999, background: "rgba(148,163,184,0.10)", overflow: "hidden", display: "flex", margin: "8px 0 4px" }}>
            <span style={{ width: `${longPct}%`, background: "rgba(34,197,94,0.50)", borderRadius: "999px 0 0 999px" }} />
            <span style={{ width: `${shortPct}%`, background: "rgba(239,68,68,0.50)", borderRadius: "0 999px 999px 0" }} />
          </div>
          <div className="metric-detail">{longPct.toFixed(1)}% long · {shortPct.toFixed(1)}% short · {formatCompactUsd(shortUsd)} short</div>
          <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <BiasInstrumentRow label="ETH" longUsd={ethLongUsd} shortUsd={ethShortUsd} color="#627eea" />
            <BiasInstrumentRow label="BTC" longUsd={btcLongUsd} shortUsd={btcShortUsd} color="#f7931a" />
          </div>
        </article>
      </div>

      {/* Risk watchlist — full width below */}
      <article className="card-hero" title={`${formatUsd(riskNotionalUsd)} above 80% debt ratio`} style={{ marginTop: 10, borderColor: riskPositions > 0 ? "rgba(245,158,11,0.30)" : undefined }}>
        <p className="metric-label" style={{ marginBottom: 4 }}>Risk Watchlist</p>
        <div className="metric-value">{numberFormatter.format(riskPositions)} <span className="muted small" style={{ fontWeight: 400 }}>positions at risk</span></div>
        <div className="metric-detail">{formatCompactUsd(riskNotionalUsd)} total notional at or above 80% debt ratio · {riskShare.toFixed(1)}% of tracked OI</div>
        {riskPositions > 0 && (
          <div style={{ height: 6, borderRadius: 999, background: "rgba(148,163,184,0.10)", overflow: "hidden", marginTop: 8 }}>
            <span style={{ width: `${riskShare}%`, height: "100%", background: "rgba(245,158,11,0.50)", borderRadius: 999, display: "block" }} />
          </div>
        )}
      </article>

      <div className="section-header" style={{ marginTop: 20 }}>
        <div>
          <p className="eyebrow">Debt & volume</p>
          <h2>Additional metrics</h2>
        </div>
      </div>

      <div className="card-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="card-hero" title={`Tracked debt ${formatUsd(debtUsd)}`}>
          <p className="metric-label" style={{ marginBottom: 4 }}>Debt Utilization</p>
          <div className="metric-value">{formatCompactUsd(debtUsd)}</div>
          <div className="metric-detail">{debtUtilization.toFixed(1)}% of OI</div>
          <div style={{ height: 6, borderRadius: 999, background: "rgba(148,163,184,0.10)", overflow: "hidden", marginTop: 8 }}>
            <span style={{ width: `${debtUtilization}%`, height: "100%", background: "rgba(56,189,248,0.50)", borderRadius: 999, display: "block" }} />
          </div>
        </article>
        <div className="card-hero">
          <p className="metric-label" style={{ marginBottom: 4 }}>Wallets</p>
          <div className="metric-value">{numberFormatter.format(wallets)}</div>
          <div className="metric-detail">tracked known wallets</div>
        </div>
        <div className="card-hero">
          <p className="metric-label" style={{ marginBottom: 4 }}>Events</p>
          <div className="metric-value">{numberFormatter.format(events)}</div>
          <div className="metric-detail">synced cashflows</div>
        </div>
        <div className="card-hero">
          <p className="metric-label" style={{ marginBottom: 4 }}>Updated</p>
          <div className="metric-value" style={{ fontSize: 22 }}>{formatTime(updatedAt)}</div>
          <div className="metric-detail">last position snapshot</div>
        </div>
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
        <div className="card-warning">
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
            <a className="button" href="/leaderboard">View leaderboard →</a>
          </div>

          <div className="table-wrap">
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
