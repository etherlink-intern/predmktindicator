import { Client } from "pg";

export type PoolSummary = {
  poolName: string;
  side: string;
  collateral: string;
  positions: number;
  uniqueOwners: number;
  rawCollateral: string;
  rawDebt: string;
};

export type TraderSummary = {
  owner: string;
  positions: number;
  pools: number;
  wstethLong: number;
  wbtcLong: number;
  wstethShort: number;
  wbtcShort: number;
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
    shortPositions: 0
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

export async function getDashboardData(): Promise<DashboardData> {
  if (!getDatabaseUrl()) {
    return emptyDashboard;
  }

  try {
    return await withClient(async (client) => {
      const exists = await client.query<{ exists: boolean }>(
        "select to_regclass('public.fx_current_positions') is not null as exists"
      );
      if (!exists.rows[0]?.exists) {
        return emptyDashboard;
      }

      const [metaResult, totalsResult, poolsResult, tradersResult] = await Promise.all([
        client.query<{ generated_at: Date }>(
          "select generated_at from public.fx_current_position_syncs order by generated_at desc limit 1"
        ),
        client.query<{
          open_positions: string;
          unique_traders: string;
          pools: string;
          long_positions: string;
          short_positions: string;
        }>(`
          select
            count(*)::text as open_positions,
            count(distinct owner)::text as unique_traders,
            count(distinct pool_address)::text as pools,
            count(*) filter (where side = 'long')::text as long_positions,
            count(*) filter (where side = 'short')::text as short_positions
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
        }>(`
          select
            pool_name,
            side,
            collateral,
            count(*)::text as positions,
            count(distinct owner)::text as unique_owners,
            coalesce(sum(raw_collateral), 0)::text as raw_collateral,
            coalesce(sum(raw_debt), 0)::text as raw_debt
          from public.fx_current_positions
          group by pool_name, side, collateral
          order by side, collateral, pool_name
        `),
        client.query<TraderSummary>(`
          select
            owner,
            count(*)::int as positions,
            count(distinct pool_address)::int as pools,
            count(*) filter (where pool_name = 'WstETHLongPool')::int as "wstethLong",
            count(*) filter (where pool_name = 'WBTCLongPool')::int as "wbtcLong",
            count(*) filter (where pool_name = 'WstETHShortPool')::int as "wstethShort",
            count(*) filter (where pool_name = 'WBTCShortPool')::int as "wbtcShort"
          from public.fx_current_positions
          group by owner
          order by positions desc, pools desc, owner asc
          limit 25
        `)
      ]);

      const totals = totalsResult.rows[0];
      return {
        hasSnapshot: Number(totals?.open_positions ?? 0) > 0,
        generatedAt: metaResult.rows[0]?.generated_at?.toISOString?.() ?? null,
        totals: {
          openPositions: Number(totals?.open_positions ?? 0),
          uniqueTraders: Number(totals?.unique_traders ?? 0),
          pools: Number(totals?.pools ?? 0),
          longPositions: Number(totals?.long_positions ?? 0),
          shortPositions: Number(totals?.short_positions ?? 0)
        },
        pools: poolsResult.rows.map((row) => ({
          poolName: row.pool_name,
          side: row.side,
          collateral: row.collateral,
          positions: Number(row.positions),
          uniqueOwners: Number(row.unique_owners),
          rawCollateral: row.raw_collateral,
          rawDebt: row.raw_debt
        })),
        traders: tradersResult.rows
      };
    });
  } catch (error) {
    console.error("Failed to load f(x) dashboard data", error);
    return emptyDashboard;
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
