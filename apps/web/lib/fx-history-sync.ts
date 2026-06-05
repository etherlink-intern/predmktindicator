import type { Client } from "pg";
import { tableExists, upsertKnownWallet } from "./fx-wallet-maintenance";

type RunSqlResponse = {
  result_type?: string;
  result?: string[][];
  error?: string;
  path?: string;
  code?: string;
};

type SyncResult = {
  configured: boolean;
  transfers: number;
  cashflows: number;
  snapshots: number;
  officialPositions: number;
  officialOrders: number;
  walletsSeeded: number;
  sourceTables: Record<string, string | null>;
};

type OfficialPoolConfig = {
  key: string;
  endpoint: string;
  poolAddress: string;
  poolName: string;
  side: "long" | "short";
  collateral: "wstETH" | "WBTC";
  precision: number;
};

type OfficialPosition = {
  id: string;
  owner: string;
  realOwner?: string | null;
  isClosed: boolean;
  price?: string | null;
  priceRate?: string | null;
  debts?: string | null;
  colls?: string | null;
  blockNumber?: string | null;
  timestamp?: string | null;
  targetLeverage?: string | null;
  orders?: OfficialOrder[];
  latestOrders?: OfficialOrder[];
};

type OfficialOrder = {
  id: string;
  type: string;
  deltaColls?: string | null;
  deltaDebts?: string | null;
  execPrice?: string | null;
  logIndex?: string | null;
  positionColls?: string | null;
  positionDebts?: string | null;
  oldPositionColls?: string | null;
  oldPositionDebts?: string | null;
  price?: string | null;
  priceRate?: string | null;
  protocolFees?: string | null;
  hash?: string | null;
  timestamp?: string | null;
  blockNumber?: string | null;
  positionCollIndex?: string | null;
  positionDebtIndex?: string | null;
  tickMovement?: { price?: string | null; type?: string | null; typeLogIndex?: string | null } | null;
};

const OFFICIAL_POOLS: OfficialPoolConfig[] = [
  {
    key: "wstETH",
    endpoint: "https://fx.aladdin.club/ALCHEMY_HOST/fx-v2-wsteth/3.0.0/gn",
    poolAddress: "0x6ecfa38fee8a5277b91efda204c235814f0122e8",
    poolName: "WstETHLongPool",
    side: "long",
    collateral: "wstETH",
    precision: 1e18,
  },
  {
    key: "WBTC",
    endpoint: "https://fx.aladdin.club/ALCHEMY_HOST/fx-v2-wbtc/3.0.0/gn",
    poolAddress: "0xab709e26fa6b0a30c119d8c55b887ded24952473",
    poolName: "WBTCLongPool",
    side: "long",
    collateral: "WBTC",
    precision: 1e8,
  },
  {
    key: "wstETH_short",
    endpoint: "https://fx.aladdin.club/ALCHEMY_HOST/fx-v2-wsteth-short-backup/v2.0.0/gn",
    poolAddress: "0x25707b9e6690b52c60ae6744d711cf9c1dfc1876",
    poolName: "WstETHShortPool",
    side: "short",
    collateral: "wstETH",
    precision: 1e18,
  },
  {
    key: "WBTC_short",
    endpoint: "https://fx.aladdin.club/ALCHEMY_HOST/fx-v2-wbtc-short/v2.0.0/gn",
    poolAddress: "0xa0cc8162c523998856d59065faa254f87d20a5b0",
    poolName: "WBTCShortPool",
    side: "short",
    collateral: "WBTC",
    precision: 1e8,
  },
];

const tableCandidates = {
  transfers: ['public."FxPositionTransfer"', 'envio."FxPositionTransfer"'],
  cashflows: ['public."FxPositionCashflow"', 'envio."FxPositionCashflow"'],
  snapshots: ['public."FxPositionSnapshot"', 'envio."FxPositionSnapshot"'],
};

function hasuraQueryUrl() {
  const explicit = process.env.ENVIO_HASURA_QUERY_URL || process.env.HASURA_GRAPHQL_QUERY_URL;
  if (explicit) return explicit;

  const endpoint = process.env.HASURA_GRAPHQL_ENDPOINT || process.env.ENVIO_HASURA_GRAPHQL_URL;
  if (endpoint) {
    return endpoint.replace(/\/v1\/(metadata|graphql)$/, "/v2/query");
  }

  return process.env.NODE_ENV === "production" ? "http://envio-hasura:8080/v2/query" : "http://127.0.0.1:8088/v2/query";
}

function hasuraAdminSecret() {
  return process.env.HASURA_GRAPHQL_ADMIN_SECRET || process.env.ENVIO_HASURA_ADMIN_SECRET;
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

async function runHasuraSql(sql: string): Promise<string[][]> {
  const queryUrl = hasuraQueryUrl();
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = hasuraAdminSecret();
  if (secret) headers["x-hasura-admin-secret"] = secret;

  const response = await fetch(queryUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "run_sql", args: { source: "default", sql } }),
  });

  const payload = (await response.json().catch(() => ({}))) as RunSqlResponse;
  if (!response.ok || payload.error) {
    throw new Error(`Hasura run_sql failed: ${payload.error ?? response.statusText}`);
  }
  return payload.result ?? [];
}

function rowsFromRunSql(result: string[][]) {
  const [headers, ...rows] = result;
  if (!headers) return [];
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
}

function nullSafe(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "NULL" || trimmed === "null") return null;
  return trimmed;
}

async function findSourceTable(candidates: string[]) {
  for (const candidate of candidates) {
    const result = await runHasuraSql(`select to_regclass('${escapeSqlLiteral(candidate)}')::text as table_name`);
    const rows = rowsFromRunSql(result);
    const tableName = rows[0]?.table_name;
    if (tableName && tableName !== "NULL") return candidate;
  }
  return null;
}

