import {
  indexer,
  type FxContract,
  type FxEvent,
  type FxLiquidateEvent,
  type FxPoolIndexEvent,
  type FxPositionCashflow,
  type FxPositionSnapshot,
  type FxPositionTransfer,
  type FxRebalanceEvent,
  type FxRedeemEvent,
  type FxTickMovement,
} from "envio";

const ZERO = 0n;

const CONTRACT_METADATA: Record<string, { name: string; category: string; side?: string; collateral?: string }> = {
  "0x250893ca4ba5d05626c785e8da758026928fcd24": {
    name: "LongPoolManager",
    category: "position-manager",
    side: "long",
  },
  "0xacdc0ab51178d0ae8f70c1ead7d3cf5421fdd66d": {
    name: "ShortPoolManager",
    category: "position-manager",
    side: "short",
  },
  "0x6ecfa38fee8a5277b91efda204c235814f0122e8": {
    name: "WstETHLongPool",
    category: "position-pool",
    side: "long",
    collateral: "wstETH",
  },
  "0xab709e26fa6b0a30c119d8c55b887ded24952473": {
    name: "WBTCLongPool",
    category: "position-pool",
    side: "long",
    collateral: "WBTC",
  },
  "0x25707b9e6690b52c60ae6744d711cf9c1dfc1876": {
    name: "WstETHShortPool",
    category: "position-pool",
    side: "short",
    collateral: "wstETH",
  },
  "0xa0cc8162c523998856d59065faa254f87d20a5b0": {
    name: "WBTCShortPool",
    category: "position-pool",
    side: "short",
    collateral: "WBTC",
  },
  "0x33636d49fbefbe798e15e7f356e8dbef543cc708": {
    name: "RouterDiamond",
    category: "router",
  },
  "0xb753366082466c4b5984312f0c4bb97554be067e": {
    name: "FxMintRouter",
    category: "router",
  },
};

type EntityStore<T> = {
  get?: (id: string) => Promise<T | undefined>;
  set: (entity: T) => void;
};

type FxContext = {
  FxContract: Required<Pick<EntityStore<FxContract>, "get" | "set">>;
  FxEvent: EntityStore<FxEvent>;
  FxPositionTransfer: EntityStore<FxPositionTransfer>;
  FxPositionCashflow: EntityStore<FxPositionCashflow>;
  FxRedeemEvent: EntityStore<FxRedeemEvent>;
  FxLiquidateEvent: EntityStore<FxLiquidateEvent>;
  FxRebalanceEvent: EntityStore<FxRebalanceEvent>;
  FxPoolIndexEvent: EntityStore<FxPoolIndexEvent>;
  FxPositionSnapshot: EntityStore<FxPositionSnapshot>;
  FxTickMovement: EntityStore<FxTickMovement>;
};

type FxBaseEvent = {
  chainId: number;
  eventName: string;
  srcAddress: string;
  block: { number: number; timestamp: number };
  transaction: { hash?: string; from?: string; to?: string };
  logIndex: number;
  params: Record<string, unknown>;
};

function normalizeAddress(address: unknown): string {
  return String(address ?? "").toLowerCase();
}

function eventId(event: Pick<FxBaseEvent, "chainId" | "block" | "logIndex">): string {
  return `${event.chainId}:${event.block.number}:${event.logIndex}`;
}

function transactionHash(event: FxBaseEvent): string {
  return String(event.transaction.hash ?? "");
}

function optionalTxAddress(value: unknown): string | undefined {
  const normalized = normalizeAddress(value);
  return normalized ? normalized : undefined;
}

function bigIntParam(event: FxBaseEvent, key: string): bigint {
  const value = event.params[key];
  if (value === null || value === undefined) return ZERO;
  return BigInt(value as bigint | number | string);
}

function maybeBigIntParam(event: FxBaseEvent, key: string): bigint | undefined {
  if (!(key in event.params) || event.params[key] === null || event.params[key] === undefined) return undefined;
  return bigIntParam(event, key);
}

function signedFlow(value: bigint) {
  return {
    positive: value > ZERO ? value : ZERO,
    negative: value < ZERO ? -value : ZERO,
  };
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
    side: metadata.side,
    collateral: metadata.collateral,
    observedEventCount: (existing?.observedEventCount ?? 0) + 1,
    firstObservedBlock,
    lastObservedBlock,
  };
  context.FxContract.set(contract);
  return contract;
}

async function recordFxEvent(context: FxContext, event: FxBaseEvent): Promise<FxContract> {
  const contract = await upsertContract(context, event);
  const entity: FxEvent = {
    id: eventId(event),
    contract_id: contract.id,
    eventName: event.eventName,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: transactionHash(event),
    transactionFrom: optionalTxAddress(event.transaction.from),
    transactionTo: optionalTxAddress(event.transaction.to),
    logIndex: BigInt(event.logIndex),
  };
  context.FxEvent.set(entity);
  return contract;
}

