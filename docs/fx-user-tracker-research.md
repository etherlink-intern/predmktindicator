# f(x) Protocol Trader-Profile Dashboard Implementation Plan

_Refined spec date: 2026-06-03_

## Core decision

Build **fx-trader-profiles** as a hosted-indexing + Postgres-backed dashboard, not as a locally hosted Ethereum indexing project. The subgraph should stay hosted on Goldsky for MVP; the app, Postgres database, cron workers, and API can be either managed-hosted or self-hosted on a VPS.

Local development should only run:

- `pnpm dev`
- `pnpm test`
- `pnpm db:push`
- `pnpm scripts:discover-contracts`

Local development must **not** run:

- `graph-node`
- Erigon/Geth archive nodes
- local Ethereum historical backfill indexers
- self-hosted Ponder over full mainnet history
- large `eth_getLogs` scans

Use **Goldsky Starter** as the primary MVP indexer because it is managed and its current public pricing lists Starter access for subgraphs, pipelines, and Edge RPC, including 3 always-on free subgraphs, 100,000 free stored subgraph entities, a 20 requests / 10s subgraph query rate limit, 1 always-on Starter pipeline, 1M free pipeline events, and 1M free Edge RPC requests/month.

Use **The Graph Studio** as a portability target, not the default MVP host. The Graph remains useful because its standard subgraph structure is portable: `subgraph.yaml`, `schema.graphql`, and AssemblyScript mappings. Its Studio pricing currently advertises 100,000 free monthly queries before paid usage.

## 1. Product scope

### 1.1 Product name

Working name: **fx-trader-profiles**

### 1.2 Goal

Build a dashboard that profiles f(x) Protocol wallets by:

- PNL
- ROI
- volume
- net capital flow
- open/closed positions
- position lifecycle
- liquidation/rebalance exposure
- behavioral patterns / "trading antics"

This should complement protocol-level dashboards by focusing on wallet behavior, not only TVL, supply, or protocol aggregates.

### 1.3 MVP definition

MVP is complete when the app can:

1. Discover active f(x) wallets from leaderboard-style data.
2. Persist daily wallet snapshots.
3. Index confirmed position ownership and position-state events through a hosted subgraph.
4. Show a trader leaderboard sorted by PNL, ROI, volume, net flow, risk, and recent activity.
5. Show one trader profile page with position timeline, closed/open positions, and deterministic behavior tags.
6. Show freshness, data-source, and methodology disclaimers.

### 1.4 Non-goals for MVP

Do not build these yet:

- copy trading
- alerts
- paid premium access
- transaction submission
- wallet login
- mobile-first UI
- real-time websocket UI
- exact official PNL parity
- self-hosted Ethereum infrastructure
- ClickHouse analytics storage
- provider-agnostic local backfill orchestration

## 2. Confirmed external assumptions

The official f(x) leaderboard page is crawler-visible as a JavaScript app with a **f(x) Protocol Trading Leaderboard**, **Season 2 of the f(x) Trading Challenge Airdrop**, a **7D** view, and table columns for **Ranking**, **Trader**, **PNL**, and **ROI**. The crawler view can show **No data found**, so implementation must treat official leaderboard data as a discoverable client-side API, not static HTML.

Smartclaw is a useful comparison source because its docs expose public f(x) endpoints such as `/api/fx/status`, `/api/fx/top-pnl`, `/api/fx/fxusd-rate`, `/api/rates`, and `/api/premium`, and state that wallet PNL, ROI, and volume are sourced from the f(x) Protocol leaderboard API. Smartclaw is seed/comparison only, not source of truth.

f(x) v2 mechanics require event-level position tracking. OpenZeppelin describes f(x) v2 as involving fxUSD, xPosition, batch rebalancing, liquidation, redemption, funding fees, and tick-based leveraged positions grouped into roughly 0.15% price bands. A later OpenZeppelin writeup notes that original audit coverage focused on xPosition long positions and that short positions were introduced later, so contract discovery must explicitly check both long and short position contracts.

Official Aladdin docs link to f(x) useful links, GitHub, audit reports, and contract tables. The official contracts page includes FXN on Ethereum at `0x365AccFCa291e7D3914637ABf1F7635dB165Bb09`. Treat the docs page as useful but potentially mixed across product generations; every production address must be versioned and verified against GitHub deployments, app bundle references, and Etherscan.

For RPC fallback, Chainstack advertises free Ethereum RPC nodes starting at $0/month and a 3M requests/month free tier; Alchemy currently lists a free tier with 25 requests/second and 30M compute units/month. Use these only for targeted `eth_call`, metadata reads, and small-range gap filling, not primary historical backfills.

## 3. Architecture

### 3.1 Hosted-only architecture

```mermaid
flowchart TD
  A[Official f(x) leaderboard/API discovery] --> B[wallet-seed worker]
  S[Smartclaw public endpoints] --> B
  C[Goldsky hosted subgraph] --> D[subgraph query worker]
  R[Goldsky/Chainstack/Alchemy RPC] --> E[ABI enrichment worker]
  B --> P[(Postgres: Supabase/Neon or self-hosted)]
  D --> P
  E --> P
  P --> API[Next.js API routes / server actions]
  API --> UI[Trader dashboard]
  GH[GitHub Actions / Vercel Cron] --> B
  GH --> D
  GH --> E
```

### 3.2 Recommended stack

Use:

