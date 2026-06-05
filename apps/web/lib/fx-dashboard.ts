import { Client } from "pg";
import {
  emptyWalletMaintenanceSummary,
  getWalletMaintenanceSummary,
  tableExists,
  type WalletMaintenanceSummary,
  upsertKnownWallet
} from "./fx-wallet-maintenance";

export type PoolSummary = {
  poolName: string;
  side: string;
  collateral: string;
  positions: number;
  uniqueOwners: number;
  rawCollateral: string;
  rawDebt: string;
  equityUsd: number;
  collateralValueUsd: number;
  debtValueUsd: number;
  avgDebtRatio: number;
};

export type TraderSummary = {
  owner: string;
  positions: number;
  pools: number;
  wstethLong: number;
  wbtcLong: number;
  wstethShort: number;
  wbtcShort: number;
  notionalValueUsd: number;
  ethLongExposureUsd: number;
  ethShortExposureUsd: number;
  ethNetExposureUsd: number;
  btcLongExposureUsd: number;
  btcShortExposureUsd: number;
  btcNetExposureUsd: number;
  collateralValueUsd: number;
  debtValueUsd: number;
  equityUsd: number;
  avgDebtRatio: number;
  maxDebtRatio: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  feesUsd: number;
  hasPositionHistory: boolean;
};

export type PositionSummary = {
  poolName: string;
  poolAddress: string;
  side: string;
  collateral: string;
  tokenId: string;
  owner: string;
  rawCollateral: string;
  rawDebt: string;
  oraclePrice: number;
  entryPriceUsd: number;
  unrealizedPnlUsd: number;
  collateralValueUsd: number;
  debtValueUsd: number;
  equityUsd: number;
  debtRatio: number;
};

export type HistoricalPosition = {
  poolAddress: string;
  poolName: string;
  side: string;
  tokenId: string;
  feesUsd: number;
  realizedPnlUsd: number;
  cashflowEventCount: number;
  firstBlock: number;
  lastBlock: number;
  isOpen: boolean;
};

export type TraderProfile = {
  owner: string;
  generatedAt: string | null;
  summary: TraderSummary;
  positions: PositionSummary[];
  history: HistoricalPosition[];
};

export type DashboardData = {
  hasSnapshot: boolean;
  generatedAt: string | null;
  totals: {
    openPositions: number;
    uniqueTraders: number;
    pools: number;
    longPositions: number;
    shortPositions: number;
    collateralValueUsd: number;
    debtValueUsd: number;
    equityUsd: number;
    trackedOpenInterestUsd: number;
    longNotionalUsd: number;
    shortBorrowedExposureUsd: number;
    longDebtUsd: number;
    riskQueuePositions80: number;
    riskQueueNotional80Usd: number;
    syncedTransfers: number;
    syncedCashflows: number;
    syncedSnapshots: number;
    syncedEvents: number;
  };
  pools: PoolSummary[];
  traders: TraderSummary[];
  walletMaintenance: WalletMaintenanceSummary;
};

const emptyDashboard: DashboardData = {
  hasSnapshot: false,
  generatedAt: null,
  totals: {
    openPositions: 0,
    uniqueTraders: 0,
    pools: 0,
    longPositions: 0,
    shortPositions: 0,
    collateralValueUsd: 0,
    debtValueUsd: 0,
    equityUsd: 0,
    trackedOpenInterestUsd: 0,
    longNotionalUsd: 0,
    shortBorrowedExposureUsd: 0,
    longDebtUsd: 0,
    riskQueuePositions80: 0,
    riskQueueNotional80Usd: 0,
    syncedTransfers: 0,
    syncedCashflows: 0,
    syncedSnapshots: 0,
    syncedEvents: 0
  },
  pools: [],
  traders: [],
  walletMaintenance: emptyWalletMaintenanceSummary
};

function getDatabaseUrl() {
  return process.env.DATABASE_URL;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database access");
  }

  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function hasCurrentPositionsTable(client: Client) {
  return tableExists(client, "public.fx_current_positions");
}

