# Local Envio Indexer

This package contains the local Envio HyperIndex scaffold for the f(x) trader profile pipeline.

## Current status

The current indexer is a bounded Ethereum mainnet ERC-20 smoke indexer, not the final f(x) product indexer.

It indexes two UNI `Transfer` events from blocks `10861674..10861766` through the local RPC router. This proves that the local stack works end-to-end:

- `rpc-router` resolves inside Docker as `http://rpc-router:8545`
- Envio writes entities into its own Postgres database
- Hasura exposes the indexed entities over GraphQL

The real f(x) indexer should replace this smoke target only after verified f(x) contract addresses, start blocks, ABIs, and target events are pinned in `contracts/fx-v2.json`.

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
pnpm indexer:verify
pnpm indexer:ps
pnpm indexer:logs
pnpm indexer:down
```

`pnpm indexer:dev` uses:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.indexer.yml up -d --build rpc-router envio-postgres envio-hasura envio-indexer
```

The smoke indexer has an `end_block`, so it exits with code `0` after catching up. That is expected. `envio-indexer` uses `restart: on-failure` so successful completion does not restart-loop.

`pnpm indexer:codegen` regenerates `.envio/` generated types from `config.yaml` and `schema.graphql`. The `.envio/` directory is intentionally ignored, so run codegen before local typecheck/tests after a fresh clone or config/schema change.

`pnpm indexer:verify` checks the bounded smoke run by validating container state, Hasura health, expected Postgres row counts, and a Hasura GraphQL query.

## Query smoke data

Hasura requires the local admin secret from the ignored `.env` file.

Example GraphQL query:

```graphql
query {
  SmokeTransfer(limit: 5, order_by: { id: asc }) {
    id
    value
  }
  SmokeAccount(limit: 5, order_by: { id: asc }) {
    id
    balance
    sentTransferCount
    receivedTransferCount
  }
}
```

## Next step for real f(x) indexing

Do not guess contract addresses. Complete contract discovery first:

1. Verify f(x) v2 contract addresses and proxy targets from official docs/repos/explorers.
2. Save the manifest to `contracts/fx-v2.json`.
3. Save reviewed ABIs under `contracts/abis/`.
4. Replace `ERC20Smoke` with f(x) contracts/events in `config.yaml`.
5. Remove the smoke `end_block` only when running a real continuous indexer.
