import { Client } from "pg";

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
  collateralValueUsd: number;
  debtValueUsd: number;
  equityUsd: number;
  avgDebtRatio: number;
  maxDebtRatio: number;
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
  collateralValueUsd: number;
  debtValueUsd: number;
  equityUsd: number;
  debtRatio: number;
};

export type TraderProfile = {
  owner: string;
  generatedAt: string | null;
  summary: TraderSummary;
  positions: PositionSummary[];
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
  };
  pools: PoolSummary[];
  traders: TraderSummary[];
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
    equityUsd: 0
  },
  pools: [],
  traders: []
};

function getDatabaseUrl() {
  return process.env.DATABASE_URL;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return fn(undefined as unknown as Client);
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
  const exists = await client.query<{ exists: boolean }>(
    "select to_regclass('public.fx_current_positions') is not null as exists"
  );
  return Boolean(exists.rows[0]?.exists);
}

async function latestSnapshotTime(client: Client) {
  const exists = await client.query<{ exists: boolean }>(
    "select to_regclass('public.fx_current_position_syncs') is not null as exists"
  );
  if (!exists.rows[0]?.exists) return null;
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
    collateralValueUsd: toNumber(row.collateralValueUsd),
    debtValueUsd: toNumber(row.debtValueUsd),
    equityUsd: toNumber(row.equityUsd),
    avgDebtRatio: toNumber(row.avgDebtRatio),
    maxDebtRatio: toNumber(row.maxDebtRatio)
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
    coalesce(sum(collateral_value_usd), 0)::float8 as "collateralValueUsd",
    coalesce(sum(debt_value_usd), 0)::float8 as "debtValueUsd",
    coalesce(sum(equity_usd), 0)::float8 as "equityUsd",
    coalesce(avg(debt_ratio), 0)::float8 as "avgDebtRatio",
    coalesce(max(debt_ratio), 0)::float8 as "maxDebtRatio"
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

      const [generatedAt, totalsResult, poolsResult, tradersResult] = await Promise.all([
        latestSnapshotTime(client),
        client.query<{
          open_positions: string;
          unique_traders: string;
          pools: string;
          long_positions: string;
          short_positions: string;
          collateral_value_usd: number;
          debt_value_usd: number;
          equity_usd: number;
        }>(`
          select
            count(*)::text as open_positions,
            count(distinct owner)::text as unique_traders,
            count(distinct pool_address)::text as pools,
            count(*) filter (where side = 'long')::text as long_positions,
            count(*) filter (where side = 'short')::text as short_positions,
            coalesce(sum(collateral_value_usd), 0)::float8 as collateral_value_usd,
            coalesce(sum(debt_value_usd), 0)::float8 as debt_value_usd,
            coalesce(sum(equity_usd), 0)::float8 as equity_usd
          from public.fx_current_positions
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
          order by positions desc, pools desc, "equityUsd" desc, owner asc
          limit 25
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
          equityUsd: toNumber(totals?.equity_usd)
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
        traders: tradersResult.rows.map(mapTrader)
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
      if (!(await hasCurrentPositionsTable(client))) {
        return null;
      }
      const [generatedAt, summaryResult, positionsResult] = await Promise.all([
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
             coalesce(collateral_value_usd, 0)::float8 as "collateralValueUsd",
             coalesce(debt_value_usd, 0)::float8 as "debtValueUsd",
             coalesce(equity_usd, 0)::float8 as "equityUsd",
             coalesce(debt_ratio, 0)::float8 as "debtRatio"
           from public.fx_current_positions
           where lower(owner) = $1
           order by equity_usd desc nulls last, pool_name, token_id`,
          [normalized]
        )
      ]);

      const summary = summaryResult.rows[0];
      if (!summary) return null;
      return {
        owner: String(summary.owner),
        generatedAt,
        summary: mapTrader(summary),
        positions: positionsResult.rows.map(mapPosition)
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
