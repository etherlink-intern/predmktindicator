import { indexer, type SmokeAccount, type SmokeTransfer } from "envio";

function normalizeAddress(address: unknown): string {
  return String(address).toLowerCase();
}

function transferId(from: string, to: string, value: bigint): string {
  return `${from}-${to}-${value.toString()}`;
}

async function getAccount(context: Parameters<Parameters<typeof indexer.onEvent>[1]>[0]["context"], id: string): Promise<SmokeAccount> {
  const existing = await context.SmokeAccount.get(id);
  return existing ?? {
    id,
    balance: 0n,
    sentTransferCount: 0,
    receivedTransferCount: 0,
  };
}

indexer.onEvent(
  { contract: "ERC20Smoke", event: "Transfer" },
  async ({ event, context }) => {
    const from = normalizeAddress(event.params.from);
    const to = normalizeAddress(event.params.to);
    const value = event.params.value;

    const fromAccount = await getAccount(context, from);
    const toAccount = await getAccount(context, to);

    context.SmokeAccount.set({
      ...fromAccount,
      balance: fromAccount.balance - value,
      sentTransferCount: fromAccount.sentTransferCount + 1,
    });

    context.SmokeAccount.set({
      ...toAccount,
      balance: toAccount.balance + value,
      receivedTransferCount: toAccount.receivedTransferCount + 1,
    });

    const transfer: SmokeTransfer = {
      id: transferId(from, to, value),
      from_id: from,
      to_id: to,
      value,
    };
    context.SmokeTransfer.set(transfer);
  },
);