async function latestSnapshotTime(client: Client) {
  if (!(await tableExists(client, "public.fx_current_position_syncs"))) return null;
  const result = await client.query<{ generated_at: Date }>(
    "select generated_at from public.fx_current_position_syncs order by generated_at desc limit 1"
  );
  return result.rows[0]?.generated_at?.toISOString?.() ?? null;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapTrader(row: Record<string, unknown>): TraderSummary {
  return {
    owner: String(row.owner),
    positions: toNumber(row.positions),
    pools: toNumber(row.pools),
    wstethLong: toNumber(row.wstethLong),
    wbtcLong: toNumber(row.wbtcLong),
    wstethShort: toNumber(row.wstethShort),
    wbtcShort: toNumber(row.wbtcShort),
    notionalValueUsd: toNumber(row.notionalValueUsd),
    ethLongExposureUsd: toNumber(row.ethLongExposureUsd),
    ethShortExposureUsd: toNumber(row.ethShortExposureUsd),
    ethNetExposureUsd: toNumber(row.ethNetExposureUsd),
    btcLongExposureUsd: toNumber(row.btcLongExposureUsd),
    btcShortExposureUsd: toNumber(row.btcShortExposureUsd),
    btcNetExposureUsd: toNumber(row.btcNetExposureUsd),
    collateralValueUsd: toNumber(row.collateralValueUsd),
    debtValueUsd: toNumber(row.debtValueUsd),
    equityUsd: toNumber(row.equityUsd),
    avgDebtRatio: toNumber(row.avgDebtRatio),
    maxDebtRatio: toNumber(row.maxDebtRatio),
    unrealizedPnlUsd: toNumber(row.unrealizedPnlUsd),
    totalPnlUsd: toNumber(row.totalPnlUsd),
    feesUsd: toNumber(row.feesUsd),
    hasPositionHistory: Boolean(row.hasPositionHistory)
  };
}

function mapPosition(row: Record<string, unknown>): PositionSummary {
  return {
    poolName: String(row.poolName),
    poolAddress: String(row.poolAddress),
    side: String(row.side),
    collateral: String(row.collateral),
    tokenId: String(row.tokenId),
    owner: String(row.owner),
    rawCollateral: String(row.rawCollateral),
    rawDebt: String(row.rawDebt),
    oraclePrice: toNumber(row.oraclePrice),
    entryPriceUsd: toNumber(row.entryPriceUsd),
    unrealizedPnlUsd: toNumber(row.unrealizedPnlUsd),
    collateralValueUsd: toNumber(row.collateralValueUsd),
    debtValueUsd: toNumber(row.debtValueUsd),
    equityUsd: toNumber(row.equityUsd),
    debtRatio: toNumber(row.debtRatio)
  };
}

const traderSelect = `
  select
    owner,
    count(*)::int as positions,
    count(distinct pool_address)::int as pools,
    count(*) filter (where pool_name = 'WstETHLongPool')::int as "wstethLong",
    count(*) filter (where pool_name = 'WBTCLongPool')::int as "wbtcLong",
    count(*) filter (where pool_name = 'WstETHShortPool')::int as "wstethShort",
    count(*) filter (where pool_name = 'WBTCShortPool')::int as "wbtcShort",
    coalesce(sum(collateral_value_usd) filter (where pool_name = 'WstETHLongPool'), 0)::float8 as "ethLongExposureUsd",
    coalesce(sum(debt_value_usd) filter (where pool_name = 'WstETHShortPool'), 0)::float8 as "ethShortExposureUsd",
    (
      coalesce(sum(collateral_value_usd) filter (where pool_name = 'WstETHLongPool'), 0) -
      coalesce(sum(debt_value_usd) filter (where pool_name = 'WstETHShortPool'), 0)
    )::float8 as "ethNetExposureUsd",
    coalesce(sum(collateral_value_usd) filter (where pool_name = 'WBTCLongPool'), 0)::float8 as "btcLongExposureUsd",
    coalesce(sum(debt_value_usd) filter (where pool_name = 'WBTCShortPool'), 0)::float8 as "btcShortExposureUsd",
    (
      coalesce(sum(collateral_value_usd) filter (where pool_name = 'WBTCLongPool'), 0) -
      coalesce(sum(debt_value_usd) filter (where pool_name = 'WBTCShortPool'), 0)
    )::float8 as "btcNetExposureUsd",
    coalesce(sum(
      case
        when side = 'long' then collateral_value_usd
        when side = 'short' then debt_value_usd
        else 0
      end
    ), 0)::float8 as "notionalValueUsd",
    coalesce(sum(collateral_value_usd), 0)::float8 as "collateralValueUsd",
    coalesce(sum(debt_value_usd), 0)::float8 as "debtValueUsd",
    coalesce(sum(equity_usd), 0)::float8 as "equityUsd",
    coalesce(avg(debt_ratio), 0)::float8 as "avgDebtRatio",
    coalesce(max(debt_ratio), 0)::float8 as "maxDebtRatio",
    coalesce(sum(
      case
        when ui_unrealized_pnl_usd is not null
          then ui_unrealized_pnl_usd
        when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
          then collateral_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
        when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
          then debt_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
        else 0
      end
    ), 0)::float8 as "unrealizedPnlUsd",
    (coalesce(sum(
      case
        when ui_unrealized_pnl_usd is not null
          then ui_unrealized_pnl_usd
        when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
          then collateral_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
        when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
          then debt_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
        else 0
      end
    ), 0)
    + coalesce(sum(
      case when side = 'short' then realized_pnl_raw / 1000000000000000000
           when collateral = 'WBTC' then realized_pnl_raw * oracle_price / 100000000
           else realized_pnl_raw * oracle_price / 1000000000000000000
      end
    ), 0))::float8 as "totalPnlUsd",
    coalesce(sum(
      total_fees_raw / 1000000000000000000
    ), 0)::float8 as "feesUsd",
    coalesce(bool_or(entry_price_raw is not null and entry_price_raw > 0), false) or coalesce(bool_or(realized_pnl_raw != 0), false) as "hasPositionHistory"
  from public.fx_current_positions
`;

export async function getDashboardData(): Promise<DashboardData> {
  if (!getDatabaseUrl()) {
    return emptyDashboard;
  }

  try {
    return await withClient(async (client) => {
      if (!(await hasCurrentPositionsTable(client))) {
        return emptyDashboard;
      }

      const [generatedAt, walletMaintenance, totalsResult, poolsResult, tradersResult] = await Promise.all([
        latestSnapshotTime(client),
        getWalletMaintenanceSummary(client),
        client.query<{
          open_positions: string;
          unique_traders: string;
          pools: string;
          long_positions: string;
          short_positions: string;
          collateral_value_usd: number;
          debt_value_usd: number;
          equity_usd: number;
          tracked_open_interest_usd: number;
          long_notional_usd: number;
          short_borrowed_exposure_usd: number;
          long_debt_usd: number;
          risk_queue_positions_80: string;
          risk_queue_notional_80_usd: number;
          synced_transfers: string;
          synced_cashflows: string;
          synced_snapshots: string;
        }>(`
          with position_totals as (
            select
              count(*)::text as open_positions,
              count(distinct owner)::text as unique_traders,
              count(distinct pool_address)::text as pools,
              count(*) filter (where side = 'long')::text as long_positions,
              count(*) filter (where side = 'short')::text as short_positions,
              coalesce(sum(collateral_value_usd), 0)::float8 as collateral_value_usd,
              coalesce(sum(debt_value_usd), 0)::float8 as debt_value_usd,
              coalesce(sum(equity_usd), 0)::float8 as equity_usd,
              (
                coalesce(sum(collateral_value_usd) filter (where side = 'long'), 0) +
                coalesce(sum(debt_value_usd) filter (where side = 'short'), 0)
              )::float8 as tracked_open_interest_usd,
              coalesce(sum(collateral_value_usd) filter (where side = 'long'), 0)::float8 as long_notional_usd,
              coalesce(sum(debt_value_usd) filter (where side = 'short'), 0)::float8 as short_borrowed_exposure_usd,
              coalesce(sum(debt_value_usd) filter (where side = 'long'), 0)::float8 as long_debt_usd,
              count(*) filter (where debt_ratio >= 0.8)::text as risk_queue_positions_80,
              coalesce(sum(
                case
                  when debt_ratio >= 0.8 and side = 'long' then collateral_value_usd
                  when debt_ratio >= 0.8 and side = 'short' then debt_value_usd
                  else 0
                end
              ), 0)::float8 as risk_queue_notional_80_usd
            from public.fx_current_positions
          ), event_totals as (
            select
              coalesce(to_regclass('public.fx_position_transfers') is not null, false) as has_transfers,
              coalesce(to_regclass('public.fx_position_cashflows') is not null, false) as has_cashflows,
              coalesce(to_regclass('public.fx_position_snapshots') is not null, false) as has_snapshots
          )
          select
            position_totals.*,
            case when event_totals.has_transfers then (select count(*)::text from public.fx_position_transfers) else '0' end as synced_transfers,
            case when event_totals.has_cashflows then (select count(*)::text from public.fx_position_cashflows) else '0' end as synced_cashflows,
            case when event_totals.has_snapshots then (select count(*)::text from public.fx_position_snapshots) else '0' end as synced_snapshots
          from position_totals, event_totals
        `),
        client.query<{
          pool_name: string;
          side: string;
          collateral: string;
          positions: string;
          unique_owners: string;
          raw_collateral: string;
          raw_debt: string;
          collateral_value_usd: number;
          debt_value_usd: number;
          equity_usd: number;
          avg_debt_ratio: number;
        }>(`
          select
            pool_name,
            side,
            collateral,
            count(*)::text as positions,
            count(distinct owner)::text as unique_owners,
            coalesce(sum(raw_collateral), 0)::text as raw_collateral,
            coalesce(sum(raw_debt), 0)::text as raw_debt,
            coalesce(sum(collateral_value_usd), 0)::float8 as collateral_value_usd,
            coalesce(sum(debt_value_usd), 0)::float8 as debt_value_usd,
            coalesce(sum(equity_usd), 0)::float8 as equity_usd,
            coalesce(avg(debt_ratio), 0)::float8 as avg_debt_ratio
          from public.fx_current_positions
          group by pool_name, side, collateral
          order by side, collateral, pool_name
        `),
        client.query<Record<string, unknown>>(`
          ${traderSelect}
          group by owner
          order by "notionalValueUsd" desc, positions desc, owner asc
        `)
      ]);

      const totals = totalsResult.rows[0];
      return {
        hasSnapshot: Number(totals?.open_positions ?? 0) > 0,
        generatedAt,
        totals: {
          openPositions: Number(totals?.open_positions ?? 0),
          uniqueTraders: Number(totals?.unique_traders ?? 0),
          pools: Number(totals?.pools ?? 0),
          longPositions: Number(totals?.long_positions ?? 0),
          shortPositions: Number(totals?.short_positions ?? 0),
          collateralValueUsd: toNumber(totals?.collateral_value_usd),
          debtValueUsd: toNumber(totals?.debt_value_usd),
          equityUsd: toNumber(totals?.equity_usd),
          trackedOpenInterestUsd: toNumber(totals?.tracked_open_interest_usd),
          longNotionalUsd: toNumber(totals?.long_notional_usd),
          shortBorrowedExposureUsd: toNumber(totals?.short_borrowed_exposure_usd),
          longDebtUsd: toNumber(totals?.long_debt_usd),
          riskQueuePositions80: Number(totals?.risk_queue_positions_80 ?? 0),
          riskQueueNotional80Usd: toNumber(totals?.risk_queue_notional_80_usd),
          syncedTransfers: Number(totals?.synced_transfers ?? 0),
          syncedCashflows: Number(totals?.synced_cashflows ?? 0),
          syncedSnapshots: Number(totals?.synced_snapshots ?? 0),
          syncedEvents:
            Number(totals?.synced_transfers ?? 0) +
            Number(totals?.synced_cashflows ?? 0) +
            Number(totals?.synced_snapshots ?? 0)
        },
        pools: poolsResult.rows.map((row) => ({
          poolName: row.pool_name,
          side: row.side,
          collateral: row.collateral,
          positions: Number(row.positions),
          uniqueOwners: Number(row.unique_owners),
          rawCollateral: row.raw_collateral,
          rawDebt: row.raw_debt,
          collateralValueUsd: toNumber(row.collateral_value_usd),
          debtValueUsd: toNumber(row.debt_value_usd),
          equityUsd: toNumber(row.equity_usd),
          avgDebtRatio: toNumber(row.avg_debt_ratio)
        })),
        traders: tradersResult.rows.map(mapTrader),
        walletMaintenance
      };
    });
  } catch (error) {
    console.error("Failed to load f(x) dashboard data", error);
    return emptyDashboard;
  }
}

export async function getPositionProfile(id: string): Promise<PositionSummary | null> {
  const [poolAddress, tokenId] = id.split("-");
  const normalizedPool = poolAddress?.toLowerCase();
  if (!getDatabaseUrl() || !/^0x[a-f0-9]{40}$/.test(normalizedPool ?? "") || !/^\d+$/.test(tokenId ?? "")) {
    return null;
  }

  try {
    return await withClient(async (client) => {
      if (!(await hasCurrentPositionsTable(client))) {
        return null;
      }
      const result = await client.query<Record<string, unknown>>(
        `select
           pool_name as "poolName",
           pool_address as "poolAddress",
           side,
           collateral,
           token_id::text as "tokenId",
           owner,
           raw_collateral::text as "rawCollateral",
           raw_debt::text as "rawDebt",
           coalesce(oracle_price, 0)::float8 as "oraclePrice",
           coalesce(
             ui_entry_price_usd,
             case
               when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
                 then entry_price_raw / 1000000000000000000
               when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
                 then 1000000000000000000::numeric / entry_price_raw
               else 0
             end
           )::float8 as "entryPriceUsd",
           coalesce(ui_unrealized_pnl_usd, 0)::float8 as "unrealizedPnlUsd",
           coalesce(collateral_value_usd, 0)::float8 as "collateralValueUsd",
           coalesce(debt_value_usd, 0)::float8 as "debtValueUsd",
           coalesce(equity_usd, 0)::float8 as "equityUsd",
           coalesce(debt_ratio, 0)::float8 as "debtRatio"
         from public.fx_current_positions
         where lower(pool_address) = $1 and token_id = $2::numeric
         limit 1`,
        [normalizedPool, tokenId]
      );
      const row = result.rows[0];
      return row ? mapPosition(row) : null;
    });
  } catch (error) {
    console.error("Failed to load f(x) position profile", error);
    return null;
  }
}

export async function getTraderProfile(address: string): Promise<TraderProfile | null> {
  const normalized = address.toLowerCase();
  if (!getDatabaseUrl() || !/^0x[a-f0-9]{40}$/.test(normalized)) {
    return null;
  }

  try {
    return await withClient(async (client) => {
      await upsertKnownWallet(client, normalized, "profile_page_load");

      if (!(await hasCurrentPositionsTable(client))) {
        return null;
      }
      const [generatedAt, summaryResult, positionsResult, historyResult] = await Promise.all([
        latestSnapshotTime(client),
        client.query<Record<string, unknown>>(
          `${traderSelect}
           where lower(owner) = $1
           group by owner
           limit 1`,
          [normalized]
        ),
        client.query<Record<string, unknown>>(
          `select
             pool_name as "poolName",
             pool_address as "poolAddress",
             side,
             collateral,
             token_id::text as "tokenId",
             owner,
             raw_collateral::text as "rawCollateral",
             raw_debt::text as "rawDebt",
             coalesce(oracle_price, 0)::float8 as "oraclePrice",
             coalesce(
               ui_entry_price_usd,
               case
                 when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
                   then entry_price_raw / 1000000000000000000
                 when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
                   then 1000000000000000000::numeric / entry_price_raw
                 else 0
               end
             )::float8 as "entryPriceUsd",
             coalesce(
               ui_unrealized_pnl_usd,
               case
                 when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
                   then collateral_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
                 when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
                   then debt_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
                 else 0
               end
             )::float8 as "unrealizedPnlUsd",
             coalesce(collateral_value_usd, 0)::float8 as "collateralValueUsd",
             coalesce(debt_value_usd, 0)::float8 as "debtValueUsd",
             coalesce(equity_usd, 0)::float8 as "equityUsd",
             coalesce(debt_ratio, 0)::float8 as "debtRatio"
           from public.fx_current_positions
           where lower(owner) = $1
           order by equity_usd desc nulls last, pool_name, token_id`,
          [normalized]
        ),
        client.query<Record<string, unknown>>(
          `with trader_cashflows as (
             select distinct pool_address, position_id
             from public.fx_position_cashflows
             where (lower(user_address) = $1 or lower(recipient_address) = $1)
               and position_id is not null
           ), pool_meta as (
             select distinct on (lower(pool_address))
               lower(pool_address) as pool_address,
               pool_name,
               side,
               collateral,
               oracle_price
             from public.fx_current_positions
             order by lower(pool_address), updated_at desc nulls last
           )
           select
             lower(h.pool_address) as "poolAddress",
             coalesce(p.pool_name, m.pool_name, h.pool_address) as "poolName",
             coalesce(p.side, m.side, 'unknown') as "side",
             h.position_id::text as "tokenId",
             coalesce(
               h.total_fees_raw / 1000000000000000000,
             0)::float8 as "feesUsd",
             h.cashflow_event_count as "cashflowEventCount",
             coalesce(
               case when coalesce(p.side, m.side, 'long') = 'short'
                 then h.realized_pnl_raw / 1000000000000000000
                 when coalesce(p.collateral, m.collateral) = 'WBTC'
                 then h.realized_pnl_raw * coalesce(p.oracle_price, m.oracle_price, 0) / 100000000
                 else h.realized_pnl_raw * coalesce(p.oracle_price, m.oracle_price, 0) / 1000000000000000000
               end,
             0)::float8 as "realizedPnlUsd",
             h.first_cashflow_block as "firstBlock",
             h.last_cashflow_block as "lastBlock",
             p.token_id is not null as "isOpen"
           from public.fx_position_pnl h
           join trader_cashflows tc on lower(tc.pool_address) = lower(h.pool_address) and tc.position_id = h.position_id
           left join public.fx_current_positions p
             on lower(p.pool_address) = lower(h.pool_address) and p.token_id = h.position_id
           left join pool_meta m
             on m.pool_address = lower(h.pool_address)
           order by h.last_cashflow_block desc nulls last`,
          [normalized]
        )
      ]);

      const summary = summaryResult.rows[0];
      if (!summary) return null;
      return {
        owner: String(summary.owner),
        generatedAt,
        summary: mapTrader(summary),
        positions: positionsResult.rows.map(mapPosition),
        history: historyResult.rows.map((row) => ({
          poolAddress: String(row.poolAddress),
          poolName: String(row.poolName),
          side: String(row.side),
          tokenId: String(row.tokenId),
          feesUsd: toNumber(row.feesUsd),
          realizedPnlUsd: toNumber(row.realizedPnlUsd),
          cashflowEventCount: Number(row.cashflowEventCount),
          firstBlock: Number(row.firstBlock),
          lastBlock: Number(row.lastBlock),
          isOpen: Boolean(row.isOpen),
        })),
      };
    });
  } catch (error) {
    console.error("Failed to load f(x) trader profile", error);
    return null;
  }
}

export function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatDate(value: string | null) {
  if (!value) return "No snapshot yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatUsd(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits
  }).format(value);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

export function displayInstrument(collateral: string) {
  return collateral.toLowerCase().includes("btc") ? "BTC" : "ETH";
}

export function displayPool(poolName: string) {
  const instrument = poolName.toLowerCase().includes("btc") ? "BTC" : "ETH";
  const side = poolName.toLowerCase().includes("short") ? "Short" : "Long";
  return `${instrument} ${side}`;
}
