import { formatAddress, formatUsd, getCapitalFlowData, type CapitalFlowPeriod } from "../../../lib/fx-dashboard";
import { LocalTime } from "../../local-time";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ period?: string }> | { period?: string };
};

function compactUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function periodLabel(period: CapitalFlowPeriod) {
  if (period === "7d") return "7 days";
  if (period === "30d") return "30 days";
  return "all-time";
}

export default async function CapitalFlowsPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const period = params.period === "30d" || params.period === "all" ? params.period : "7d";
  const data = await getCapitalFlowData(period);
  const summary = data.summary;
  const filters: CapitalFlowPeriod[] = ["7d", "30d", "all"];

  return (
    <section>
      <p className="eyebrow">Capital Flows</p>
      <h1>Capital Flow dashboard</h1>
      <p className="muted">
        This page measures collateral entering and leaving f(x) positions. Deposits and withdrawals are converted to USD from collateral movements: long-pool collateral uses the latest pool oracle, short-pool collateral is treated as fxUSD-denominated collateral. It is a capital-flow lens, not PnL.
      </p>

      <div className="period-tabs" aria-label="Capital flow period filters">
        {filters.map((f) => <a className={f === data.period ? "active" : ""} href={`/research/capital-flows?period=${f}`} key={f}>{f === "all" ? "All-time" : f}</a>)}
      </div>

      <div className="flow-narrative">
        <div>
          <p className="eyebrow">Research narrative</p>
          <h2>{summary.netFlowUsd >= 0 ? "Net capital is entering the book" : "Net capital is leaving the book"}</h2>
          <p className="muted">
            Over {periodLabel(data.period)}, tracked wallets deposited {compactUsd(summary.depositsUsd)} and withdrew {compactUsd(summary.withdrawalsUsd)}, leaving net flow of <strong className={summary.netFlowUsd >= 0 ? "positive" : "negative"}>{compactUsd(summary.netFlowUsd)}</strong>. New-wallet capital contributed {compactUsd(summary.newCapitalUsd)}; returning-wallet capital contributed {compactUsd(summary.returningCapitalUsd)}.
          </p>
        </div>
        <div className="terminal-metrics">
          <div><span>Net inflow / outflow</span><strong className={summary.netFlowUsd >= 0 ? "positive" : "negative"}>{compactUsd(summary.netFlowUsd)}</strong></div>
          <div><span>Deposits</span><strong>{compactUsd(summary.depositsUsd)}</strong></div>
          <div><span>Withdrawals</span><strong>{compactUsd(summary.withdrawalsUsd)}</strong></div>
          <div><span>Wallets / events</span><strong>{summary.wallets.toLocaleString()} / {summary.events.toLocaleString()}</strong></div>
        </div>
      </div>

      <div className="health-grid dense" style={{ marginTop: 16 }}>
        <div className="health-cell"><span className="metric-label">New capital</span><strong>{compactUsd(summary.newCapitalUsd)}</strong><span className="muted small">First observed deposit event by a wallet in this dataset.</span></div>
        <div className="health-cell"><span className="metric-label">Returning wallet capital</span><strong>{compactUsd(summary.returningCapitalUsd)}</strong><span className="muted small">Subsequent deposits by wallets already seen before.</span></div>
        <div className="health-cell"><span className="metric-label">Flow by wallet cohort</span><strong>{data.cohorts.length}</strong><span className="muted small">Cohorts are based on newness, whale deposits and active add frequency.</span></div>
      </div>

      <section>
        <div className="section-header">
          <div>
            <p className="eyebrow">Flow by wallet cohort</p>
            <h2>Cohorts explain who supplied or removed capital</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>Cohort</th><th className="numeric">Wallets</th><th className="numeric">Deposits</th><th className="numeric">Withdrawals</th><th className="numeric">Net flow</th><th>Definition</th></tr></thead>
            <tbody>
              {data.cohorts.map((cohort) => (
                <tr key={cohort.cohort}>
                  <td>{cohort.cohort}</td>
                  <td className="numeric mono">{cohort.wallets.toLocaleString()}</td>
                  <td className="numeric mono">{formatUsd(cohort.depositsUsd)}</td>
                  <td className="numeric mono">{formatUsd(cohort.withdrawalsUsd)}</td>
                  <td className={`numeric mono ${cohort.netFlowUsd >= 0 ? "positive" : "negative"}`}>{formatUsd(cohort.netFlowUsd)}</td>
                  <td className="muted small">{cohort.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="split-grid">
        <section>
          <div className="section-header"><div><p className="eyebrow">Largest deposits</p><h2>Capital added</h2><p className="muted small">Ranks individual collateral-in events by USD amount.</p></div></div>
          <div className="table-wrap flush"><table className="compact"><thead><tr><th>Wallet</th><th>Pool</th><th className="numeric">Amount</th><th className="numeric">Time</th></tr></thead><tbody>{data.largestDeposits.map((event) => <tr key={`${event.wallet}-${event.positionId}-${event.blockTimestamp}`}><td><a className="mono" href={`/traders/${event.wallet}`}>{formatAddress(event.wallet)}</a></td><td>{event.asset} {event.side}</td><td className="numeric mono">{formatUsd(event.amountUsd)}</td><td className="numeric"><LocalTime date={event.blockTimestamp} /></td></tr>)}</tbody></table></div>
        </section>
        <section>
          <div className="section-header"><div><p className="eyebrow">Largest withdrawals</p><h2>Capital removed</h2><p className="muted small">Ranks individual collateral-out events by USD amount.</p></div></div>
          <div className="table-wrap flush"><table className="compact"><thead><tr><th>Wallet</th><th>Pool</th><th className="numeric">Amount</th><th className="numeric">Time</th></tr></thead><tbody>{data.largestWithdrawals.map((event) => <tr key={`${event.wallet}-${event.positionId}-${event.blockTimestamp}`}><td><a className="mono" href={`/traders/${event.wallet}`}>{formatAddress(event.wallet)}</a></td><td>{event.asset} {event.side}</td><td className="numeric mono">{formatUsd(event.amountUsd)}</td><td className="numeric"><LocalTime date={event.blockTimestamp} /></td></tr>)}</tbody></table></div>
        </section>
      </div>
    </section>
  );
}
