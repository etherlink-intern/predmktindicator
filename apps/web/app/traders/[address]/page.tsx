import { notFound } from "next/navigation";
import {
  displayPool,
  formatAddress,
  formatDate,
  formatPercent,
  formatUsd,
  getTraderProfile
} from "../../../lib/fx-dashboard";

const nf = new Intl.NumberFormat("en-US");

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
  const totalBoth = totalLong + totalShort || 1;
  const longPct = (totalLong / totalBoth) * 100;
  const shortPct = (totalShort / totalBoth) * 100;
  const dominant = longPct >= 50 ? "long" : "short";
  const dominantPct = Math.max(longPct, shortPct);

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
            {s.positions} position{s.positions !== 1 ? "s" : ""} · {formatDate(profile.generatedAt)}
          </p>
        </div>
      </div>

      {/* Compact summary strip — no cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 28px", marginBottom: 20, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{formatUsd(s.notionalValueUsd)}</span><div className="metric-label">Notional</div></div>
        <div><span className="metric-value" style={{ fontSize: 20, color: s.equityUsd >= 0 ? "var(--positive)" : "var(--negative)" }}>{formatUsd(s.equityUsd)}</span><div className="metric-label">Equity</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{formatUsd(s.debtValueUsd)}</span><div className="metric-label">Debt</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{formatUsd(s.feesUsd)}</span><div className="metric-label">Fees paid</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{nf.format(s.positions)}</span><div className="metric-label">Positions</div></div>
        <div><span className="metric-value" style={{ fontSize: 20 }}>{formatPercent(s.maxDebtRatio)}</span><div className="metric-label">Max debt ratio</div></div>
      </div>

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

      {/* Positions table — immediately visible, no section gap */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>Open positions</h2>
        <span className="muted small">Snapshot: {formatDate(profile.generatedAt)}</span>
      </div>

      <div className="table-wrap" style={{ marginTop: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Position</th>
              <th>Market</th>
              <th>Side</th>
              <th className="numeric">Oracle price</th>
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
                <td className="numeric">{nf.format(position.oraclePrice)}</td>
                <td className="numeric">{formatUsd(position.collateralValueUsd)}</td>
                <td className="numeric">{formatUsd(position.debtValueUsd)}</td>
                <td className="numeric">{formatUsd(position.equityUsd)}</td>
                <td className="numeric">{formatPercent(position.debtRatio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
