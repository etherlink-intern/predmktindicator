# f(x) Protocol Trader-Profile Dashboard Research

_Research date: 2026-06-03_

## Goal

Build a low-cost, trader-centric dashboard for f(x) Protocol that tracks wallets by positions, realized/unrealized PNL, ROI, volume, capital flow, liquidation/rebalance exposure, and recurring behavior patterns. The product should be similar in spirit to the community `fxprotocolstats.com` dashboard, but focused on trader profiles and "trading antics" rather than only protocol-level stats.

## Executive recommendation

Start with a **hybrid free stack**:

1. **Use f(x)'s existing leaderboard/API surface as seed data** to discover active wallets and baseline PNL/ROI/volume.
2. **Index on-chain position contracts yourself** with a free/cheap hosted indexer first, preferably Goldsky if the free-tier limits work, but keep the ingestion design provider-agnostic so we can use The Graph, Envio, Subsquid, Ponder, or direct RPC log chunks as needed.
3. **Use ClickHouse as the analytics storage layer** for immutable raw events, position snapshots, leaderboard snapshots, and pre-aggregated wallet stats. ClickHouse fits the product better than a pure OLTP database because the tracker is mostly append-heavy time-series analytics over wallets, positions, blocks, and rolling windows.
4. **Use free RPC quotas only for gap filling and ABI reads**, not for the main historical event stream. Goldsky's free Edge RPC or Chainstack's free Ethereum endpoint are good starting points; add Alchemy as a secondary key.

This avoids paying for archive-node-style backfills while still giving us a durable path to a richer trader product. Use Postgres/Supabase only if we later need app metadata, auth, notes, watchlists, or moderation workflows; ClickHouse should be the source of truth for market/trader analytics.

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

> Current confidence: the **position manager and position NFT equivalents are the pool contracts themselves**. f(x) v2 positions appear to be ERC-721 positions minted/owned inside each long/short pool, while `PoolManager(Long)` and `ShortPoolManager` orchestrate operations. These should be treated as the first contracts to index for user-position tracking.

| Component | Address / source | Notes for the tracker |
| --- | --- | --- |
| `PoolManager(Long)` | `0x250893CA4Ba5d05626C785e8da758026928FCD24` | Core long-side manager. Index its operation/rebalance/liquidation events once ABI is confirmed. |
| `ShortPoolManager` | `0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D` | Core short-side manager. Index alongside short pools. |
| wstETH Long Pool / AaveFundingPool ETH | `0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8` | Primary ERC-721 position pool for long wstETH/ETH exposure. A third-party explorer identifies token IDs here as `f(x) wstETH position`, standard ERC-721. |
| WBTC Long Pool | `0xAB709e26Fa6B0A30c119D8c55B887DeD24952473` | Primary ERC-721 position pool for long WBTC exposure. |
| wstETH Short Pool | `0x25707b9e6690B52C60aE6744d711cf9C1dFC1876` | Short-side structured position pool. |
| WBTC Short Pool | `0xA0cC8162c523998856D59065fAa254F87D20A5b0` | Short-side structured position pool. |
| fxETH / wstETH CreditNote | `0x7c5350BaC0eB97F86A366Ee4F9619a560480F05A` | CreditNote contract referenced by f(x) keeper docs; likely needed for short/rebalance accounting. |
| fxBTC / WBTC CreditNote | `0xB25a554033C59e33e48c5dc05A7192Fb1bbDdfc6` | CreditNote contract referenced by f(x) keeper docs; likely needed for short/rebalance accounting. |
| FxUSDBasePool / fxSP | `0x65C9A641afCEB9C0E6034e558A319488FA0FA3be` | Base stable pool used for fxUSD mint/deposit and fxSAVE two-step redemption. Useful context but not the primary xPOSITION NFT source. |
| SavingFxUSD / fxSAVE | `0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39` | ERC-4626-like saving product; track for trader capital flows if profiles include stable yield behavior. |
| fxUSD | `0x085780639CC2cACd35E474e71f4d000e2405d8f6` | Stable token used in minting/redemption/conversion flows. |
| RouterManagementFacet / router diamond | `0x33636D49FbefBE798e15e7F356E8DBef543CC708` | f(x) router/diamond entry point visible in fxSAVE integration docs and Etherscan transaction labels; useful for decoding routed user actions. |
| SavingFxUSDFacet | `0x56afB443dE36340c32f1a461605171992480059D` | Facet used for `instantRedeemFromFxSave`. |
| MultiPathConverter | `0x12AF4529129303D7FbD2563E242C4a2890525912` | Converter used in fxSAVE examples for fxUSD/USDC routing. |
| FXN | `0x365AccFCa291e7D3914637ABf1F7635dB165Bb09` | Governance/token context. |
| f(x) deployer | `0x8345e79473cdcA968788d8AB9183ffB6c057Ca3e` | Search result labels as f(x) protocol deployer. Useful for finding contract creations. |

