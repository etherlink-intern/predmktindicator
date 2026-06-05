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

export type AverageEntryPriceBucket = {
  instrument: "ETH" | "BTC";
  bucketLowUsd: number;
  bucketHighUsd: number;
  bucketSizeUsd: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  longPositions: number;
  shortPositions: number;
  longOwners: number;
  shortOwners: number;
  longTopWalletShare: number;
  shortTopWalletShare: number;
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
  fundingWindowFeesUsd: number;
  fundingWindowFeeEvents: number;
  fundingWindowFeePositions: number;
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
  firstAt: string | null;
  lastAt: string | null;
  isOpen: boolean;
};

export type FundingFeeActivity = {
  poolAddress: string;
  poolName: string;
  side: string;
  tokenId: string;
  feesUsd: number;
  events: number;
  firstAt: string | null;
  lastAt: string | null;
  isOpen: boolean;
};

export type TraderProfile = {
  owner: string;
  generatedAt: string | null;
  summary: TraderSummary;
  positions: PositionSummary[];
  history: HistoricalPosition[];
  fundingFeeActivity: FundingFeeActivity[];
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
    fundingWindowStart: string | null;
    fundingWindowEnd: string | null;
    fundingWindowFeesUsd: number;
    fundingWindowFeeEvents: number;
    fundingWindowFeePositions: number;
    fundingWindowWallets: number
  };
  pools: PoolSummary[];
  averageEntryBook: {
    eth: Record<number, AverageEntryPriceBucket[]>;
    btc: Record<number, AverageEntryPriceBucket[]>;
  };
  oraclePrices: {
    eth: number;
    btc: number;
  };
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
    syncedEvents: 0,
    fundingWindowStart: null,
    fundingWindowEnd: null,
    fundingWindowFeesUsd: 0,
    fundingWindowFeeEvents: 0,
    fundingWindowFeePositions: 0,
    fundingWindowWallets: 0
  },
  pools: [],
  averageEntryBook: { eth: {}, btc: {} },
  oraclePrices: { eth: 0, btc: 0 },
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
    fundingWindowFeesUsd: toNumber(row.fundingWindowFeesUsd),
    fundingWindowFeeEvents: toNumber(row.fundingWindowFeeEvents),
    fundingWindowFeePositions: toNumber(row.fundingWindowFeePositions),
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

function mapAverageEntryPriceBucket(row: Record<string, unknown>): AverageEntryPriceBucket {
  const instrument = String(row.instrument) === "BTC" ? "BTC" : "ETH";
  return {
    instrument,
    bucketLowUsd: toNumber(row.bucketLowUsd),
    bucketHighUsd: toNumber(row.bucketHighUsd),
    bucketSizeUsd: toNumber(row.bucketSizeUsd),
    longNotionalUsd: toNumber(row.longNotionalUsd),
    shortNotionalUsd: toNumber(row.shortNotionalUsd),
    longPositions: toNumber(row.longPositions),
    shortPositions: toNumber(row.shortPositions),
    longOwners: toNumber(row.longOwners),
    shortOwners: toNumber(row.shortOwners),
    longTopWalletShare: toNumber(row.longTopWalletShare),
    shortTopWalletShare: toNumber(row.shortTopWalletShare)
  };
}

function groupBucketsBySize(buckets: AverageEntryPriceBucket[]): Record<number, AverageEntryPriceBucket[]> {
  const grouped: Record<number, AverageEntryPriceBucket[]> = {};
  for (const bucket of buckets) {
    const size = bucket.bucketSizeUsd;
    if (!grouped[size]) grouped[size] = [];
    grouped[size].push(bucket);
  }
  return grouped;
}


const fundingWindowSql = `
  select
    (
      date_trunc('day', now() at time zone 'UTC') +
      floor(extract(hour from now() at time zone 'UTC') / 8) * interval '8 hours'
    ) at time zone 'UTC' as window_start
`;

const feeRawSql = `
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
`;

const fundingFeeEventsSql = `
  with funding_window as (${fundingWindowSql}),
  fee_events as (
    select
      coalesce(
        nullif(lower(p.owner), ''),
        nullif(lower(o.owner), ''),
        nullif(lower(o.real_owner), ''),
        nullif(lower(c.user_address), ''),
        nullif(lower(c.recipient_address), '')
      ) as owner,
      lower(c.pool_address) as pool_address,
      c.position_id,
      c.block_timestamp,
      c.block_number,
      c.log_index,
      ${feeRawSql} as fee_raw
    from public.fx_position_cashflows c
    cross join funding_window w
    left join public.fx_current_positions p
      on lower(p.pool_address) = lower(c.pool_address)
      and p.token_id = c.position_id
    left join public.fx_official_positions o
      on lower(o.pool_address) = lower(c.pool_address)
      and o.position_id = c.position_id
    where c.source = 'manager'
      and c.position_id is not null
      and c.block_timestamp >= w.window_start
      and c.block_timestamp < w.window_start + interval '8 hours'
      and c.collateral_in_raw < 1000000000000000000000000
      and c.collateral_out_raw < 1000000000000000000000000
      and c.debt_increase_raw < 100000000000000000000000000000000
      and c.debt_decrease_raw < 100000000000000000000000000000000
  )
  select * from fee_events
`;

const fundingFeesByOwnerSql = `
  with fee_events as (${fundingFeeEventsSql})
  select
    owner,
    coalesce(sum(fee_raw / 1000000000000000000), 0)::float8 as fees_usd,
    count(*)::int as events,
    count(distinct (pool_address, position_id))::int as positions
  from fee_events
  where owner is not null
    and fee_raw > 0
  group by owner
`;

