# f(x) Protocol Trader-Profile Dashboard Research

_Research date: 2026-06-03_

## Goal

Build a low-cost, trader-centric dashboard for f(x) Protocol that tracks wallets by positions, realized/unrealized PNL, ROI, volume, capital flow, liquidation/rebalance exposure, and recurring behavior patterns. The product should be similar in spirit to the community `fxprotocolstats.com` dashboard, but focused on trader profiles and "trading antics" rather than only protocol-level stats.

## Executive recommendation

Start with a **hybrid free stack**:

1. **Use f(x)'s existing leaderboard/API surface as seed data** to discover active wallets and baseline PNL/ROI/volume.
2. **Index on-chain position contracts yourself** with a free hosted indexer first, preferably **Goldsky Starter** for fast setup, or **The Graph Studio** if you want the most portable subgraph model.
3. **Keep raw snapshots in a cheap database** (Supabase/Neon free tier or SQLite during prototyping), because profile-level analytics need daily/hourly time series that are awkward to recompute from a subgraph alone.
4. **Use free RPC quotas only for gap filling and ABI reads**, not for the main historical event stream. Goldsky's free Edge RPC or Chainstack's free Ethereum endpoint are good starting points; add Alchemy as a secondary key.

This avoids paying for archive-node-style backfills while still giving us a durable path to a richer trader product.

## What the existing sites reveal

### `fxprotocolstats.com`

Observed behavior and public traces:

- The page identifies itself as **"f(x) Protocol — v2 Command Center"** when fetched by a crawler.
- Social/search previews describe it as an **alpha deploy** that is desktop-first, "not optimized for mobile yet," and may contain data errors despite a significant data pipeline effort.
- Protocol social/search snippets around the dashboard report current f(x) context such as TVL, fxUSD supply, fxSAVE APY, and sustained growth. These are useful benchmark cards for our dashboard, but they are not enough to build trader profiles.

Implication: `fxprotocolstats.com` is probably a community dashboard with a bespoke data pipeline and protocol-level emphasis. We should not clone it directly; we should use it as a design reference for layout, top-line cards, and caveats while building our own wallet-level data model.

### `fx.aladdin.club/v2/leaderboard`

Crawler-visible content on the official leaderboard shows:

- Product title: **f(x) Protocol Trading Leaderboard**.
- It is tied to a **Trading Challenge / Airdrop** flow.
- Main leaderboard dimensions are **Rank / Trader / PNL / ROI** and the UI exposes a **7D** window.
- The page is a JavaScript app and can show "No data found" to simple crawlers, so live data likely arrives through client-side API calls or wallet/network-aware requests.

Third-party API documentation from Smartclaw states its f(x) wallet data is sourced from the **f(x) Protocol leaderboard API**, tracking ~1.7k wallets and exposing PNL, ROI, volume, and net capital flow. That strongly suggests a private or discoverable leaderboard endpoint exists and can be used as a seed source, though it should not be our only source of truth.

### Smartclaw as a reference implementation

Smartclaw is directly relevant because it already does a version of the requested idea:

- It describes itself as a **cross-protocol smart wallet tracking API**.
- It currently integrates **f(x) Protocol** first.
- Public endpoints include:
  - `GET /api/fx/status`
  - `GET /api/fx/top-pnl?limit=...`
  - `GET /api/top-pnl?limit=...`
  - `GET /api/fx/fxusd-rate`
  - `GET /api/rates`
  - `GET /api/premium`
- Its schema for a trader includes `trader`, `roi`, `pnl`, `pnlClean`, `vol`, `net`, and sometimes `protocol`.
- Its methodology says wallet PNL, ROI, and volume come from f(x)'s leaderboard API, while rate data uses The Graph/protocol subgraphs.

We should treat Smartclaw as both:

1. a **bootstrapping source** for discovery/comparison while building; and
2. a **competitive benchmark** to exceed by adding per-wallet position timelines, risk labels, trade archetypes, and behavior analytics.

