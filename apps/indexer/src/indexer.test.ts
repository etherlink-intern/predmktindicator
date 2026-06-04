import { describe, it, expect } from "vitest";
import { createTestIndexer, TestHelpers, type SmokeAccount } from "envio";

const { Addresses } = TestHelpers;

describe("ERC20 smoke handlers", () => {
  it("moves balances and writes a transfer for a simulated Transfer event", async () => {
    const indexer = createTestIndexer();
    const from = Addresses.mockAddresses[0]!;
    const to = Addresses.mockAddresses[1]!;

    const initialFrom: SmokeAccount = {
      id: from.toLowerCase(),
      balance: 10n,
      sentTransferCount: 0,
      receivedTransferCount: 0,
    };
    indexer.SmokeAccount.set(initialFrom);

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "ERC20Smoke",
              event: "Transfer",
              params: {
                from,
                to,
                value: 3n,
              },
            },
          ],
        },
      },
    });

    const fromAccount = await indexer.SmokeAccount.getOrThrow(from.toLowerCase());
    const toAccount = await indexer.SmokeAccount.getOrThrow(to.toLowerCase());
    const transfer = await indexer.SmokeTransfer.getOrThrow(
      `${from.toLowerCase()}-${to.toLowerCase()}-3`,
    );

    expect(fromAccount).toMatchObject({
      balance: 7n,
      sentTransferCount: 1,
      receivedTransferCount: 0,
    });
    expect(toAccount).toMatchObject({
      balance: 3n,
      sentTransferCount: 0,
      receivedTransferCount: 1,
    });
    expect(transfer).toMatchObject({
      from_id: from.toLowerCase(),
      to_id: to.toLowerCase(),
      value: 3n,
    });
  });
});
