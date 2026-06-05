const trackedPools = [
  ["ETH Long", "long", "ETH", "wstETH collateral, long-side debt"],
  ["ETH Short", "short", "ETH", "fxUSD collateral, borrowed ETH exposure"],
  ["BTC Long", "long", "BTC", "WBTC collateral, long-side debt"],
  ["BTC Short", "short", "BTC", "fxUSD collateral, borrowed BTC exposure"]
];

const dataSources = [
  ["Current position book", "fx_current_positions", "Open-position owner, collateral, debt, equity, oracle price, debt ratio and current PnL inputs."],
  ["Historical cashflows", "fx_position_cashflows", "Manager-source deposits, withdrawals, debt changes, fees and first/last activity timestamps."],
  ["Official f(x) positions", "fx_official_positions", "Canonical owner / real owner, pool metadata, closed/open state and raw position state from the official f(x) subgraphs."],
  ["Official f(x) orders", "fx_official_position_orders", "Execution-price order history used for UI-aligned entry price, realized PnL and order-count freshness."],
  ["Position PnL cache", "fx_position_pnl", "Per-position cashflow aggregates plus official-order UI PnL columns and freshness guards."]
];

const rankingRows = [
  ["Top PnL", "Default ranking. Sorts wallets by total PnL = realized PnL + unrealized PnL, descending. Positive PnL ranks above negative PnL."],
  ["Top ROI", "Sorts by total PnL divided by capital used. Wallets must have at least $1K of capital/notional to reduce tiny-wallet noise."],
  ["Best Realized PnL", "Sorts by closed-position realized PnL only. Unrealized gains are shown separately but do not drive this tab."],
  ["Most Active", "Sorts by total position count. This measures activity/churn, not trading performance."],
  ["Whale Traders", "Sorts by current notional exposure. This measures size, not trading performance."]
];

const flowRows = [
  ["Long BTC collateral", "collateral_raw / 1e8 × latest WBTC pool oracle"],
  ["Long ETH collateral", "collateral_raw / 1e18 × latest wstETH pool oracle"],
  ["Short collateral", "collateral_raw / 1e18 because short-side collateral is fxUSD-denominated"],
  ["Net flow", "deposits minus withdrawals in the selected 7d / 30d / all-time window"]
];