## Protocol mechanics that matter for trader tracking

f(x) Protocol v2 is not a simple perp orderbook. The OpenZeppelin v2 audit describes:

- **fxUSD**, an overcollateralized stablecoin implementation.
- **xPosition**, the leveraged trading platform.
- **PoolManager** and pool contracts that create/increase positions, redeem, rebalance, liquidate, and manage positions using price ticks.
- **AaveFundingPool**, **FxUSDBasePool**, **FxUSDRegeneracy**, **PegKeeper**, **SavingFxUSD**, reserve/stability mechanisms, and oracle integrations.
- Position logic uses a tick-based approach, grouping positions into price bands around ~0.15% bands according to the audit summary.

For a trader dashboard, this means we need to track both **NFT-like position ownership** and **position state transitions** rather than only token swaps.

## High-value data entities

### Wallet / trader

- `address`
- ENS / labels / known social aliases when available
- first seen / last active
- total positions opened
- total active positions
- realized PNL
- unrealized PNL estimate
- total volume / notional
- average and median ROI
- win rate
- max drawdown
- liquidation/rebalance count
- favorite collateral/market
- average hold time
- "antics" tags, e.g. `high-frequency scalper`, `martingale/averager`, `diamond hands`, `degen max leverage`, `panic closer`, `rebalance survivor`, `challenge farmer`

### Position

- `positionId` / token ID
- owning wallet over time
- pool/market
- collateral token
- long/short or exposure type, if inferable from pool/product
- open tx/block/time
- close tx/block/time
- collateral shares/raw collateral
- debt shares/raw debt
- entry price estimate
- current/exit price estimate
- realized PNL estimate
- unrealized PNL estimate
- fees/funding paid
- current tick and tick movements
- liquidation/rebalance flags

### Event / action

- tx hash, log index, block, timestamp
- wallet initiator and position owner
- action type: `open`, `increase`, `decrease`, `close`, `transfer`, `rebalance`, `liquidate`, `redeem`, `funding_snapshot`, `tick_movement`
- raw event payload
- normalized collateral/debt deltas
- price at action time
- USD value/notional

### Snapshot

- hourly/daily wallet aggregate
- hourly/daily position state
- leaderboard rank, PNL, ROI, volume, net flow
- protocol state: fxUSD supply, fxSAVE APY, TVL, funding/borrow rate, collateral prices

## Contract and ABI resources

Primary official resources:

- AladdinDAO docs: f(x) useful links, whitepaper, GitHub, audits.
- AladdinDAO docs: f(x) contract address tables.
- `AladdinDAO/fx-protocol-contracts` GitHub repository for v2 Solidity source and ABIs.
- `AladdinDAO/aladdin-v3-contracts` and `AladdinDAO/deployments` for historical/mainnet deployment references.
- Etherscan verified contracts when GitHub deployment JSON is incomplete or easier to consume.

Known relevant addresses from public docs/search:

| Component | Address / source | Notes |
| --- | --- | --- |
| FXN | `0x365AccFCa291e7D3914637ABf1F7635dB165Bb09` | Governance/token context. |
| fxUSD (legacy/beta docs table) | `0x085780639CC2cACd35E474e71f4d000e2405d8f6` | Docs and Etherscan identify this as f(x) USD / FxUSDRegeneracy proxy in older tables; verify against current v2 app before production. |
| FxUSDRegeneracy implementation/reference | `0x1a144095ad1cb488fe6378dbfc62368a7453d114` appears in indexed contract sources | Search result identifies this as FxUSDRegeneracy; verify proxy/current production address. |
| AaveFundingPool example | `0x7cacd4e098e2837643eeaaaefc040b87df29c332` | Etherscan search exposes `AaveFundingPool` ABI/events including position events. Verify market/pool mapping. |
| f(x) deployer | `0x8345e79473cdcA968788d8AB9183ffB6c057Ca3e` | Search result labels as f(x) protocol deployer. Useful for finding contract creations. |