Source notes: the f(x) keeper docs list the long/short managers, long/short pools, and CreditNote addresses; ETHGas' f(x) rebate page corroborates the long pools, short pools, base pool, and fxSAVE addresses; fxSAVE integration docs list router/facet/converter addresses.

Important: before writing production code, run a final contract-discovery pass against the current app bundle, Etherscan labels, and official deployment JSON. The older Aladdin docs page has v1 and beta entries mixed with newer resources, so addresses must remain versioned and source-tagged.

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

### Option A: Goldsky Starter subgraph + ClickHouse export (recommended prototype)

Why:

- Goldsky Starter currently documents access to Subgraphs, Mirror/Turbo pipelines, and Edge RPC. The free-tier pricing page currently lists 3 free always-on subgraph workers, 100k free stored subgraph entities, 1 free Mirror/Turbo worker, and 1M free Mirror/Turbo event writes.
- Treat these as **current assumptions to verify in the actual Goldsky account before build**; if Turbo/Mirror is restricted, exhausted, or awkward for direct ClickHouse writes, the same segmented backfill plan still works with other providers or our own orchestrated workers.
- Good for quick iteration and hosted indexing without running infrastructure.
- ClickHouse becomes our durable store, so Goldsky can be treated as an indexing/export layer rather than the long-term historical database.

Risks:

- The 100k entity limit is an **entities stored** limit across active subgraphs, not just monthly query volume. If we index every position event/snapshot into subgraph entities forever, we will hit it.
- Goldsky's docs say deleting a subgraph stops tracking stored entities, but historical deletes inside the subgraph do not reduce the count. In other words, do not rely on entity pruning as a quota strategy.
- Standard EVM subgraphs support `startBlock`, but not a clean `endBlock` segment boundary. A temporary historical subgraph can start at a block, but it will keep indexing forward unless we stop/delete it after export.
- Rate limits on free subgraph queries mean the public dashboard should query our API/ClickHouse cache, not Goldsky directly.

Best use:

- Keep one **live tail subgraph** with a compact schema for recent/open mutable state: active positions, current owner, latest position snapshot, and latest protocol indexes.
- Use Goldsky **Turbo/Mirror Job Mode** for one-time historical block-range exports into ClickHouse where possible. Goldsky's Turbo docs state that EVM one-time ranges should use Job Mode with `start_at: earliest` plus a fast-scan filter and an upper `block_number` bound, because EVM dataset sources do not support `end_block`.
- If we must use subgraphs for historical backfill, run temporary block-era subgraphs one at a time, export their GraphQL results to ClickHouse, verify row counts/checkpoints, then delete the temporary subgraph so stored entities no longer count. This is quota-conscious, but more operationally brittle than Turbo/Mirror Job Mode.
- Goldsky Edge RPC remains useful for ABI reads and gap filling.

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

### Option C: Self-hosted Ponder / Subsquid / Envio + ClickHouse

Why:

- Cheapest at scale if hosted on a small VPS or free compute temporarily.
- TypeScript development is faster for custom calculations.
- Easier to push normalized rows directly into ClickHouse.
- Good fallback if Goldsky Turbo/Mirror is unavailable on our account or if hosted subgraph limits get annoying.

Risks:

- Requires more ops, backfill management, and RPC access.
- Free hosting may sleep or kill long-running indexers.

Best use:

- Use after confirming exact contracts and event model.
- Run as workers owned by the orchestrator: backfill chunks, live tail, enrichment, and rollups.
- Keep output schema identical to hosted-provider exports so we can swap providers without changing the dashboard API.

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

## ClickHouse storage plan

