import type { Client } from "pg";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type WalletMaintenanceSummary = {
  knownWallets: number;
  historyReadyWallets: number;
  historyPendingWallets: number;
  lastMaintainedAt: string | null;
};

export type KnownWalletMaintenanceResult = WalletMaintenanceSummary & {
  seededFromCurrentPositions: number;
  seededFromTransfers: number;
};

export const emptyWalletMaintenanceSummary: WalletMaintenanceSummary = {
  knownWallets: 0,
  historyReadyWallets: 0,
  historyPendingWallets: 0,
  lastMaintainedAt: null
};

export async function tableExists(client: Client, tableName: string) {
  const result = await client.query<{ exists: boolean }>("select to_regclass($1) is not null as exists", [tableName]);
  return Boolean(result.rows[0]?.exists);
}

export async function ensureWalletMaintenanceTables(client: Client) {
  await client.query(`
    create table if not exists public.fx_known_wallets (
      address text primary key,
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      source text not null default 'unknown',
      last_position_sync_at timestamptz,
      last_history_sync_at timestamptz,
      history_cursor_block bigint,
      history_status text not null default 'pending',
      realized_pnl_status text not null default 'not_indexed',
      updated_at timestamptz not null default now(),
      check (address ~ '^0x[0-9a-f]{40}$')
    );

    create index if not exists fx_known_wallets_history_status_idx
      on public.fx_known_wallets(history_status, last_history_sync_at nulls first);

    create index if not exists fx_known_wallets_seen_idx
      on public.fx_known_wallets(last_seen_at desc);
  `);
}

export async function upsertKnownWallet(client: Client, address: string, source: string) {
  const normalized = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized) || normalized === ZERO_ADDRESS) {
    return false;
  }

  await ensureWalletMaintenanceTables(client);
  await client.query(
    `insert into public.fx_known_wallets(address, source)
     values ($1, $2)
     on conflict (address) do update set
       last_seen_at = now(),
       source = excluded.source,
       updated_at = now()`,
    [normalized, source]
  );
  return true;
}

async function seedWalletsFromCurrentPositions(client: Client) {
  if (!(await tableExists(client, "public.fx_current_positions"))) {
    return 0;
  }

  const result = await client.query<{ inserted: string }>(`
    with candidates as (
      select distinct lower(owner) as address
      from public.fx_current_positions
      where owner is not null
        and lower(owner) <> '${ZERO_ADDRESS}'
        and lower(owner) ~ '^0x[0-9a-f]{40}$'
    ), inserted as (
      insert into public.fx_known_wallets(address, source, last_position_sync_at)
      select address, 'current_positions_snapshot', now()
      from candidates
      on conflict (address) do update set
        last_seen_at = now(),
        source = excluded.source,
        last_position_sync_at = coalesce(public.fx_known_wallets.last_position_sync_at, excluded.last_position_sync_at),
        updated_at = now()
      returning 1
    )
    select count(*)::text as inserted from inserted
  `);

  return Number(result.rows[0]?.inserted ?? 0);
}

const transferSources = [
  { table: 'public."FxPositionTransfer"', fromColumn: '"from"', toColumn: '"to"', blockColumn: '"blockNumber"' },
  { table: "public.fx_position_transfer", fromColumn: '"from"', toColumn: '"to"', blockColumn: "block_number" },
  { table: "public.fx_position_transfers", fromColumn: '"from"', toColumn: '"to"', blockColumn: "block_number" }
];

async function seedWalletsFromTransferTable(
  client: Client,
  table: string,
  fromColumn: string,
  toColumn: string,
  blockColumn: string
) {
  if (!(await tableExists(client, table))) {
    return 0;
  }

  const result = await client.query<{ inserted: string }>(`
    with candidates as (
      select lower(${fromColumn}) as address, max(${blockColumn})::bigint as last_block from ${table}
      where ${fromColumn} is not null and lower(${fromColumn}) <> '${ZERO_ADDRESS}'
      group by lower(${fromColumn})
      union
      select lower(${toColumn}) as address, max(${blockColumn})::bigint as last_block from ${table}
      where ${toColumn} is not null and lower(${toColumn}) <> '${ZERO_ADDRESS}'
      group by lower(${toColumn})
    ), normalized as (
      select address, max(last_block) as last_block
      from candidates
      where address ~ '^0x[0-9a-f]{40}$'
      group by address
    ), inserted as (
      insert into public.fx_known_wallets(address, source, history_cursor_block)
      select address, 'position_transfer_index', last_block
      from normalized
      on conflict (address) do update set
        last_seen_at = now(),
        source = excluded.source,
        history_cursor_block = greatest(
          coalesce(public.fx_known_wallets.history_cursor_block, 0),
          coalesce(excluded.history_cursor_block, 0)
        ),
        updated_at = now()
      returning 1
    )
    select count(*)::text as inserted from inserted
  `);

  return Number(result.rows[0]?.inserted ?? 0);
}

async function seedWalletsFromTransfers(client: Client) {
  let seeded = 0;
  for (const source of transferSources) {
    seeded += await seedWalletsFromTransferTable(
      client,
      source.table,
      source.fromColumn,
      source.toColumn,
      source.blockColumn
    );
  }
  return seeded;
}

export async function getWalletMaintenanceSummary(client: Client): Promise<WalletMaintenanceSummary> {
  if (!(await tableExists(client, "public.fx_known_wallets"))) {
    return emptyWalletMaintenanceSummary;
  }

  const result = await client.query<{
    known_wallets: string;
    history_ready_wallets: string;
    history_pending_wallets: string;
    last_maintained_at: Date | null;
  }>(`
    select
      count(*)::text as known_wallets,
      count(*) filter (where history_status = 'complete')::text as history_ready_wallets,
      count(*) filter (where history_status <> 'complete')::text as history_pending_wallets,
      max(updated_at) as last_maintained_at
    from public.fx_known_wallets
  `);

  const row = result.rows[0];
  return {
    knownWallets: Number(row?.known_wallets ?? 0),
    historyReadyWallets: Number(row?.history_ready_wallets ?? 0),
    historyPendingWallets: Number(row?.history_pending_wallets ?? 0),
    lastMaintainedAt: row?.last_maintained_at?.toISOString?.() ?? null
  };
}

export async function maintainKnownWallets(client: Client): Promise<KnownWalletMaintenanceResult> {
  await ensureWalletMaintenanceTables(client);

  const seededFromCurrentPositions = await seedWalletsFromCurrentPositions(client);
  const seededFromTransfers = await seedWalletsFromTransfers(client);
  const summary = await getWalletMaintenanceSummary(client);

  return {
    ...summary,
    seededFromCurrentPositions,
    seededFromTransfers
  };
}