export async function ensureFxHistoryTables(client: Client) {
  await client.query(`
    create table if not exists public.fx_position_transfers (
      id text primary key,
      contract_address text not null,
      pool_address text not null,
      token_id numeric not null,
      from_address text not null,
      to_address text not null,
      block_number bigint not null,
      block_timestamp timestamptz,
      transaction_hash text not null,
      log_index bigint not null,
      synced_at timestamptz not null default now()
    );

    create table if not exists public.fx_position_cashflows (
      id text primary key,
      source text not null,
      event_name text not null,
      contract_address text not null,
      pool_address text not null,
      user_address text,
      recipient_address text,
      position_id numeric,
      delta_collateral_raw numeric,
      delta_debt_raw numeric,
      collateral_in_raw numeric not null default 0,
      collateral_out_raw numeric not null default 0,
      debt_increase_raw numeric not null default 0,
      debt_decrease_raw numeric not null default 0,
      fee_raw numeric not null default 0,
      collateral_raw numeric,
      debt_raw numeric,
      borrow_raw numeric,
      block_number bigint not null,
      block_timestamp timestamptz,
      transaction_hash text not null,
      transaction_from text,
      log_index bigint not null,
      synced_at timestamptz not null default now()
    );

    create table if not exists public.fx_position_snapshots (
      id text primary key,
      contract_address text not null,
      pool_address text not null,
      position_id numeric not null,
      tick integer not null,
      coll_shares_raw numeric not null,
      debt_shares_raw numeric not null,
      price_raw numeric not null,
      block_number bigint not null,
      block_timestamp timestamptz,
      transaction_hash text not null,
      log_index bigint not null,
      synced_at timestamptz not null default now()
    );

    create table if not exists public.fx_official_positions (
      pool_address text not null,
      position_id numeric not null,
      pool_name text not null,
      side text not null,
      collateral text not null,
      owner text,
      real_owner text,
      is_closed boolean not null default false,
      price_raw numeric,
      price_rate_raw numeric,
      colls_raw numeric,
      debts_raw numeric,
      target_leverage numeric,
      block_number bigint,
      block_timestamp timestamptz,
      synced_at timestamptz not null default now(),
      primary key (pool_address, position_id)
    );

    create table if not exists public.fx_official_position_orders (
      id text primary key,
      pool_address text not null,
      position_id numeric not null,
      order_type text not null,
      delta_colls_raw numeric,
      delta_debts_raw numeric,
      exec_price_raw numeric,
      position_colls_raw numeric,
      position_debts_raw numeric,
      old_position_colls_raw numeric,
      old_position_debts_raw numeric,
      price_raw numeric,
      price_rate_raw numeric,
      protocol_fees_raw numeric,
      position_coll_index numeric,
      position_debt_index numeric,
      tick_movement_price_raw numeric,
      tick_movement_type text,
      block_number bigint not null,
      block_timestamp timestamptz,
      transaction_hash text,
      log_index bigint not null default 0,
      synced_at timestamptz not null default now()
    );

    create index if not exists fx_position_cashflows_position_idx
      on public.fx_position_cashflows(lower(pool_address), position_id, block_number, log_index);
    create index if not exists fx_position_cashflows_user_idx
      on public.fx_position_cashflows(lower(user_address), block_number) where user_address is not null;
    create index if not exists fx_position_snapshots_position_idx
      on public.fx_position_snapshots(lower(pool_address), position_id, block_number, log_index);
    create index if not exists fx_official_positions_owner_idx
      on public.fx_official_positions(lower(owner), block_number);
    create index if not exists fx_official_position_orders_position_idx
      on public.fx_official_position_orders(lower(pool_address), position_id, block_number, log_index);
  `);

  await client.query(`
    alter table public.fx_position_transfers
      alter column log_index type bigint using log_index::bigint;
    alter table public.fx_position_cashflows
      alter column log_index type bigint using log_index::bigint;
    alter table public.fx_position_snapshots
      alter column log_index type bigint using log_index::bigint;
  `);
}

async function syncTransfers(client: Client, table: string | null) {
  if (!table) return 0;
  const result = await runHasuraSql(`
    select id, contract_id, contract_id as pool, "tokenId"::text, "from", "to", "blockNumber", "blockTimestamp", "transactionHash", "logIndex"
    from ${table}
    order by "blockNumber" asc, "logIndex" asc
  `);
  const rows = rowsFromRunSql(result);
  for (const row of rows) {
    await client.query(
      `insert into public.fx_position_transfers(
        id, contract_address, pool_address, token_id, from_address, to_address, block_number, block_timestamp,
        transaction_hash, log_index, synced_at
      ) values ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),$9,$10,now())
      on conflict (id) do update set
        contract_address = excluded.contract_address,
        pool_address = excluded.pool_address,
        token_id = excluded.token_id,
        from_address = excluded.from_address,
        to_address = excluded.to_address,
        block_number = excluded.block_number,
        block_timestamp = excluded.block_timestamp,
        transaction_hash = excluded.transaction_hash,
        log_index = excluded.log_index,
        synced_at = now()`,
      [
        row.id,
        row.contract_id,
        row.pool,
        nullSafe(row.tokenId),
        row.from,
        row.to,
        nullSafe(row.blockNumber),
        nullSafe(row.blockTimestamp),
        row.transactionHash,
        nullSafe(row.logIndex),
      ],
    );
  }
  return rows.length;
}