Important: before writing production code, run a contract-discovery pass against the current app bundle, Etherscan labels, and official deployment JSON. The docs page has older v1 and beta entries mixed with newer resources, so addresses must be versioned.

## Events and reads to index first

From the publicly visible AaveFundingPool ABI/search snippet and audit descriptions, the first subgraph should index these events where available:

- ERC-721 `Transfer(from,to,tokenId)` for position ownership and open/close/transfer detection.
- `PositionSnapshot(position,tick,collShares,debtShares,price)` for point-in-time position state.
- `TickMovement(oldTick,newTick,collShares,debtShares,price)` for risk/momentum and liquidation-band analytics.
- `CollateralIndexSnapshot(index)` and `DebtIndexSnapshot(index)` for share-to-raw/state conversion.
- `SnapshotAaveBorrowIndex(borrowIndex,timestamp)` for funding/borrow cost context.
- `UpdateBorrowStatus`, `UpdateRedeemStatus`, `UpdateFundingRatio`, `UpdateOpenRatio`, `UpdateCloseFeeRatio`, `UpdateDebtRatioRange`, `UpdateRebalanceRatios`, `UpdateLiquidateRatios` for protocol regime changes.
- PoolManager-level `operate`, `redeem`, `rebalance`, and `liquidate` emitted events, once exact ABIs are confirmed.

Contract reads needed for enrichment:

- `ownerOf(tokenId)` / `balanceOf(owner)`
- `getPosition(tokenId)`
- `getPositionDebtRatio(tokenId)`
- `positionData(tokenId)` / `positionMetadata(tokenId)`
- `getDebtAndCollateralIndex()`
- `collateralToken()`
- `priceOracle()`
- pool registry / market registry methods from PoolManager/FxUSDRegeneracy once confirmed

## Indexing architecture options

### Option A: Goldsky Starter subgraph (recommended prototype)

Why:

- Goldsky Starter is free and includes subgraphs, Mirror/Turbo, and Edge RPC access.
- Current public pricing says Starter includes 3 always-on subgraphs, 100k free subgraph entities, and Edge RPC free requests.
- Good for quick iteration and hosted indexing without running infrastructure.

Risks:

- 100k entities may be tight if we index every snapshot/event forever. Use compact entities and store raw long-tail data in a database if needed.
- Rate limits on free subgraph queries mean the public dashboard should cache API responses.

Best use:

- One Ethereum mainnet subgraph for f(x) position events.
- One Mirror/Turbo pipeline later if we want raw event warehousing.
- Goldsky Edge RPC for ABI reads and gap filling.

### Option B: The Graph Studio

Why:

- The Graph subgraphs are portable, GraphQL-native, and standard for web3 dashboards.
- Official pricing currently advertises 100k free monthly queries and then usage-based billing.
- The Graph docs define a subgraph as `subgraph.yaml`, `schema.graphql`, and AssemblyScript mappings.

Risks:

- Query volume can exceed 100k/month quickly if the frontend queries directly.
- Free sync/storage fair-use limits and dormancy rules matter.

Best use:

- Build an open subgraph with stable schema.
- Put our own API/cache in front of it so dashboard users do not burn raw query quota.

### Option C: Self-hosted Ponder or Subsquid + SQLite/Postgres

Why:

- Cheapest at scale if hosted on a small VPS or free compute temporarily.
- TypeScript development is faster for custom calculations.
- Easier to store derived daily wallet profile aggregates.

Risks:

- Requires more ops, backfill management, and RPC access.
- Free hosting may sleep or kill long-running indexers.

Best use:

- Use after confirming exact contracts and event model.
- Run nightly/hourly job to update profiles and serve a Next.js dashboard.

## Cheap/free RPC plan

Use RPC only where the indexer cannot provide data:

1. **Goldsky Edge RPC**: use the free included quota if we choose Goldsky.
2. **Chainstack free Ethereum endpoint**: public pages advertise a free start and search snippets state 3M requests/month; verify at signup because plans change.
3. **Alchemy free tier**: use as backup for `eth_call`, logs over small ranges, and metadata reads.
4. **Public RPC fallbacks**: only for development, never production; they are rate-limited and unreliable.

Cost controls:

- Never run `eth_getLogs` over huge ranges from the browser.
- Cache ABI reads by block/day.
- Batch calls with Multicall where possible.
- Backfill once through indexer, then only tail new blocks.
- Store derived snapshots so profile pages load from our DB/API.

## Dashboard features to build

### Protocol overview cards

- active tracked traders
- active positions
- total notional / volume
- aggregate PNL and average ROI
- winner/loser split
- volume-weighted win rate
- fxUSD supply / fxSAVE APY / TVL context
- latest funding/borrow rate

### Trader leaderboard

Sort/filter by:

- PNL
- ROI
- volume
- net capital flow
- win rate
- max drawdown
- realized vs unrealized PNL
- recent activity
- open risk
- antics tags

### Trader profile page

- wallet header: address, ENS, labels, first/last seen
- cumulative PNL/ROI chart
- position timeline
- current open positions
- closed trades table
- behavioral tags and explanations
- risk panel: liquidation/rebalance proximity, leverage/debt ratio, concentration
- copy-trade caution card: sample size, stale data, protocol risk

### Position detail page

- lifecycle chart from open to close/current
- collateral/debt changes
- tick movement history
- funding/fee timeline
- related transactions
- owner transfers if position NFT moved

### "Trading antics" analytics

Derived labels should be deterministic and explainable:

| Label | Possible rule |
| --- | --- |
| Averager | 3+ increases into a losing position before close. |
| Scalper | median hold time under 6h and high position count. |
| Swing trader | median hold time over 2d with moderate count. |
| Max leverage | repeated positions near minimum safe collateral/debt ratio. |
| Rebalance survivor | position experienced tick movement/rebalance but later closed profitably. |
| Panic closer | closes soon after large adverse price/tick move. |
| Whale | top 5% notional or collateral. |
| Challenge farmer | many small qualifying positions around leaderboard/challenge windows. |

## Suggested data pipeline

```mermaid
flowchart TD
  A[Official f(x) leaderboard/API] --> B[Wallet seed job]
  C[Goldsky/The Graph subgraph] --> D[Indexer GraphQL API]
  E[RPC providers] --> F[ABI read/gap-fill worker]
  B --> G[Postgres/Supabase/Neon]
  D --> G
  F --> G
  G --> H[Backend API/cache]
  H --> I[Trader dashboard]
```

## Minimal implementation phases

### Phase 0: Contract discovery

- Pull official deployment JSON from AladdinDAO GitHub.
- Inspect current app bundle/network calls for `fx.aladdin.club/v2/leaderboard` and `v2/trade`.
- Confirm current PoolManager, FxUSDRegeneracy, AaveFundingPool, base pools, and position NFT contracts.
- Save ABIs and start blocks.

Deliverable: `contracts.json` with verified addresses, start blocks, ABI source, and confidence level.

### Phase 1: Wallet seed and baseline leaderboard

- Ingest official leaderboard data if endpoint is available and terms permit.
- Ingest Smartclaw public endpoints as a comparison source only.
- Store daily wallet snapshots with PNL, ROI, volume, net.
- Build a basic leaderboard UI.

Deliverable: profiles with leaderboard metrics but no deep position timeline yet.

### Phase 2: Position event indexer

- Deploy Goldsky/The Graph subgraph for confirmed position/pool events.
- Index position ownership, snapshots, tick movement, and pool-level events.
- Backfill to contract start blocks.
- Create derived position state tables.