Yes: ClickHouse is a strong default database for this tracker. The workload is mostly immutable, append-heavy, and analytical: wallet activity, position lifecycle events, block timestamps, price snapshots, leaderboard snapshots, and rolling stats. Those are better suited to ClickHouse than a transactional Postgres-first design.

Recommended ClickHouse model:

- **Raw append tables** using `MergeTree`, partitioned by month or week and ordered by `(chain_id, contract_address, block_number, log_index)` for events and `(wallet, window, snapshot_ts)` for profile snapshots.
- **Idempotent ingest tables** using `ReplacingMergeTree(version)` or upstream de-duplication keyed by `(chain_id, tx_hash, log_index, event_name)` so retries from Goldsky/API jobs do not duplicate events.
- **Current-state tables** for active positions and current wallet aggregates, either built with `ReplacingMergeTree` or refreshed by scheduled jobs from raw events.
- **Rollup tables/materialized views** for leaderboard windows: all-time, 30D, 7D, 1D, hourly wallet activity, daily PNL, and market-level aggregates.
- **Raw JSON payload columns** for undecoded event data so we can re-decode later without re-indexing.
- **Checkpoint table** for every ingestion source: source name, contract, from_block, to_block, row count, checksum/hash if available, exported_at, and verification status.

Suggested tables:

| Table | Purpose | Notes |
| --- | --- | --- |
| `raw_fx_events` | Immutable decoded contract logs | Key by chain/tx/log; preserve raw payload and decoded fields. |
| `raw_position_snapshots` | Position-level collateral/debt/tick snapshots | Useful for lifecycle charts and risk calculations. |
| `raw_leaderboard_snapshots` | Official/Smartclaw leaderboard snapshots | Keep source and window so we can compare methodology. |
| `position_current` | Latest position state | Upsert-style table for open-position cards. |
| `wallet_window_stats` | All-time/30D/7D/1D wallet stats | Powers leaderboard directly. |
| `wallet_daily_stats` | Daily rollups per wallet | Powers charts and fast historical profile queries. |
| `ingest_checkpoints` | Backfill/live-tail bookkeeping | Prevents duplicated segment exports and documents data freshness. |

Operational notes:

- ClickHouse is excellent for the public analytics API, but we may still want a tiny Postgres/Supabase database for app concerns like user accounts, saved watchlists, internal annotations, feature flags, and moderation.
- Do not expose ClickHouse directly to the browser. Put a small API/cache layer in front of it for rate limiting, query shaping, and stable response contracts.
- Prefer append-and-recompute for derived stats. If the PNL methodology changes, keep raw events immutable and rebuild `wallet_window_stats`/`wallet_daily_stats`.

## Goldsky segmentation / quota strategy

The practical answer is: **yes, we can divide-and-conquer the historical buildout, but Goldsky should be one execution backend, not the whole plan.** As of the currently published Goldsky pricing docs, Starter includes Mirror/Turbo access with a free worker/write allowance, but we should verify that in the actual account before relying on it. Use Goldsky, The Graph, Envio, Subsquid, Ponder, or direct `eth_getLogs` chunk workers as interchangeable sources that all write durable rows into ClickHouse.

Recommended strategy:

1. **Historical backfill via Goldsky Turbo/Mirror Job Mode, if available**
   - Define block-range jobs per contract/pool and write decoded rows into ClickHouse.
   - For EVM ranges, use the Goldsky-recommended pattern: Job Mode with `start_at: earliest`, a fast-scan filter, and an upper `block_number` bound in the filter.
   - Run segments like `deployment_block -> 2024-12-31`, monthly/quarterly ranges, or fixed block chunks depending on row volume.
   - After each segment, write an `ingest_checkpoints` row with row count and status.

2. **Provider-agnostic divide-and-conquer backfill**
   - Split history by `(contract, event family, block_start, block_end)` and assign chunks to whichever backend is cheapest and working: Goldsky Job Mode, The Graph/Subgraph Studio exports, Envio/HyperIndex, Subsquid, Ponder, or raw RPC log fetchers.
   - Store every output in the same ClickHouse raw tables so the downstream rollups do not care which backend produced the rows.
   - Re-run failed chunks independently; never restart the whole backfill for one failed range.
   - Use smaller chunks around high-volume periods and larger chunks around low-volume periods.

3. **Live tail via compact subgraph or pipeline**
   - Keep only current/open state and recent events in Goldsky if we need GraphQL convenience.
   - Export new events to ClickHouse continuously or on a short cron.
   - Query ClickHouse for product pages; do not use Goldsky as the public historical database.

