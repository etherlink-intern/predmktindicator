import { formatPercent, formatUsd, getTopTraders, type TopTrader } from "../../lib/fx-dashboard";
import { LocalTime } from "../local-time";

export const dynamic = "force-dynamic";

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatScore(score: number) {
  return (score * 100).toFixed(0);
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(2, score * 100);
  const color =
    score >= 0.6 ? "rgba(34,197,94,0.72)" :
    score >= 0.35 ? "rgba(234,179,8,0.72)" :
    "rgba(239,68,68,0.72)";
  return (
    <span style={{ display: "inline-block", width: 80, height: 6, borderRadius: 999, background: "var(--border)", verticalAlign: "middle" }}>
      <span style={{ display: "block", width: `${pct}%`, height: "100%", borderRadius: 999, background: color }} />
    </span>
  );
}

function WinRateBadge({ rate }: { rate: number }) {
  if (rate === 0) return <span className="muted">n/a</span>;
  const color = rate >= 0.6 ? "var(--green)" : rate >= 0.3 ? "var(--amber)" : "var(--red)";
  return <span style={{ color, fontWeight: 700 }}>{formatPercent(rate)}</span>;
}

export default async function TopTradersPage() {
  const traders = await getTopTraders();

  return (
    <section>
      <p className="eyebrow">Rankings</p>
      <h1>Top 10 Traders</h1>
      <p className="muted">
        Wallets ranked by a composite score that rewards profitable trading (realized + unrealized PnL),
        consistency (win rate), activity (position count), and risk management (lower leverage).
      </p>

      {traders.length === 0 ? (
        <div className="card-warning">
          <p className="muted">No trader data available yet. Rankings will appear after positions are synced.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="compact" style={{ width: "100%", minWidth: 680 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Trader</th>
                <th style={{ width: 90 }}>Score</th>
                <th className="numeric">Total PnL</th>
                <th className="numeric">Realized PnL</th>
                <th className="numeric">Win Rate</th>
                <th className="numeric">Positions</th>
                <th className="numeric">Notional</th>
                <th className="numeric">Max Debt</th>
                <th className="numeric">Fees</th>
              </tr>
            </thead>
            <tbody>
              {traders.map((t: TopTrader) => (
                <tr key={t.address}>
                  <td className="mono" style={{ fontWeight: 800, color: t.rank <= 3 ? "var(--gold)" : "inherit" }}>
                    {t.rank}
                  </td>
                  <td>
                    <a href={`/traders/${t.address}`} className="mono" style={{ textDecoration: "none" }}>
                      {shortAddress(t.address)}
                    </a>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="mono small" style={{ fontWeight: 700, width: 24 }}>{formatScore(t.score)}</span>
                      <ScoreBar score={t.score} />
                    </div>
                  </td>
                  <td className={`numeric mono ${t.totalPnlUsd >= 0 ? "positive" : "negative"}`}>
                    {formatUsd(t.totalPnlUsd)}
                  </td>
                  <td className={`numeric mono ${t.realizedPnlUsd >= 0 ? "positive" : "negative"}`}>
                    {formatUsd(t.realizedPnlUsd)}
                  </td>
                  <td className="numeric"><WinRateBadge rate={t.winRate} /></td>
                  <td className="numeric mono">{t.openPositions + t.closedPositions}</td>
                  <td className="numeric mono">{formatUsd(t.notionalUsd)}</td>
                  <td className="numeric mono">{formatPercent(t.maxDebtRatio)}</td>
                  <td className="numeric mono">{formatUsd(t.feesUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <h2>How scores are calculated</h2>
        <div className="card-grid compact" style={{ marginTop: 8 }}>
          <article className="card">
            <p className="muted">PnL (40%)</p>
            <p className="small">Hyperbolic tangent of total PnL scaled to $1M. Rewards both large profits and reduced losses.</p>
          </article>
          <article className="card">
            <p className="muted">Win Rate (30%)</p>
            <p className="small">Percentage of closed positions that were profitable. Raw fraction of winning / total closed.</p>
          </article>
          <article className="card">
            <p className="muted">Activity (20%)</p>
            <p className="small">Total positions (open + closed), capped at 20. Rewards active, engaged traders.</p>
          </article>
          <article className="card">
            <p className="muted">Risk (10%)</p>
            <p className="small">Penalty for high leverage. Max debt ratio above 80% starts reducing the score.</p>
          </article>
        </div>
      </div>
    </section>
  );
}
