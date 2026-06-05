import { notFound } from "next/navigation";
import { formatAddress, getResearchData } from "../../../lib/fx-dashboard";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> | { slug: string } };

export default async function ResearchDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const research = await getResearchData();
  const card = research.cards.find((item) => item.slug === slug);
  if (!card) notFound();

  const supporting = research.cards.filter((item) => item.slug !== slug).slice(0, 3);

  return (
    <section>
      <p className="eyebrow">{card.kicker}</p>
      <h1>{card.title}</h1>
      <p className="muted">{card.summary}</p>

      <div className="flow-narrative">
        <div>
          <p className="eyebrow">Measurement</p>
          <h2>{card.metric}</h2>
          <p className="muted">
            This research card is a drill-down stub that points to the live source view for verification. The signal is generated from indexed f(x) positions, cashflows and wallet-level PnL. It is not a composite score; the metric above is the direct value used on the card.
          </p>
          <a className="button" href={card.href}>Open source view →</a>
        </div>
        <div className="terminal-metrics">
          <div><span>Signal group</span><strong>{card.kicker}</strong></div>
          <div><span>Primary metric</span><strong>{card.metric}</strong></div>
          <div><span>Current net flow</span><strong>{research.capitalFlows.summary.netFlowUsd >= 0 ? "+" : ""}{Math.round(research.capitalFlows.summary.netFlowUsd).toLocaleString()}</strong></div>
          <div><span>Risk queue</span><strong>{research.dashboard.totals.riskQueuePositions80.toLocaleString()} positions</strong></div>
        </div>
      </div>

      <section>
        <div className="section-header"><div><p className="eyebrow">Related signals</p><h2>Continue research</h2></div></div>
        <div className="research-card-grid">
          {supporting.map((item) => (
            <a className="research-card" href={item.href} key={item.slug}>
              <span className="metric-label">{item.kicker}</span>
              <strong>{item.title}</strong>
              <span className="research-card-metric">{item.metric}</span>
              <span className="muted small">{item.summary}</span>
            </a>
          ))}
        </div>
      </section>

      <section>
        <div className="section-header"><div><p className="eyebrow">Archetype sample</p><h2>Wallets with explicit classifications</h2></div></div>
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>Archetype</th><th>Wallet</th><th className="numeric">Metric</th><th>Reason</th></tr></thead>
            <tbody>
              {research.archetypes.flatMap((group) => group.wallets.slice(0, 1).map((wallet) => (
                <tr key={`${group.name}-${wallet.address}`}>
                  <td>{group.name}</td>
                  <td><a className="mono" href={`/traders/${wallet.address}`}>{formatAddress(wallet.address)}</a></td>
                  <td className="numeric mono">{wallet.metric}</td>
                  <td className="muted small">{wallet.reason}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