4. **Temporary subgraph fallback**
   - If a subgraph mapping is easier than a Turbo transform for complex contract logic, deploy a temporary subgraph for a historical segment, export all entities to ClickHouse, verify, and delete the subgraph.
   - This can keep active stored entities under the Starter threshold because deleted subgraphs no longer count as stored entities, but it is brittle because EVM subgraphs have a `startBlock` and no native `endBlock`. We need automation to stop/delete after the target block is exported.

5. **ClickHouse as immutable archive**
   - Once a block segment is exported and finalized, treat it as immutable. Past on-chain logs cannot change after sufficient confirmations/finality, so ClickHouse becomes the archive of record.
   - If we discover a decoding bug, re-run the affected segment into a replacement table/version and swap derived views after validation.

Guardrails:

- This should be framed as **cost control within free-tier/provider rules**, not as evasion. Respect provider limits and upgrade or rotate to another backend if public traffic or data volume exceeds what is reasonable.
- Keep segment sizes small enough to validate and replay. Monthly segments are easier to reason about than one huge genesis-to-present run.
- Track checksums/counts per segment so a deleted temporary indexer can be recreated if needed.
- Keep the live Goldsky schema compact: avoid storing per-wallet arrays, long historical snapshots, or derived leaderboard rows as subgraph entities.

## Backfill orchestrator

We need an orchestrator so the historical database can be built by many small jobs instead of one fragile monolithic backfill. The orchestrator should own planning, leasing, execution, verification, retries, and rollup triggers.

### Orchestrator responsibilities

- **Plan chunks** from `contracts/fx-v2.json`: one work item per contract/event/block range, with adaptive chunk sizes based on expected event density.
- **Lease work** so multiple workers can run in parallel without duplicate effort.
- **Select backend** per chunk: Goldsky Turbo/Mirror when available, temporary subgraph export for complex mappings, Envio/Subsquid/Ponder when cheaper or faster, or raw RPC logs for small targeted ranges.
- **Write ClickHouse checkpoints** before/after each chunk with status, row counts, block bounds, backend, version, error, and timestamps.
- **Validate output** by comparing raw log counts, expected event signatures, monotonic block ranges, and duplicate keys.
- **Retry safely** with exponential backoff and a maximum-attempts/dead-letter queue.
- **Promote data** from raw staging tables into canonical raw tables only after validation.
- **Trigger rollups** after a segment is finalized: update `position_current`, `wallet_daily_stats`, and `wallet_window_stats`.
- **Expose progress** for an admin dashboard: percent complete by contract, lag from chain head, failed chunks, rows ingested, provider cost/usage, and next scheduled work.

### Suggested orchestrator tables

| Table | Purpose | Key fields |
| --- | --- | --- |
| `ingest_jobs` | One logical campaign, e.g. `wsteth-long-pool-backfill-v1` | job_id, contract, event_family, planned_from_block, planned_to_block, status |
| `ingest_chunks` | Individual block-range tasks | chunk_id, job_id, from_block, to_block, backend, priority, status, attempts, lease_owner, lease_until |
| `ingest_chunk_results` | Verification/audit output | chunk_id, rows_written, duplicate_rows, min_block, max_block, checksum, duration_ms, cost_estimate |
| `ingest_provider_usage` | Provider-level budget tracking | backend, day, worker_hours, event_writes, rpc_calls, dollars_estimated |
| `rollup_runs` | Derived table refresh tracking | rollup_name, from_block, to_block, status, rows_affected, completed_at |

### Worker types

- `planner`: creates chunk plans from contract start blocks to target finality block.
- `executor-goldsky`: launches/polls Goldsky Job Mode or temporary subgraph exports when available.
- `executor-subgraph`: pages through hosted subgraph GraphQL results for a bounded segment.
- `executor-rpc`: uses provider RPC logs for small or missing ranges.
- `executor-ponder/envio/subsquid`: runs self-hosted/provider-specific backfill jobs with the same output schema.
- `verifier`: checks staging rows and promotes valid chunks.
- `rollup`: refreshes derived ClickHouse tables and leaderboard windows.

### Chunk sizing

Start conservative, then adapt:

