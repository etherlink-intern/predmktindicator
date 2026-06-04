const trackedPools = [
  ["WstETHLongPool", "long", "wstETH"],
  ["WstETHShortPool", "short", "wstETH"],
  ["WBTCLongPool", "long", "WBTC"],
  ["WBTCShortPool", "short", "WBTC"]
];

export default function MethodologyPage() {
  return (
    <section>
      <p className="eyebrow">Methodology</p>
      <h1>Blockchain-first f(x) trader profiles</h1>
      <p className="muted">
        This app treats verified f(x) contracts and live Ethereum reads as the source of truth. External web
        leaderboards can be useful comparison material, but they are not used for displayed trader equity, debt, or
        risk metrics.
      </p>

      <div className="card-grid compact">
        <article className="card">
          <p className="eyebrow">Source of truth</p>
          <h2>On-chain pool state</h2>
          <p className="muted">
            Current positions are discovered from position-pool contracts using protocol view methods, then ownership
            is confirmed with each pool's ERC-721 owner lookup.
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">Metric type</p>
          <h2>Current marks</h2>
          <p className="muted">
            Equity, debt, and debt ratio are current mark-to-oracle values. They are not all-time realized PnL.
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">Historical PnL</p>
          <h2>Not guessed</h2>
          <p className="muted">
            Realized PnL requires historical operation cashflows from manager events. Until those events are fully
            indexed, the UI intentionally avoids showing realized PnL.
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
              <th>Contract read</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td><code>getNextPositionId()</code></td>
              <td>Find the highest position ID range to scan for each tracked pool.</td>
            </tr>
            <tr>
              <td>2</td>
              <td><code>getPosition(tokenId)</code></td>
              <td>Read raw collateral and raw debt for every candidate position ID.</td>
            </tr>
            <tr>
              <td>3</td>
              <td><code>ownerOf(tokenId)</code></td>
              <td>Keep only owner-confirmed open positions and assign them to wallets.</td>
            </tr>
            <tr>
              <td>4</td>
              <td><code>priceOracle()</code> + <code>getExchangePrice()</code></td>
              <td>Fetch the live pool oracle mark used for current valuation.</td>
            </tr>
            <tr>
              <td>5</td>
              <td><code>getPositionDebtRatio(tokenId)</code></td>
              <td>Read protocol debt ratio directly instead of estimating liquidation risk off-site.</td>
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
              <th>Pool</th>
              <th>Side</th>
              <th>Collateral</th>
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
            Raw collateral is converted to token units and marked with the pool oracle price. For wstETH pools this is
            a wstETH-denominated collateral mark; for WBTC pools this is a WBTC-denominated collateral mark.
          </p>
        </article>
        <article className="card">
          <h2>Debt value</h2>
          <p className="muted">
            Raw debt is converted from 18-decimal debt units into its current notional value. It is shown separately so
            leveraged positions are not mistaken for unencumbered collateral.
          </p>
        </article>
        <article className="card">
          <h2>Current equity</h2>
          <p className="muted">
            Current equity is the snapshot mark after subtracting debt value from collateral value. It changes as pool
            state and oracle prices move.
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
            Realized historical PnL is not displayed yet. It needs manager-operation event indexing for deposits,
            withdrawals, debt changes, redemptions, liquidations, and fees.
          </li>
          <li>
            Broad historical <code>eth_getLogs</code> scans are not reliable on the current free RPC path. The durable
            path is to index verified manager and pool events with Envio/HyperIndex.
          </li>
          <li>
            Snapshot counts are current at the last sync time. They are refreshed by the local chain snapshot job, not
            by a browser-side live subscription.
          </li>
          <li>
            External leaderboard ROI/PnL values from f(x) or third-party dashboards are intentionally excluded from
            these profile metrics unless explicitly labeled as comparison data in a future view.
          </li>
        </ul>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Next step</p>
          <h2>Path to true PnL</h2>
        </div>
      </div>
      <p className="muted">
        The next production step is a historical manager-event indexer. Once cashflows are indexed from chain, trader
        pages can add realized PnL, unrealized PnL, total return, fees, and liquidation history without relying on stale
        external leaderboard snapshots.
      </p>
    </section>
  );
}
