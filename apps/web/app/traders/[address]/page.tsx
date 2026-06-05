import { notFound } from "next/navigation";
import {
  displayPool,
  formatAddress,
  formatPercent,
  formatUsd,
  getTraderProfile
} from "../../../lib/fx-dashboard";
import { LocalTime } from "../../local-time";

const nf = new Intl.NumberFormat("en-US");

function formatCompactUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (absolute >= 1_000) return `${sign}$${Math.round(absolute / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(absolute).toLocaleString()}`;
}

function formatOraclePrice(price: number) {
  if (price === 0) return "—";
  if (price >= 1) return nf.format(price);
  return price.toFixed(6);
}

function formatPnl(value: number) {
  if (value === 0) return "—";
  return <span style={{ color: value > 0 ? "var(--positive)" : "var(--negative)" }}>{formatCompactUsd(value)}</span>;
}

function averageEntryMove(position: { side: string; entryPriceUsd: number; oraclePrice: number }) {
  if (!position.entryPriceUsd || !position.oraclePrice) return null;
  // For shorts, oraclePrice is inverted (1/real_price). Convert to real price for comparison.
  const markPrice = position.side === "short" && position.oraclePrice > 0 && position.oraclePrice < 1
    ? 1 / position.oraclePrice
    : position.oraclePrice;
  if (position.side === "short") {
    return (position.entryPriceUsd - markPrice) / position.entryPriceUsd;
  }
  return (markPrice - position.entryPriceUsd) / position.entryPriceUsd;
}

function formatEntryMove(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return <span style={{ color: value >= 0 ? "var(--positive)" : "var(--negative)" }}>{formatPercent(value)}</span>;
}

