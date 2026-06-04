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
  walletsSeeded: number;
  sourceTables: Record<string, string | null>;
};

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

    create index if not exists fx_position_cashflows_position_idx
      on public.fx_position_cashflows(lower(pool_address), position_id, block_number, log_index);
    create index if not exists fx_position_cashflows_user_idx
      on public.fx_position_cashflows(lower(user_address), block_number) where user_address is not null;
    create index if not exists fx_position_snapshots_position_idx
      on public.fx_position_snapshots(lower(pool_address), position_id, block_number, log_index);
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
        row.user,
        row.recipient,
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

export async function syncFxEventHistoryFromHasura(client: Client): Promise<SyncResult> {
  await ensureFxHistoryTables(client);

  const sourceTables = {
    transfers: await findSourceTable(tableCandidates.transfers),
    cashflows: await findSourceTable(tableCandidates.cashflows),
    snapshots: await findSourceTable(tableCandidates.snapshots),
  };

  if (!sourceTables.transfers && !sourceTables.cashflows && !sourceTables.snapshots) {
    return { configured: false, transfers: 0, cashflows: 0, snapshots: 0, walletsSeeded: 0, sourceTables };
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
    walletsSeeded: cashflows.walletsSeeded,
    sourceTables,
  };
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
    alter table public.fx_position_pnl add column if not exists entry_price_raw numeric;
  `);

  const result = await client.query<{ rows_upserted: string }>(`
    with entry_prices as (
      select distinct on (lower(pool_address), position_id)
        lower(pool_address) as pool_address,
        position_id,
        price_raw as entry_price_raw
      from public.fx_position_snapshots
      where price_raw is not null and price_raw > 0
      order by lower(pool_address), position_id, block_number asc, log_index asc
    ),
    aggregate as (
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
        coalesce(sum(c.fee_raw), 0) as total_fees_raw,
        coalesce(sum(c.collateral_out_raw - c.collateral_in_raw - c.fee_raw), 0) as realized_pnl_raw,
        e.entry_price_raw,
        min(c.block_number)::bigint as first_cashflow_block,
        max(c.block_number)::bigint as last_cashflow_block
      from public.fx_position_cashflows c
      left join entry_prices e on lower(e.pool_address) = lower(c.pool_address) and e.position_id = c.position_id
      where c.position_id is not null
        and c.collateral_in_raw < 1000000000000000000000000
        and c.collateral_out_raw < 1000000000000000000000000
        and c.debt_increase_raw < 100000000000000000000000000000000
        and c.debt_decrease_raw < 100000000000000000000000000000000
      group by lower(c.pool_address), c.position_id, e.entry_price_raw
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

  return {
    positionsUpserted: Number(result.rows[0]?.rows_upserted ?? 0),
    currentPositionsUpdated,
  };
}