export default function MethodologyPage() {
  return (
    <section>
      <p className="eyebrow">Methodology</p>
      <h1>How the f(x) research dashboard calculates trader and protocol metrics</h1>
      <p className="muted">
        This dashboard combines public f(x) Protocol subgraph data, indexed cashflows and current position snapshots to build trader profiles, capital-flow research, protocol-health cards and ranking tables. Values are research estimates for transparency and monitoring; they are not trading, investment, tax or legal advice.
      </p>

      <div className="card-grid compact">
        <article className="card">
          <p className="eyebrow">Coverage</p>
          <h2>Four official f(x) pools</h2>
          <p className="muted">ETH/BTC long and short pools are tracked. Wallets are filtered to valid 0x addresses; literal NULL strings and unknown system rows are excluded from trader rankings.</p>
        </article>
        <article className="card">
          <p className="eyebrow">PnL source</p>
          <h2>Official order stream first</h2>
          <p className="muted">Realized PnL prefers the official f(x) order stream when the latest synced order block is at least as fresh as the latest indexed cashflow block.</p>
        </article>
        <article className="card">
          <p className="eyebrow">Freshness guard</p>
          <h2>No stale UI PnL</h2>
          <p className="muted"><code>ui_realized_pnl_usd</code> is used only when <code>ui_last_order_block &gt;= last_cashflow_block</code>. Otherwise the dashboard falls back to cashflow-derived realized PnL.</p>
        </article>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Data pipeline</p>
          <h2>What data is read</h2>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Layer</th>
              <th>Table / source</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {dataSources.map(([layer, source, purpose]) => (
              <tr key={source}>
                <td>{layer}</td>
                <td><code>{source}</code></td>
                <td>{purpose}</td>
              </tr>
            ))}
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
              <th>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {trackedPools.map(([pool, side, collateral, note]) => (
              <tr key={pool}>
                <td>{pool}</td>
                <td><span className={`pill ${side}`}>{side}</span></td>
                <td>{collateral}</td>
                <td>{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">PnL methodology</p>
          <h2>Realized, unrealized and total PnL</h2>
        </div>
      </div>
      <div className="card-grid compact">
        <article className="card">
          <h2>Realized PnL</h2>
          <p className="muted">Realized PnL is computed from official f(x) execution prices using a weighted-average entry model over Open/Add and Reduce/Close/Liquidate/WithdrawRepay/Withdraw orders. For shorts, the calculation uses debt-token size from <code>deltaDebts</code> and flips the direction so falling prices are profitable.</p>
        </article>
        <article className="card">
          <h2>Unrealized PnL</h2>
          <p className="muted">Open-position unrealized PnL uses current oracle prices. Shorts prefer official-order UI unrealized PnL. Long displays intentionally use the raw entry-price fallback instead of long-side <code>ui_entry_price_usd</code>, because long order enrichment can have misleading decimal scales.</p>
        </article>
        <article className="card">
          <h2>Total PnL</h2>
          <p className="muted">Trader total PnL is realized PnL from indexed position history plus current unrealized PnL from open positions. Top Traders and profile pages use the same ownership and PnL methodology.</p>
        </article>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Order sync</p>
          <h2>How official f(x) order history is kept complete</h2>
        </div>
      </div>
      <div className="card warning">
        <ul className="method-list">
          <li>Official f(x) subgraph orders are fetched with skip-based pagination in 1,000-order pages, so positions with more than 1,000 orders are not truncated.</li>
          <li>The incremental candidate set includes positions with recent cashflows, positions whose cashflow block is newer than the last synced official-order block, and current positions missing official-order coverage.</li>
          <li>Order rows are de-duplicated by official order id and sorted by block number and log index before entry/PnL calculations.</li>
          <li>A client timeout while calling the long-running sync endpoint is inconclusive; database freshness and enrichment output are the verification source.</li>
        </ul>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Trader rankings</p>
          <h2>No opaque composite score as the default</h2>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Tab</th>
              <th>What it ranks</th>
            </tr>
          </thead>
          <tbody>
            {rankingRows.map(([tab, definition]) => (
              <tr key={tab}>
                <td>{tab}</td>
                <td>{definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Capital flows</p>
          <h2>How deposits and withdrawals are converted to USD</h2>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Flow type</th>
              <th>Conversion</th>
            </tr>
          </thead>
          <tbody>
            {flowRows.map(([flowType, conversion]) => (
              <tr key={flowType}>
                <td>{flowType}</td>
                <td>{conversion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Research sections</p>
          <h2>What the research hub measures</h2>
        </div>
      </div>
      <div className="card-grid compact">
        <article className="card"><h2>Research cards</h2><p className="muted">Cards surface live signals and open a drill-down brief. Each brief links to a verifiable source view such as capital flows, a trader profile, a position page or the conviction tracker.</p></article>
        <article className="card"><h2>Trader archetypes</h2><p className="muted">Archetypes are rule-based classifications over current exposure, position count, notional size, directional bias and liquidation proximity. They are labels, not performance scores.</p></article>
        <article className="card"><h2>Conviction tracker</h2><p className="muted">Highest Conviction Positions are ranked by large open exposure weighted by debt-ratio pressure. This measures committed exposure and liquidation headroom, not skill.</p></article>
        <article className="card"><h2>Protocol health</h2><p className="muted">Protocol Health cards explain TVL, open interest, long/short ratio, average leverage, net deposits, active traders, liquidation risk and fee generation.</p></article>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Known limitations</p>
          <h2>How to read the numbers safely</h2>
        </div>
      </div>
      <div className="card warning">
        <ul className="method-list">
          <li>Values depend on the latest indexed subgraph rows, current position snapshots and oracle prices. They are refreshed periodically, not via a live browser-side subscription.</li>
          <li>Official-order PnL is treated as the preferred UI-aligned source only after passing the freshness guard against cashflows.</li>
          <li>Cashflow fallback PnL can differ from f(x) UI execution-price PnL, especially for shorts, because short collateral movements are fxUSD-denominated rather than direct execution-price profit/loss.</li>
          <li>Liquidation-risk displays are debt-ratio proximity signals, not predictions that a liquidation will occur.</li>
          <li>Metrics may differ from other dashboards because each site can use different coverage, refresh timing, owner attribution and calculation methods.</li>
        </ul>
      </div>
    </section>
  );
}