function formatDays(days: number | null) {
  if (days === null || !Number.isFinite(days) || days <= 0) return "—";
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(days >= 10 ? 0 : 1)}d`;
}

function leverageFor(position: { debtRatio: number; collateralValueUsd: number; debtValueUsd: number; equityUsd: number }) {
  if (position.debtRatio > 0 && position.debtRatio < 1) return 1 / (1 - position.debtRatio);
  if (position.equityUsd > 0) return position.collateralValueUsd / position.equityUsd;
  return 0;
}

export const dynamic = "force-dynamic";

type TraderPageProps = {
  params: Promise<{ address: string }> | { address: string };
};

export default async function TraderPage({ params }: TraderPageProps) {
  const resolvedParams = await params;
  const profile = await getTraderProfile(resolvedParams.address);

  if (!profile) {
    notFound();
  }

  const s = profile.summary;
  const netLabel = s.ethNetExposureUsd !== 0 || s.btcNetExposureUsd !== 0
    ? s.ethNetExposureUsd + s.btcNetExposureUsd > 0 ? "Net long" : "Net short"
    : "Flat";
  const netColor = s.ethNetExposureUsd + s.btcNetExposureUsd > 0 ? "var(--positive)" : s.ethNetExposureUsd + s.btcNetExposureUsd < 0 ? "var(--negative)" : "var(--muted)";

  // Total long/short for bias bar
  const totalLong = s.ethLongExposureUsd + s.btcLongExposureUsd;
  const totalShort = s.ethShortExposureUsd + s.btcShortExposureUsd;
  const totalBothRaw = totalLong + totalShort;
  const totalBoth = totalBothRaw || 1;
  const longPct = totalBothRaw > 0 ? (totalLong / totalBoth) * 100 : 0;
  const shortPct = totalBothRaw > 0 ? (totalShort / totalBoth) * 100 : 0;
  const dominant = totalBothRaw === 0 ? "flat" : longPct >= 50 ? "long" : "short";
  const dominantPct = Math.max(longPct, shortPct);
  const realizedPnlUsd = profile.history.reduce((sum, item) => sum + item.realizedPnlUsd, 0);
  const lifetimePnlUsd = realizedPnlUsd + s.unrealizedPnlUsd;
  const capitalBaseUsd = Math.max(s.collateralValueUsd, s.notionalValueUsd);
  const roi = capitalBaseUsd > 0 ? lifetimePnlUsd / capitalBaseUsd : null;
  const roiLabel = roi === null ? "—" : formatPercent(roi);
  const avgLeverage = profile.positions.length > 0
    ? profile.positions.reduce((sum, position) => sum + leverageFor(position), 0) / profile.positions.length
    : 0;
  const holdSamples = profile.history
    .map((item) => item.firstAt && item.lastAt ? (new Date(item.lastAt).getTime() - new Date(item.firstAt).getTime()) / 86400000 : null)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  const avgHoldDays = holdSamples.length > 0 ? holdSamples.reduce((sum, value) => sum + value, 0) / holdSamples.length : null;
  const biggestWin = profile.history.reduce((best, item) => item.realizedPnlUsd > best ? item.realizedPnlUsd : best, 0);
  const biggestLoss = profile.history.reduce((worst, item) => item.realizedPnlUsd < worst ? item.realizedPnlUsd : worst, 0);
  const ethExposure = s.ethLongExposureUsd + s.ethShortExposureUsd;
  const btcExposure = s.btcLongExposureUsd + s.btcShortExposureUsd;
  const preferredAsset = ethExposure === 0 && btcExposure === 0 ? "—" : ethExposure >= btcExposure ? "ETH" : "BTC";
  const biasLabel = dominant === "flat" ? "flat" : dominant === "long" ? "long-biased" : "short-biased";
  const observedBehavior = `${preferredAsset === "—" ? "No dominant asset yet" : `Primarily ${preferredAsset} ${biasLabel}`}. Usually uses ${avgLeverage ? avgLeverage.toFixed(1) : "—"}× average leverage across open positions. Average hold period is ${formatDays(avgHoldDays)} based on indexed cashflow timestamps. Current book is ${dominant === "flat" ? "flat" : `${dominantPct.toFixed(0)}% ${dominant}`}.`;


  return (
    <section>
      {/* Header row: identity + stance */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: 2 }}>Trader profile</p>
          <h1 className="mono" style={{ fontSize: 18, margin: 0 }}>{formatAddress(profile.owner)}</h1>
          <p className="mono muted" style={{ fontSize: 12, wordBreak: "break-all" }}>{profile.owner}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: netColor }}>{netLabel}</span>
          <p className="muted small" style={{ marginTop: 2 }}>
            {s.positions} position{s.positions !== 1 ? "s" : ""} · <LocalTime date={profile.generatedAt} />
          </p>
        </div>
      </div>

      {/* Compact summary strip — no cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 28px", marginBottom: 20, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
        <div title="Lifetime PnL = realized PnL from indexed position history + current unrealized PnL."><span className="metric-value" style={{ fontSize: 20, color: lifetimePnlUsd >= 0 ? "var(--positive)" : "var(--negative)" }}>{formatCompactUsd(lifetimePnlUsd)}</span><div className="metric-label">Lifetime PnL</div></div>
        <div><span className="metric-value" style={{ fontSize: 20, color: realizedPnlUsd >= 0 ? "var(--positive)" : "var(--negative)" }}>{formatCompactUsd(realizedPnlUsd)}</span><div className="metric-label">Realized PnL</div></div>
        <div><span className="metric-value" style={{ fontSize: 20, color: s.unrealizedPnlUsd >= 0 ? "var(--positive)" : "var(--negative)" }}>{formatCompactUsd(s.unrealizedPnlUsd)}</span><div className="metric-label">Unrealized PnL</div></div>
        <div title="ROI = lifetime PnL divided by max(current collateral, current notional). Closed-only wallets without current capital show n/a."><span className="metric-value" style={{ fontSize: 20 }}>{roiLabel}</span><div className="metric-label">ROI</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{formatUsd(s.notionalValueUsd)}</span><div className="metric-label">Notional</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{avgLeverage ? `${avgLeverage.toFixed(2)}×` : "—"}</span><div className="metric-label">Average leverage</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{formatDays(avgHoldDays)}</span><div className="metric-label">Average hold time</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{biggestWin ? formatCompactUsd(biggestWin) : "—"}</span><div className="metric-label">Biggest win</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{biggestLoss ? formatCompactUsd(biggestLoss) : "—"}</span><div className="metric-label">Biggest loss</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{preferredAsset}</span><div className="metric-label">Preferred asset</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{dominantPct.toFixed(0)}% {dominant === "long" ? "L" : "S"}</span><div className="metric-label">Long/short bias</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{formatPercent(s.maxDebtRatio)}</span><div className="metric-label">Liquidation proximity</div></div>
      </div>

      <section className="observed-behavior">
        <div>
          <p className="eyebrow">Observed Behavior</p>
          <h2>Behavioral readout</h2>
        </div>
        <p>{observedBehavior}</p>
        <p className="muted small">This block is generated from current exposure, debt ratios, indexed cashflow timestamps and realized/unrealized PnL. It is descriptive, not advice.</p>
      </section>

      {/* Exposures — compact merged section */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ minWidth: 160, flex: 1 }}>
          <div className="metric-label" style={{ marginBottom: 6 }}>Net ETH</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: s.ethNetExposureUsd >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {formatUsd(Math.abs(s.ethNetExposureUsd))}
            </span>
            <span className="muted small">{s.ethNetExposureUsd >= 0 ? "Long" : "Short"}</span>
          </div>
          <div className="muted small">L {formatUsd(s.ethLongExposureUsd)} / S {formatUsd(s.ethShortExposureUsd)}</div>
        </div>
        <div style={{ minWidth: 160, flex: 1 }}>
          <div className="metric-label" style={{ marginBottom: 6 }}>Net BTC</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: s.btcNetExposureUsd >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {formatUsd(Math.abs(s.btcNetExposureUsd))}
            </span>
            <span className="muted small">{s.btcNetExposureUsd >= 0 ? "Long" : "Short"}</span>
          </div>
          <div className="muted small">L {formatUsd(s.btcLongExposureUsd)} / S {formatUsd(s.btcShortExposureUsd)}</div>
        </div>
        <div style={{ flex: 2, minWidth: 200 }}>
          <div className="metric-label" style={{ marginBottom: 6 }}>Portfolio bias</div>
          <div style={{ height: 8, borderRadius: 999, background: "rgba(148,163,184,0.10)", overflow: "hidden", display: "flex", marginBottom: 4 }}>
            <span style={{ width: `${longPct}%`, background: "rgba(34,197,94,0.50)", borderRadius: "999px 0 0 999px" }} />
            <span style={{ width: `${shortPct}%`, background: "rgba(239,68,68,0.50)", borderRadius: "0 999px 999px 0" }} />
          </div>
          <div className="muted small">
            <span style={{ color: "var(--positive)" }}>{longPct.toFixed(1)}% long</span>
            <span style={{ margin: "0 6px" }}>·</span>
            <span style={{ color: "var(--negative)" }}>{shortPct.toFixed(1)}% short</span>
          </div>
        </div>
      </div>

      {/* Open positions table */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>Current positions, entry price history & liquidation proximity <span className="muted small" style={{ fontWeight: 400 }}>({profile.positions.length})</span></h2>
        <span className="muted small">Snapshot: <LocalTime date={profile.generatedAt} /></span>
      </div>

      <div className="table-wrap" style={{ marginTop: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Position</th>
              <th>Market</th>
              <th>Side</th>
              <th className="numeric">Oracle price</th>
              <th className="numeric">Avg entry</th>
              <th className="numeric">Entry Δ</th>
              <th className="numeric">PnL</th>
              <th className="numeric">Collateral</th>
              <th className="numeric">Debt</th>
              <th className="numeric">Equity</th>
              <th className="numeric">Debt ratio</th>
            </tr>
          </thead>
          <tbody>
            {profile.positions.map((position) => (
              <tr key={`${position.poolAddress}:${position.tokenId}`}>
                <td>
                  <a className="mono" href={`/positions/${position.poolAddress}-${position.tokenId}`} style={{ fontSize: 13 }}>#{position.tokenId}</a>
                </td>
                <td>{displayPool(position.poolName)}</td>
                <td><span className={`pill ${position.side}`}>{position.side}</span></td>
                <td className="numeric">{formatOraclePrice(position.oraclePrice)}</td>
                <td className="numeric" title="Average entry price for this open position, using official f(x) orders when indexed and snapshot fallback otherwise.">{position.entryPriceUsd ? formatUsd(position.entryPriceUsd) : "—"}</td>
                <td className="numeric" title="Move from average entry to current oracle price, adjusted for long/short direction.">{formatEntryMove(averageEntryMove(position))}</td>
                <td className="numeric">{formatPnl(position.unrealizedPnlUsd)}</td>
                <td className="numeric">{formatUsd(position.collateralValueUsd)}</td>
                <td className="numeric">{formatUsd(position.debtValueUsd)}</td>
                <td className="numeric">{formatUsd(position.equityUsd)}</td>
                <td className="numeric">{formatPercent(position.debtRatio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {profile.history.length > 0 && (
        <section className="timeline-strip">
          <div>
            <p className="eyebrow">Position timeline</p>
            <h2>First and latest indexed activity</h2>
            <p className="muted small">Average hold time is computed from first-to-last cashflow timestamps when available.</p>
          </div>
          <div className="terminal-metrics">
            <div><span>History rows</span><strong>{profile.history.length.toLocaleString()}</strong></div>
            <div><span>Average hold</span><strong>{formatDays(avgHoldDays)}</strong></div>
            <div><span>Biggest win</span><strong className="positive">{biggestWin ? formatCompactUsd(biggestWin) : "—"}</strong></div>
            <div><span>Biggest loss</span><strong className="negative">{biggestLoss ? formatCompactUsd(biggestLoss) : "—"}</strong></div>
          </div>
        </section>
      )}


      {/* Current 8h exchange-window fee activity */}
      {profile.fundingFeeActivity.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "20px 0 8px" }}>
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>8h fee activity <span className="muted small" style={{ fontWeight: 400 }}>({profile.fundingFeeActivity.length} positions)</span></h2>
            <span className="muted small">Binance/OKX-style 00:00 / 08:00 / 16:00 UTC window</span>
          </div>

          <div className="table-wrap" style={{ marginTop: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th className="numeric">8h fees</th>
                  <th className="numeric">Events</th>
                  <th className="numeric">Last fee event</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {profile.fundingFeeActivity.map((activity) => (
                  <tr key={`${activity.poolAddress}:${activity.tokenId}`}>
                    <td>
                      <a className="mono" href={`/positions/${activity.poolAddress}-${activity.tokenId}`} style={{ fontSize: 13 }}>#{activity.tokenId}</a>
                    </td>
                    <td>{activity.poolName !== activity.poolAddress ? displayPool(activity.poolName) : activity.poolAddress.slice(0, 10) + "…"}</td>
                    <td><span className={`pill ${activity.side}`}>{activity.side === "unknown" ? "—" : activity.side}</span></td>
                    <td className="numeric">{formatUsd(activity.feesUsd)}</td>
                    <td className="numeric">{nf.format(activity.events)}</td>
                    <td className="numeric"><LocalTime date={activity.lastAt} /></td>
                    <td>
                      <span className={`pill ${activity.isOpen ? "long" : "short"}`} style={{ fontSize: 10 }}>
                        {activity.isOpen ? "Open" : "Closed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Historical positions table */}
      {profile.history.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "20px 0 8px" }}>
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>Position history <span className="muted small" style={{ fontWeight: 400 }}>({profile.history.length})</span></h2>
          </div>

          <div className="table-wrap" style={{ marginTop: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th className="numeric">Fees paid</th>
                  <th className="numeric">Realized PnL</th>
                  <th className="numeric">Events</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {profile.history.map((h) => (
                  <tr key={`${h.poolAddress}:${h.tokenId}`}>
                    <td>
                      <a className="mono" href={`/positions/${h.poolAddress}-${h.tokenId}`} style={{ fontSize: 13 }}>#{h.tokenId}</a>
                    </td>
                    <td>{h.poolName !== h.poolAddress ? h.poolName : h.poolAddress.slice(0, 10) + "…"}</td>
                    <td><span className={`pill ${h.side}`}>{h.side === "unknown" ? "—" : h.side}</span></td>
                    <td className="numeric">{formatUsd(h.feesUsd)}</td>
                    <td className="numeric">{formatPnl(h.realizedPnlUsd)}</td>
                    <td className="numeric">{nf.format(h.cashflowEventCount)}</td>
                    <td>
                      <span className={`pill ${h.isOpen ? "long" : "short"}`} style={{ fontSize: 10 }}>
                        {h.isOpen ? "Open" : "Closed"}
                      </span>
                    </td>
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