async function recordPositionTransfer(context: FxContext, event: FxBaseEvent) {
  const contract = await recordFxEvent(context, event);
  const transfer: FxPositionTransfer = {
    id: eventId(event),
    contract_id: contract.id,
    pool: normalizeAddress(event.srcAddress),
    tokenId: bigIntParam(event, "tokenId"),
    from: normalizeAddress(event.params.from),
    to: normalizeAddress(event.params.to),
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: transactionHash(event),
    logIndex: BigInt(event.logIndex),
  };
  context.FxPositionTransfer.set(transfer);
}

type CashflowBase = Omit<
  FxPositionCashflow,
  "id" | "deltaColls" | "deltaDebts" | "collateralInRaw" | "collateralOutRaw" | "debtIncreaseRaw" | "debtDecreaseRaw"
>;

function setCashflowFromSignedDeltas(base: CashflowBase, deltaColls: bigint, deltaDebts: bigint): FxPositionCashflow {
  const coll = signedFlow(deltaColls);
  const debt = signedFlow(deltaDebts);
  return {
    id: base.transactionHash ? `${base.transactionHash}:${base.logIndex}` : `${base.blockNumber}:${base.logIndex}`,
    ...base,
    deltaColls,
    deltaDebts,
    collateralInRaw: coll.positive,
    collateralOutRaw: coll.negative,
    debtIncreaseRaw: debt.positive,
    debtDecreaseRaw: debt.negative,
  };
}

async function recordManagerOperate(context: FxContext, event: FxBaseEvent) {
  const contract = await recordFxEvent(context, event);
  const deltaColls = bigIntParam(event, "deltaColls");
  const deltaDebts = bigIntParam(event, "deltaDebts");
  const protocolFees = bigIntParam(event, "protocolFees");
  context.FxPositionCashflow.set(
    setCashflowFromSignedDeltas(
      {
        contract_id: contract.id,
        source: "manager",
        eventName: event.eventName,
        pool: normalizeAddress(event.params.pool),
        positionId: bigIntParam(event, "position"),
        user: undefined,
        recipient: undefined,
        colls: undefined,
        debts: undefined,
        borrows: undefined,
        protocolFees,
        feeRaw: protocolFees,
        blockNumber: event.block.number,
        blockTimestamp: event.block.timestamp,
        transactionHash: transactionHash(event),
        transactionFrom: optionalTxAddress(event.transaction.from),
        logIndex: BigInt(event.logIndex),
      },
      deltaColls,
      deltaDebts,
    ),
  );
}

async function recordRouterOperate(context: FxContext, event: FxBaseEvent) {
  const contract = await recordFxEvent(context, event);
  context.FxPositionCashflow.set(
    setCashflowFromSignedDeltas(
      {
        contract_id: contract.id,
        source: "router",
        eventName: event.eventName,
        pool: normalizeAddress(event.params.pool),
        positionId: bigIntParam(event, "positionId"),
        user: normalizeAddress(event.params.user),
        recipient: undefined,
        colls: undefined,
        debts: undefined,
        borrows: undefined,
        protocolFees: undefined,
        feeRaw: ZERO,
        blockNumber: event.block.number,
        blockTimestamp: event.block.timestamp,
        transactionHash: transactionHash(event),
        transactionFrom: optionalTxAddress(event.transaction.from),
        logIndex: BigInt(event.logIndex),
      },
      bigIntParam(event, "deltaColls"),
      bigIntParam(event, "deltaDebts"),
    ),
  );
}

async function recordRouterAction(context: FxContext, event: FxBaseEvent) {
  const contract = await recordFxEvent(context, event);
  const colls = bigIntParam(event, "colls");
  const debts = bigIntParam(event, "debts");
  const isClose = event.eventName === "CloseOrRemove";
  context.FxPositionCashflow.set({
    id: `${transactionHash(event)}:${event.logIndex}`,
    contract_id: contract.id,
    source: "router",
    eventName: event.eventName,
    pool: normalizeAddress(event.params.pool),
    positionId: bigIntParam(event, "position"),
    user: undefined,
    recipient: normalizeAddress(event.params.recipient),
    deltaColls: isClose ? -colls : colls,
    deltaDebts: isClose ? -debts : debts,
    colls,
    debts,
    borrows: bigIntParam(event, "borrows"),
    protocolFees: undefined,
    collateralInRaw: isClose ? ZERO : colls,
    collateralOutRaw: isClose ? colls : ZERO,
    debtIncreaseRaw: isClose ? ZERO : debts,
    debtDecreaseRaw: isClose ? debts : ZERO,
    feeRaw: ZERO,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: transactionHash(event),
    transactionFrom: optionalTxAddress(event.transaction.from),
    logIndex: BigInt(event.logIndex),
  });
}

async function recordRedeem(context: FxContext, event: FxBaseEvent) {
  const contract = await recordFxEvent(context, event);
  const protocolFees = maybeBigIntParam(event, "protocolFees");
  context.FxRedeemEvent.set({
    id: eventId(event),
    contract_id: contract.id,
    eventName: event.eventName,
    pool: normalizeAddress(event.params.pool),
    colls: bigIntParam(event, "colls"),
    debts: bigIntParam(event, "debts"),
    protocolFees,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: transactionHash(event),
    logIndex: BigInt(event.logIndex),
  });
}

