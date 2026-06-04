import { describe, it, expect } from "vitest";
import { createTestIndexer, TestHelpers, type FxContract } from "envio";

const { Addresses } = TestHelpers;

const WSTETH_LONG_POOL = "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8";
const WBTC_LONG_POOL = "0xAB709e26Fa6B0A30c119D8c55B887DeD24952473";
const WSTETH_SHORT_POOL = "0x25707b9e6690B52C60aE6744d711cf9C1dFC1876";
const WBTC_SHORT_POOL = "0xA0cC8162c523998856D59065fAa254F87D20A5b0";
const LONG_POOL_MANAGER = "0x250893CA4Ba5d05626C785e8da758026928FCD24";
const SHORT_POOL_MANAGER = "0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D";
const FX_MINT_ROUTER = "0xB753366082466c4B5984312f0c4Bb97554be067E";

describe("f(x) event indexer handlers", () => {
  it("records manager Operate cashflow events and updates contract observation metadata", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "FxLongPoolManager",
              event: "Operate",
              srcAddress: LONG_POOL_MANAGER,
              logIndex: 317,
              block: { number: 21529341, timestamp: 1735480000 },
              transaction: { hash: "0xf091a88d5fc3e5ffea9111bb9fc4b4b6637e2df0715f116b2e96de95486d33b3" },
              params: {
                pool: WSTETH_LONG_POOL,
                position: 42n,
                deltaColls: 1000n,
                deltaDebts: 700n,
                protocolFees: 3n,
              },
            },
          ],
        },
      },
    });

    const contract = await indexer.FxContract.getOrThrow(LONG_POOL_MANAGER.toLowerCase());
    const event = await indexer.FxEvent.getOrThrow("1:21529341:317");
    const cashflow = await indexer.FxPositionCashflow.getOrThrow(
      "0xf091a88d5fc3e5ffea9111bb9fc4b4b6637e2df0715f116b2e96de95486d33b3:317",
    );

    expect(contract).toMatchObject({
      name: "LongPoolManager",
      category: "position-manager",
      observedEventCount: 1,
      firstObservedBlock: 21529341,
      lastObservedBlock: 21529341,
    } satisfies Partial<FxContract>);
    expect(event).toMatchObject({
      contract_id: LONG_POOL_MANAGER.toLowerCase(),
      eventName: "Operate",
      blockNumber: 21529341,
      transactionHash: "0xf091a88d5fc3e5ffea9111bb9fc4b4b6637e2df0715f116b2e96de95486d33b3",
      logIndex: 317n,
    });
    expect(cashflow).toMatchObject({
      source: "manager",
      eventName: "Operate",
      pool: WSTETH_LONG_POOL.toLowerCase(),
      positionId: 42n,
      deltaColls: 1000n,
      deltaDebts: 700n,
      collateralInRaw: 1000n,
      collateralOutRaw: 0n,
      debtIncreaseRaw: 700n,
      debtDecreaseRaw: 0n,
      feeRaw: 3n,
    });
  });

  it("records router Operate events with the user field", async () => {
    const indexer = createTestIndexer();
    const user = Addresses.mockAddresses[3]!;

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "FxRouter",
              event: "Operate",
              srcAddress: FX_MINT_ROUTER,
              logIndex: 18,
              block: { number: 23687220, timestamp: 1761800000 },
              transaction: { hash: "0x975da520126448e67a3671ba2454a631dea74a7f5b1a6aa6d4f76fb176b8daff" },
              params: {
                pool: WBTC_LONG_POOL,
                user,
                positionId: 7n,
                deltaColls: -50n,
                deltaDebts: -25n,
              },
            },
          ],
        },
      },
    });

    const cashflow = await indexer.FxPositionCashflow.getOrThrow(
      "0x975da520126448e67a3671ba2454a631dea74a7f5b1a6aa6d4f76fb176b8daff:18",
    );

    expect(cashflow).toMatchObject({
      source: "router",
      pool: WBTC_LONG_POOL.toLowerCase(),
      user: user.toLowerCase(),
      positionId: 7n,
      collateralInRaw: 0n,
      collateralOutRaw: 50n,
      debtIncreaseRaw: 0n,
      debtDecreaseRaw: 25n,
    });
  });

  it("records f(x) pool position Transfer and PositionSnapshot events", async () => {
    const indexer = createTestIndexer();
    const from = Addresses.mockAddresses[1]!;
    const to = Addresses.mockAddresses[2]!;

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "FxPositionPool",
              event: "Transfer",
              srcAddress: WSTETH_LONG_POOL,
              logIndex: 12,
              block: { number: 21529400, timestamp: 1735481000 },
              transaction: { hash: "0x1111111111111111111111111111111111111111111111111111111111111111" },
              params: { from, to, tokenId: 42n },
            },
            {
              contract: "FxPositionPool",
              event: "PositionSnapshot",
              srcAddress: WSTETH_LONG_POOL,
              logIndex: 13,
              block: { number: 21529401, timestamp: 1735481012 },
              transaction: { hash: "0x2222222222222222222222222222222222222222222222222222222222222222" },
              params: { position: 42n, tick: 12n, collShares: 100n, debtShares: 70n, price: 1777n },
            },
          ],
        },
      },
    });

    const contract = await indexer.FxContract.getOrThrow(WSTETH_LONG_POOL.toLowerCase());
    const transfer = await indexer.FxPositionTransfer.getOrThrow("1:21529400:12");
    const snapshot = await indexer.FxPositionSnapshot.getOrThrow("1:21529401:13");

    expect(contract).toMatchObject({
      name: "WstETHLongPool",
      category: "position-pool",
      side: "long",
      collateral: "wstETH",
      observedEventCount: 2,
    });
    expect(transfer).toMatchObject({
      contract_id: WSTETH_LONG_POOL.toLowerCase(),
      pool: WSTETH_LONG_POOL.toLowerCase(),
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      tokenId: 42n,
    });
    expect(snapshot).toMatchObject({
      contract_id: WSTETH_LONG_POOL.toLowerCase(),
      pool: WSTETH_LONG_POOL.toLowerCase(),
      positionId: 42n,
      tick: 12,
      collShares: 100n,
      debtShares: 70n,
      price: 1777n,
    });
  });

  it("labels all current f(x) position pools by side and collateral", async () => {
    const indexer = createTestIndexer();
    const pools = [
      { address: WSTETH_LONG_POOL, expected: { name: "WstETHLongPool", side: "long", collateral: "wstETH" } },
      { address: WBTC_LONG_POOL, expected: { name: "WBTCLongPool", side: "long", collateral: "WBTC" } },
      { address: WSTETH_SHORT_POOL, expected: { name: "WstETHShortPool", side: "short", collateral: "wstETH" } },
      { address: WBTC_SHORT_POOL, expected: { name: "WBTCShortPool", side: "short", collateral: "WBTC" } },
    ] as const;

    await indexer.process({
      chains: {
        1: {
          simulate: pools.map((pool, index) => ({
            contract: "FxPositionPool" as const,
            event: "Transfer" as const,
            srcAddress: pool.address,
            logIndex: index + 1,
            block: { number: 23688000 + index, timestamp: 1761800000 + index },
            transaction: { hash: `0x${String(index + 1).padStart(64, "0")}` as `0x${string}` },
            params: {
              from: Addresses.mockAddresses[1]!,
              to: Addresses.mockAddresses[2]!,
              tokenId: BigInt(index + 1),
            },
          })),
        },
      },
    });

    for (const pool of pools) {
      const contract = await indexer.FxContract.getOrThrow(pool.address.toLowerCase());
      expect(contract).toMatchObject({
        ...pool.expected,
        category: "position-pool",
        observedEventCount: 1,
      });
    }
  });

  it("records short manager liquidation and rebalance events", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "FxShortPoolManager",
              event: "Liquidate",
              srcAddress: SHORT_POOL_MANAGER,
              logIndex: 22,
              block: { number: 22996000, timestamp: 1761810000 },
              transaction: { hash: "0x3333333333333333333333333333333333333333333333333333333333333333" },
              params: { pool: WBTC_SHORT_POOL, colls: 100n, debts: 80n },
            },
            {
              contract: "FxShortPoolManager",
              event: "RebalanceTick",
              srcAddress: SHORT_POOL_MANAGER,
              logIndex: 23,
              block: { number: 22996001, timestamp: 1761810012 },
              transaction: { hash: "0x4444444444444444444444444444444444444444444444444444444444444444" },
              params: { pool: WBTC_SHORT_POOL, tick: -5n, colls: 10n, debts: 8n },
            },
          ],
        },
      },
    });

    const liquidate = await indexer.FxLiquidateEvent.getOrThrow("1:22996000:22");
    const rebalance = await indexer.FxRebalanceEvent.getOrThrow("1:22996001:23");

    expect(liquidate).toMatchObject({ pool: WBTC_SHORT_POOL.toLowerCase(), colls: 100n, debts: 80n });
    expect(rebalance).toMatchObject({ eventName: "RebalanceTick", pool: WBTC_SHORT_POOL.toLowerCase(), tick: -5 });
  });
});