async function syncCashflows(client: Client, table: string | null) {
  if (!table) return { rows: 0, walletsSeeded: 0 };
  const result = await runHasuraSql(`
    select id, contract_id, source, "eventName", pool, "positionId"::text, "user", recipient,
           "deltaColls"::text, "deltaDebts"::text, colls::text, debts::text, borrows::text,
           "protocolFees"::text, "collateralInRaw"::text, "collateralOutRaw"::text,
           "debtIncreaseRaw"::text, "debtDecreaseRaw"::text, "feeRaw"::text,
           "blockNumber", "blockTimestamp", "transactionHash", "transactionFrom", "logIndex"
    from ${table}
    order by "blockNumber" asc, "logIndex" asc
  `);
  const rows = rowsFromRunSql(result);
  let walletsSeeded = 0;
  for (const row of rows) {
    await client.query(
      `insert into public.fx_position_cashflows(
        id, source, event_name, contract_address, pool_address, user_address, recipient_address, position_id,
        delta_collateral_raw, delta_debt_raw, collateral_in_raw, collateral_out_raw, debt_increase_raw,
        debt_decrease_raw, fee_raw, collateral_raw, debt_raw, borrow_raw, block_number, block_timestamp,
        transaction_hash, transaction_from, log_index, synced_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::numeric,0),coalesce($12::numeric,0),coalesce($13::numeric,0),coalesce($14::numeric,0),coalesce($15::numeric,0),$16,$17,$18,$19,to_timestamp($20),$21,$22,$23,now())
      on conflict (id) do update set
        source = excluded.source,
        event_name = excluded.event_name,
        contract_address = excluded.contract_address,
        pool_address = excluded.pool_address,
        user_address = excluded.user_address,
        recipient_address = excluded.recipient_address,
        position_id = excluded.position_id,
        delta_collateral_raw = excluded.delta_collateral_raw,
        delta_debt_raw = excluded.delta_debt_raw,
        collateral_in_raw = excluded.collateral_in_raw,
        collateral_out_raw = excluded.collateral_out_raw,
        debt_increase_raw = excluded.debt_increase_raw,
        debt_decrease_raw = excluded.debt_decrease_raw,
        fee_raw = excluded.fee_raw,
        collateral_raw = excluded.collateral_raw,
        debt_raw = excluded.debt_raw,
        borrow_raw = excluded.borrow_raw,
        block_number = excluded.block_number,
        block_timestamp = excluded.block_timestamp,
        transaction_hash = excluded.transaction_hash,
        transaction_from = excluded.transaction_from,
        log_index = excluded.log_index,
        synced_at = now()`,
      [
        row.id,
        row.source,
        row.eventName,
        row.contract_id,
        row.pool,
        nullSafe(row.user),
        nullSafe(row.recipient),
        nullSafe(row.positionId),
        nullSafe(row.deltaColls),
        nullSafe(row.deltaDebts),
        nullSafe(row.collateralInRaw),
        nullSafe(row.collateralOutRaw),
        nullSafe(row.debtIncreaseRaw),
        nullSafe(row.debtDecreaseRaw),
        nullSafe(row.feeRaw),
        nullSafe(row.colls),
        nullSafe(row.debts),
        nullSafe(row.borrows),
        nullSafe(row.blockNumber),
        nullSafe(row.blockTimestamp),
        row.transactionHash,
        row.transactionFrom,
        nullSafe(row.logIndex),
      ],
    );

    if (typeof row.user === "string" && row.user.startsWith("0x")) {
      await upsertKnownWallet(client, row.user, "fx_router_cashflow");
      walletsSeeded += 1;
    }
    if (typeof row.recipient === "string" && row.recipient.startsWith("0x")) {
      await upsertKnownWallet(client, row.recipient, "fx_router_cashflow");
      walletsSeeded += 1;
    }
  }
  return { rows: rows.length, walletsSeeded };
}

async function syncSnapshots(client: Client, table: string | null) {
  if (!table) return 0;
  const result = await runHasuraSql(`
    select id, contract_id, pool, "positionId"::text, tick, "collShares"::text, "debtShares"::text, price::text,
           "blockNumber", "blockTimestamp", "transactionHash", "logIndex"
    from ${table}
    order by "blockNumber" asc, "logIndex" asc
  `);
  const rows = rowsFromRunSql(result);
  for (const row of rows) {
    await client.query(
      `insert into public.fx_position_snapshots(
        id, contract_address, pool_address, position_id, tick, coll_shares_raw, debt_shares_raw, price_raw,
        block_number, block_timestamp, transaction_hash, log_index, synced_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10),$11,$12,now())
      on conflict (id) do update set
        contract_address = excluded.contract_address,
        pool_address = excluded.pool_address,
        position_id = excluded.position_id,
        tick = excluded.tick,
        coll_shares_raw = excluded.coll_shares_raw,
        debt_shares_raw = excluded.debt_shares_raw,
        price_raw = excluded.price_raw,
        block_number = excluded.block_number,
        block_timestamp = excluded.block_timestamp,
        transaction_hash = excluded.transaction_hash,
        log_index = excluded.log_index,
        synced_at = now()`,
      [
        row.id,
        row.contract_id,
        row.pool,
        nullSafe(row.positionId),
        nullSafe(row.tick),
        nullSafe(row.collShares),
        nullSafe(row.debtShares),
        nullSafe(row.price),
        nullSafe(row.blockNumber),
        nullSafe(row.blockTimestamp),
        row.transactionHash,
        nullSafe(row.logIndex),
      ],
    );
  }
  return rows.length;
}

const OFFICIAL_POSITION_QUERY = `
  query Positions($ids: [String!]!, $skip: Int!) {
    positions(first: 1000, where: { id_in: $ids }, orderBy: blockNumber, orderDirection: asc) {
      timestamp
      price
      priceRate
      owner
      realOwner
      isClosed
      id
      debts
      colls
      blockNumber
      targetLeverage
      orders(first: 1000, skip: $skip, orderBy: blockNumber, orderDirection: asc) {
        deltaColls
        deltaDebts
        execPrice
        id
        logIndex
        positionColls
        positionDebts
        oldPositionColls
        oldPositionDebts
        price
        priceRate
        protocolFees
        type
        hash
        timestamp
        blockNumber
        positionCollIndex
        positionDebtIndex
        tickMovement { price type typeLogIndex }
      }
    }
  }
`;

