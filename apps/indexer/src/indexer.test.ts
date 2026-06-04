import { describe, it, expect } from "vitest";
import { createTestIndexer, TestHelpers, type FxContract } from "envio";

const { Addresses } = TestHelpers;

const WSTETH_LONG_POOL = "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8";
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
});
