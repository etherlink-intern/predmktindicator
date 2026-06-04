# Local Envio Indexer

This package contains the local Envio HyperIndex scaffold for the f(x) trader profile pipeline.

## Current status

The current indexer is a bounded Ethereum mainnet f(x) Protocol starter indexer.

It indexes all verified current f(x) position pools — WstETH/WBTC across Long/Short — from blocks `23678000..23694600` through the local RPC router. This proves that the local stack works end-to-end on real f(x) position-transfer activity across every current collateral/side pair:

- `rpc-router` resolves inside Docker as `http://rpc-router:8545`
- Envio writes f(x) entities into its own Postgres database
- Hasura exposes the indexed f(x) entities over GraphQL

The current bounded window captures compact recent windows with observed position NFT `Transfer` activity for WstETHLongPool, WBTCLongPool, WstETHShortPool, and WBTCShortPool.

Verified contract targets live in `contracts/fx-v2.json`.

## Ports

The Envio stack intentionally avoids host port `8080` because this host already uses it for Dozzle.

- Hasura: `http://127.0.0.1:8088`
- Envio Postgres: `127.0.0.1:5438`
- Envio indexer HTTP port, while running: `127.0.0.1:9898`
- RPC router: `http://127.0.0.1:18545`

Inside Docker, the indexer uses `http://rpc-router:8545`.

## Commands

From the repository root:

```bash
pnpm indexer:codegen
pnpm indexer:build
pnpm indexer:test
pnpm indexer:dev
pnpm indexer:reset
pnpm indexer:verify
pnpm indexer:ps
pnpm indexer:logs
pnpm indexer:down
```

`pnpm indexer:dev` uses:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.indexer.yml up -d --build rpc-router envio-postgres envio-hasura envio-indexer
```

The f(x) starter indexer has an `end_block`, so it exits with code `0` after catching up. That is expected. `envio-indexer` uses `restart: on-failure` so successful completion does not restart-loop.

If `config.yaml` or `schema.graphql` changes incompatibly with existing local Envio storage, reset the bounded local indexer data and rerun:

```bash
pnpm indexer:reset
```

`pnpm indexer:codegen` regenerates `.envio/` generated types from `config.yaml` and `schema.graphql`. The `.envio/` directory is intentionally ignored, so run codegen before local typecheck/tests after a fresh clone or config/schema change.

`pnpm indexer:verify` checks the bounded f(x) run by validating container state, Hasura health, expected Postgres row counts, and a Hasura GraphQL query.

## Query f(x) data

Hasura requires the local admin secret from the ignored `.env` file.

Example GraphQL query:

```graphql
query {
  FxContract(limit: 10, order_by: { id: asc }) {
    id
    name
    category
    side
    collateral
    observedEventCount
  }
  FxEvent(limit: 20, order_by: [{ blockNumber: asc }, { logIndex: asc }]) {
    id
    eventName
    blockNumber
    transactionHash
    contract { id name }
  }
  FxPositionTransfer(limit: 20, order_by: { id: asc }) {
    id
    tokenId
    from
    to
  }
}
```

## Next step for deeper f(x) indexing

The bounded starter indexer proves real f(x) indexing. The next product step is to expand from lifecycle/proxy events into the business events that power trader profiles:

1. Add manager/pool/router event handlers from `contracts/abis/*.events.json`.
2. Select a bounded historical window with actual position open/close/add/remove activity.
3. Add entities for trader addresses, position IDs, collateral/debt deltas, and pool snapshots.
4. Remove the bounded `end_block` only when ready for a real continuous indexer.