async function fetchOfficialPositions(pool: OfficialPoolConfig, ids: string[]): Promise<OfficialPosition[]> {
  if (ids.length === 0) return [];
  const positionsById = new Map<string, OfficialPosition>();

  for (let skip = 0; ; skip += 1000) {
    const response = await fetch(pool.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "fx-trader-profiles/official-order-sync" },
      body: JSON.stringify({ query: OFFICIAL_POSITION_QUERY, variables: { ids, skip } }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: { positions?: OfficialPosition[] };
      errors?: { message?: string }[];
    };
    if (!response.ok || payload.errors?.length) {
      throw new Error(`Official f(x) subgraph failed for ${pool.key}: ${payload.errors?.[0]?.message ?? response.statusText}`);
    }

    const pagePositions = payload.data?.positions ?? [];
    if (pagePositions.length === 0) break;

    let pageWasFull = false;
    for (const position of pagePositions) {
      const existing = positionsById.get(position.id);
      const mergedOrders = [...(existing?.orders ?? []), ...(position.orders ?? [])];
      positionsById.set(position.id, { ...position, orders: mergedOrders });
      if ((position.orders?.length ?? 0) === 1000) pageWasFull = true;
    }

    if (!pageWasFull) break;
  }

  return [...positionsById.values()];
}

async function syncOfficialFxOrders(client: Client) {
  let positionCount = 0;
  let orderCount = 0;
  const chunkSize = 5;
  const hasPositionPnl = await tableExists(client, "public.fx_position_pnl");
  if (hasPositionPnl) {
    await client.query(`
      alter table public.fx_position_pnl
        add column if not exists ui_entry_price_usd numeric,
        add column if not exists ui_unrealized_pnl_usd numeric,
        add column if not exists ui_realized_pnl_usd numeric,
        add column if not exists ui_order_count integer not null default 0,
        add column if not exists ui_last_order_block bigint;
    `);
  }

  for (const pool of OFFICIAL_POOLS) {
    const currentIds = await client.query<{ token_id: string }>(
      `with candidate_ids as (
         select distinct position_id as token_id
         from public.fx_position_cashflows
         where lower(pool_address) = $1
           and position_id is not null
           and block_timestamp >= now() - interval '14 days'
         ${hasPositionPnl ? `union
         select position_id as token_id
         from public.fx_position_pnl
         where lower(pool_address) = $1
           and (ui_last_order_block is null or last_cashflow_block > ui_last_order_block)` : ``}
         union
         select p.token_id::numeric as token_id
         from public.fx_current_positions p
         where lower(p.pool_address) = $1
           and (
             p.entry_price_raw is null
             or not exists (
               select 1
               from public.fx_official_position_orders o
               where lower(o.pool_address) = lower(p.pool_address)
                 and o.position_id = p.token_id
             )
           )
       )
       select token_id::text
       from candidate_ids
       order by token_id`,
      [pool.poolAddress],
    );
    const ids = currentIds.rows.map((row) => row.token_id);
    for (let start = 0; start < ids.length; start += chunkSize) {
      const positions = await fetchOfficialPositions(pool, ids.slice(start, start + chunkSize));
      if (positions.length === 0) continue;

      for (const position of positions) {
        await client.query(
          `insert into public.fx_official_positions(
            pool_address, position_id, pool_name, side, collateral, owner, real_owner, is_closed,
            price_raw, price_rate_raw, colls_raw, debts_raw, target_leverage, block_number, block_timestamp, synced_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,to_timestamp($15),now())
          on conflict (pool_address, position_id) do update set
            pool_name = excluded.pool_name,
            side = excluded.side,
            collateral = excluded.collateral,
            owner = excluded.owner,
            real_owner = excluded.real_owner,
            is_closed = excluded.is_closed,
            price_raw = excluded.price_raw,
            price_rate_raw = excluded.price_rate_raw,
            colls_raw = excluded.colls_raw,
            debts_raw = excluded.debts_raw,
            target_leverage = excluded.target_leverage,
            block_number = excluded.block_number,
            block_timestamp = excluded.block_timestamp,
            synced_at = now()`,
          [
            pool.poolAddress,
            nullSafe(position.id),
            pool.poolName,
            pool.side,
            pool.collateral,
            position.owner?.toLowerCase?.() ?? null,
            position.realOwner?.toLowerCase?.() ?? null,
            Boolean(position.isClosed),
            nullSafe(position.price),
            nullSafe(position.priceRate),
            nullSafe(position.colls),
            nullSafe(position.debts),
            nullSafe(position.targetLeverage),
            nullSafe(position.blockNumber),
            nullSafe(position.timestamp),
          ],
        );
        positionCount += 1;

        if (typeof position.owner === "string" && position.owner.startsWith("0x")) {
          await upsertKnownWallet(client, position.owner, "fx_official_subgraph");
        }

        const mergedOrders = new Map<string, OfficialOrder>();
        for (const order of [...(position.orders ?? []), ...(position.latestOrders ?? [])]) {
          mergedOrders.set(order.id, order);
        }
        const orderedOfficialOrders = [...mergedOrders.values()].sort((a, b) => {
          const blockDelta = toFiniteNumber(a.blockNumber) - toFiniteNumber(b.blockNumber);
          if (blockDelta !== 0) return blockDelta;
          return toFiniteNumber(a.tickMovement?.typeLogIndex ?? a.logIndex) - toFiniteNumber(b.tickMovement?.typeLogIndex ?? b.logIndex);
        });

        for (const order of orderedOfficialOrders) {
          await client.query(
            `insert into public.fx_official_position_orders(
              id, pool_address, position_id, order_type, delta_colls_raw, delta_debts_raw, exec_price_raw,
              position_colls_raw, position_debts_raw, old_position_colls_raw, old_position_debts_raw,
              price_raw, price_rate_raw, protocol_fees_raw, position_coll_index, position_debt_index,
              tick_movement_price_raw, tick_movement_type, block_number, block_timestamp, transaction_hash, log_index, synced_at
            ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,to_timestamp($20),$21,$22,now())
            on conflict (id) do update set
              pool_address = excluded.pool_address,
              position_id = excluded.position_id,
              order_type = excluded.order_type,
              delta_colls_raw = excluded.delta_colls_raw,
              delta_debts_raw = excluded.delta_debts_raw,
              exec_price_raw = excluded.exec_price_raw,
              position_colls_raw = excluded.position_colls_raw,
              position_debts_raw = excluded.position_debts_raw,
              old_position_colls_raw = excluded.old_position_colls_raw,
              old_position_debts_raw = excluded.old_position_debts_raw,
              price_raw = excluded.price_raw,
              price_rate_raw = excluded.price_rate_raw,
              protocol_fees_raw = excluded.protocol_fees_raw,
              position_coll_index = excluded.position_coll_index,
              position_debt_index = excluded.position_debt_index,
              tick_movement_price_raw = excluded.tick_movement_price_raw,
              tick_movement_type = excluded.tick_movement_type,
              block_number = excluded.block_number,
              block_timestamp = excluded.block_timestamp,
              transaction_hash = excluded.transaction_hash,
              log_index = excluded.log_index,
              synced_at = now()`,
            [
              order.id,
              pool.poolAddress,
              nullSafe(position.id),
              order.type,
              nullSafe(order.deltaColls),
              nullSafe(order.deltaDebts),
              nullSafe(order.execPrice),
              nullSafe(order.positionColls),
              nullSafe(order.positionDebts),
              nullSafe(order.oldPositionColls),
              nullSafe(order.oldPositionDebts),
              nullSafe(order.price),
              nullSafe(order.priceRate),
              nullSafe(order.protocolFees),
              nullSafe(order.positionCollIndex),
              nullSafe(order.positionDebtIndex),
              nullSafe(order.tickMovement?.price),
              order.tickMovement?.type ?? null,
              nullSafe(order.blockNumber),
              nullSafe(order.timestamp),
              order.hash ?? null,
              nullSafe(order.tickMovement?.typeLogIndex ?? order.logIndex),
            ],
          );
          orderCount += 1;
        }
      }
    }
  }

  return { positions: positionCount, orders: orderCount };
}

