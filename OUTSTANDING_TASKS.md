# Outstanding tasks before shipping

This checklist tracks what remains before `fx-trader-profiles` can be shipped as a useful public MVP.

## Legend

- **P0**: required before any public MVP
- **P1**: important for a credible beta
- **P2**: nice-to-have after MVP

## P0 — Product and infrastructure blockers

### App/runtime

- [ ] Replace placeholder dashboard copy with real empty/loading/error states.
- [ ] Add a production reverse-proxy example, such as Caddy or Nginx, for TLS termination.
- [ ] Add a Docker Compose profile or docs for using an externally managed Postgres instead of the bundled Postgres container.
- [ ] Add rate limiting for public API routes and cron endpoints.
- [ ] Add structured logging for API routes and workers.
- [ ] Add a deployment runbook with backup/restore, update, rollback, and incident steps.
- [ ] Verify Watchtower behavior with the final image naming/tagging strategy.

### Database

- [ ] Add Drizzle to the workspace.
- [ ] Implement the Postgres schema from `docs/fx-user-tracker-research.md`.
- [ ] Add migrations and wire `pnpm db:push` to real Drizzle migration commands.
- [ ] Add a `sync_cursors` or equivalent cursor table for idempotent worker progress.
- [ ] Add database indexes from the spec.
- [ ] Test backup and restore from the `postgres-backup` volume.
- [ ] Decide whether production uses bundled Postgres, Supabase, Neon, or another managed Postgres provider.

### Configuration and secrets

- [ ] Generate production `CRON_SECRET` and store it securely.
- [ ] Add real `GOLDSKY_SUBGRAPH_URL` once the subgraph is deployed.
- [ ] Add at least one server-side RPC fallback URL.
- [ ] Confirm no RPC or indexer key is exposed via `NEXT_PUBLIC_*` variables.
- [ ] Add environment validation with clear startup errors.

## P0 — f(x) data and indexing blockers

### Contract discovery

- [ ] Implement `workers/discover-contracts.ts`.
- [ ] Produce `contracts/fx-v2.candidate.json`.
- [ ] Verify current f(x) v2 contracts against official docs, GitHub deployments, app bundle references, and Etherscan.
- [ ] Mark old/beta/v1 addresses as `deprecated`.
- [ ] Produce approved `contracts/fx-v2.json` with confidence levels, start blocks, ABI paths, and evidence.
- [ ] Confirm long and short position pool contracts separately.
- [ ] Confirm whether position NFTs are separate contracts or pool-native ERC-721 positions.

### ABIs and subgraph

- [ ] Add verified ABI files under `subgraph/abis/`.
- [ ] Generate `subgraph/subgraph.yaml` from verified contract config.
- [ ] Implement AssemblyScript mappings for ERC-721 `Transfer`.
- [ ] Implement handlers for confirmed position snapshot/tick/index events only where ABI support exists.
- [ ] Add unit/fixture coverage for action normalization.
- [ ] Deploy hosted Goldsky subgraph.
- [ ] Verify Goldsky entity count stays under the free-tier target.
- [ ] Verify subgraph lag and expose latest indexed block via `/api/health`.

### Seed/comparison data

- [ ] Implement Smartclaw snapshot ingestion.
- [ ] Discover official f(x) leaderboard API endpoint if available and allowed.
- [ ] Add payload hashing for all external snapshots.
- [ ] Store source, fetched timestamp, period, raw payload, and normalized wallet metrics.
- [ ] Ensure Smartclaw is clearly labeled as seed/comparison data, not source of truth.

## P0 — Workers and APIs

### Workers

- [ ] Implement `snapshot-leaderboard` worker logic.
- [ ] Implement `sync-subgraph` worker logic with cursor-based pagination.
- [ ] Implement `enrich-positions` worker with server-side RPC fallback and Multicall batching where possible.
- [ ] Implement `compute-trader-metrics` worker.
- [ ] Ensure all workers are idempotent.
- [ ] Ensure workers write `job_runs` with status, cursor, rows read/written, and errors.
- [ ] Prevent overlapping cron runs for the same job.

### API routes

- [ ] Implement `GET /api/traders` with pagination, sorting, period filters, tag filters, and cache headers.
- [ ] Implement `GET /api/traders/:address`.
- [ ] Implement `GET /api/traders/:address/positions`.
- [ ] Implement `GET /api/positions/:positionId`.
- [ ] Expand `GET /api/health` to include subgraph lag, last successful jobs, and stale-data warnings.
- [ ] Add response schemas/validation.
- [ ] Add stable cursor pagination.

