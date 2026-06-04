import { indexer, type FxContract, type FxEvent, type FxPositionTransfer } from "envio";

const CONTRACT_METADATA: Record<string, { name: string; category: string }> = {
  "0x250893ca4ba5d05626c785e8da758026928fcd24": {
    name: "LongPoolManager",
    category: "position-manager",
  },
  "0x6ecfa38fee8a5277b91efda204c235814f0122e8": {
    name: "WstETHLongPool",
    category: "position-pool",
  },
  "0x33636d49fbefbe798e15e7f356e8dbef543cc708": {
    name: "RouterDiamond",
    category: "router",
  },
  "0x65c9a641afceb9c0e6034e558a319488fa0fa3be": {
    name: "FxUSDBasePool",
    category: "stable-base-pool",
  },
};

type FxContext = {
  FxContract: {
    get: (id: string) => Promise<FxContract | undefined>;
    set: (entity: FxContract) => void;
  };
  FxEvent: { set: (entity: FxEvent) => void };
  FxPositionTransfer: { set: (entity: FxPositionTransfer) => void };
};

type FxBaseEvent = {
  chainId: number;
  eventName: string;
  srcAddress: string;
  block: {
    number: number;
    timestamp: number;
  };
  transaction: {
    hash?: string;
  };
  logIndex: number;
};

type FxTransferEvent = FxBaseEvent & {
  params: {
    from: string;
    to: string;
    tokenId: bigint;
  };
};

function normalizeAddress(address: unknown): string {
  return String(address).toLowerCase();
}

function eventId(event: Pick<FxBaseEvent, "chainId" | "block" | "logIndex">): string {
  return `${event.chainId}:${event.block.number}:${event.logIndex}`;
}

function transactionHash(event: FxBaseEvent): string {
  return String(event.transaction.hash ?? "");
}

async function upsertContract(context: FxContext, event: FxBaseEvent): Promise<FxContract> {
  const id = normalizeAddress(event.srcAddress);
  const metadata = CONTRACT_METADATA[id] ?? { name: id, category: "unknown" };
  const existing = await context.FxContract.get(id);

  const firstObservedBlock = existing?.firstObservedBlock ?? event.block.number;
  const lastObservedBlock = existing?.lastObservedBlock
    ? Math.max(existing.lastObservedBlock, event.block.number)
    : event.block.number;

  const contract: FxContract = {
    id,
    name: metadata.name,
    category: metadata.category,
    observedEventCount: (existing?.observedEventCount ?? 0) + 1,
    firstObservedBlock,
    lastObservedBlock,
  };
  context.FxContract.set(contract);
  return contract;
}

async function recordFxEvent(context: FxContext, event: FxBaseEvent): Promise<void> {
  const contract = await upsertContract(context, event);
  const entity: FxEvent = {
    id: eventId(event),
    contract_id: contract.id,
    eventName: event.eventName,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: transactionHash(event),
    logIndex: event.logIndex,
  };
  context.FxEvent.set(entity);
}

for (const eventName of ["Upgraded", "AdminChanged", "OwnershipTransferred"] as const) {
  indexer.onEvent(
    { contract: "FxLifecycle", event: eventName },
    async ({ event, context }) => {
      await recordFxEvent(context, event);
    },
  );
}

indexer.onEvent(
  { contract: "FxLifecycle", event: "Transfer" },
  async ({ event, context }) => {
    const contract = await upsertContract(context, event);
    context.FxEvent.set({
      id: eventId(event),
      contract_id: contract.id,
      eventName: event.eventName,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: transactionHash(event),
      logIndex: event.logIndex,
    });

    const transfer: FxPositionTransfer = {
      id: eventId(event),
      contract_id: contract.id,
      tokenId: event.params.tokenId,
      from: normalizeAddress(event.params.from),
      to: normalizeAddress(event.params.to),
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: transactionHash(event),
      logIndex: event.logIndex,
    };
    context.FxPositionTransfer.set(transfer);
  },
);