- Prototype: 25k-100k blocks per chunk per contract/event family.
- High-volume periods: shrink to 5k-25k blocks.
- Low-volume periods: expand to 250k+ blocks.
- Always align chunk boundaries to finalized blocks and never let workers write unfinalized history into immutable tables.

## Design system provenance

Use **shadcn/ui** as the primary UI provenance for the tracker design system. The site positions itself as "The Foundation for your Design System" and provides open-source, customizable, extensible components and blocks that can be adapted rather than treated as a locked visual kit.

Recommended design approach:

- Use shadcn/ui primitives for tables, tabs, cards, sheets, dialogs, dropdown menus, command/search, badges, tooltips, skeletons, charts, and data-display states.
- Keep the visual language terminal/markets-native: dense tables, compact cards, monospace addresses, green/red performance deltas, and strong stale-data indicators.
- Build dashboard-specific components on top of shadcn/ui rather than copying external dashboards directly: `PerformanceTabs`, `TraderRankTable`, `PositionCard`, `PnLChart`, `ActivityFeed`, `RiskBadge`, `AnticsTag`, and `AddressIdentity`.
- Treat this as a provenance/inspiration source, not a finished brand: customize colors, spacing density, typography, empty states, and chart styling for f(x) trader analytics.

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

### Page 1: Trader leaderboard

The leaderboard should be the primary discovery page: fast, dense, sortable, and explicitly time-windowed. It should answer, "Who is performing, over what window, with how much risk and how much recent activity?"

#### Time windows

Provide one top-level segmented control with these windows:

- **All time**: lifetime tracked performance from first indexed position/activity.
- **30D**: rolling 30-day performance.
- **7D**: rolling 7-day performance; this mirrors the official leaderboard's visible emphasis but should not be the only view.
- **1D**: rolling 24-hour performance for current activity and momentum.

Each row should recalculate the same core metrics for the selected window, while still showing lifetime context in compact secondary cells/tooltips when useful.

#### Primary table columns

- Rank and rank delta versus previous snapshot/window.
- Trader identity: wallet, ENS/name if available, known labels, copy address, explorer link.
- PNL: absolute USD PNL for selected window.
- ROI: percent return for selected window.
- Volume / notional traded.
- Net capital flow: deposits minus withdrawals / collateral in minus out.
- Realized PNL vs unrealized PNL split.
- Active positions count and total open notional.
- Win rate and closed-trade count for the selected window.
- Average hold time.
- Max drawdown or worst open-position drawdown.
- Liquidation/rebalance exposure count.
- Antics tags: scalper, whale, averager, max leverage, rebalance survivor, etc.
- Last activity timestamp.

#### Filters and controls

- Search by wallet, ENS, position ID, or label.
- Filter by market: wstETH/ETH long, WBTC long, wstETH short, WBTC short, fxSAVE/fxUSD flows.
- Filter by status: currently active, closed-only, liquidated/rebalanced, high risk, whale, new trader.
- Filter by behavior tag.
- Toggle "include tiny wallets" / minimum volume threshold so a wallet with one lucky tiny trade does not dominate ROI.
- Toggle "verified methodology only" to hide rows where PNL confidence is low.

#### Leaderboard summary cards

- Number of tracked traders in the selected window.
- Total volume/notional and open notional.
- Aggregate realized/unrealized PNL.
- Median ROI and average ROI.
- Winners vs losers.
- Most active market.
- Biggest open risk bucket.
- Data freshness: last indexed block, last leaderboard snapshot, last RPC enrichment run.

#### Row drill-down preview

Clicking or hovering a row should show a compact preview before opening the trader page:

- Mini PNL sparkline.
- Current open positions with market and estimated risk.
- Last 3 actions.
- Top behavior tags and why they were assigned.

### Page 2: Trader profile / user tracker page

The trader page should answer, "What is this wallet doing right now, what positions does it hold, how has it behaved historically, and how reliable are its stats?"

#### Header and identity

- Wallet address with copy, explorer, and share links.
- ENS/name/avatar when available.
- Labels: whale, high frequency, challenge farmer, high risk, new wallet, smart wallet candidate.
- First seen / last seen.
- Current leaderboard rank across All time, 30D, 7D, and 1D.
- Data confidence badge: high/medium/low depending on indexed contracts, snapshots, price coverage, and whether official leaderboard data agrees.

#### Current activity panel