export async function syncFxEventHistoryFromHasura(client: Client): Promise<SyncResult> {
  await ensureFxHistoryTables(client);

  const sourceTables = {
    transfers: await findSourceTable(tableCandidates.transfers),
    cashflows: await findSourceTable(tableCandidates.cashflows),
    snapshots: await findSourceTable(tableCandidates.snapshots),
  };

  const official = await syncOfficialFxOrders(client);

  if (!sourceTables.transfers && !sourceTables.cashflows && !sourceTables.snapshots) {
    return {
      configured: official.positions > 0 || official.orders > 0,
      transfers: 0,
      cashflows: 0,
      snapshots: 0,
      officialPositions: official.positions,
      officialOrders: official.orders,
      walletsSeeded: 0,
      sourceTables,
    };
  }

  const [transfers, cashflows, snapshots] = await Promise.all([
    syncTransfers(client, sourceTables.transfers),
    syncCashflows(client, sourceTables.cashflows),
    syncSnapshots(client, sourceTables.snapshots),
  ]);

  return {
    configured: true,
    transfers,
    cashflows: cashflows.rows,
    snapshots,
    officialPositions: official.positions,
    officialOrders: official.orders,
    walletsSeeded: cashflows.walletsSeeded,
    sourceTables,
  };
}

function toFiniteNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function usdOrderPrice(pool: OfficialPoolConfig, row: Record<string, unknown>) {
  const price = toFiniteNumber(row.price_raw);
  const rate = toFiniteNumber(row.price_rate_raw);
  const execPrice = toFiniteNumber(row.exec_price_raw);
  if (rate <= 0) return 0;
  if (execPrice > 0) return execPrice / rate;
  if (price <= 0) return 0;
  if (pool.side === "short") return 1e36 / (price * rate);
  return price / 1e18;
}

function usdCurrentPrice(pool: OfficialPoolConfig, position: Record<string, unknown>, current: Record<string, unknown>) {
  const officialPrice = toFiniteNumber(position.price_raw);
  const officialRate = toFiniteNumber(position.price_rate_raw);
  if (pool.side === "short") {
    const oracle = toFiniteNumber(current.oracle_price);
    const rate = officialRate > 0 ? officialRate : 1e18;
    if (oracle > 0 && rate > 0) return 1 / (oracle * (rate / 1e18));
    if (officialPrice > 0 && officialRate > 0) return 1e36 / (officialPrice * officialRate);
    return 0;
  }
  const oracle = toFiniteNumber(current.oracle_price);
  return oracle > 0 ? oracle : officialPrice / 1e18;
}

function orderPositionSize(pool: OfficialPoolConfig, row: Record<string, unknown>) {
  if (pool.side === "short") {
    // Official f(x) order stream uses asset decimals for deltaDebts, but
    // positionDebts is normalized to 1e18. WBTC shorts therefore need
    // deltaDebts / 1e8 for order contribution, but positionDebts / 1e18
    // for current/remaining size.
    return (toFiniteNumber(row.position_debts_raw) / 1e18) * (toFiniteNumber(row.price_rate_raw) / 1e18);
  }
  // position_colls_raw is always in shares (1e18 scale), not asset decimals
  return toFiniteNumber(row.position_colls_raw) / 1e18;
}

function orderContribution(pool: OfficialPoolConfig, row: Record<string, unknown>, orderPrice: number) {
  if (pool.side === "short") {
    return (toFiniteNumber(row.delta_debts_raw) / pool.precision) * orderPrice * (toFiniteNumber(row.price_rate_raw) / 1e18);
  }
  return (toFiniteNumber(row.delta_colls_raw) / pool.precision) * orderPrice;
}

function orderDeltaSize(pool: OfficialPoolConfig, row: Record<string, unknown>) {
  const rate = toFiniteNumber(row.price_rate_raw) / 1e18;
  if (pool.side === "short") {
    return (toFiniteNumber(row.delta_debts_raw) / pool.precision) * rate;
  }
  return (toFiniteNumber(row.delta_colls_raw) / pool.precision) * rate;
}