const traderSelect = `
  select
    public.fx_current_positions.owner as owner,
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
        when side = 'short' and ui_unrealized_pnl_usd is not null
          then ui_unrealized_pnl_usd
        when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
          then collateral_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
        when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
            and oracle_price is not null and oracle_price > 0
          then debt_value_usd * (1 - entry_price_raw::numeric / (oracle_price * 1000000000000000000))
        else 0
      end
    ), 0)::float8 as "unrealizedPnlUsd",
    (coalesce(sum(
      case
        when side = 'short' and ui_unrealized_pnl_usd is not null
          then ui_unrealized_pnl_usd
        when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
          then collateral_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
        when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
            and oracle_price is not null and oracle_price > 0
          then debt_value_usd * (1 - entry_price_raw::numeric / (oracle_price * 1000000000000000000))
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
    coalesce(max(fw.fees_usd), 0)::float8 as "fundingWindowFeesUsd",
    coalesce(max(fw.events), 0)::int as "fundingWindowFeeEvents",
    coalesce(max(fw.positions), 0)::int as "fundingWindowFeePositions",
    coalesce(bool_or(entry_price_raw is not null and entry_price_raw > 0), false) or coalesce(bool_or(realized_pnl_raw != 0), false) as "hasPositionHistory"
  from public.fx_current_positions
  left join (${fundingFeesByOwnerSql}) fw on fw.owner = lower(public.fx_current_positions.owner)
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

      const [generatedAt, walletMaintenance, totalsResult, poolsResult, averageEntryBookResult, tradersResult, oraclePricesResult] = await Promise.all([
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
          funding_window_start: Date | null;
          funding_window_end: Date | null;
          funding_window_fees_usd: number;
          funding_window_fee_events: string;
          funding_window_fee_positions: string;
          funding_window_wallets: string;
        }>(`
          with funding_window as (${fundingWindowSql}),
          funding_fee_events as (${fundingFeeEventsSql}),
          funding_fee_totals as (
            select
              coalesce(sum(fee_raw / 1000000000000000000) filter (where fee_raw > 0), 0)::float8 as funding_window_fees_usd,
              count(*) filter (where fee_raw > 0)::text as funding_window_fee_events,
              count(distinct (pool_address, position_id)) filter (where fee_raw > 0)::text as funding_window_fee_positions,
              count(distinct owner) filter (where owner is not null and fee_raw > 0)::text as funding_window_wallets
            from funding_fee_events
          ), position_totals as (
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
            case when event_totals.has_snapshots then (select count(*)::text from public.fx_position_snapshots) else '0' end as synced_snapshots,
            funding_window.window_start as funding_window_start,
            funding_window.window_start + interval '8 hours' as funding_window_end,
            funding_fee_totals.funding_window_fees_usd,
            funding_fee_totals.funding_window_fee_events,
            funding_fee_totals.funding_window_fee_positions,
            funding_fee_totals.funding_window_wallets
          from position_totals, event_totals, funding_window, funding_fee_totals
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
          with base_positions as (
            select
              case when collateral = 'WBTC' then 'BTC' else 'ETH' end as instrument,
              side,
              lower(owner) as owner,
              token_id,
              ui_entry_price_usd,
              case
                when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
                  then entry_price_raw / 1000000000000000000
                when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
                  then 1000000000000000000::numeric / entry_price_raw
                else null
              end as fallback_entry_price_usd,
              case
                when side = 'long' then coalesce(collateral_value_usd, 0)
                when side = 'short' then coalesce(debt_value_usd, 0)
                else 0
              end as notional_usd
            from public.fx_current_positions
            where side in ('long', 'short')
              and owner is not null
              and (entry_price_raw is not null or ui_entry_price_usd is not null)
          ), wallet_side_average as (
            select
              instrument,
              side,
              owner,
              count(*)::int as open_position_count,
              case when side = 'short' then (
                sum(coalesce(ui_entry_price_usd, fallback_entry_price_usd) * notional_usd)
                / nullif(sum(notional_usd) filter (where coalesce(ui_entry_price_usd, fallback_entry_price_usd) is not null), 0)
              ) else (
                sum(fallback_entry_price_usd * notional_usd)
                / nullif(sum(notional_usd) filter (where fallback_entry_price_usd is not null), 0)
              ) end as weighted_average_entry_price_usd
            from base_positions
            where notional_usd > 0
            group by instrument, side, owner
          ), positioned_entries as (
            select
              p.instrument,
              p.side,
              p.owner,
              p.token_id,
              case
                when p.side = 'short' then coalesce(
                  p.ui_entry_price_usd,
                  case when w.open_position_count > 1 then w.weighted_average_entry_price_usd end,
                  p.fallback_entry_price_usd
                )
                else coalesce(
                  case when w.open_position_count > 1 then w.weighted_average_entry_price_usd end,
                  p.fallback_entry_price_usd
                )
              end as avg_entry_price_usd,
              p.notional_usd
            from base_positions p
            left join wallet_side_average w
              on w.instrument = p.instrument
              and w.side = p.side
              and w.owner = p.owner
          ), sizes as (
            select 50::numeric as bucket_size_usd, 'ETH' as instrument
            union all select 100, 'ETH'
            union all select 200, 'ETH'
            union all select 500, 'ETH'
            union all select 500, 'BTC'
            union all select 1000, 'BTC'
            union all select 2000, 'BTC'
            union all select 5000, 'BTC'
          ), buckets as (
            select
              p.instrument,
              s.bucket_size_usd,
              floor(p.avg_entry_price_usd / s.bucket_size_usd) * s.bucket_size_usd as bucket_low_usd,
              p.side,
              p.owner,
              p.notional_usd
            from positioned_entries p
            cross join sizes s
            where s.instrument = p.instrument
              and p.avg_entry_price_usd is not null
              and p.avg_entry_price_usd > 0
              and p.notional_usd > 0
          ), owner_bucket_side as (
            select
              instrument,
              bucket_size_usd,
              bucket_low_usd,
              side,
              owner,
              sum(notional_usd) as owner_notional_usd,
              count(*)::int as owner_positions
            from buckets
            group by instrument, bucket_size_usd, bucket_low_usd, side, owner
          ), grouped as (
            select
              instrument,
              bucket_low_usd,
              bucket_low_usd + bucket_size_usd as bucket_high_usd,
              bucket_size_usd,
              coalesce(sum(owner_notional_usd) filter (where side = 'long'), 0) as long_notional_usd,
              coalesce(sum(owner_notional_usd) filter (where side = 'short'), 0) as short_notional_usd,
              coalesce(sum(owner_positions) filter (where side = 'long'), 0)::int as long_positions,
              coalesce(sum(owner_positions) filter (where side = 'short'), 0)::int as short_positions,
              count(*) filter (where side = 'long')::int as long_owners,
              count(*) filter (where side = 'short')::int as short_owners,
              coalesce(
                max(owner_notional_usd) filter (where side = 'long')
                / nullif(sum(owner_notional_usd) filter (where side = 'long'), 0),
                0
              ) as long_top_wallet_share,
              coalesce(
                max(owner_notional_usd) filter (where side = 'short')
                / nullif(sum(owner_notional_usd) filter (where side = 'short'), 0),
                0
              ) as short_top_wallet_share
            from owner_bucket_side
            group by instrument, bucket_size_usd, bucket_low_usd
          )
          select
            instrument,
            bucket_low_usd::float8 as "bucketLowUsd",
            bucket_high_usd::float8 as "bucketHighUsd",
            bucket_size_usd::float8 as "bucketSizeUsd",
            long_notional_usd::float8 as "longNotionalUsd",
            short_notional_usd::float8 as "shortNotionalUsd",
            long_positions::int as "longPositions",
            short_positions::int as "shortPositions",
            long_owners::int as "longOwners",
            short_owners::int as "shortOwners",
            long_top_wallet_share::float8 as "longTopWalletShare",
            short_top_wallet_share::float8 as "shortTopWalletShare"
          from grouped
          order by instrument asc, bucket_size_usd asc, bucket_low_usd desc
        `),
        client.query<Record<string, unknown>>(`
          ${traderSelect}
          group by public.fx_current_positions.owner
          order by "notionalValueUsd" desc, positions desc, owner asc
        `),
        client.query<{ instrument: string; oracle_price: number }>(`
          select distinct on (case when pool_name like '%BTC%' then 'BTC' else 'ETH' end)
            case when pool_name like '%BTC%' then 'BTC' else 'ETH' end as instrument,
            oracle_price::float8 as oracle_price
          from public.fx_current_positions
          where oracle_price > 0
          order by case when pool_name like '%BTC%' then 'BTC' else 'ETH' end, pool_name
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
            Number(totals?.synced_snapshots ?? 0),
          fundingWindowStart: totals?.funding_window_start?.toISOString?.() ?? null,
          fundingWindowEnd: totals?.funding_window_end?.toISOString?.() ?? null,
          fundingWindowFeesUsd: toNumber(totals?.funding_window_fees_usd),
          fundingWindowFeeEvents: Number(totals?.funding_window_fee_events ?? 0),
          fundingWindowFeePositions: Number(totals?.funding_window_fee_positions ?? 0),
          fundingWindowWallets: Number(totals?.funding_window_wallets ?? 0)
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
        averageEntryBook: {
          eth: groupBucketsBySize(averageEntryBookResult.rows.map(mapAverageEntryPriceBucket).filter((bucket) => bucket.instrument === "ETH")),
          btc: groupBucketsBySize(averageEntryBookResult.rows.map(mapAverageEntryPriceBucket).filter((bucket) => bucket.instrument === "BTC"))
        },
        oraclePrices: {
          eth: toNumber((oraclePricesResult.rows as any[]).find((r: any) => r.instrument === 'ETH')?.oracle_price),
          btc: toNumber((oraclePricesResult.rows as any[]).find((r: any) => r.instrument === 'BTC')?.oracle_price)
        },
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
             case
               when side = 'short' then ui_entry_price_usd
               else null
             end,
             case
               when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
                 then entry_price_raw / 1000000000000000000
               when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
                 then 1000000000000000000::numeric / entry_price_raw
               else 0
             end
           )::float8 as "entryPriceUsd",
           coalesce(
             case
               when side = 'short' then ui_unrealized_pnl_usd
               else null
             end,
             case
               when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
                 then collateral_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
               when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
                   and oracle_price is not null and oracle_price > 0
                 then debt_value_usd * (1 - entry_price_raw::numeric / (oracle_price * 1000000000000000000))
               else 0
             end
           )::float8 as "unrealizedPnlUsd",
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
      const [generatedAt, summaryResult, closedSummaryResult, positionsResult, historyResult, fundingActivityResult] = await Promise.all([
        latestSnapshotTime(client),
        client.query<Record<string, unknown>>(
          `${traderSelect}
           where lower(public.fx_current_positions.owner) = $1
           group by public.fx_current_positions.owner
           limit 1`,
          [normalized]
        ),
        client.query<Record<string, unknown>>(
          `with pool_meta as (
             select distinct on (lower(pool_address))
               lower(pool_address) as pool_address,
               oracle_price
             from public.fx_current_positions
             where oracle_price is not null and oracle_price > 0
             order by lower(pool_address), updated_at desc nulls last
           ), pool_side as (
             select distinct on (lower(pool_address))
               lower(pool_address) as pool_address,
               pool_name,
               side,
               collateral
             from public.fx_current_positions
             order by lower(pool_address), updated_at desc nulls last
           ), pnl_owner_positions as (
             select distinct lower(owner) as owner, lower(pool_address) as pool_address, position_id
             from public.fx_official_positions
             where owner is not null
             union
             select distinct lower(real_owner) as owner, lower(pool_address) as pool_address, position_id
             from public.fx_official_positions
             where real_owner is not null
             union
             select distinct lower(user_address) as owner, lower(pool_address) as pool_address, position_id
             from public.fx_position_cashflows
             where user_address is not null and position_id is not null
             union
             select distinct lower(recipient_address) as owner, lower(pool_address) as pool_address, position_id
             from public.fx_position_cashflows
             where recipient_address is not null and position_id is not null
           )
           select
             op.owner,
             0::int as positions,
             0::int as pools,
             0::int as "wstethLong",
             0::int as "wbtcLong",
             0::int as "wstethShort",
             0::int as "wbtcShort",
             0::float8 as "ethLongExposureUsd",
             0::float8 as "ethShortExposureUsd",
             0::float8 as "ethNetExposureUsd",
             0::float8 as "btcLongExposureUsd",
             0::float8 as "btcShortExposureUsd",
             0::float8 as "btcNetExposureUsd",
             0::float8 as "notionalValueUsd",
             0::float8 as "collateralValueUsd",
             0::float8 as "debtValueUsd",
             0::float8 as "equityUsd",
             0::float8 as "avgDebtRatio",
             0::float8 as "maxDebtRatio",
             0::float8 as "unrealizedPnlUsd",
             coalesce(sum(
               case
                 when coalesce(po.side, ps.side, 'long') = 'short' then pp.realized_pnl_raw / 1000000000000000000
                 when coalesce(po.collateral, ps.collateral) = 'WBTC' then pp.realized_pnl_raw * coalesce(pm.oracle_price, 0) / 100000000
                 else pp.realized_pnl_raw * coalesce(pm.oracle_price, 0) / 1000000000000000000
               end
             ), 0)::float8 as "totalPnlUsd",
             coalesce(sum(pp.total_fees_raw / 1000000000000000000), 0)::float8 as "feesUsd",
             0::float8 as "fundingWindowFeesUsd",
             0::int as "fundingWindowFeeEvents",
             0::int as "fundingWindowFeePositions",
             true as "hasPositionHistory"
           from pnl_owner_positions op
           join public.fx_position_pnl pp
             on lower(pp.pool_address) = op.pool_address
             and pp.position_id = op.position_id
           left join public.fx_official_positions po
             on lower(po.pool_address) = lower(pp.pool_address)
             and po.position_id = pp.position_id
           left join pool_side ps on ps.pool_address = lower(pp.pool_address)
           left join pool_meta pm on pm.pool_address = lower(pp.pool_address)
           where op.owner = $1
           group by op.owner
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
               case
                 when side = 'short' then ui_entry_price_usd
                 else null
               end,
               case
                 when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
                   then entry_price_raw / 1000000000000000000
                 when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
                   then 1000000000000000000::numeric / entry_price_raw
                 else 0
               end
             )::float8 as "entryPriceUsd",
             coalesce(
               case
                 when side = 'short' then ui_unrealized_pnl_usd
                 else null
               end,
               case
                 when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
                   then collateral_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
                 when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
                     and oracle_price is not null and oracle_price > 0
                   then debt_value_usd * (1 - entry_price_raw::numeric / (oracle_price * 1000000000000000000))
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
             select distinct c.pool_address, c.position_id
             from public.fx_position_cashflows c
             left join public.fx_official_positions o
               on lower(o.pool_address) = lower(c.pool_address)
               and o.position_id = c.position_id
             where c.position_id is not null
               and (
                 lower(c.user_address) = $1
                 or lower(c.recipient_address) = $1
                 or lower(o.owner) = $1
                 or lower(o.real_owner) = $1
               )
           ), event_times as (
             select lower(pool_address) as pool_address, position_id, min(block_timestamp) as first_at, max(block_timestamp) as last_at
             from public.fx_position_cashflows
             where block_timestamp is not null
             group by lower(pool_address), position_id
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
             coalesce(p.pool_name, o.pool_name, m.pool_name, h.pool_address) as "poolName",
             coalesce(p.side, o.side, m.side, 'unknown') as "side",
             h.position_id::text as "tokenId",
             coalesce(
               h.total_fees_raw / 1000000000000000000,
             0)::float8 as "feesUsd",
             h.cashflow_event_count as "cashflowEventCount",
             coalesce(
               case when coalesce(p.side, o.side, m.side, 'long') = 'short'
                 then h.realized_pnl_raw / 1000000000000000000
                 when coalesce(p.collateral, o.collateral, m.collateral) = 'WBTC'
                 then h.realized_pnl_raw * coalesce(p.oracle_price, m.oracle_price, 0) / 100000000
                 else h.realized_pnl_raw * coalesce(p.oracle_price, m.oracle_price, 0) / 1000000000000000000
               end,
             0)::float8 as "realizedPnlUsd",
             h.first_cashflow_block as "firstBlock",
             h.last_cashflow_block as "lastBlock",
             et.first_at as "firstAt",
             et.last_at as "lastAt",
             p.token_id is not null as "isOpen"
           from public.fx_position_pnl h
           join trader_cashflows tc on lower(tc.pool_address) = lower(h.pool_address) and tc.position_id = h.position_id
           left join public.fx_current_positions p
             on lower(p.pool_address) = lower(h.pool_address) and p.token_id = h.position_id
           left join public.fx_official_positions o
             on lower(o.pool_address) = lower(h.pool_address) and o.position_id = h.position_id
           left join event_times et
             on et.pool_address = lower(h.pool_address) and et.position_id = h.position_id
           left join pool_meta m
             on m.pool_address = lower(h.pool_address)
           order by h.last_cashflow_block desc nulls last`,
          [normalized]
        ),
        client.query<Record<string, unknown>>(
          `with fee_events as (${fundingFeeEventsSql}),
           pool_meta as (
             select distinct on (lower(pool_address))
               lower(pool_address) as pool_address,
               pool_name,
               side,
               collateral
             from public.fx_current_positions
             order by lower(pool_address), updated_at desc nulls last
           )
           select
             e.pool_address as "poolAddress",
             coalesce(p.pool_name, m.pool_name, o.pool_name, e.pool_address) as "poolName",
             coalesce(p.side, m.side, o.side, 'unknown') as "side",
             e.position_id::text as "tokenId",
             coalesce(sum(e.fee_raw / 1000000000000000000), 0)::float8 as "feesUsd",
             count(*)::int as "events",
             min(e.block_timestamp) as "firstAt",
             max(e.block_timestamp) as "lastAt",
             p.token_id is not null as "isOpen"
           from fee_events e
           left join public.fx_current_positions p
             on lower(p.pool_address) = e.pool_address
             and p.token_id = e.position_id
           left join public.fx_official_positions o
             on lower(o.pool_address) = e.pool_address
             and o.position_id = e.position_id
           left join pool_meta m on m.pool_address = e.pool_address
           where e.owner = $1
             and e.fee_raw > 0
           group by e.pool_address, e.position_id, coalesce(p.pool_name, m.pool_name, o.pool_name, e.pool_address), coalesce(p.side, m.side, o.side, 'unknown'), p.token_id
           order by max(e.block_timestamp) desc nulls last, sum(e.fee_raw) desc`,
          [normalized]
        )
      ]);

      const summary = summaryResult.rows[0] ?? closedSummaryResult.rows[0];
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
          firstAt: row.firstAt instanceof Date ? row.firstAt.toISOString() : null,
          lastAt: row.lastAt instanceof Date ? row.lastAt.toISOString() : null,
          isOpen: Boolean(row.isOpen),
        })),
        fundingFeeActivity: fundingActivityResult.rows.map((row) => ({
          poolAddress: String(row.poolAddress),
          poolName: String(row.poolName),
          side: String(row.side),
          tokenId: String(row.tokenId),
          feesUsd: toNumber(row.feesUsd),
          events: Number(row.events ?? 0),
          firstAt: row.firstAt instanceof Date ? row.firstAt.toISOString() : null,
          lastAt: row.lastAt instanceof Date ? row.lastAt.toISOString() : null,
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

export type TopTrader = {
  address: string;
  totalPnlUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  notionalUsd: number;
  capitalUsedUsd: number;
  roi: number;
  openPositions: number;
  closedPositions: number;
  totalPositions: number;
  winRate: number;
  maxDebtRatio: number;
  equityUsd: number;
  feesUsd: number;
};

export async function getTopTraders(): Promise<TopTrader[]> {
  if (!getDatabaseUrl()) return [];

  return withClient(async (client) => {
    if (!(await hasCurrentPositionsTable(client)) || !(await tableExists(client, "public.fx_position_pnl"))) {
      return [];
    }

    const result = await client.query<Record<string, unknown>>(`
      with current_trader as (
        select
          lower(owner) as owner,
          count(*)::int as open_positions,
          coalesce(
            sum(collateral_value_usd) filter (where side = 'long'), 0
          ) + coalesce(
            sum(debt_value_usd) filter (where side = 'short'), 0
          ) as notional_usd,
          coalesce(sum(
            case
              when side = 'short' and ui_unrealized_pnl_usd is not null
                then ui_unrealized_pnl_usd
              when side = 'long' and entry_price_raw is not null and entry_price_raw > 0
                then collateral_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
              when side = 'short' and entry_price_raw is not null and entry_price_raw > 0
                  and oracle_price is not null and oracle_price > 0
                then debt_value_usd * (1 - entry_price_raw::numeric / (oracle_price * 1000000000000000000))
              else 0
            end
          ), 0) as unrealized_pnl_usd,
          coalesce(sum(collateral_value_usd), 0) as capital_used_usd,
          max(debt_ratio) as max_debt_ratio,
          coalesce(sum(equity_usd), 0) as equity_usd
        from public.fx_current_positions
        where owner is not null
        group by lower(owner)
      ),
      pool_meta as (
        select distinct on (lower(pool_address))
          lower(pool_address) as pool_address,
          oracle_price
        from public.fx_current_positions
        where oracle_price is not null and oracle_price > 0
        order by lower(pool_address), updated_at desc nulls last
      ),
      pnl_owner_positions as (
        select distinct lower(owner) as owner, lower(pool_address) as pool_address, position_id
        from public.fx_official_positions
        where owner is not null
        union
        select distinct lower(real_owner) as owner, lower(pool_address) as pool_address, position_id
        from public.fx_official_positions
        where real_owner is not null
        union
        select distinct lower(user_address) as owner, lower(pool_address) as pool_address, position_id
        from public.fx_position_cashflows
        where user_address is not null and position_id is not null
        union
        select distinct lower(recipient_address) as owner, lower(pool_address) as pool_address, position_id
        from public.fx_position_cashflows
        where recipient_address is not null and position_id is not null
      ),
      closed_trader as (
        select
          op.owner,
          coalesce(sum(
            case
              when coalesce(po.side, pm_side.side, 'long') = 'short' then pp.realized_pnl_raw / 1000000000000000000
              when coalesce(po.collateral, pm_side.collateral) = 'WBTC' then pp.realized_pnl_raw * coalesce(pm.oracle_price, 0) / 100000000
              else pp.realized_pnl_raw * coalesce(pm.oracle_price, 0) / 1000000000000000000
            end
          ), 0) as realized_pnl_usd,
          coalesce(sum(pp.total_fees_raw), 0) as total_fees_raw,
          count(*)::int as closed_positions,
          count(*) filter (where pp.realized_pnl_raw > 0)::int as winning_positions
        from pnl_owner_positions op
        join public.fx_position_pnl pp
          on lower(pp.pool_address) = op.pool_address
          and pp.position_id = op.position_id
        left join public.fx_official_positions po
          on lower(po.pool_address) = lower(pp.pool_address)
          and po.position_id = pp.position_id
        left join (
          select distinct on (lower(pool_address))
            lower(pool_address) as pool_address, side, collateral
          from public.fx_current_positions
          order by lower(pool_address), updated_at desc nulls last
        ) pm_side on pm_side.pool_address = lower(pp.pool_address)
        left join pool_meta pm on pm.pool_address = lower(pp.pool_address)
        group by op.owner
      ),
      combined as (
        select
          coalesce(ct.owner, cl.owner) as owner,
          coalesce(ct.open_positions, 0) as open_positions,
          coalesce(cl.closed_positions, 0) as closed_positions,
          coalesce(ct.notional_usd, 0) as notional_usd,
          coalesce(ct.unrealized_pnl_usd, 0) as unrealized_pnl_usd,
          coalesce(cl.realized_pnl_usd, 0) as realized_pnl_usd,
          coalesce(cl.total_fees_raw, 0) as total_fees_raw,
          coalesce(cl.winning_positions, 0) as winning_positions,
          coalesce(ct.max_debt_ratio, 0) as max_debt_ratio,
          coalesce(ct.equity_usd, 0) as equity_usd,
          coalesce(ct.capital_used_usd, 0) as capital_used_usd
        from current_trader ct
        full outer join closed_trader cl on ct.owner = cl.owner
      )
      select
        owner,
        open_positions::int as open_positions,
        closed_positions::int as closed_positions,
        notional_usd::float8 as notional_usd,
        unrealized_pnl_usd::float8 as unrealized_pnl_usd,
        realized_pnl_usd::float8 as realized_pnl_usd,
        total_fees_raw::numeric as total_fees_raw,
        winning_positions::int as winning_positions,
        max_debt_ratio::float8 as max_debt_ratio,
        equity_usd::float8 as equity_usd,
        capital_used_usd::float8 as capital_used_usd
      from combined
      where notional_usd > 1000 or closed_positions > 0
      order by owner asc
    `);

    const traders: TopTrader[] = result.rows.map((row: any) => {
      const unrealizedPnl = Number(row.unrealized_pnl_usd ?? 0);
      const realizedPnlUsd = Number(row.realized_pnl_usd ?? 0);
      const totalPnl = unrealizedPnl + realizedPnlUsd;
      const feesRaw = row.total_fees_raw ? Number(row.total_fees_raw) : 0;
      const feesUsd = feesRaw / 1e18;
      const closedPositions = Number(row.closed_positions ?? 0);
      const winningPositions = Number(row.winning_positions ?? 0);
      const winRate = closedPositions > 0 ? winningPositions / closedPositions : 0;
      const notional = Number(row.notional_usd ?? 0);
      const capitalUsed = Number(row.capital_used_usd ?? 0);
      const effectiveCapital = Math.max(capitalUsed, notional, 1);
      const roi = totalPnl / effectiveCapital;

      return {
        address: String(row.owner),
        totalPnlUsd: totalPnl,
        unrealizedPnlUsd: unrealizedPnl,
        realizedPnlUsd: realizedPnlUsd,
        notionalUsd: notional,
        capitalUsedUsd: capitalUsed,
        roi,
        openPositions: Number(row.open_positions ?? 0),
        closedPositions,
        totalPositions: Number(row.open_positions ?? 0) + closedPositions,
        winRate,
        maxDebtRatio: Number(row.max_debt_ratio ?? 0),
        equityUsd: Number(row.equity_usd ?? 0),
        feesUsd,
      };
    });

    return traders;
  });
}


export type CapitalFlowPeriod = "7d" | "30d" | "all";

export type CapitalFlowEvent = {
  wallet: string;
  poolName: string;
  asset: string;
  side: string;
  positionId: string;
  direction: "deposit" | "withdrawal";
  amountUsd: number;
  blockTimestamp: string | null;
};

export type CapitalFlowCohort = {
  cohort: string;
  wallets: number;
  depositsUsd: number;
  withdrawalsUsd: number;
  netFlowUsd: number;
  explanation: string;
};

export type CapitalFlowData = {
  period: CapitalFlowPeriod;
  summary: {
    netFlowUsd: number;
    depositsUsd: number;
    withdrawalsUsd: number;
    newCapitalUsd: number;
    returningCapitalUsd: number;
    wallets: number;
    events: number;
  };
  cohorts: CapitalFlowCohort[];
  largestDeposits: CapitalFlowEvent[];
  largestWithdrawals: CapitalFlowEvent[];
};

export type ResearchInsightCard = {
  slug: string;
  kicker: string;
  title: string;
  summary: string;
  metric: string;
  href: string;
  tone: "positive" | "negative" | "warning" | "neutral";
};

export type ConvictionPosition = {
  wallet: string;
  poolAddress: string;
  tokenId: string;
  asset: string;
  direction: string;
  positionSizeUsd: number;
  entryPriceUsd: number;
  leverage: number;
  liquidationDistancePct: number;
  pnlUsd: number;
};

export type ArchetypeWallet = {
  address: string;
  reason: string;
  metric: string;
};

export type TraderArchetype = {
  name: string;
  description: string;
  wallets: ArchetypeWallet[];
};

export type ProtocolHealthMetric = {
  label: string;
  value: string;
  explanation: string;
  tone: "positive" | "negative" | "warning" | "neutral";
};

export type ResearchData = {
  dashboard: DashboardData;
  cards: ResearchInsightCard[];
  capitalFlows: CapitalFlowData;
  conviction: ConvictionPosition[];
  archetypes: TraderArchetype[];
  protocolHealth: ProtocolHealthMetric[];
};

function normalizePeriod(period?: string | null): CapitalFlowPeriod {
  return period === "30d" || period === "all" ? period : "7d";
}

function periodWhereSql(alias = "e") {
  return `($1 = 'all' or ${alias}.block_timestamp >= now() - case when $1 = '30d' then interval '30 days' else interval '7 days' end)`;
}

const capitalFlowEventsCte = `
  with pool_meta as (
    select distinct on (lower(pool_address))
      lower(pool_address) as pool_address,
      pool_name,
      side,
      collateral,
      oracle_price
    from public.fx_current_positions
    order by lower(pool_address), updated_at desc nulls last
  ), base as (
    select
      coalesce(nullif(lower(p.owner), ''), nullif(lower(o.owner), ''), nullif(lower(o.real_owner), ''), nullif(lower(c.user_address), ''), nullif(lower(c.recipient_address), '')) as wallet,
      lower(c.pool_address) as pool_address,
      coalesce(p.pool_name, o.pool_name, m.pool_name, c.pool_address) as pool_name,
      coalesce(p.side, o.side, m.side, 'unknown') as side,
      coalesce(p.collateral, o.collateral, m.collateral, '') as collateral,
      coalesce(p.oracle_price, m.oracle_price, 0) as oracle_price,
      c.position_id,
      c.collateral_in_raw,
      c.collateral_out_raw,
      c.block_timestamp,
      c.log_index
    from public.fx_position_cashflows c
    left join public.fx_current_positions p
      on lower(p.pool_address) = lower(c.pool_address) and p.token_id = c.position_id
    left join public.fx_official_positions o
      on lower(o.pool_address) = lower(c.pool_address) and o.position_id = c.position_id
    left join pool_meta m on m.pool_address = lower(c.pool_address)
    where c.source = 'manager'
      and c.position_id is not null
      and c.block_timestamp is not null
      and (c.collateral_in_raw > 0 or c.collateral_out_raw > 0)
      and c.collateral_in_raw < 1000000000000000000000000
      and c.collateral_out_raw < 1000000000000000000000000
  ), flow_events as (
    select
      wallet, pool_address, pool_name, side, collateral, position_id, block_timestamp, log_index,
      'deposit'::text as direction,
      case
        when side = 'long' and collateral = 'WBTC' then collateral_in_raw * oracle_price / 100000000
        when side = 'long' then collateral_in_raw * oracle_price / 1000000000000000000
        else collateral_in_raw / 1000000000000000000
      end as amount_usd
    from base
    where collateral_in_raw > 0
    union all
    select
      wallet, pool_address, pool_name, side, collateral, position_id, block_timestamp, log_index,
      'withdrawal'::text as direction,
      case
        when side = 'long' and collateral = 'WBTC' then collateral_out_raw * oracle_price / 100000000
        when side = 'long' then collateral_out_raw * oracle_price / 1000000000000000000
        else collateral_out_raw / 1000000000000000000
      end as amount_usd
    from base
    where collateral_out_raw > 0
  ), enriched as (
    select
      e.*,
      min(block_timestamp) filter (where direction = 'deposit') over (partition by wallet) as first_deposit_at,
      case
        when direction = 'deposit'
          then row_number() over (partition by wallet, direction order by block_timestamp asc, log_index asc)
        else null
      end as deposit_rank
    from flow_events e
    where wallet is not null and amount_usd > 1
  )
`;

function mapCapitalFlowEvent(row: Record<string, unknown>): CapitalFlowEvent {
  return {
    wallet: String(row.wallet),
    poolName: String(row.poolName),
    asset: displayInstrument(String(row.collateral || row.poolName)),
    side: String(row.side),
    positionId: String(row.positionId),
    direction: String(row.direction) === "withdrawal" ? "withdrawal" : "deposit",
    amountUsd: toNumber(row.amountUsd),
    blockTimestamp: row.blockTimestamp instanceof Date ? row.blockTimestamp.toISOString() : null,
  };
}

export async function getCapitalFlowData(periodInput?: string | null): Promise<CapitalFlowData> {
  const period = normalizePeriod(periodInput);
  const empty: CapitalFlowData = {
    period,
    summary: { netFlowUsd: 0, depositsUsd: 0, withdrawalsUsd: 0, newCapitalUsd: 0, returningCapitalUsd: 0, wallets: 0, events: 0 },
    cohorts: [],
    largestDeposits: [],
    largestWithdrawals: []
  };
  if (!getDatabaseUrl()) return empty;

  try {
    return await withClient(async (client) => {
      if (!(await tableExists(client, "public.fx_position_cashflows"))) return empty;
      const where = periodWhereSql("e");
      const [summaryResult, cohortResult, depositResult, withdrawalResult] = await Promise.all([
        client.query<Record<string, unknown>>(`${capitalFlowEventsCte}
          select
            coalesce(sum(amount_usd) filter (where direction = 'deposit' and ${where}), 0)::float8 as "depositsUsd",
            coalesce(sum(amount_usd) filter (where direction = 'withdrawal' and ${where}), 0)::float8 as "withdrawalsUsd",
            coalesce(sum(amount_usd) filter (where direction = 'deposit' and deposit_rank = 1 and ${where}), 0)::float8 as "newCapitalUsd",
            coalesce(sum(amount_usd) filter (where direction = 'deposit' and coalesce(deposit_rank, 2) > 1 and ${where}), 0)::float8 as "returningCapitalUsd",
            count(distinct wallet) filter (where ${where})::int as wallets,
            count(*) filter (where ${where})::int as events
          from enriched e`, [period]),
        client.query<Record<string, unknown>>(`${capitalFlowEventsCte}, period_events as (
            select * from enriched e where ${where}
          ), wallet_stats as (
            select wallet,
              coalesce(sum(amount_usd) filter (where direction = 'deposit'), 0) as deposits_usd,
              coalesce(sum(amount_usd) filter (where direction = 'withdrawal'), 0) as withdrawals_usd,
              count(*) filter (where direction = 'deposit') as deposit_events,
              max(amount_usd) filter (where direction = 'deposit') as largest_deposit_usd,
              min(first_deposit_at) as first_deposit_at
            from period_events
            group by wallet
          ), cohorts as (
            select
              case
                when first_deposit_at >= (case when $1 = 'all' then timestamp 'epoch' else now() - case when $1 = '30d' then interval '30 days' else interval '7 days' end end) and deposit_events > 0 then 'New wallets'
                when largest_deposit_usd >= 100000 then 'Whale deposits'
                when deposit_events >= 3 then 'Active adders'
                else 'Returning wallets'
              end as cohort,
              wallet, deposits_usd, withdrawals_usd
            from wallet_stats
          )
          select cohort,
            count(*)::int as wallets,
            coalesce(sum(deposits_usd), 0)::float8 as "depositsUsd",
            coalesce(sum(withdrawals_usd), 0)::float8 as "withdrawalsUsd"
          from cohorts
          group by cohort
          order by coalesce(sum(deposits_usd), 0) - coalesce(sum(withdrawals_usd), 0) desc`, [period]),
        client.query<Record<string, unknown>>(`${capitalFlowEventsCte}
          select wallet, pool_name as "poolName", collateral, side, position_id::text as "positionId", direction, amount_usd::float8 as "amountUsd", block_timestamp as "blockTimestamp"
          from enriched e
          where direction = 'deposit' and ${where}
          order by amount_usd desc
          limit 10`, [period]),
        client.query<Record<string, unknown>>(`${capitalFlowEventsCte}
          select wallet, pool_name as "poolName", collateral, side, position_id::text as "positionId", direction, amount_usd::float8 as "amountUsd", block_timestamp as "blockTimestamp"
          from enriched e
          where direction = 'withdrawal' and ${where}
          order by amount_usd desc
          limit 10`, [period])
      ]);
      const summary = summaryResult.rows[0] ?? {};
      const depositsUsd = toNumber(summary.depositsUsd);
      const withdrawalsUsd = toNumber(summary.withdrawalsUsd);
      const explanations: Record<string, string> = {
        "New wallets": "Wallets whose first observed collateral deposit occurred in this period.",
        "Returning wallets": "Previously-seen wallets adding or removing collateral again.",
        "Whale deposits": "Wallets with at least one deposit of $100K+ in the selected period.",
        "Active adders": "Wallets with three or more deposit events in the selected period."
      };
      return {
        period,
        summary: {
          depositsUsd,
          withdrawalsUsd,
          netFlowUsd: depositsUsd - withdrawalsUsd,
          newCapitalUsd: toNumber(summary.newCapitalUsd),
          returningCapitalUsd: toNumber(summary.returningCapitalUsd),
          wallets: Number(summary.wallets ?? 0),
          events: Number(summary.events ?? 0)
        },
        cohorts: cohortResult.rows.map((row) => {
          const deposits = toNumber(row.depositsUsd);
          const withdrawals = toNumber(row.withdrawalsUsd);
          const cohort = String(row.cohort);
          return { cohort, wallets: Number(row.wallets ?? 0), depositsUsd: deposits, withdrawalsUsd: withdrawals, netFlowUsd: deposits - withdrawals, explanation: explanations[cohort] ?? "Wallets grouped by deposit behavior in the selected period." };
        }),
        largestDeposits: depositResult.rows.map(mapCapitalFlowEvent),
        largestWithdrawals: withdrawalResult.rows.map(mapCapitalFlowEvent)
      };
    });
  } catch (error) {
    console.error("Failed to load capital flow data", error);
    return empty;
  }
}

export async function getConvictionPositions(limit = 12): Promise<ConvictionPosition[]> {
  if (!getDatabaseUrl()) return [];
  try {
    return await withClient(async (client) => {
      if (!(await hasCurrentPositionsTable(client))) return [];
      const result = await client.query<Record<string, unknown>>(`
        select
          lower(owner) as wallet,
          lower(pool_address) as "poolAddress",
          token_id::text as "tokenId",
          case when collateral = 'WBTC' then 'BTC' else 'ETH' end as asset,
          side as direction,
          case when side = 'long' then coalesce(collateral_value_usd, 0) else coalesce(debt_value_usd, 0) end::float8 as "positionSizeUsd",
          coalesce(
            case when side = 'short' then ui_entry_price_usd else null end,
            case
              when side = 'long' and entry_price_raw is not null and entry_price_raw > 0 then entry_price_raw / 1000000000000000000
              when side = 'short' and entry_price_raw is not null and entry_price_raw > 0 then 1000000000000000000::numeric / entry_price_raw
              else 0
            end
          )::float8 as "entryPriceUsd",
          case when coalesce(equity_usd, 0) > 0 then (case when side = 'long' then collateral_value_usd else debt_value_usd end) / equity_usd else 0 end::float8 as leverage,
          greatest(0, 1 - coalesce(debt_ratio, 0))::float8 as "liquidationDistancePct",
          coalesce(
            case when side = 'short' then ui_unrealized_pnl_usd else null end,
            case
              when side = 'long' and entry_price_raw is not null and entry_price_raw > 0 then collateral_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
              when side = 'short' and entry_price_raw is not null and entry_price_raw > 0 and oracle_price is not null and oracle_price > 0 then debt_value_usd * (1 - entry_price_raw::numeric / (oracle_price * 1000000000000000000))
              else 0
            end
          )::float8 as "pnlUsd"
        from public.fx_current_positions
        where owner is not null
        order by (case when side = 'long' then coalesce(collateral_value_usd, 0) else coalesce(debt_value_usd, 0) end) * greatest(coalesce(debt_ratio, 0), 0.1) desc
        limit $1`, [limit]);
      return result.rows.map((row) => ({
        wallet: String(row.wallet),
        poolAddress: String(row.poolAddress),
        tokenId: String(row.tokenId),
        asset: String(row.asset),
        direction: String(row.direction),
        positionSizeUsd: toNumber(row.positionSizeUsd),
        entryPriceUsd: toNumber(row.entryPriceUsd),
        leverage: toNumber(row.leverage),
        liquidationDistancePct: toNumber(row.liquidationDistancePct),
        pnlUsd: toNumber(row.pnlUsd)
      }));
    });
  } catch (error) {
    console.error("Failed to load conviction positions", error);
    return [];
  }
}

export async function getOpenPositions(limit = 500): Promise<PositionSummary[]> {
  if (!getDatabaseUrl()) return [];
  try {
    return await withClient(async (client) => {
      if (!(await hasCurrentPositionsTable(client))) return [];
      const result = await client.query<Record<string, unknown>>(`
        select pool_name as "poolName", pool_address as "poolAddress", side, collateral, token_id::text as "tokenId", owner,
          raw_collateral::text as "rawCollateral", raw_debt::text as "rawDebt", coalesce(oracle_price,0)::float8 as "oraclePrice",
          coalesce(case when side='short' then ui_entry_price_usd else null end,
            case when side='long' and entry_price_raw is not null and entry_price_raw > 0 then entry_price_raw / 1000000000000000000
                 when side='short' and entry_price_raw is not null and entry_price_raw > 0 then 1000000000000000000::numeric / entry_price_raw
                 else 0 end)::float8 as "entryPriceUsd",
          coalesce(case when side='short' then ui_unrealized_pnl_usd else null end,
            case when side='long' and entry_price_raw is not null and entry_price_raw > 0 then collateral_value_usd * (oracle_price * 1000000000000000000 / entry_price_raw - 1)
                 when side='short' and entry_price_raw is not null and entry_price_raw > 0 and oracle_price is not null and oracle_price > 0 then debt_value_usd * (1 - entry_price_raw::numeric / (oracle_price * 1000000000000000000))
                 else 0 end)::float8 as "unrealizedPnlUsd",
          coalesce(collateral_value_usd,0)::float8 as "collateralValueUsd", coalesce(debt_value_usd,0)::float8 as "debtValueUsd", coalesce(equity_usd,0)::float8 as "equityUsd", coalesce(debt_ratio,0)::float8 as "debtRatio"
        from public.fx_current_positions
        order by (case when side='long' then coalesce(collateral_value_usd,0) else coalesce(debt_value_usd,0) end) desc
        limit $1`, [limit]);
      return result.rows.map(mapPosition);
    });
  } catch (error) {
    console.error("Failed to load open positions", error);
    return [];
  }
}

function compactUsdLabel(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (absolute >= 1_000) return `${sign}$${Math.round(absolute / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(absolute).toLocaleString()}`;
}

function buildArchetypes(traders: TraderSummary[]): TraderArchetype[] {
  const byNotional = [...traders].sort((a, b) => b.notionalValueUsd - a.notionalValueUsd);
  const whales = byNotional.slice(0, 5).map((t) => ({ address: t.owner, metric: compactUsdLabel(t.notionalValueUsd), reason: `Current notional ranks near the top of the tracked book; this archetype is size-based, not performance-based.` }));
  const swing = [...traders].filter((t) => t.positions >= 2 && t.positions <= 15 && t.notionalValueUsd >= 10_000).sort((a,b) => b.totalPnlUsd - a.totalPnlUsd).slice(0,5).map((t) => ({ address: t.owner, metric: `${t.positions} open`, reason: `Moderate position count with meaningful exposure suggests position cycling rather than one-shot whale sizing.` }));
  const momentum = [...traders].filter((t) => Math.max(t.ethLongExposureUsd + t.btcLongExposureUsd, t.ethShortExposureUsd + t.btcShortExposureUsd) / Math.max(t.notionalValueUsd, 1) > 0.8).sort((a,b)=>b.notionalValueUsd-a.notionalValueUsd).slice(0,5).map((t)=>({ address:t.owner, metric: compactUsdLabel(t.notionalValueUsd), reason:`More than 80% of current exposure points in one direction, so the wallet is expressing directional momentum rather than balanced inventory.`}));
  const mean = [...traders].filter((t) => (t.ethLongExposureUsd > 0 && t.ethShortExposureUsd > 0) || (t.btcLongExposureUsd > 0 && t.btcShortExposureUsd > 0) || (Math.abs(t.ethNetExposureUsd) > 0 && Math.abs(t.btcNetExposureUsd) > 0 && Math.sign(t.ethNetExposureUsd) !== Math.sign(t.btcNetExposureUsd))).sort((a,b)=>b.notionalValueUsd-a.notionalValueUsd).slice(0,5).map((t)=>({address:t.owner, metric: compactUsdLabel(Math.abs(t.ethNetExposureUsd)+Math.abs(t.btcNetExposureUsd)), reason:`The wallet carries offsetting side or asset exposure, which is consistent with spread/mean-reversion behavior.`}));
  const degens = [...traders].filter((t)=>t.maxDebtRatio >= 0.85).sort((a,b)=>b.maxDebtRatio-a.maxDebtRatio).slice(0,5).map((t)=>({address:t.owner, metric: formatPercent(t.maxDebtRatio), reason:`Maximum debt ratio is above 85%; this classification measures liquidation proximity, not skill.`}));
  const survivors = [...traders].filter((t)=>t.maxDebtRatio >= 0.75 && t.unrealizedPnlUsd >= 0).sort((a,b)=>b.maxDebtRatio-a.maxDebtRatio).slice(0,5).map((t)=>({address:t.owner, metric:`${formatPercent(t.maxDebtRatio)} / ${compactUsdLabel(t.unrealizedPnlUsd)}`, reason:`High debt ratio with non-negative current PnL indicates the wallet has survived a close-to-liquidation risk state so far.`}));
  return [
    { name: "Whales", description: "Largest wallets by current notional exposure. This is a size ranking, not a performance score.", wallets: whales },
    { name: "Swing Traders", description: "Wallets with multiple meaningful positions but not extreme churn. This approximates position-cycling behavior.", wallets: swing },
    { name: "Momentum Traders", description: "Wallets whose current book is strongly one-sided by long/short exposure.", wallets: momentum },
    { name: "Mean Reverters", description: "Wallets carrying offsetting asset or side exposure, often consistent with spread or reversion trades.", wallets: mean },
    { name: "Degens", description: "Wallets nearest liquidation by debt ratio. This measures risk appetite, not profitability.", wallets: degens },
    { name: "Liquidation Survivors", description: "High-risk wallets that remain in non-negative current PnL based on indexed snapshots.", wallets: survivors }
  ];
}

function buildProtocolHealth(dashboard: DashboardData, capitalFlows: CapitalFlowData): ProtocolHealthMetric[] {
  const totals = dashboard.totals;
  const longShortTotal = totals.longNotionalUsd + totals.shortBorrowedExposureUsd || 1;
  const avgLev = totals.equityUsd > 0 ? totals.trackedOpenInterestUsd / totals.equityUsd : 0;
  return [
    { label: "TVL", value: compactUsdLabel(totals.collateralValueUsd), explanation: "Tracked collateral value across currently open f(x) positions.", tone: "neutral" },
    { label: "Open interest", value: compactUsdLabel(totals.trackedOpenInterestUsd), explanation: "Long collateral exposure plus short borrowed exposure for open positions.", tone: "neutral" },
    { label: "Long / short ratio", value: `${((totals.longNotionalUsd / longShortTotal) * 100).toFixed(1)}% L`, explanation: "Share of tracked open interest currently on the long side versus short borrowed exposure.", tone: "neutral" },
    { label: "Average leverage", value: `${avgLev.toFixed(2)}×`, explanation: "Open interest divided by current equity. This is a portfolio-level approximation.", tone: avgLev > 4 ? "warning" : "neutral" },
    { label: "Net deposits", value: compactUsdLabel(capitalFlows.summary.netFlowUsd), explanation: "Collateral deposits minus withdrawals in the selected 7-day research window.", tone: capitalFlows.summary.netFlowUsd >= 0 ? "positive" : "negative" },
    { label: "Active traders", value: totals.uniqueTraders.toLocaleString(), explanation: "Distinct wallets currently owning tracked position NFTs.", tone: "neutral" },
    { label: "Liquidation risk", value: `${totals.riskQueuePositions80.toLocaleString()} pos`, explanation: "Positions at or above 80% debt ratio; this is a risk queue proxy, not a liquidation prediction.", tone: totals.riskQueuePositions80 > 0 ? "warning" : "positive" },
    { label: "Fee generation", value: compactUsdLabel(totals.fundingWindowFeesUsd), explanation: "Open/close fees observed in the current 8h exchange-style UTC window.", tone: "neutral" }
  ];
}

function buildResearchCards(dashboard: DashboardData, capitalFlows: CapitalFlowData, conviction: ConvictionPosition[], traders: TopTrader[]): ResearchInsightCard[] {
  const ethLongPool = dashboard.pools.find((p) => p.side === "long" && displayInstrument(p.collateral) === "ETH");
  const btcShortRisk = conviction.filter((p) => p.asset === "BTC" && p.direction === "short" && p.liquidationDistancePct <= 0.25);
  const largestDeposit = capitalFlows.largestDeposits[0];
  const topTrader = traders.sort((a, b) => b.totalPnlUsd - a.totalPnlUsd)[0];
  const whale = conviction[0];
  return [
    { slug: "eth-longs-leverage", kicker: "Market Structure", title: "ETH longs increasing leverage", summary: `ETH long positions show an average debt ratio of ${formatPercent(ethLongPool?.avgDebtRatio ?? 0)} across ${(ethLongPool?.positions ?? 0).toLocaleString()} open positions.`, metric: formatPercent(ethLongPool?.avgDebtRatio ?? 0), href: "/research/eth-longs-leverage", tone: "warning" },
    { slug: "btc-shorts-liquidation-cluster", kicker: "Liquidation Maps", title: "BTC shorts clustering near liquidation levels", summary: `${btcShortRisk.length} high-conviction BTC short positions sit within 25% debt-ratio headroom in the conviction sample.`, metric: `${btcShortRisk.length} positions`, href: "/research/btc-shorts-liquidation-cluster", tone: btcShortRisk.length ? "warning" : "neutral" },
    { slug: "largest-wallet-added-exposure", kicker: "Whale Activity", title: "Largest wallet added exposure", summary: largestDeposit ? `${formatAddress(largestDeposit.wallet)} deposited ${compactUsdLabel(largestDeposit.amountUsd)} into ${displayPool(largestDeposit.poolName)}.` : "No qualifying deposit event in this window.", metric: largestDeposit ? compactUsdLabel(largestDeposit.amountUsd) : "—", href: largestDeposit ? `/traders/${largestDeposit.wallet}` : "/research/largest-wallet-added-exposure", tone: "neutral" },
    { slug: "net-inflows-positive", kicker: "Capital Flows", title: "Net inflows turned positive this week", summary: `7d net flow is ${compactUsdLabel(capitalFlows.summary.netFlowUsd)} from ${compactUsdLabel(capitalFlows.summary.depositsUsd)} deposits and ${compactUsdLabel(capitalFlows.summary.withdrawalsUsd)} withdrawals.`, metric: compactUsdLabel(capitalFlows.summary.netFlowUsd), href: "/research/capital-flows", tone: capitalFlows.summary.netFlowUsd >= 0 ? "positive" : "negative" },
    { slug: "top-trader-reversed-position", kicker: "Trader Archetypes", title: "Top trader reversed position", summary: topTrader ? `${formatAddress(topTrader.address)} leads Top PnL at ${compactUsdLabel(topTrader.totalPnlUsd)}. Use the profile timeline to inspect side changes and position adds/removes.` : "No trader PnL data available yet.", metric: topTrader ? compactUsdLabel(topTrader.totalPnlUsd) : "—", href: topTrader ? `/traders/${topTrader.address}` : "/top-traders", tone: "positive" },
    { slug: "highest-conviction-position", kicker: "Conviction Tracker", title: "Highest conviction position", summary: whale ? `${formatAddress(whale.wallet)} carries ${compactUsdLabel(whale.positionSizeUsd)} ${whale.asset} ${whale.direction} exposure at ${whale.leverage.toFixed(2)}× estimated leverage.` : "No conviction data available yet.", metric: whale ? compactUsdLabel(whale.positionSizeUsd) : "—", href: whale ? `/positions/${whale.poolAddress}-${whale.tokenId}` : "/research/highest-conviction-position", tone: "neutral" }
  ];
}

export async function getResearchData(): Promise<ResearchData> {
  const [dashboard, capitalFlows, conviction, traders] = await Promise.all([
    getDashboardData(),
    getCapitalFlowData("7d"),
    getConvictionPositions(12),
    getTopTraders()
  ]);
  return {
    dashboard,
    capitalFlows,
    conviction,
    archetypes: buildArchetypes(dashboard.traders),
    protocolHealth: buildProtocolHealth(dashboard, capitalFlows),
    cards: buildResearchCards(dashboard, capitalFlows, conviction, traders)
  };
}
