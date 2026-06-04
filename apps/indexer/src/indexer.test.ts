import { describe, it, expect } from "vitest";
import { createTestIndexer, TestHelpers, type FxContract } from "envio";

const { Addresses } = TestHelpers;

const WSTETH_LONG_POOL = "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8";
const WBTC_LONG_POOL = "0xAB709e26Fa6B0A30c119D8c55B887DeD24952473";
const WSTETH_SHORT_POOL = "0x25707b9e6690B52C60aE6744d711cf9C1dFC1876";
const WBTC_SHORT_POOL = "0xA0cC8162c523998856D59065fAa254F87D20A5b0";
const LONG_POOL_MANAGER = "0x250893CA4Ba5d05626C785e8da758026928FCD24";

describe("f(x) lifecycle handlers", () => {
  it("records a lifecycle event and updates contract observation metadata", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "FxLifecycle",
              event: "Upgraded",
              srcAddress: LONG_POOL_MANAGER,
              logIndex: 317,
              block: {
                number: 21529341,
                timestamp: 1735480000,
              },
              transaction: {
                hash: "0xf091a88d5fc3e5ffea9111bb9fc4b4b6637e2df0715f116b2e96de95486d33b3",
              },
              params: {
                implementation: Addresses.mockAddresses[0]!,
              },
            },
          ],
        },
      },
    });

    const contract = await indexer.FxContract.getOrThrow(LONG_POOL_MANAGER.toLowerCase());
    const event = await indexer.FxEvent.getOrThrow("1:21529341:317");

    expect(contract).toMatchObject({
      name: "LongPoolManager",
      category: "position-manager",
      observedEventCount: 1,
      firstObservedBlock: 21529341,
      lastObservedBlock: 21529341,
    } satisfies Partial<FxContract>);
    expect(event).toMatchObject({
      contract_id: LONG_POOL_MANAGER.toLowerCase(),
      eventName: "Upgraded",
      blockNumber: 21529341,
      transactionHash: "0xf091a88d5fc3e5ffea9111bb9fc4b4b6637e2df0715f116b2e96de95486d33b3",
      logIndex: 317,
    });
  });

  it("records f(x) pool position Transfer events", async () => {
    const indexer = createTestIndexer();
    const from = Addresses.mockAddresses[1]!;
    const to = Addresses.mockAddresses[2]!;

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "FxLifecycle",
              event: "Transfer",
              srcAddress: WSTETH_LONG_POOL,
              logIndex: 12,
              block: {
                number: 21529400,
                timestamp: 1735481000,
              },
              transaction: {
                hash: "0x975da520126448e67a3671ba2454a631dea74a7f5b1a6aa6d4f76fb176b8daff",
              },
              params: {
                from,
                to,
                tokenId: 42n,
              },
            },
          ],
        },
      },
    });

    const contract = await indexer.FxContract.getOrThrow(WSTETH_LONG_POOL.toLowerCase());
    const transfer = await indexer.FxPositionTransfer.getOrThrow("1:21529400:12");

    expect(contract).toMatchObject({
      name: "WstETHLongPool",
      category: "position-pool",
      side: "long",
      collateral: "wstETH",
      observedEventCount: 1,
    });
    expect(transfer).toMatchObject({
      contract_id: WSTETH_LONG_POOL.toLowerCase(),
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      tokenId: 42n,
      blockNumber: 21529400,
      logIndex: 12,
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
            contract: "FxLifecycle",
            event: "Transfer",
            srcAddress: pool.address,
            logIndex: index + 1,
            block: {
              number: 23688000 + index,
              timestamp: 1761800000 + index,
            },
            transaction: {
              hash: `0x${String(index + 1).padStart(64, "0")}` as `0x${string}`,
            },
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

});