function realizedPnlFromOfficialOrders(pool: OfficialPoolConfig, orders: Record<string, unknown>[]) {
  let entrySize = 0;
  let entryPrice = 0;
  let realizedPnlUsd = 0;

  for (const order of orders) {
    const type = String(order.order_type);
    const price = usdOrderPrice(pool, order);
    const deltaSize = orderDeltaSize(pool, order);
    if (!price || !Number.isFinite(price) || !Number.isFinite(deltaSize)) continue;

    if (deltaSize > 0 && (type === "Open" || type === "Add")) {
      entryPrice = entrySize + deltaSize > 0
        ? (entrySize * entryPrice + deltaSize * price) / (entrySize + deltaSize)
        : 0;
      entrySize += deltaSize;
      continue;
    }

    if (deltaSize < 0 && (type === "Reduce" || type === "Close" || type === "Liquidate")) {
      const closeSize = Math.min(Math.abs(deltaSize), entrySize);
      if (closeSize > 0 && entryPrice > 0) {
        const direction = pool.side === "short" ? -1 : 1;
        realizedPnlUsd += (price - entryPrice) * direction * closeSize;
        entrySize = Math.max(0, entrySize - closeSize);
      }
      if (type === "Close" || entrySize < 1e-8) {
        entrySize = 0;
        entryPrice = 0;
      }
    }
  }

  return realizedPnlUsd;
}

async function updateUiPnlFromOfficialOrders(client: Client) {
  if (!(await tableExists(client, "public.fx_current_positions"))) return 0;

  await client.query(`
    alter table public.fx_position_pnl
      add column if not exists ui_entry_price_usd numeric,
      add column if not exists ui_unrealized_pnl_usd numeric,
      add column if not exists ui_realized_pnl_usd numeric,
      add column if not exists ui_order_count integer not null default 0,
      add column if not exists ui_last_order_block bigint;
    alter table public.fx_current_positions
      add column if not exists ui_entry_price_usd numeric,
      add column if not exists ui_unrealized_pnl_usd numeric,
      add column if not exists ui_order_count integer not null default 0,
      add column if not exists ui_last_order_block bigint;
  `);

  const currentRows = await client.query<Record<string, unknown>>(`
    select lower(pool_address) as pool_address, token_id, oracle_price, raw_collateral, raw_debt, collateral_value_usd, debt_value_usd
    from public.fx_current_positions
  `);

  const currentByPosition = new Map<string, Record<string, unknown>>();
  for (const current of currentRows.rows) {
    currentByPosition.set(`${String(current.pool_address).toLowerCase()}:${String(current.token_id)}`, current);
  }

  const positionRows = await client.query<Record<string, unknown>>(`
    select lower(pool_address) as pool_address, position_id, price_raw, price_rate_raw, debts_raw, colls_raw
    from public.fx_official_positions
  `);

  let updated = 0;
  const resetTypes = new Set(["Close"]);
  const nonEntryTypes = new Set(["Reduce", "TickMovement", "Rebalance", "Liquidate", "CollIndexChanged", "DebtIndexChanged", "Repay", "WithdrawRepay"]);

  for (const position of positionRows.rows) {
    const poolAddress = String(position.pool_address).toLowerCase();
    const tokenId = String(position.position_id);
    const pool = OFFICIAL_POOLS.find((item) => item.poolAddress === poolAddress);
    if (!pool) continue;
    const current = currentByPosition.get(`${poolAddress}:${tokenId}`);

    const orders = await client.query<Record<string, unknown>>(
      `select * from public.fx_official_position_orders
       where lower(pool_address) = $1 and position_id = $2::numeric
       order by block_number asc, log_index asc`,
      [poolAddress, tokenId],
    );
    if (orders.rows.length === 0) continue;

    const realizedPnlUsd = realizedPnlFromOfficialOrders(pool, orders.rows);

    let entryValue = 0;
    let entryPrice = 0;
    let previousSize = 0;
    for (const order of orders.rows) {
      const type = String(order.order_type);
      if (resetTypes.has(type)) {
        entryValue = 0;
        entryPrice = 0;
        previousSize = 0;
        continue;
      }
      const size = orderPositionSize(pool, order);
      if (nonEntryTypes.has(type)) {
        previousSize = size;
        continue;
      }
      const price = usdOrderPrice(pool, order);
      const contribution = orderContribution(pool, order, price);
      entryValue = previousSize * entryPrice + contribution;
      entryPrice = size > 0 ? entryValue / size : 0;
      previousSize = size;
    }

    const currentPrice = current ? usdCurrentPrice(pool, position, current) : 0;
    const currentSize = current
      ? (pool.side === "short"
        ? (toFiniteNumber(position.debts_raw) / 1e18) * (toFiniteNumber(position.price_rate_raw) / 1e18)
        : toFiniteNumber(current.raw_collateral) / 1e18)    // raw_collateral is in shares (1e18), not asset decimals
      : 0;
    const uiPnl = current && entryPrice > 0 && currentPrice > 0
      ? (currentPrice - entryPrice) * (pool.side === "short" ? -1 : 1) * currentSize
      : 0;
    const lastBlock = Math.max(...orders.rows.map((row) => toFiniteNumber(row.block_number)));

    await client.query(
      `update public.fx_position_pnl
       set ui_entry_price_usd = $3,
           ui_unrealized_pnl_usd = $4,
           ui_realized_pnl_usd = $5,
           ui_order_count = $6,
           ui_last_order_block = $7,
           updated_at = now()
       where lower(pool_address) = $1 and position_id = $2::numeric`,
      [poolAddress, tokenId, entryPrice || null, uiPnl, realizedPnlUsd, orders.rows.length, lastBlock || null],
    );
    if (current) {
      await client.query(
        `update public.fx_current_positions
         set ui_entry_price_usd = $3,
             ui_unrealized_pnl_usd = $4,
             ui_order_count = $5,
             ui_last_order_block = $6
         where lower(pool_address) = $1 and token_id = $2::numeric`,
        [poolAddress, tokenId, entryPrice || null, uiPnl, orders.rows.length, lastBlock || null],
      );
    }
    updated += 1;
  }
  return updated;
}