## P0 — UI blockers

### Home page

- [ ] Show tracked traders, active positions, estimated volume, aggregate PNL, winners/losers, win rate, latest indexed block, and data freshness.
- [ ] Add clear methodology disclaimer banner.

### Leaderboard page

- [ ] Add All / 30D / 7D / 1D or MVP-supported period controls.
- [ ] Add sorting by PNL, ROI, volume, net flow, win rate, risk, and recent activity.
- [ ] Add filters for active-only/all, tag, and market.
- [ ] Add empty states for no data and stale data.
- [ ] Link rows to trader profile pages.

### Trader profile page

- [ ] Show address, ENS if available, labels, first seen, and last active.
- [ ] Show official/comparison/estimated PNL clearly separated.
- [ ] Show open positions.
- [ ] Show closed positions and hold time.
- [ ] Show activity timeline.
- [ ] Show behavior tags with evidence and explanations.
- [ ] Show risk score and insufficient-data states.

### Position detail page

- [ ] Show position header, lifecycle, collateral/debt snapshots, tick movements, transactions, owner transfers, and risk history.

### Methodology page

- [ ] Document data sources.
- [ ] Document PNL fields and definitions.
- [ ] Document ROI formula.
- [ ] Document risk formula.
- [ ] Document behavior tag rules.
- [ ] Document known limitations and address confidence levels.

## P0 — Testing blockers

- [ ] Add unit tests for `normalizeLeaderboardWallet`.
- [ ] Add unit tests for `normalizePositionEvent`.
- [ ] Add unit tests for `inferActionType`.
- [ ] Add unit tests for `computeEstimatedRoi`.
- [ ] Add unit tests for `computeWinRate`.
- [ ] Add unit tests for `computeHoldTime`.
- [ ] Add unit tests for `computeDrawdown`.
- [ ] Add unit tests for `computeRiskScore`.
- [ ] Add unit tests for `computeTraderTags`.
- [ ] Add fixture files for Smartclaw leaderboard responses.
- [ ] Add fixture files for official leaderboard responses if endpoint is available.
- [ ] Add fixture files for subgraph `PositionAction` responses.
- [ ] Add fixture files for RPC `getPosition` reads.
- [ ] Add integration tests for snapshot ingestion idempotency.
- [ ] Add integration tests for subgraph sync idempotency.
- [ ] Add integration tests for RPC fallback behavior.
- [ ] Add integration tests for deterministic tag generation.
- [ ] Add API pagination tests.
- [ ] Add CI workflow running install, build, lint/typecheck, and tests.

## P1 — Beta hardening

- [ ] Add ENS resolution and caching.
- [ ] Add explorer links for wallets, positions, and transactions.
- [ ] Add data-quality badges per wallet and position.
- [ ] Add admin-only job status page.
- [ ] Add stale job alerting via Discord/Telegram/email.
- [ ] Add API response caching strategy.
- [ ] Add Postgres connection pooling if using serverless or many concurrent workers.
- [ ] Add backup restore drill documentation.
- [ ] Add sample screenshots to README once UI is populated.
- [ ] Add a public changelog.

## P2 — Post-MVP ideas

- [ ] Add charts for cumulative PNL, daily volume, risk score, and drawdown.
- [ ] Add position lifecycle Gantt/timeline visualizations.
- [ ] Add more nuanced behavior tags.
- [ ] Add configurable market filters.
- [ ] Add optional ClickHouse analytics backend if Postgres becomes a bottleneck.
- [ ] Add optional alerts after public MVP is stable.
- [ ] Add mobile-friendly layouts.

## Manual pre-ship checklist

Run before any public deployment:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm db:push
pnpm discover:contracts
pnpm worker:snapshot-leaderboard --source smartclaw --limit 20
pnpm worker:sync-subgraph --page-size 20
pnpm worker:enrich-positions --limit 20
scripts/self-host-monitor.sh
```

Also verify:

- [ ] `/api/health` reports database OK.
- [ ] `/api/health` reports subgraph configured and not stale.
- [ ] Cron jobs show recent successful `job_runs`.
- [ ] Backups exist and one restore has been tested.
- [ ] No private endpoints or API keys are committed.
- [ ] Every PNL value in UI is labeled official, comparison, or estimated.
- [ ] Methodology page is linked from dashboard pages.
