# f(x) Protocol Contract Discovery

Discovery date: 2026-06-04

## Purpose

This document pins the f(x) Protocol contracts that are safe to use for the first real Envio indexing pass for the trader-profile product.

The previous Envio scaffold indexed a bounded UNI ERC-20 smoke range only. This discovery pass replaced the unknown-contract blocker with a verified manifest, and the local Envio scaffold now uses a bounded f(x) deployment-window starter pass.

## Sources used

Official / primary sources:

- AladdinDAO f(x) contract docs: `https://docs.aladdin.club/f-x-protocol/contracts`
- AladdinDAO f(x) contracts repo: `https://github.com/AladdinDAO/fx-protocol-contracts`
- AladdinDAO deployment index: `https://github.com/AladdinDAO/deployments/blob/main/deployments.mainnet.md`

Local verification sources:

- Ignition deployment JSON files under `fx-protocol-contracts/ignition/deployments/**/deployed_addresses.json`
- Ignition deployment journals under `fx-protocol-contracts/ignition/deployments/**/journal.jsonl`
- Solidity interface/event source under `fx-protocol-contracts/contracts/**`
- Local RPC router at `http://127.0.0.1:18545` for:
  - `eth_getCode` non-empty checks
  - deployment transaction receipt blocks where the Ignition journal records a transaction hash

## Manifest

The committed manifest is:

- `contracts/fx-v2.json`

It records:

- chain id
- address
- contract/source name
- start block
- deployment transaction hash when available
- ABI event snippet path
- intended events
- evidence strings
- excluded candidates

The event ABI snippets are under:

- `contracts/abis/`

These are intentionally minimal event-only ABIs for indexing. They are not full contract ABIs.

## Active index targets

These targets have official repo provenance, non-empty code at the recorded address, and a start block tied to a deployment transaction receipt.

| Name | Category | Address | Start block | Event focus |
| --- | --- | --- | ---: | --- |
| LongPoolManager | position-manager / long | `0x250893CA4Ba5d05626C785e8da758026928FCD24` | 21529341 | `Operate`, `Redeem`, `RegisterPool` |
| ShortPoolManager | position-manager / short | `0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D` | 22953721 | `Operate`, `Rebalance`, `Liquidate`, credit-note redemptions |
| WstETHLongPool | position-pool / long | `0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8` | 21529392 | ERC-721 `Transfer`, `PositionSnapshot`, `TickMovement`, index snapshots |
| WBTCLongPool | position-pool / long | `0xAB709e26Fa6B0A30c119D8c55B887DeD24952473` | 22067306 | ERC-721 `Transfer`, `PositionSnapshot`, `TickMovement`, index snapshots |
| WstETHShortPool | position-pool / short | `0x25707b9e6690B52C60aE6744d711cf9C1dFC1876` | 22953759 | ERC-721 `Transfer`, `PositionSnapshot`, `TickMovement`, index snapshots |
| WBTCShortPool | position-pool / short | `0xA0cC8162c523998856D59065fAa254F87D20A5b0` | 22995917 | ERC-721 `Transfer`, `PositionSnapshot`, `TickMovement`, index snapshots |
| RouterDiamond | router | `0x33636D49FbefBE798e15e7F356E8DBef543CC708` | 21529417 | router-level `Operate`, archived flash-loan `OpenOrAdd` / `CloseOrRemove` |
| FxMintRouter | router | `0xB753366082466c4B5984312f0c4Bb97554be067E` | 23687207 | router-level `Operate` |
| LimitOrderManager | limit-order | `0x112873b395B98287F3A4db266a58e2D01779Ad96` | 23576162 | `FillOrder`, `CancelOrder`, nonce advancement |
| FxUSDBasePool | stable-base-pool | `0x65C9A641afCEB9C0E6034e558A319488FA0FA3be` | 21529341 | deposit/redeem/rebalance/arbitrage flows |
| PoolConfiguration | configuration | `0x16b334f2644cc00b85DB1A1efF0C2C395e00C28d` | 22953677 | funding/fee/snapshot configuration |

## Why these targets matter for trader profiles

The product needs wallet-level position behavior, not just aggregate protocol stats. The core data model should be derived from:

1. Pool ERC-721 `Transfer` events to identify position ownership over time.
2. Pool `PositionSnapshot` and `TickMovement` events to track collateral/debt state changes and risk movement.
3. Manager `Operate`, `Redeem`, `Rebalance`, and `Liquidate` events to classify wallet actions.
4. Router events to recover the user/caller address when manager events only show pool + position.
5. Limit-order events to capture off-chain order lifecycle and fills where applicable.
6. Pool-configuration snapshots to contextualize funding and fee regimes.

## Reference-only legacy market contracts

The manifest also records legacy/current docs table references such as fToken/xToken market addresses. They are not active Envio targets yet because the trader-profile MVP should first index xPosition-style long/short positions.

Reference-only examples in the manifest include:

- `fETH`
- `xETH`
- `WstETHMarket`
- `SfrxETHMarket`
- `FXN`

These can be promoted later if the dashboard needs historical fToken/xToken mint/redeem behavior.

## Explicit exclusion

An Etherscan search result exposed:

- `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` labeled `PositionManager`

That address was not found in the official AladdinDAO deployment docs or the `fx-protocol-contracts` repo search during this pass. It is recorded in `excludedCandidates` and must not be used for f(x) indexing until independently tied to the protocol.

## Verification

Run from repo root:

```bash
pnpm contracts:verify
```

The script validates:

- manifest JSON parses
- every active target address is a valid Ethereum address
- every active target has a positive start block
- every ABI path exists and contains the listed events
- every active target has non-empty bytecode at `latest`
- every recorded deployment transaction receipt exists, succeeded, and matches the manifest start block

Default RPC verification order:

1. `RPC_ROUTER_URL`, if set
2. `ETHEREUM_RPC_URL`, if set and `RPC_ROUTER_URL` is unset
3. `http://127.0.0.1:18545`
4. `https://ethereum-rpc.publicnode.com`
5. `https://eth.drpc.org`
6. `https://rpc.mevblocker.io`

The verifier tries multiple endpoints because some public RPCs return `null` for historical receipts even when they pass ordinary health checks.

Override all verification RPC URLs with a comma-separated list:

```bash
FX_CONTRACT_VERIFY_RPC_URLS=https://your-rpc-1.example,https://your-rpc-2.example pnpm contracts:verify
```

## Remaining caveats before switching Envio to f(x)

- The f(x) indexer still needs a schema and handlers for normalized position events.
- Router/manager/pool event joins must be tested against real transaction samples.
- Full historical backfill may stress free public RPCs; use bounded ranges first.
- Legacy fToken/xToken market references are not yet production index targets.
- The official leaderboard/API source is still a separate discovery/scraper task.