export async function computeFxPositionPnl(client: Client) {
  await ensureFxHistoryTables(client);
  await client.query(`
    create table if not exists public.fx_position_pnl (
      pool_address text not null,
      position_id numeric not null,
      cashflow_event_count integer not null default 0,
      collateral_in_raw numeric not null default 0,
      collateral_out_raw numeric not null default 0,
      net_collateral_raw numeric not null default 0,
      debt_increase_raw numeric not null default 0,
      debt_decrease_raw numeric not null default 0,
      net_debt_raw numeric not null default 0,
      total_fees_raw numeric not null default 0,
      realized_pnl_raw numeric not null default 0,
      entry_price_raw numeric,
      first_cashflow_block bigint,
      last_cashflow_block bigint,
      updated_at timestamptz not null default now(),
      primary key (pool_address, position_id)
    );
  `);
  await client.query(`
    alter table public.fx_position_pnl
      add column if not exists entry_price_raw numeric,
      add column if not exists ui_entry_price_usd numeric,
      add column if not exists ui_unrealized_pnl_usd numeric,
      add column if not exists ui_realized_pnl_usd numeric,
      add column if not exists ui_order_count integer not null default 0,
      add column if not exists ui_last_order_block bigint;
  `);

  // Step 1: Aggregate cashflows with entry prices from PositionSnapshot
  // Entry price is the first snapshot AFTER the most recent close (coll=0,debt=0)
  // for positions that have been closed at least once; otherwise first-ever snapshot.
  const result = await client.query<{ rows_upserted: string }>(`
    with last_closes as (
      select distinct on (lower(pool_address), position_id)
        lower(pool_address) as pool_address,
        position_id,
        block_number as last_close_block
      from public.fx_position_snapshots
      where coll_shares_raw = 0 and debt_shares_raw = 0
      order by lower(pool_address), position_id, block_number desc
    ),
    entry_prices as (
      select distinct on (lower(s.pool_address), s.position_id)
        lower(s.pool_address) as pool_address,
        s.position_id,
        s.price_raw as entry_price_raw
      from public.fx_position_snapshots s
      left join last_closes lc
        on lower(lc.pool_address) = lower(s.pool_address)
        and lc.position_id = s.position_id
      where s.price_raw is not null and s.price_raw > 0
        and s.coll_shares_raw > 0
        and (lc.last_close_block is null or s.block_number > lc.last_close_block)
      order by lower(s.pool_address), s.position_id, s.block_number asc, s.log_index asc
    ),
    -- For realized PnL, only include cashflows from COMPLETED (closed) cycles
    -- by filtering out cashflows that belong to the current open cycle
    closed_cashflows as (
      select c.*
      from public.fx_position_cashflows c
      inner join last_closes lc
        on lower(lc.pool_address) = lower(c.pool_address)
        and lc.position_id = c.position_id
        and c.block_number <= lc.last_close_block
      where c.position_id is not null
    ),
    -- Position that has never been closed still needs a pnl record with realized_pnl=0
    -- for entry_price to propagate to current_positions
    never_closed as (
      select distinct lower(c.pool_address) as pool_address, c.position_id
      from public.fx_position_cashflows c
      where c.position_id is not null
        and not exists (
          select 1 from last_closes lc
          where lower(lc.pool_address) = lower(c.pool_address)
            and lc.position_id = c.position_id
        )
    ),
    aggregate as (
      -- Closed positions: aggregate cashflows from completed cycles only
      select
        lower(c.pool_address) as pool_address,
        c.position_id,
        count(*)::int as cashflow_event_count,
        coalesce(sum(c.collateral_in_raw), 0) as collateral_in_raw,
        coalesce(sum(c.collateral_out_raw), 0) as collateral_out_raw,
        coalesce(sum(c.collateral_out_raw - c.collateral_in_raw), 0) as net_collateral_raw,
        coalesce(sum(c.debt_increase_raw), 0) as debt_increase_raw,
        coalesce(sum(c.debt_decrease_raw), 0) as debt_decrease_raw,
        coalesce(sum(c.debt_increase_raw - c.debt_decrease_raw), 0) as net_debt_raw,
        coalesce(sum(
          case
            -- Current f(x) long-pool config charges 50 bps on borrow/open/add
            -- and 20 bps on repay/close/reduce. These fees are fxUSD-denominated.
            when lower(c.pool_address) in (
              '0x6ecfa38fee8a5277b91efda204c235814f0122e8',
              '0xab709e26fa6b0a30c119d8c55b887ded24952473'
            ) then c.debt_increase_raw * 5000000 / 1000000000 + c.debt_decrease_raw * 2000000 / 1000000000
            -- Current f(x) short-pool config charges 30 bps on supplied fxUSD and
            -- 10 bps on withdrawn fxUSD. Supply events record the net amount after
            -- the fee was deducted, so gross-up by fee/(1-fee) for the supply side.
            when lower(c.pool_address) in (
              '0x25707b9e6690b52c60ae6744d711cf9c1dfc1876',
              '0xa0cc8162c523998856d59065faa254f87d20a5b0'
            ) then c.collateral_in_raw * 3000000 / (1000000000 - 3000000) + c.collateral_out_raw * 1000000 / 1000000000
            else c.fee_raw
          end
        ), 0) as total_fees_raw,
        coalesce(sum(c.collateral_out_raw - c.collateral_in_raw - c.fee_raw), 0) as realized_pnl_raw,
        e.entry_price_raw,
        min(c.block_number)::bigint as first_cashflow_block,
        max(c.block_number)::bigint as last_cashflow_block
      from closed_cashflows c
      left join entry_prices e on lower(e.pool_address) = lower(c.pool_address) and e.position_id = c.position_id
      where c.source = 'manager'
        and c.collateral_in_raw < 1000000000000000000000000
        and c.collateral_out_raw < 1000000000000000000000000
        and c.debt_increase_raw < 100000000000000000000000000000000
        and c.debt_decrease_raw < 100000000000000000000000000000000
      group by lower(c.pool_address), c.position_id, e.entry_price_raw
      union all
      -- Never-closed positions: no realized PnL (nothing closed yet), entry price from first snapshot
      select
        n.pool_address,
        n.position_id,
        count(*)::int as cashflow_event_count,
        coalesce(sum(c.collateral_in_raw), 0) as collateral_in_raw,
        coalesce(sum(c.collateral_out_raw), 0) as collateral_out_raw,
        coalesce(sum(c.collateral_out_raw - c.collateral_in_raw), 0) as net_collateral_raw,
        coalesce(sum(c.debt_increase_raw), 0) as debt_increase_raw,
        coalesce(sum(c.debt_decrease_raw), 0) as debt_decrease_raw,
        coalesce(sum(c.debt_increase_raw - c.debt_decrease_raw), 0) as net_debt_raw,
        coalesce(sum(
          case
            when lower(c.pool_address) in (
              '0x6ecfa38fee8a5277b91efda204c235814f0122e8',
              '0xab709e26fa6b0a30c119d8c55b887ded24952473'
            ) then c.debt_increase_raw * 5000000 / 1000000000 + c.debt_decrease_raw * 2000000 / 1000000000
            when lower(c.pool_address) in (
              '0x25707b9e6690b52c60ae6744d711cf9c1dfc1876',
              '0xa0cc8162c523998856d59065faa254f87d20a5b0'
            ) then c.collateral_in_raw * 3000000 / (1000000000 - 3000000) + c.collateral_out_raw * 1000000 / 1000000000
            else c.fee_raw
          end
        ), 0) as total_fees_raw,
        0::numeric as realized_pnl_raw,
        e.entry_price_raw,
        min(c.block_number)::bigint as first_cashflow_block,
        max(c.block_number)::bigint as last_cashflow_block
      from never_closed n
      join public.fx_position_cashflows c
        on lower(c.pool_address) = lower(n.pool_address)
        and c.position_id = n.position_id
      left join entry_prices e on lower(e.pool_address) = lower(n.pool_address) and e.position_id = n.position_id
      where c.source = 'manager'
        and c.collateral_in_raw < 1000000000000000000000000
        and c.collateral_out_raw < 1000000000000000000000000
        and c.debt_increase_raw < 100000000000000000000000000000000
        and c.debt_decrease_raw < 100000000000000000000000000000000
      group by n.pool_address, n.position_id, e.entry_price_raw
    ), upserted as (
      insert into public.fx_position_pnl(
        pool_address, position_id, cashflow_event_count, collateral_in_raw, collateral_out_raw, net_collateral_raw,
        debt_increase_raw, debt_decrease_raw, net_debt_raw, total_fees_raw, realized_pnl_raw, entry_price_raw,
        first_cashflow_block, last_cashflow_block, updated_at
      )
      select *, now() from aggregate
      on conflict (pool_address, position_id) do update set
        cashflow_event_count = excluded.cashflow_event_count,
        collateral_in_raw = excluded.collateral_in_raw,
        collateral_out_raw = excluded.collateral_out_raw,
        net_collateral_raw = excluded.net_collateral_raw,
        debt_increase_raw = excluded.debt_increase_raw,
        debt_decrease_raw = excluded.debt_decrease_raw,
        net_debt_raw = excluded.net_debt_raw,
        total_fees_raw = excluded.total_fees_raw,
        realized_pnl_raw = excluded.realized_pnl_raw,
        entry_price_raw = coalesce(excluded.entry_price_raw, public.fx_position_pnl.entry_price_raw),
        first_cashflow_block = excluded.first_cashflow_block,
        last_cashflow_block = excluded.last_cashflow_block,
        updated_at = now()
      returning 1
    )
    select count(*)::text as rows_upserted from upserted
  `);

  // Step 2: Update current positions with PnL data  // Step 3: Update current positions with PnL data
  let currentPositionsUpdated = 0;
  if (await tableExists(client, "public.fx_current_positions")) {
    await client.query(`
      alter table public.fx_current_positions
        add column if not exists cashflow_event_count integer not null default 0,
        add column if not exists realized_pnl_raw numeric not null default 0,
        add column if not exists total_fees_raw numeric not null default 0,
        add column if not exists entry_price_raw numeric,
        add column if not exists last_cashflow_block bigint;
    `);
    const updateResult = await client.query(`
      update public.fx_current_positions p
      set cashflow_event_count = h.cashflow_event_count,
          realized_pnl_raw = h.realized_pnl_raw,
          total_fees_raw = h.total_fees_raw,
          entry_price_raw = coalesce(h.entry_price_raw, p.entry_price_raw),
          last_cashflow_block = h.last_cashflow_block
      from public.fx_position_pnl h
      where lower(p.pool_address) = lower(h.pool_address)
        and p.token_id = h.position_id
    `);
    currentPositionsUpdated = updateResult.rowCount ?? 0;
  }

  const uiPnlUpdated = await updateUiPnlFromOfficialOrders(client);

  // Official order data is still used for UI-parity short entry/PnL, but not for fees.
  // Current f(x) managers emit Operate.protocolFees as zero and route xPOSITION fees
  // through open/close revenue-pool handlers. The canonical fee model is computed
  // above from manager cashflow deltas and live fee-ratio contract semantics.
  const officialFeeUpdated = 0;

  return {
    positionsUpserted: Number(result.rows[0]?.rows_upserted ?? 0),
    currentPositionsUpdated,
    uiPnlUpdated,
    officialFeeUpdated,
  };
}