- Language: TypeScript
- Package manager: pnpm
- Frontend: Next.js App Router
- Styling: Tailwind + shadcn/ui, or plain Tailwind where faster
- Database: Supabase Postgres, Neon Postgres, or self-hosted Postgres on a VPS
- ORM/query layer: Drizzle
- RPC client: viem
- Charts: Recharts or lightweight SVG charts
- Indexer: Goldsky hosted subgraph
- Subgraph language: AssemblyScript
- Jobs: GitHub Actions cron first; Vercel Cron if deployed on Vercel; system cron/systemd timers if self-hosted
- Deployment: Vercel, Cloudflare Pages, or a self-hosted VPS/container deployment

Avoid:

- local graph-node
- local Postgres requirement for laptop development
- local Ethereum node
- browser-side RPC log scans
- frontend direct heavy subgraph queries

### 3.3 Data ownership rule

Use each layer for what it is good at:

| Layer | Ownership |
| --- | --- |
| Goldsky subgraph | Compact indexed on-chain event/state entities. |
| Postgres | Raw snapshots, derived metrics, cached profile aggregates, UI query tables. |
| RPC | Targeted contract reads and gap fills only. |
| Frontend | Reads only from our API/database cache, not directly from every raw external source. |
| Smartclaw | Seed/comparison source only. |
| Official leaderboard | Seed/baseline source if endpoint is discoverable and terms permit. |

### 3.4 Self-hosting boundary

Yes: apart from the subgraph/indexer, the rest of the MVP can be self-hosted. The important distinction is **self-hosting the web/data app is fine; self-hosting Ethereum indexing infrastructure is not part of MVP**.

Self-hostable pieces:

- Next.js app/API as a Node server or container.
- Postgres database on a VPS, managed disk, or Docker volume with backups.
- Drizzle migrations via `pnpm db:push` from CI or a deploy shell.
- Worker scripts (`snapshot-leaderboard`, `sync-subgraph`, `enrich-positions`, `compute-trader-metrics`) run by system cron, systemd timers, Docker Compose, Coolify, Dokku, Fly.io machines, or a simple VPS process.
- Static assets and shadcn/Tailwind UI.
- Reverse proxy/TLS via Caddy, Nginx, Traefik, or Cloudflare Tunnel.

Still hosted/managed for MVP:

- Goldsky hosted subgraph for Ethereum event indexing.
- RPC providers for targeted reads and gap filling.
- Optional official/Smartclaw external HTTP APIs for seed/comparison data.

Self-hosting requirements:

1. Keep RPC and indexer keys server-side only.
2. Back up Postgres daily and test restore before relying on self-hosting.
3. Do not run full historical `eth_getLogs` jobs from the VPS.
4. Do not run local `graph-node` or archive-node infra.
5. Put rate limits on cron/API endpoints even when self-hosted.
6. Use a process manager with restart policy and job logs.
7. Keep `/api/health` and staleness banners as the operational source of truth.

## 4. Repository layout

Create this structure:

```text
fx-trader-profiles/
  apps/
    web/
      app/
        page.tsx
        leaderboard/page.tsx
        traders/[address]/page.tsx
        positions/[positionId]/page.tsx
        methodology/page.tsx
        api/
          health/route.ts
          traders/route.ts
          traders/[address]/route.ts
          traders/[address]/positions/route.ts
          positions/[positionId]/route.ts
          jobs/snapshot-leaderboard/route.ts
          jobs/sync-subgraph/route.ts
          jobs/enrich-positions/route.ts
      components/
      lib/
  packages/
    db/
      schema.ts
      migrations/
      client.ts
    fx-data/
      contracts.ts
      addresses.ts
      leaderboard.ts
      normalize-events.ts
      metrics.ts
      tags.ts
      risk.ts
      prices.ts
      validation.ts
    config/
      env.ts
  subgraph/
    subgraph.yaml
    schema.graphql
    src/
      mapping.ts
      position.ts
      pool.ts
    abis/
      ERC721.json
      PoolManager.json
      AaveFundingPool.json
      FxUSDRegeneracy.json
  workers/
    discover-contracts.ts
    snapshot-leaderboard.ts
    sync-subgraph.ts
    enrich-positions.ts
    backfill-wallet-snapshots.ts
  contracts/
    fx-v2.json
    fx-v2.candidate.json
  docs/
    methodology.md
    contracts-discovery.md
    data-sources.md
    runbook.md
  fixtures/
    leaderboard.smartclaw.sample.json
    leaderboard.official.sample.json
    subgraph.position-actions.sample.json
    rpc.get-position.sample.json
  .github/
    workflows/
      cron.yml
  package.json
  pnpm-workspace.yaml
  .env.example
```

## 5. Environment variables

Create `.env.example`:

```dotenv
DATABASE_URL=

# Hosted indexer
GOLDSKY_SUBGRAPH_URL=
GOLDSKY_API_KEY=
THE_GRAPH_SUBGRAPH_URL=

# RPC fallback, server-side only
GOLDSKY_RPC_URL=
CHAINSTACK_RPC_URL=
ALCHEMY_RPC_URL=

# Optional external seed/comparison sources
FX_LEADERBOARD_API_URL=
SMARTCLAW_BASE_URL=https://alidashboard.up.railway.app
SMARTCLAW_SITE_URL=https://smartclaw.xyz

# Job protection
CRON_SECRET=

# App config
NEXT_PUBLIC_APP_NAME=fx-trader-profiles
NEXT_PUBLIC_DEFAULT_CHAIN_ID=1
```

Rules:

1. Never expose RPC keys to the browser.
2. Never commit discovered private/API endpoints unless allowed.
3. Server routes must fail closed if `CRON_SECRET` is missing in production.
4. All external data snapshots must store `source`, `fetched_at`, and `raw payload hash`.

## 6. Contract discovery spec

### 6.1 Purpose

Produce a verified `contracts/fx-v2.json` before any production indexing.

