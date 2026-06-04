const trackedPools = [
  ["ETH Long", "long", "ETH"],
  ["ETH Short", "short", "ETH"],
  ["BTC Long", "long", "BTC"],
  ["BTC Short", "short", "BTC"]
];

export default function MethodologyPage() {
  return (
    <section>
      <p className="eyebrow">Methodology</p>
      <h1>Blockchain-first f(x) trader profiles</h1>
      <p className="muted">
        This dashboard uses public Ethereum data from verified f(x) contracts to show current position exposure and
        wallet-level risk. Values are snapshot estimates for research purposes, not financial advice.
      </p>

      <div className="card-grid compact">
        <article className="card">
          <p className="eyebrow">Source</p>
          <h2>Verified contract data</h2>
          <p className="muted">
            Current positions are discovered from public f(x) position-pool contracts and matched to the wallet that
            currently owns each position NFT.
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">Metric type</p>
          <h2>Current snapshot values</h2>
          <p className="muted">
            Equity, debt, and debt ratio are current values based on oracle prices. They are not all-time realized
            profit/loss.
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">Historical PnL</p>
          <h2>Not shown yet</h2>
          <p className="muted">
            Realized profit/loss requires a complete record of historical deposits, withdrawals, debt changes, and fees.
            Until that is available, the site does not display realized PnL.
          </p>
        </article>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Current-state snapshot</p>
          <h2>How open positions are found</h2>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Data read</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td><code>getNextPositionId()</code></td>
              <td>Find the position range for each tracked pool.</td>
            </tr>
            <tr>
              <td>2</td>
              <td><code>getPosition(tokenId)</code></td>
              <td>Read collateral and debt for each candidate position.</td>
            </tr>
            <tr>
              <td>3</td>
              <td><code>ownerOf(tokenId)</code></td>
              <td>Keep only open positions with a confirmed current owner.</td>
            </tr>
            <tr>
              <td>4</td>
              <td><code>priceOracle()</code> + <code>getExchangePrice()</code></td>
              <td>Fetch the oracle price used for current valuation.</td>
            </tr>
            <tr>
              <td>5</td>
              <td><code>getPositionDebtRatio(tokenId)</code></td>
              <td>Read the current debt ratio used for risk monitoring.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Coverage</p>
          <h2>Tracked pools</h2>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th>Side</th>
              <th>Instrument</th>
            </tr>
          </thead>
          <tbody>
            {trackedPools.map(([pool, side, collateral]) => (
              <tr key={pool}>
                <td>{pool}</td>
                <td><span className={`pill ${side}`}>{side}</span></td>
                <td>{collateral}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Valuation</p>
          <h2>What the numbers mean</h2>
        </div>
      </div>
      <div className="card-grid compact">
        <article className="card">
          <h2>Collateral value</h2>
          <p className="muted">
            Collateral is converted to token units and valued with the current oracle price for the relevant pool.
          </p>
        </article>
        <article className="card">
          <h2>Debt value</h2>
          <p className="muted">
            Debt is converted into its current value and shown separately so leveraged positions are easy to read.
          </p>
        </article>
        <article className="card">
          <h2>Current equity</h2>
          <p className="muted">
            Current equity is the snapshot estimate after subtracting debt value from collateral value. It changes as
            pool state and oracle prices move.
          </p>
        </article>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Limitations</p>
          <h2>What is not included yet</h2>
        </div>
      </div>
      <div className="card warning">
        <ul className="method-list">
          <li>
            Realized historical PnL is not displayed yet. It requires complete indexing for deposits, withdrawals,
            debt changes, redemptions, liquidations, and fees.
          </li>
          <li>
            Historical coverage is still being expanded, so current snapshot pages may not include closed positions or
            complete past activity.
          </li>
          <li>
            Snapshot counts are current as of the last refresh. They are refreshed periodically and are not a live
            browser-side subscription.
          </li>
          <li>
            Metrics may differ from other dashboards because each site can use different coverage, refresh timing, and
            calculation methods.
          </li>
          <li>
            This dashboard is informational only and should not be treated as trading, investment, tax, or legal advice.
          </li>
        </ul>
      </div>

    </section>
  );
}
