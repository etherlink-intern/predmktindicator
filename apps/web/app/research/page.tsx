import {
  formatAddress,
  formatPercent,
  formatUsd,
  getResearchData,
  type TraderArchetype
} from "../../lib/fx-dashboard";

export const dynamic = "force-dynamic";

function compactUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function toneClass(tone: string) {
  return tone === "positive" ? "positive" : tone === "negative" ? "negative" : tone === "warning" ? "warning" : "";
}

function ResearchSectionCard({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <a className="research-section-card" href={href}>
      <div>
        <p className="eyebrow">Research module</p>
        <h2>{title}</h2>
      </div>
      <p className="muted small">{description}</p>
      <span className="button ghost">Open →</span>
    </a>
  );
}

function ArchetypeBlock({ group }: { group: TraderArchetype }) {
  return (
    <article className="research-panel">
      <div className="section-header tight">
        <div>
          <h2>{group.name}</h2>
          <p className="muted small">{group.description}</p>
        </div>
      </div>
      <div className="table-wrap flush">
        <table className="compact">
          <thead>
            <tr>
              <th>Wallet</th>
              <th className="numeric">Metric</th>
              <th>Why it belongs here</th>
            </tr>
          </thead>
          <tbody>
            {group.wallets.length === 0 ? (
              <tr><td colSpan={3} className="muted">No wallet currently matches this archetype.</td></tr>
            ) : group.wallets.map((wallet) => (
              <tr key={wallet.address}>
                <td><a className="mono" href={`/traders/${wallet.address}`}>{formatAddress(wallet.address)}</a></td>
                <td className="numeric mono">{wallet.metric}</td>
                <td className="muted small">{wallet.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export default async function ResearchPage() {
  const research = await getResearchData();
  const flow = research.capitalFlows.summary;

  const modules = [
    ["Market Structure", "Positioning, long/short skew, leverage and entry-price structure across ETH and BTC pools.", "/research/eth-longs-leverage"],
    ["Capital Flows", "Collateral deposits and withdrawals grouped by new wallets, returning wallets, whales and active adders.", "/research/capital-flows"],
    ["Whale Activity", "Largest wallets and largest exposure changes, separated from performance rankings.", "/research/largest-wallet-added-exposure"],
    ["Trader Archetypes", "Wallet classifications with explicit reasons: whales, swing traders, momentum, mean reversion, degens and survivors.", "#trader-archetypes"],
    ["Protocol Health", "TVL, OI, long/short ratio, leverage, deposits, active traders, liquidation risk and fees.", "#protocol-health"],
    ["Liquidation Maps", "Debt-ratio headroom and positions closest to the liquidation-risk queue.", "/research/btc-shorts-liquidation-cluster"]
  ] as const;

  return (
    <section>
      <p className="eyebrow">f(x) Protocol Research</p>
      <h1>Trader and protocol intelligence hub</h1>
      <p className="muted">
        This page turns indexed f(x) Protocol positions, cashflows and PnL history into research modules. The UI copies structure patterns from research products: narrative cards, explicit ranking definitions, dense tables and drill-down links — not external branding.
      </p>

      <div className="research-hero-grid">
        <div className="research-hero-copy">
          <p className="eyebrow">Research brief</p>
          <h2>What changed in the book?</h2>
          <p className="muted small">
            Capital flow, leverage, liquidation proximity and trader-behavior sections explain what they rank. Opaque composite scores are avoided unless a formula is visible.
          </p>
        </div>
        <div className="terminal-metrics">
          <div><span>7d net flow</span><strong className={flow.netFlowUsd >= 0 ? "positive" : "negative"}>{compactUsd(flow.netFlowUsd)}</strong></div>
          <div><span>Deposits</span><strong>{compactUsd(flow.depositsUsd)}</strong></div>
          <div><span>Withdrawals</span><strong>{compactUsd(flow.withdrawalsUsd)}</strong></div>
          <div><span>Risk queue</span><strong>{research.dashboard.totals.riskQueuePositions80.toLocaleString()} pos</strong></div>
        </div>
      </div>

      <div className="research-section-grid">
        {modules.map(([title, description, href]) => <ResearchSectionCard title={title} description={description} href={href} key={title} />)}
      </div>

      <section className="research-strip" aria-label="Research cards">
        <div className="section-header">
          <div>
            <p className="eyebrow">Research Cards</p>
            <h2>Current signals</h2>
            <p className="muted small">Each signal links to a detail page, capital-flow page, position page or trader profile.</p>
          </div>
        </div>
        <div className="research-card-grid">
          {research.cards.map((card) => (
            <a className={`research-card ${toneClass(card.tone)}`} href={card.href} key={card.slug}>
              <span className="metric-label">{card.kicker}</span>
              <strong>{card.title}</strong>
              <span className="research-card-metric">{card.metric}</span>
              <span className="muted small">{card.summary}</span>
            </a>
          ))}
        </div>
      </section>

      <section id="protocol-health">
        <div className="section-header">
          <div>
            <p className="eyebrow">Protocol Health</p>
            <h2>What each metric measures</h2>
          </div>
        </div>
        <div className="health-grid dense">
          {research.protocolHealth.map((metric) => (
            <div className={`health-cell ${toneClass(metric.tone)}`} key={metric.label} title={metric.explanation}>
              <span className="metric-label">{metric.label}</span>
              <strong>{metric.value}</strong>
              <span className="muted small">{metric.explanation}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-header">
          <div>
            <p className="eyebrow">Conviction Tracker</p>
            <h2>Highest Conviction Positions</h2>
            <p className="muted small">Ranks open positions by size weighted by debt-ratio pressure. This measures committed exposure, not trader skill.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>Wallet</th><th>Asset</th><th>Direction</th><th className="numeric">Position size</th><th className="numeric">Entry</th><th className="numeric">Leverage</th><th className="numeric">Liq. distance</th><th className="numeric">PnL</th>
              </tr>
            </thead>
            <tbody>
              {research.conviction.map((position) => (
                <tr key={`${position.poolAddress}-${position.tokenId}`}>
                  <td><a className="mono" href={`/traders/${position.wallet}`}>{formatAddress(position.wallet)}</a></td>
                  <td>{position.asset}</td>
                  <td><span className={`pill ${position.direction}`}>{position.direction}</span></td>
                  <td className="numeric mono">{formatUsd(position.positionSizeUsd)}</td>
                  <td className="numeric mono">{position.entryPriceUsd ? formatUsd(position.entryPriceUsd) : "—"}</td>
                  <td className="numeric mono">{position.leverage.toFixed(2)}×</td>
                  <td className="numeric mono">{formatPercent(position.liquidationDistancePct)}</td>
                  <td className={`numeric mono ${position.pnlUsd >= 0 ? "positive" : "negative"}`}>{formatUsd(position.pnlUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="trader-archetypes">
        <div className="section-header">
          <div>
            <p className="eyebrow">Trader Archetypes</p>
            <h2>Wallet classifications with reasons</h2>
            <p className="muted small">Archetypes are rule-based labels over current exposure, position count, notional, directional bias and liquidation proximity.</p>
          </div>
        </div>
        <div className="archetype-grid">
          {research.archetypes.map((group) => <ArchetypeBlock group={group} key={group.name} />)}
        </div>
      </section>
    </section>
  );
}