### 6.2 Required output shape

```json
{
  "chainId": 1,
  "network": "ethereum-mainnet",
  "generatedAt": "2026-06-03T00:00:00.000Z",
  "sources": [
    {
      "kind": "official_docs",
      "url": "https://docs.aladdin.club/f-x-protocol/contracts",
      "checkedAt": "2026-06-03T00:00:00.000Z"
    },
    {
      "kind": "github",
      "url": "https://github.com/AladdinDAO/fx-protocol-contracts",
      "checkedAt": "2026-06-03T00:00:00.000Z"
    },
    {
      "kind": "app_bundle",
      "url": "https://fx.aladdin.club/v2/trade",
      "checkedAt": "2026-06-03T00:00:00.000Z"
    },
    {
      "kind": "etherscan",
      "url": "verified contract page",
      "checkedAt": "2026-06-03T00:00:00.000Z"
    }
  ],
  "contracts": [
    {
      "key": "pool_manager",
      "name": "PoolManager",
      "address": "0x0000000000000000000000000000000000000000",
      "startBlock": 0,
      "abiPath": "subgraph/abis/PoolManager.json",
      "roles": ["manager", "position_actions"],
      "version": "v2",
      "confidence": "verified",
      "evidence": [
        { "source": "github", "detail": "deployment file or ignition module" },
        { "source": "etherscan", "detail": "verified source name matches" }
      ]
    }
  ]
}
```

### 6.3 Confidence levels

| Confidence | Meaning |
| --- | --- |
| `verified` | Appears in at least two independent sources, one of which is official GitHub, official docs, current app bundle, or Etherscan verified source. |
| `probable` | Appears in one strong source and ABI/source matches expected contract. |
| `candidate` | Found by search, logs, deployer tracing, or old docs, but not production-confirmed. |
| `deprecated` | Known old/beta/v1 address that must not be indexed for MVP unless explicitly selected. |

### 6.4 Discovery worker requirements

Implement `workers/discover-contracts.ts`.

It must:

1. Read candidate addresses from docs/manual config.
2. Pull ABI/source metadata from Etherscan or local GitHub ABI artifacts where available.
3. Verify bytecode exists at address.
4. Verify event signatures exist in ABI.
5. Fetch contract creation block if available.
6. Write `contracts/fx-v2.candidate.json`.
7. Refuse to overwrite `contracts/fx-v2.json` unless `--approve` is passed.

Acceptance criteria:

```bash
pnpm discover:contracts
pnpm discover:contracts --approve
```

The approved file must include at minimum:

- PoolManager or equivalent manager/router contract
- all active position pool contracts
- all active position NFT contracts if separate
- fxUSD/fxUSD-related accounting contract
- oracle/price source contracts if needed for enrichment
- startBlock for each indexed contract
- ABI path for each indexed contract

## 7. Postgres data model

Use **Postgres as the analytics source of truth** for MVP. This can be managed Postgres (Supabase/Neon) or self-hosted Postgres; schema and code should not depend on provider-specific features for the MVP.

### 7.1 Core tables

```sql
create table data_sources (
  id text primary key,
  kind text not null,
  url text,
  description text,
  created_at timestamptz not null default now()
);

create table wallets (
  address bytea primary key,
  ens text,
  label text,
  first_seen_block bigint,
  first_seen_at timestamptz,
  last_seen_block bigint,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wallet_snapshots (
  id bigserial primary key,
  wallet_address bytea not null references wallets(address),
  snapshot_at timestamptz not null,
  period text not null,
  source_id text not null references data_sources(id),
  pnl_usd numeric,
  pnl_clean_usd numeric,
  roi numeric,
  volume_usd numeric,
  net_capital_flow_usd numeric,
  rank_pnl int,
  rank_roi int,
  raw_payload jsonb,
  payload_hash text,
  created_at timestamptz not null default now(),
  unique(wallet_address, snapshot_at, period, source_id)
);

create table contracts (
  address bytea primary key,
  chain_id int not null,
  name text not null,
  role text not null,
  version text not null,
  start_block bigint not null,
  abi_path text,
  confidence text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table positions (
  id text primary key,
  chain_id int not null,
  position_contract bytea not null,
  pool_address bytea,
  position_id numeric not null,
  current_owner bytea,
  market text,
  collateral_token bytea,
  collateral_symbol text,
  side text,
  status text not null,
  open_tx bytea,
  open_block bigint,
  open_at timestamptz,
  close_tx bytea,
  close_block bigint,
  close_at timestamptz,
  first_seen_block bigint,
  last_seen_block bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table position_events (
  id text primary key,
  chain_id int not null,
  tx_hash bytea not null,
  log_index int not null,
  block_number bigint not null,
  block_timestamp timestamptz not null,
  contract_address bytea not null,
  position_pk text references positions(id),
  wallet_address bytea,
  event_name text not null,
  action_type text not null,
  raw_args jsonb not null,
  normalized jsonb,
  created_at timestamptz not null default now(),
  unique(chain_id, tx_hash, log_index)
);

create table position_state_snapshots (
  id bigserial primary key,
  position_pk text not null references positions(id),
  block_number bigint not null,
  block_timestamp timestamptz not null,
  tx_hash bytea,
  tick numeric,
  collateral_shares numeric,
  debt_shares numeric,
  raw_collateral numeric,
  raw_debt numeric,
  price numeric,
  debt_ratio numeric,
  collateral_value_usd numeric,
  debt_value_usd numeric,
  unrealized_pnl_usd numeric,
  liquidation_risk_score numeric,
  rebalance_risk_score numeric,
  source_event_id text references position_events(id),
  created_at timestamptz not null default now(),
  unique(position_pk, block_number, tx_hash)
);

create table trader_daily_metrics (
  id bigserial primary key,
  wallet_address bytea not null references wallets(address),
  day date not null,
  realized_pnl_usd numeric,
  unrealized_pnl_usd numeric,
  total_pnl_usd numeric,
  roi numeric,
  volume_usd numeric,
  net_capital_flow_usd numeric,
  active_positions int,
  closed_positions int,
  wins int,
  losses int,
  win_rate numeric,
  max_drawdown_usd numeric,
  avg_hold_seconds numeric,
  median_hold_seconds numeric,
  liquidation_count int,
  rebalance_count int,
  risk_score numeric,
  created_at timestamptz not null default now(),
  unique(wallet_address, day)
);

create table trader_tags (
  id bigserial primary key,
  wallet_address bytea not null references wallets(address),
  tag text not null,
  score numeric not null,
  explanation text not null,
  evidence jsonb not null,
  computed_at timestamptz not null default now(),
  unique(wallet_address, tag)
);

create table job_runs (
  id bigserial primary key,
  job_name text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cursor jsonb,
  rows_read int default 0,
  rows_written int default 0,
  error text
);
```