async function recordLiquidate(context: FxContext, event: FxBaseEvent) {
  const contract = await recordFxEvent(context, event);
  context.FxLiquidateEvent.set({
    id: eventId(event),
    contract_id: contract.id,
    pool: normalizeAddress(event.params.pool),
    colls: bigIntParam(event, "colls"),
    debts: bigIntParam(event, "debts"),
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: transactionHash(event),
    logIndex: BigInt(event.logIndex),
  });
}

async function recordRebalance(context: FxContext, event: FxBaseEvent) {
  const contract = await recordFxEvent(context, event);
  context.FxRebalanceEvent.set({
    id: eventId(event),
    contract_id: contract.id,
    eventName: event.eventName,
    pool: normalizeAddress(event.params.pool),
    tick: event.params.tick === undefined ? undefined : Number(event.params.tick),
    colls: bigIntParam(event, "colls"),
    debts: bigIntParam(event, "debts"),
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: transactionHash(event),
    logIndex: BigInt(event.logIndex),
  });
}

async function recordPositionSnapshot(context: FxContext, event: FxBaseEvent) {
  const contract = await recordFxEvent(context, event);
  context.FxPositionSnapshot.set({
    id: eventId(event),
    contract_id: contract.id,
    pool: normalizeAddress(event.srcAddress),
    positionId: bigIntParam(event, "position"),
    tick: Number(event.params.tick ?? 0),
    collShares: bigIntParam(event, "collShares"),
    debtShares: bigIntParam(event, "debtShares"),
    price: bigIntParam(event, "price"),
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: transactionHash(event),
    logIndex: BigInt(event.logIndex),
  });
}

async function recordTickMovement(context: FxContext, event: FxBaseEvent) {
  const contract = await recordFxEvent(context, event);
  context.FxTickMovement.set({
    id: eventId(event),
    contract_id: contract.id,
    pool: normalizeAddress(event.srcAddress),
    oldTick: Number(event.params.oldTick ?? 0),
    newTick: Number(event.params.newTick ?? 0),
    collShares: bigIntParam(event, "collShares"),
    debtShares: bigIntParam(event, "debtShares"),
    price: bigIntParam(event, "price"),
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: transactionHash(event),
    logIndex: BigInt(event.logIndex),
  });
}

async function recordPoolIndexEvent(context: FxContext, event: FxBaseEvent) {
  const contract = await recordFxEvent(context, event);
  context.FxPoolIndexEvent.set({
    id: eventId(event),
    contract_id: contract.id,
    eventName: event.eventName,
    index: maybeBigIntParam(event, "index"),
    minDebtRatio: maybeBigIntParam(event, "minDebtRatio"),
    maxDebtRatio: maybeBigIntParam(event, "maxDebtRatio"),
    debtRatio: maybeBigIntParam(event, "debtRatio"),
    bonusRatio: maybeBigIntParam(event, "bonusRatio"),
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: transactionHash(event),
    logIndex: BigInt(event.logIndex),
  });
}

function on(contract: string, event: string, handler: (context: FxContext, event: FxBaseEvent) => Promise<unknown>) {
  (indexer.onEvent as unknown as (filter: { contract: string; event: string }, cb: (args: unknown) => Promise<void>) => void)(
    { contract, event },
    async (args: unknown) => {
      const { event: emitted, context } = args as { event: unknown; context: unknown };
    await handler(context as unknown as FxContext, emitted as unknown as FxBaseEvent);
    },
  );
}

for (const contract of ["FxLongPoolManager", "FxShortPoolManager"] as const) {
  on(contract, "RegisterPool", recordFxEvent);
  on(contract, "Operate", recordManagerOperate);
  for (const event of ["Redeem", "RedeemForSettle", "RedeemByCreditNote"] as const) on(contract, event, recordRedeem);
  on(contract, "Harvest", recordFxEvent);
  on(contract, "ReduceDebt", recordFxEvent);
}

on("FxShortPoolManager", "RebalanceTick", recordRebalance);
on("FxShortPoolManager", "Rebalance", recordRebalance);
on("FxShortPoolManager", "Liquidate", recordLiquidate);
on("FxShortPoolManager", "KillPool", recordFxEvent);
on("FxShortPoolManager", "SettleKillPool", recordFxEvent);

on("FxRouter", "Operate", recordRouterOperate);
on("FxRouter", "OpenOrAdd", recordRouterAction);
on("FxRouter", "CloseOrRemove", recordRouterAction);

on("FxPositionPool", "Transfer", recordPositionTransfer);
on("FxPositionPool", "PositionSnapshot", recordPositionSnapshot);
on("FxPositionPool", "TickMovement", recordTickMovement);
for (const event of [
  "DebtIndexSnapshot",
  "CollateralIndexSnapshot",
  "UpdateDebtRatioRange",
  "UpdateRebalanceRatios",
  "UpdateLiquidateRatios",
] as const) {
  on("FxPositionPool", event, recordPoolIndexEvent);
}