- Last action and last transaction.
- Active session summary: actions in the last 1h/24h/7d.
- Current market focus.
- Recent deposits/withdrawals/net flow.
- Recent increases/decreases/closes.
- Alerts: position near rebalance/liquidation band, sudden size increase, repeated averaging, stale oracle/indexer data.

#### Open positions

For every open position, show:

- Position ID / NFT ID and owning wallet.
- Pool/market and direction/type.
- Collateral, debt, leverage/debt-ratio, entry estimate, current price estimate.
- Realized-to-date and unrealized PNL estimate.
- Position age and last modified timestamp.
- Distance to rebalance/liquidation thresholds where derivable.
- Tick/range data and recent tick movements.
- Fees/funding/borrow-cost estimate.
- Action history for that position.

#### Limit orders / pending intent, if possible

Native on-chain position contracts may not expose a conventional order book. Add this section with an explicit confidence label:

- **Confirmed on-chain orders**: only show if the current f(x) router/manager emits or stores pending order/limit-order state.
- **Routed/automation intents**: if f(x) uses off-chain signatures, Gelato/keeper automation, private APIs, or frontend-managed order intents, show them only if an accessible API or indexed event source exists and terms permit.
- **Not available**: if pending intent is not public, show a transparent empty state explaining that unsubmitted/off-chain limit orders cannot be inferred from public chain data.
- For any available order/intent, show side, market, trigger/limit price, size, expiry, created time, source, and confidence.

#### Past activity

- Chronological event feed across opens, increases, decreases, closes, transfers, liquidations, rebalances, fxUSD/fxSAVE flows, and notable approvals.
- Filters by action type, position, market, size, and time.
- Group events into trade lifecycles so users can review full position stories, not just transactions.
- Show decoded transaction links and raw-event fallback when decoding confidence is low.

#### Trader statistics

Core stats:

- All-time, 30D, 7D, and 1D PNL/ROI.
- Realized PNL, unrealized PNL, and total PNL.
- Total volume/notional.
- Net capital flow.
- Open notional and active collateral.
- Closed trades, wins, losses, win rate.
- Profit factor and average win/average loss.
- Median hold time and longest/shortest hold.
- Max drawdown and worst single trade.
- Best trade and biggest open position.
- Liquidation/rebalance count and survival rate after rebalance.
- Fee/funding/borrow-cost estimate.

Behavior stats:

- Markets traded most.
- Typical position sizing and size variance.
- Adds-to-winners vs adds-to-losers.
- Time-of-day / day-of-week activity heatmap.
- Average reaction time after large price/tick moves.
- Antics tags with explanations and the exact evidence used.

#### Charts

- Cumulative PNL line.
- ROI by window.
- Equity/capital-flow curve.
- Open notional over time.
- Position lifecycle Gantt/timeline.
- Drawdown chart.
- Market allocation donut/bar.
- Activity heatmap.

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
  J[Goldsky Turbo/Mirror segment jobs] --> G[ClickHouse analytics DB]
  B --> G
  D --> G
  F --> G
  G --> K[Rollup/materialized stats]
  K --> H[Backend API/cache]
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
- Store daily wallet snapshots with PNL, ROI, volume, and net flow in ClickHouse.
- Build a basic leaderboard UI.

Deliverable: profiles with leaderboard metrics but no deep position timeline yet.

### Phase 2: Position event indexer

- Deploy a compact Goldsky/The Graph live-tail subgraph for confirmed position/pool events.
- Use the orchestrator to divide-and-conquer historical chunks across Goldsky Turbo/Mirror if available, other hosted indexers, self-hosted Ponder/Envio/Subsquid workers, or raw RPC log workers.
- Index position ownership, snapshots, tick movement, and pool-level events.
- Create ClickHouse raw, current-state, checkpoint, and derived rollup tables.

Deliverable: per-wallet list of open/closed positions with transaction timeline.

### Phase 3: Analytics and antics

- Compute realized/unrealized PNL estimates.
- Add win rate, hold time, drawdown, rebalance/liquidation exposure.
- Add deterministic behavior tags.
- Add profile pages and charts.

Deliverable: a differentiated trader-profile dashboard.

### Phase 4: Cost hardening

- Put a cached API between frontend and ClickHouse/Goldsky.
- Precompute daily/hourly aggregates in ClickHouse.
- Add provider failover.
- Add rate-limit monitoring and staleness banners.