### 7.2 Indexes

```sql
create index idx_wallet_snapshots_rank_pnl on wallet_snapshots(period, rank_pnl);
create index idx_wallet_snapshots_wallet_time on wallet_snapshots(wallet_address, snapshot_at desc);
create index idx_positions_owner_status on positions(current_owner, status);
create index idx_positions_market_status on positions(market, status);
create index idx_position_events_position_block on position_events(position_pk, block_number);
create index idx_position_events_wallet_block on position_events(wallet_address, block_number);
create index idx_position_state_position_block on position_state_snapshots(position_pk, block_number);
create index idx_trader_daily_wallet_day on trader_daily_metrics(wallet_address, day desc);
create index idx_trader_tags_wallet on trader_tags(wallet_address);
```

## 8. Subgraph spec

### 8.1 Design rule

Keep the subgraph compact. Goldsky Starter currently includes 100,000 free stored subgraph entities, so the MVP subgraph should store only entities needed to reconstruct position lifecycle and query recent position state.

### 8.2 Subgraph entities

Create `subgraph/schema.graphql`:

```graphql
type Position @entity {
  id: Bytes!
  chainId: Int!
  positionContract: Bytes!
  pool: Bytes
  tokenId: BigInt!
  currentOwner: Bytes
  market: String
  side: String
  status: String!
  openBlock: BigInt
  openTimestamp: BigInt
  closeBlock: BigInt
  closeTimestamp: BigInt
  lastBlock: BigInt!
  lastTimestamp: BigInt!
}

type PositionAction @entity(immutable: true) {
  id: Bytes!
  position: Position
  chainId: Int!
  txHash: Bytes!
  logIndex: Int!
  blockNumber: BigInt!
  timestamp: BigInt!
  contractAddress: Bytes!
  wallet: Bytes
  eventName: String!
  actionType: String!
  tokenId: BigInt
  tick: BigInt
  collateralShares: BigInt
  debtShares: BigInt
  price: BigInt
  rawArgs: String
}

type PoolState @entity {
  id: Bytes!
  pool: Bytes!
  market: String
  collateralToken: Bytes
  collateralSymbol: String
  latestTick: BigInt
  latestPrice: BigInt
  latestDebtIndex: BigInt
  latestCollateralIndex: BigInt
  latestBorrowIndex: BigInt
  latestBlock: BigInt!
  latestTimestamp: BigInt!
}

type SyncMeta @entity {
  id: Bytes!
  latestBlock: BigInt!
  latestTimestamp: BigInt!
}
```

### 8.3 Events to handle first

Implement handlers for confirmed events only. Candidate list:

- `Transfer(address indexed from,address indexed to,uint256 indexed tokenId)`
- `PositionSnapshot(position,tick,collShares,debtShares,price)`
- `TickMovement(oldTick,newTick,collShares,debtShares,price)`
- `CollateralIndexSnapshot(index)`
- `DebtIndexSnapshot(index)`
- `SnapshotAaveBorrowIndex(borrowIndex,timestamp)`
- `UpdateBorrowStatus(...)`
- `UpdateRedeemStatus(...)`
- `UpdateFundingRatio(...)`
- `UpdateOpenRatio(...)`
- `UpdateCloseFeeRatio(...)`
- `UpdateDebtRatioRange(...)`
- `UpdateRebalanceRatios(...)`
- `UpdateLiquidateRatios(...)`

Do not assume all events exist on all current contracts. The discovery script must check ABI support first.

### 8.4 Action normalization

| Event | Rule |
| --- | --- |
| ERC721 `Transfer`, `from == zero && to != zero` | `action_type = open`; create/update `Position.currentOwner = to`; `status = open`. |
| ERC721 `Transfer`, `from != zero && to == zero` | `action_type = close_or_burn`; `status = closed` unless later liquidation evidence says liquidated. |
| ERC721 `Transfer`, `from != zero && to != zero` | `action_type = transfer`; update current owner; do not treat as realized PNL. |
| `PositionSnapshot` | `action_type = snapshot`; update latest position state; infer increase/decrease only if collateral/debt deltas are significant. |
| `TickMovement` | `action_type = tick_movement`; update pool tick/price; create risk evidence for affected positions if linkable. |
| Liquidate/Rebalance/Redeem events | `action_type = liquidate`, `rebalance`, or `redeem`; mark affected position/pool risk evidence. |

### 8.5 Manifest requirements

`subgraph.yaml` must:

1. Use Ethereum mainnet.
2. Include one data source per verified active contract.
3. Use each contract's real `startBlock`.
4. Include only event handlers whose event signatures exist in that contract ABI.
5. Avoid call handlers for MVP unless absolutely required.

The Graph docs recommend contract creation block as `startBlock`; event handlers are the normal way to react to emitted contract events. Avoid call handlers because they depend on tracing APIs and event handlers are more performant/broadly supported.

## 9. Worker specs

### 9.1 `snapshot-leaderboard.ts`

Purpose: fetch leaderboard-like wallet metrics and store `wallet_snapshots`.

Sources:

1. Official f(x) leaderboard API if discovered and allowed.
2. Smartclaw public API as comparison/bootstrap.

Inputs:

```bash
--source official|smartclaw|all
--period 7d|30d|all
--limit 1000
```

Output tables:

- `wallets`
- `wallet_snapshots`
- `job_runs`

Normalization:

```ts
type LeaderboardWallet = {
  trader: `0x${string}`;
  pnlUsd?: string;
  pnlCleanUsd?: string;
  roi?: string;
  volumeUsd?: string;
  netCapitalFlowUsd?: string;
  rankPnl?: number;
  rankRoi?: number;
  source: "official_fx" | "smartclaw";
  period: "7d" | "30d" | "all";
  fetchedAt: string;
  raw: unknown;
};
```

Rules:

1. Upsert wallet address.
2. Insert one immutable snapshot per fetch time/source/period.
3. Keep raw payload and hash.
4. Never overwrite historical snapshots.
5. If official and Smartclaw disagree, store both; do not silently merge.

Acceptance criteria:

```bash
pnpm worker:snapshot-leaderboard --source smartclaw --period all --limit 100
```

Must insert at least 1 wallet, at least 1 wallet snapshot, and 1 completed job run.

### 9.2 `sync-subgraph.ts`

Purpose: pull indexed `Position` and `PositionAction` entities from Goldsky into Postgres.

Inputs:

```bash
--from-block optional
--to-block optional
--page-size default 500
```

Rules:

1. Read cursor from `job_runs` or a `sync_cursors` table.
2. Query subgraph by `blockNumber`/`logIndex` pagination.
3. Upsert positions.
4. Insert `position_events` idempotently.
5. Convert timestamps to `timestamptz`.
6. Store `rawArgs` if available.

Acceptance criteria: `pnpm worker:sync-subgraph` must be idempotent when run twice.

### 9.3 `enrich-positions.ts`

Purpose: use RPC for targeted ABI reads only.

Allowed reads:

- `ownerOf(tokenId)`
- `getPosition(tokenId)`
- `getPositionDebtRatio(tokenId)`
- `positionData(tokenId)`
- `positionMetadata(tokenId)`
- `getDebtAndCollateralIndex()`
- `collateralToken()`
- `priceOracle()`
- pool registry methods

Rules:

1. Only enrich positions changed since the last successful run.
2. Batch reads using Multicall where possible.
3. Use Goldsky RPC first, then Chainstack, then Alchemy.
4. Cache read results by contract, method, args, and block number.
5. Do not use RPC for full historical `eth_getLogs` backfill.
6. Mark unavailable reads as null with error metadata instead of crashing the entire job.

Acceptance criteria:

```bash
pnpm worker:enrich-positions --limit 50
```

Must update `position_state_snapshots`, `positions.updated_at`, and `job_runs`.

### 9.4 `compute-trader-metrics.ts`

Purpose: compute daily wallet aggregates and behavior tags.

Inputs:

```bash
--day YYYY-MM-DD
--wallet optional
```

Outputs:

- `trader_daily_metrics`
- `trader_tags`

Rules:

1. Recompute deterministically for a wallet/day.
2. Use leaderboard PNL as official/baseline and computed PNL as estimated/on-chain.
3. Never hide methodology differences.
4. Store tag evidence as JSON.

## 10. Metrics methodology

### 10.1 Store multiple PNL types

Use separate fields:

| Field | Meaning |
| --- | --- |
| `official_pnl_usd` | PNL from official f(x) leaderboard API when available. |
| `comparison_pnl_usd` | PNL from Smartclaw. |
| `estimated_realized_pnl_usd` | Our computed closed-position PNL estimate. |
| `estimated_unrealized_pnl_usd` | Our computed open-position mark-to-market estimate. |
| `total_estimated_pnl_usd` | `estimated_realized_pnl_usd + estimated_unrealized_pnl_usd`. |

UI labels:

- Official PNL
- Estimated realized PNL
- Estimated unrealized PNL
- Comparison source PNL

### 10.2 ROI

Store:

- `official_roi`
- `comparison_roi`
- `estimated_roi`

Default estimated ROI formula:

```text
estimated_roi = total_estimated_pnl_usd / max(abs(net_capital_flow_usd), min_capital_base_usd)
min_capital_base_usd = 100
```

Reason: avoid absurd ROI from dust wallets. Do not claim official ROI parity unless verified.

### 10.3 Volume

Compute and store:

- `official_volume_usd`
- `comparison_volume_usd`
- `estimated_notional_volume_usd`

Estimated volume rule: for each position-changing action, estimate USD notional from collateral/debt/price fields when available. If unavailable, leave estimated volume null rather than guessing.

### 10.4 Win rate

```text
closed_trade_win = estimated_realized_pnl_usd > 0
win_rate = winning_closed_positions / closed_positions_with_estimated_pnl
```

Do not include open positions in win rate.

### 10.5 Hold time

```text
hold_seconds = close_at - open_at
```

Only compute for closed positions.

### 10.6 Drawdown

MVP approximation:

```text
wallet_equity_curve = daily total_estimated_pnl_usd
max_drawdown = max(previous_peak - later_trough)
```

Later version: position-level intraday drawdown using hourly snapshots.

### 10.7 Risk score

MVP risk score is weighted average of:

- open position debt ratio
- tick proximity to rebalance/liquidation thresholds
- concentration in largest position
- recent adverse tick movement
- liquidation/rebalance history

Output range: `0` to `100`.

Risk labels:

| Range | Label |
| --- | --- |
| 0-25 | low |
| 26-50 | moderate |
| 51-75 | high |
| 76-100 | extreme |

If position debt ratio or liquidation threshold is unknown, use `risk_score = null` and `risk_status = "insufficient data"`.

## 11. Behavior tags / "trading antics"

All tags must be deterministic, neutral, and evidence-backed. Avoid defamatory wording.

### 11.1 Tag schema

```ts
type TraderTag = {
  tag: string;
  score: number;
  explanation: string;
  evidence: {
    wallet: string;
    windowDays: number;
    metrics: Record<string, string | number | null>;
    samplePositionIds: string[];
    sampleTxHashes: string[];
  };
};
```

### 11.2 MVP tags

| Tag | Rule | Required evidence | MVP status |
| --- | --- | --- | --- |
| Averager | 3+ increase actions into a position after estimated unrealized PNL was negative. | position IDs, increase tx hashes, negative snapshot before each increase. | enabled when unrealized PNL coverage exists |
| Scalper | median closed-position hold time < 6 hours and closed position count >= 10. | closed position count, median hold time. | enabled |
| Swing Trader | median closed-position hold time > 2 days and closed position count >= 5. | closed position count, median hold time. | enabled |
| High Leverage | at least 3 positions with debt ratio in top 10% of observed positions or debt ratio within configured danger band. | position IDs, debt ratios, percentile threshold. | enabled when debt ratio coverage exists |
| Rebalance Survivor | position had rebalance/tick-risk event and later closed with positive estimated realized PNL. | position ID, rebalance/tick event, close event, estimated PNL. | enabled when close PNL coverage exists |
| Panic Closer | position closed within 2 hours after adverse tick movement and close PNL <= 0. | adverse movement event, close event, time delta, PNL. | enabled when tick movement coverage exists |
| Whale | wallet is top 5% by estimated notional volume or collateral among tracked wallets. | percentile rank, volume/collateral. | enabled |
| Challenge Farmer | many small qualifying positions clustered around known leaderboard/challenge windows. | challenge window config, position count, median size, timestamps. | disabled until challenge windows are encoded |

### 11.3 UI copy rules

Good:

> High Leverage: This wallet repeatedly opened positions with debt ratios near the top decile of tracked positions.

Avoid:

- Reckless degen
- Manipulator
- Scammer

## 12. API spec

### 12.1 `GET /api/health`

Response:

```json
{
  "ok": true,
  "database": "ok",
  "subgraph": {
    "ok": true,
    "latestIndexedBlock": 123,
    "lagBlocks": 12
  },
  "jobs": {
    "snapshotLeaderboard": { "lastSuccessAt": "2026-06-03T00:00:00.000Z" },
    "syncSubgraph": { "lastSuccessAt": "2026-06-03T00:00:00.000Z" },
    "enrichPositions": { "lastSuccessAt": "2026-06-03T00:00:00.000Z" }
  }
}
```

### 12.2 `GET /api/traders`

Query params:

- `sort=pnl|roi|volume|netFlow|winRate|risk|recent`
- `period=7d|30d|all`
- `tag=optional`
- `limit=default 50 max 200`
- `cursor=optional`

Response:

```json
{
  "data": [
    {
      "address": "0x...",
      "ens": null,
      "label": null,
      "pnlUsd": "12345.67",
      "roi": "0.42",
      "volumeUsd": "1000000",
      "netCapitalFlowUsd": "50000",
      "winRate": "0.61",
      "activePositions": 3,
      "closedPositions": 42,
      "riskScore": 64,
      "tags": ["Scalper", "High Leverage"],
      "lastActiveAt": "2026-06-03T00:00:00.000Z",
      "dataQuality": {
        "officialLeaderboard": true,
        "onchainPositions": true,
        "estimatedPnl": true
      }
    }
  ],
  "nextCursor": null,
  "asOf": "2026-06-03T00:00:00.000Z"
}
```

### 12.3 `GET /api/traders/:address`

Response includes address, summary, tags, charts, latest positions, and data quality metadata.

### 12.4 `GET /api/traders/:address/positions`

Query params:

- `status=open|closed|all`
- `limit=default 50`
- `cursor=optional`

Response includes paginated position rows with position ID, market, side, status, open/close times, estimated PNL, and risk score.

### 12.5 `GET /api/positions/:positionId`

Response includes position header, events, state snapshots, and risk explanation.

## 13. Frontend pages

### 13.1 Home

Cards:

- Tracked traders
- Active positions
- Estimated total volume
- Estimated aggregate PNL
- Winners / losers
- Weighted win rate
- Last indexed block
- Data freshness

Banner:

> This dashboard estimates wallet-level behavior from public leaderboard snapshots and indexed on-chain position events. PNL methods may differ from f(x)'s official leaderboard.

### 13.2 Leaderboard

Table columns:

- Rank
- Trader
- PNL
- ROI
- Volume
- Net flow
- Win rate
- Active positions
- Risk
- Tags
- Last active

Filters:

- Period: 7D / 30D / All
- Sort: PNL / ROI / Volume / Net Flow / Win Rate / Risk / Recent
- Status: Active only / All
- Tag
- Market

### 13.3 Trader profile

Sections:

- Header: address, ENS, labels, first seen, last active
- Summary cards: official PNL, estimated PNL, ROI, volume, win rate, active risk
- Charts: cumulative PNL, daily volume, active risk score
- Behavior tags: deterministic tags with explanations
- Open positions: current position table
- Closed positions: realized results and hold time
- Timeline: open / increase / decrease / rebalance / liquidation / close events
- Caution card: methodology, stale-data warning, protocol risk

### 13.4 Position detail

Sections:

- Position header
- Lifecycle chart
- Collateral/debt state table
- Tick movement history
- Funding/fee context when available
- Transactions
- Owner transfers
- Risk history

### 13.5 Methodology

Include:

- Data sources
- PNL fields and definitions
- ROI formula
- Risk formula
- Behavior tag rules
- Known limitations
- Address/version confidence

## 14. Cron and deployment

### 14.1 Managed cron option: GitHub Actions workflow

`.github/workflows/cron.yml`:

```yaml
name: cron
on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:
jobs:
  run-jobs:
    runs-on: ubuntu-latest
    steps:
      - name: Snapshot leaderboard
        run: |
          curl -fsS -X POST "$APP_URL/api/jobs/snapshot-leaderboard" \
            -H "Authorization: Bearer $CRON_SECRET"
      - name: Sync subgraph
        run: |
          curl -fsS -X POST "$APP_URL/api/jobs/sync-subgraph" \
            -H "Authorization: Bearer $CRON_SECRET"
      - name: Enrich positions
        run: |
          curl -fsS -X POST "$APP_URL/api/jobs/enrich-positions" \
            -H "Authorization: Bearer $CRON_SECRET"
```

### 14.2 Self-hosted cron option

If self-hosting the app/API/database, replace GitHub Actions or Vercel Cron with a VPS scheduler. Acceptable options:

- system cron calling protected API routes with `CRON_SECRET`
- systemd timers running worker commands directly
- Docker Compose service plus `supercronic`
- Coolify/Dokku scheduled jobs

Example system cron shape:

```cron
*/30 * * * * curl -fsS -X POST "$APP_URL/api/jobs/snapshot-leaderboard" -H "Authorization: Bearer $CRON_SECRET"
*/30 * * * * curl -fsS -X POST "$APP_URL/api/jobs/sync-subgraph" -H "Authorization: Bearer $CRON_SECRET"
0 */2 * * * curl -fsS -X POST "$APP_URL/api/jobs/enrich-positions" -H "Authorization: Bearer $CRON_SECRET"
```

Self-hosted cron must log failures, avoid overlapping runs, and write `job_runs` rows exactly like managed cron.

### 14.3 Job cadence

MVP cadence:

| Job | Cadence |
| --- | --- |
| `snapshot-leaderboard` | every 30 minutes |
| `sync-subgraph` | every 30 minutes |
| `enrich-positions` | every 2 hours |
| `compute-trader-metrics` | every 2 hours and after `sync-subgraph` |
| contract discovery | manual only |

### 14.4 Staleness rules

Show UI warning if:

- leaderboard snapshot age > 6 hours
- subgraph sync age > 2 hours
- enrichment age > 12 hours
- subgraph lag > 500 blocks

## 15. Cost-control requirements

Hard rules for coder model:

1. Do not run full historical `eth_getLogs` from RPC.
2. Do not query subgraph directly from public frontend components.
3. Do not store every tiny computed chart point in the subgraph.
4. Do not compute trader profiles on every page load from raw events.
5. Precompute daily/hourly aggregates into Postgres.
6. Cache API responses for 30-300 seconds depending on endpoint.
7. Use pagination everywhere.
8. Add rate-limit guards around cron endpoints.
9. Use cursor-based sync jobs.
10. Store only compact raw payloads needed for auditability.

Recommended cache TTLs:

| Endpoint | TTL |
| --- | --- |
| `/api/health` | 30 seconds |
| `/api/traders` | 60 seconds |
| `/api/traders/:address` | 120 seconds |
| `/api/positions/:positionId` | 300 seconds |
| methodology/static docs | static |

## 16. Testing spec

### 16.1 Unit tests

Create tests for:

- `normalizeLeaderboardWallet`
- `normalizePositionEvent`
- `inferActionType`
- `computeEstimatedRoi`
- `computeWinRate`
- `computeHoldTime`
- `computeDrawdown`
- `computeRiskScore`
- `computeTraderTags`

### 16.2 Fixture tests

Add fixtures:

```text
fixtures/
  leaderboard.smartclaw.sample.json
  leaderboard.official.sample.json
  subgraph.position-actions.sample.json
  rpc.get-position.sample.json
```

### 16.3 Integration tests

Use a test database.

Required tests:

1. `snapshot-leaderboard` inserts wallets and snapshots idempotently.
2. `sync-subgraph` inserts events idempotently.
3. `enrich-positions` handles one failed RPC provider and succeeds with fallback.
4. `compute-trader-metrics` creates deterministic tags.
5. API pagination returns stable cursors.

### 16.4 Manual smoke test

Before deployment:

```bash
pnpm install
pnpm lint
pnpm test
pnpm db:push
pnpm discover:contracts
pnpm worker:snapshot-leaderboard --source smartclaw --limit 20
pnpm worker:sync-subgraph --page-size 20
pnpm worker:enrich-positions --limit 20
pnpm dev
```

## 17. Implementation phases

### Phase 0 — Scaffold

Deliver:

- Next.js app
- Drizzle/Postgres schema
- `.env.example`
- health endpoint
- `job_runs` table
- basic dashboard shell

Acceptance criteria:

1. App deploys to Vercel/Cloudflare or a self-hosted VPS/container.
2. Database migrations run.
3. `/api/health` returns database status.
4. No RPC or indexer key is exposed client-side.

### Phase 1 — Wallet seed snapshots

Deliver:

- Smartclaw snapshot ingest
- official leaderboard endpoint placeholder
- `wallet_snapshots` table populated
- basic leaderboard page

Acceptance criteria:

1. Can fetch at least 100 wallets from comparison/seed source.
2. Stores PNL, ROI, volume, net flow if present.
3. Shows source and `fetched_at` in UI.
4. Does not treat Smartclaw as final truth.

### Phase 2 — Contract discovery

Deliver:

- `contracts/fx-v2.candidate.json`
- `contracts/fx-v2.json` approved manually
- ABI files
- start blocks
- confidence levels

Acceptance criteria:

1. Every indexed address has bytecode.
2. Every indexed address has ABI.
3. Every event handler in subgraph exists in corresponding ABI.
4. Current app bundle/deployment references are checked manually or by script.
5. Deprecated/beta addresses are marked as such.

### Phase 3 — Hosted subgraph

Deliver:

- subgraph manifest
- `schema.graphql`
- mapping handlers
- Goldsky deployment
- subgraph sync worker

Acceptance criteria:

1. Goldsky subgraph syncs from verified start blocks.
2. Position `Transfer` events are indexed.
3. `PositionSnapshot`-like events are indexed where available.
4. Postgres receives idempotent `position_events`.
5. The app shows indexed position lists for at least one wallet.

### Phase 4 — Enrichment and derived metrics

Deliver:

- RPC enrichment worker
- `position_state_snapshots`
- `trader_daily_metrics`
- estimated PNL/ROI placeholders
- risk score v0

Acceptance criteria:

1. Uses Multicall or batched reads.
2. Falls back across RPC providers.
3. Does not call large `eth_getLogs`.
4. Shows `insufficient data` where exact metrics cannot be computed.

### Phase 5 — Trader profile UX

Deliver:

- trader profile page
- position detail page
- charts
- behavior tags
- methodology page

Acceptance criteria:

1. Every tag has evidence and explanation.
2. Every PNL metric is labeled official/comparison/estimated.
3. Staleness warnings appear correctly.
4. Profile page loads from cached DB/API data, not raw subgraph scans.

## 18. Coder-model handoff prompt

Use this as the implementation prompt:

```text
Build the fx-trader-profiles MVP as a hosted-indexing, Postgres-backed TypeScript monorepo. The web app, database, and jobs may be managed-hosted or self-hosted, but Ethereum indexing must use the hosted Goldsky subgraph for MVP.
Hard constraints:
- Do not require local graph-node.
- Do not require a local Ethereum node.
- Do not perform large eth_getLogs backfills through RPC.
- Use Goldsky hosted subgraph as the primary indexer target.
- Use Postgres as the source of truth for dashboard analytics; managed Postgres and self-hosted Postgres must both work.
- Use RPC only for targeted ABI reads and gap filling.
- Keep all external API/RPC keys server-side.
- Store data source, fetched_at, and raw payload hash for every external snapshot.
Implement the repository structure, database schema, workers, API routes, and basic pages described in the spec.
Start with:
1. Scaffold Next.js + TypeScript + pnpm workspace.
2. Add Drizzle schema and migrations.
3. Implement /api/health.
4. Implement Smartclaw seed snapshot ingest.
5. Implement contract discovery output format.
6. Add subgraph skeleton with schema.graphql and subgraph.yaml placeholders.
7. Add leaderboard and trader profile pages using database-backed mock/seed data.
8. Add tests for metric and tag functions.
Do not hardcode unverified f(x) v2 production addresses except as candidates with confidence="candidate".
Do not claim exact official PNL parity.
Do not expose copy-trading or trading actions.
```

## 19. Final recommendation

Use this order:

1. Build the database/API/UI around seed snapshots first.
2. Confirm current v2 contracts.
3. Deploy the hosted Goldsky subgraph.
4. Sync compact on-chain position events into Postgres.
5. Compute trader profiles in Postgres.
6. Add position-risk and behavior tags only after enough event coverage exists.

This keeps the project viable on weak local hardware because the expensive work—Ethereum historical log indexing and long-running sync—is moved to hosted indexer/RPC infrastructure. Everything else can run on managed services or a small self-hosted VPS as long as backups, cron logs, and health checks are in place.

## External references

- f(x) Protocol stats dashboard: <https://fxprotocolstats.com>
- Official f(x) leaderboard: <https://fx.aladdin.club/v2/leaderboard>
- Official f(x) useful links/docs: <https://docs.aladdin.club/f-x-protocol/useful-links>
- Official f(x) contracts/docs: <https://docs.aladdin.club/f-x-protocol/contracts>
- AladdinDAO GitHub organization: <https://github.com/AladdinDAO>
- f(x) v2 OpenZeppelin audit: <https://www.openzeppelin.com/news/fx-v2-audit>
- Smartclaw docs/API reference: <https://alidashboard.up.railway.app/docs>
- Smartclaw public site: <https://smartclaw.xyz/>
- shadcn/ui design system and component provenance: <https://ui.shadcn.com/?utm_source=chatgpt.com>
- Goldsky pricing/docs: <https://goldsky.com/pricing>
- The Graph subgraph docs: <https://thegraph.com/docs/en/subgraphs/developing/subgraphs/>
- The Graph Studio pricing: <https://thegraph.com/studio-pricing/>
- Chainstack Ethereum RPC/free endpoint info: <https://chainstack.com/build-better-with-ethereum>
- Alchemy pricing/free tier: <https://www.alchemy.com/pricing>