Deliverable: per-wallet list of open/closed positions with transaction timeline.

### Phase 3: Analytics and antics

- Compute realized/unrealized PNL estimates.
- Add win rate, hold time, drawdown, rebalance/liquidation exposure.
- Add deterministic behavior tags.
- Add profile pages and charts.

Deliverable: a differentiated trader-profile dashboard.

### Phase 4: Cost hardening

- Put a cached API between frontend and subgraph.
- Precompute daily/hourly aggregates.
- Add provider failover.
- Add rate-limit monitoring and staleness banners.

Deliverable: public dashboard that stays within free/cheap quotas.

## Key risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Official leaderboard endpoint is private or changes | Treat it as seed/comparison only; rely on on-chain indexer for core profile history. |
| PNL methodology differs from official leaderboard | Show methodology and confidence levels; compare against official/Smartclaw snapshots. |
| Contract addresses are mixed across v1/v2/beta docs | Version every address and verify against current app/etherscan before indexing. |
| Free subgraph/entity quotas exceeded | Store raw history compactly; aggregate old events; cache frontend; move to self-hosted Ponder if needed. |
| RPC costs explode during backfill | Let hosted indexer backfill logs; RPC only for targeted reads. |
| Trader labels become defamatory or misleading | Use neutral, explainable tags and avoid personal claims beyond on-chain behavior. |

## Resource checklist

### Must collect

- Current f(x) v2 deployment JSON and ABIs.
- Current `fx.aladdin.club` API/network endpoints for leaderboard and trade pages.
- Etherscan verified ABIs for PoolManager, AaveFundingPool/base pools, FxUSDRegeneracy, PegKeeper, SavingFxUSD.
- Contract start blocks.
- Oracle/price sources for ETH, BTC, stETH, WBTC, fxUSD/USDC.
- Leaderboard challenge windows and eligibility rules, if used for challenge-farmer labels.

### Accounts / services

- Goldsky account (Starter/free) or The Graph Studio account.
- One or more free RPC accounts: Goldsky Edge, Chainstack, Alchemy.
- Supabase or Neon free Postgres account, or local SQLite for prototype.
- Vercel/Cloudflare Pages for frontend hosting.
- GitHub Actions cron or a cheap worker for snapshots.

### Code artifacts to create

- `contracts/fx-v2.json`: verified addresses, start blocks, ABI source.
- `subgraph/`: manifest, schema, mappings, ABI files.
- `workers/snapshot-leaderboard.ts`: leaderboard snapshot ingest.
- `workers/enrich-positions.ts`: RPC reads and derived metrics.
- `api/traders`, `api/traders/:address`, `api/positions/:id`.
- `docs/methodology.md`: PNL/ROI and tag methodology.

## External references

- f(x) Protocol stats dashboard: <https://fxprotocolstats.com>
- Official f(x) leaderboard: <https://fx.aladdin.club/v2/leaderboard>
- Official f(x) useful links/docs: <https://docs.aladdin.club/f-x-protocol/useful-links>
- Official f(x) contracts/docs: <https://docs.aladdin.club/f-x-protocol/contracts>
- AladdinDAO GitHub organization: <https://github.com/AladdinDAO>
- f(x) v2 OpenZeppelin audit: <https://www.openzeppelin.com/news/fx-v2-audit>
- Smartclaw docs/API reference: <https://alidashboard.up.railway.app/docs>
- Smartclaw public site: <https://smartclaw.xyz/>
- Goldsky pricing/docs: <https://docs.goldsky.com/pricing>
- The Graph subgraph docs: <https://thegraph.com/docs/en/subgraphs/developing/subgraphs/>
- The Graph Studio pricing: <https://thegraph.com/studio-pricing/>
- Chainstack Ethereum RPC/free endpoint info: <https://chainstack.com/build-better-with-ethereum>
- Alchemy pricing/free tier: <https://www.alchemy.com/pricing>