Deliverable: public dashboard that stays within free/cheap quotas.

## Key risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Official leaderboard endpoint is private or changes | Treat it as seed/comparison only; rely on on-chain indexer for core profile history. |
| PNL methodology differs from official leaderboard | Show methodology and confidence levels; compare against official/Smartclaw snapshots. |
| Contract addresses are mixed across v1/v2/beta docs | Version every address and verify against current app/etherscan before indexing. |
| Free subgraph/entity quotas exceeded or Goldsky Turbo unavailable | Use ClickHouse as durable history, run the orchestrator across alternate hosted providers/self-hosted indexers/RPC chunks, keep any live subgraph compact, and delete temporary historical subgraphs after verified export. |
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

- Goldsky account (Starter/free, verify Turbo/Mirror availability), The Graph Studio account, and at least one fallback indexer path (Envio/Subsquid/Ponder or direct RPC workers).
- One or more free RPC accounts: Goldsky Edge, Chainstack, Alchemy.
- ClickHouse: local OSS Docker for prototype, then ClickHouse Cloud or a cheap self-hosted ClickHouse node for production analytics.
- Optional Supabase/Neon/Postgres only for app metadata, watchlists, auth, and admin workflows.
- Vercel/Cloudflare Pages for frontend hosting.
- GitHub Actions cron or a cheap worker for snapshots.

### Code artifacts to create

- `contracts/fx-v2.json`: verified addresses, start blocks, ABI source.
- `subgraph/`: manifest, schema, mappings, ABI files.
- `db/clickhouse/schema.sql`: raw event, snapshot, current-state, checkpoint, and rollup tables.
- `workers/snapshot-leaderboard.ts`: leaderboard snapshot ingest into ClickHouse.
- `workers/orchestrator/plan-backfill.ts`: create contract/event/block-range chunks.
- `workers/orchestrator/run-chunk.ts`: execute a chunk through Goldsky, another hosted indexer, self-hosted indexer, or RPC fallback.
- `workers/orchestrator/verify-chunk.ts`: validate rows, checkpoints, and promote staging data.
- `workers/export-goldsky-segment.ts`: segmented Goldsky Turbo/Mirror or temporary-subgraph export into ClickHouse when available.
- `workers/enrich-positions.ts`: RPC reads and derived metrics.
- `api/traders`, `api/traders/:address`, `api/positions/:id`.
- `docs/methodology.md`: PNL/ROI and tag methodology.

## External references

- f(x) Protocol stats dashboard: <https://fxprotocolstats.com>
- Official f(x) leaderboard: <https://fx.aladdin.club/v2/leaderboard>
- Official f(x) useful links/docs: <https://docs.aladdin.club/f-x-protocol/useful-links>
- Official f(x) contracts/docs: <https://docs.aladdin.club/f-x-protocol/contracts>
- f(x) keeper contract addresses: <https://fxprotocol.gitbook.io/fx-docs/developers/processing-the-rebalances-and-liquidations>
- f(x) fxSAVE integration addresses: <https://fxprotocol.gitbook.io/fx-docs/developers/integrating-fxsave>
- ETHGas f(x) eligible contract list: <https://docs.ethgas.com/overview/open-gas/f-x-protocol>
- AladdinDAO GitHub organization: <https://github.com/AladdinDAO>
- f(x) v2 OpenZeppelin audit: <https://www.openzeppelin.com/news/fx-v2-audit>
- Smartclaw docs/API reference: <https://alidashboard.up.railway.app/docs>
- Smartclaw public site: <https://smartclaw.xyz/>
- shadcn/ui design system and component provenance: <https://ui.shadcn.com/?utm_source=chatgpt.com>
- ClickHouse docs: <https://clickhouse.com/docs>
- Goldsky pricing/docs: <https://docs.goldsky.com/pricing>
- Goldsky Turbo supported sources and Job Mode notes: <https://docs.goldsky.com/turbo-pipelines/sources/overview>
- The Graph subgraph docs: <https://thegraph.com/docs/en/subgraphs/developing/subgraphs/>
- The Graph Studio pricing: <https://thegraph.com/studio-pricing/>
- Chainstack Ethereum RPC/free endpoint info: <https://chainstack.com/build-better-with-ethereum>
- Alchemy pricing/free tier: <https://www.alchemy.com/pricing>
