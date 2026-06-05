import { NextResponse } from "next/server";
import { Client } from "pg";
import { authorizeCron } from "../../../../lib/cron";

export const dynamic = "force-dynamic";

const WAD = 10n ** 18n;
const NEXT_ID_SIG = "0x067f4ddd";
const GET_POSITION_SIG = "0xeb02c301";
const OWNER_OF_SIG = "0x6352211e";
const PRICE_ORACLE_SIG = "0x2630c12f";
const GET_EXCHANGE_PRICE_SIG = "0xa51ff4a2";
const GET_DEBT_RATIO_SIG = "0x861b4cfe";

// Short pools are small and more price-sensitive for liquidation/risk views, so
// scan them first. If an external client ever aborts the HTTP request, shorts
// have the best chance of being refreshed before long-pool catch-up work.
const POOLS = [
  { name: "WstETHShortPool", address: "0x25707b9e6690B52C60aE6744d711cf9C1dFC1876", side: "short", collateral: "wstETH" },
  { name: "WBTCShortPool",   address: "0xA0cC8162c523998856D59065fAa254F87D20A5b0", side: "short", collateral: "WBTC" },
  { name: "WBTCLongPool",    address: "0xAB709e26Fa6B0A30c119D8c55B887DeD24952473", side: "long",  collateral: "WBTC" },
  { name: "WstETHLongPool",  address: "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8", side: "long",  collateral: "wstETH" },
];

type PoolConfig = (typeof POOLS)[number];

type PositionRow = {
  poolName: string;
  poolAddress: string;
  side: string;
  collateral: string;
  tokenId: number;
  owner: string;
  rawCollateral: bigint;
  rawDebt: bigint;
  oraclePrice: number;
  collateralValueUsd: number;
  debtValueUsd: number;
  equityUsd: number;
  debtRatio: number;
};

function rpcUrl() {
  return process.env.RPC_ROUTER_URL || process.env.ALCHEMY_RPC_URL || process.env.ETHEREUM_RPC_URL || "http://127.0.0.1:18545";
}

function envNumber(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function rpcBatchSize() {
  return envNumber("FX_RPC_BATCH_SIZE", 20, 1, 20);
}

function rpcThrottleMs() {
  return envNumber("FX_RPC_THROTTLE_MS", 100, 0, 2_000);
}

function fullScanSliceSize() {
  return envNumber("FX_CURRENT_FULL_SCAN_SLICE", 50, 0, 10_000);
}

function useContractDebtRatio() {
  return process.env.FX_USE_CONTRACT_DEBT_RATIO === "true";
}

function exactDebtRatioThreshold() {
  return envNumber("FX_EXACT_DEBT_RATIO_THRESHOLD", 1, 0, 1);
}

function word(value: bigint | number): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function decodeUint(result: string): bigint {
  return BigInt(result);
}

function decodeUintPair(result: string): [bigint, bigint] {
  const hex = result.slice(2);
  return [BigInt("0x" + hex.slice(0, 64)), BigInt("0x" + hex.slice(64, 128))];
}

function decodeAddress(result: string): string {
  return "0x" + result.slice(-40).toLowerCase();
}

function uniqSorted(values: number[]) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

function rangeInclusive(start: number, end: number) {
  if (end < start) return [] as number[];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

async function ethCall(to: string, data: string, timeout = 30): Promise<string> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] });
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(rpcUrl(), { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(timeout * 1000) });
    const json = await res.json() as { result?: string; error?: { message?: string } };
    if (json.result) return json.result;
    if (json.error?.message?.includes("capacity") || json.error?.message?.includes("rate")) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(json.error?.message || "eth_call failed");
  }
  throw new Error("eth_call failed after retries");
}

async function batchEthCall(calls: Array<{ id: string; to: string; data: string }>, timeout = 60): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const batchSize = rpcBatchSize();
  const throttleMs = rpcThrottleMs();
  for (let i = 0; i < calls.length; i += batchSize) {
    const chunk = calls.slice(i, i + batchSize);
    const payload = chunk.map((c) => ({ jsonrpc: "2.0", id: c.id, method: "eth_call", params: [{ to: c.to, data: c.data }, "latest"] }));
    let batch: Array<{ id: string; result?: string; error?: { message?: string } }> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(rpcUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeout * 1000),
      });
      const text = await res.text();
      let json: Array<{ id: string; result?: string; error?: { message?: string } }> | { error?: { message?: string } } | null = null;
      try {
        json = JSON.parse(text) as Array<{ id: string; result?: string; error?: { message?: string } }> | { error?: { message?: string } };
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw new Error(`batch eth_call returned invalid JSON (${text.length} bytes)`);
      }
      if (res.ok && Array.isArray(json)) {
        batch = json;
        break;
      }
      const message = Array.isArray(json) ? "batch eth_call failed" : (json?.error?.message ?? "batch eth_call failed");
      if (message.includes("capacity") || message.includes("rate") || message.includes("timeout")) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw new Error(message);
    }
    if (!batch) throw new Error("batch eth_call failed after retries");
    for (const item of batch) {
      results.set(String(item.id), item.result || null);
    }
    if (throttleMs > 0 && i + batchSize < calls.length) {
      await new Promise((r) => setTimeout(r, throttleMs));
    }
  }
  return results;
}

function computeValuation(side: string, rawCollateral: bigint, rawDebt: bigint, price: number): { collateralValueUsd: number; debtValueUsd: number; equityUsd: number } {
  const collAmount = Number(rawCollateral) / Number(WAD);
  const debtAmount = Number(rawDebt) / Number(WAD);
  if (side === "long") {
    const cv = collAmount * price;
    const dv = debtAmount;
    return { collateralValueUsd: cv, debtValueUsd: dv, equityUsd: cv - dv };
  }
  const cv = collAmount;
  const dv = debtAmount / price;
  return { collateralValueUsd: cv, debtValueUsd: dv, equityUsd: cv - dv };
}

async function ensureTables(client: Client) {
  await client.query(`
    create table if not exists public.fx_current_position_syncs (
      id bigserial primary key,
      generated_at timestamptz not null default now(),
      source text not null default 'live_rpc_snapshot'
    );
    create table if not exists public.fx_current_positions (
      pool_name text not null,
      pool_address text not null,
      side text not null check (side in ('long','short')),
      collateral text not null,
      token_id numeric(78,0) not null,
      owner text not null,
      raw_collateral numeric(78,0) not null,
      raw_debt numeric(78,0) not null,
      oracle_price numeric(78,18),
      collateral_value_usd numeric(78,18),
      debt_value_usd numeric(78,18),
      equity_usd numeric(78,18),
      debt_ratio numeric(78,18),
      updated_at timestamptz not null default now(),
      primary key (pool_address, token_id)
    );
    create table if not exists public.fx_current_position_scan_state (
      pool_address text primary key,
      pool_name text not null,
      last_scanned_token_id numeric(78,0) not null default 0,
      full_scan_cursor numeric(78,0) not null default 0,
      last_full_scan_at timestamptz,
      updated_at timestamptz not null default now()
    );
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
  `);
}

async function upsertPositionRows(client: Client, rows: PositionRow[]) {
  for (const chunk of chunkArray(rows, 250)) {
    const params: Array<string | number> = [];
    const valuesSql = chunk.map((row, rowIndex) => {
      const base = rowIndex * 14;
      params.push(
        row.poolName,
        row.poolAddress,
        row.side,
        row.collateral,
        String(row.tokenId),
        row.owner,
        String(row.rawCollateral),
        String(row.rawDebt),
        row.oraclePrice.toFixed(18),
        row.collateralValueUsd.toFixed(12),
        row.debtValueUsd.toFixed(12),
        row.equityUsd.toFixed(12),
        row.debtRatio.toFixed(18),
        new Date().toISOString(),
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5}::numeric,$${base + 6},$${base + 7}::numeric,$${base + 8}::numeric,$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`;
    }).join(",");
    await client.query(
      `insert into public.fx_current_positions(
        pool_name, pool_address, side, collateral, token_id, owner,
        raw_collateral, raw_debt, oracle_price, collateral_value_usd,
        debt_value_usd, equity_usd, debt_ratio, updated_at
      ) values ${valuesSql}
      on conflict (pool_address, token_id) do update set
        pool_name = excluded.pool_name,
        side = excluded.side,
        collateral = excluded.collateral,
        owner = excluded.owner,
        raw_collateral = excluded.raw_collateral,
        raw_debt = excluded.raw_debt,
        oracle_price = excluded.oracle_price,
        collateral_value_usd = excluded.collateral_value_usd,
        debt_value_usd = excluded.debt_value_usd,
        equity_usd = excluded.equity_usd,
        debt_ratio = excluded.debt_ratio,
        updated_at = excluded.updated_at`,
      params,
    );
  }
}

async function seedKnownWallets(client: Client, wallets: Set<string>) {
  const addresses = [...wallets].filter((addr) => /^0x[0-9a-f]{40}$/.test(addr));
  if (addresses.length === 0) return;
  await client.query(
    `insert into public.fx_known_wallets(address, source, last_position_sync_at)
     select address, 'current_positions_snapshot', now()
     from unnest($1::text[]) as address
     on conflict (address) do update set
       last_seen_at = now(),
       source = excluded.source,
       last_position_sync_at = now(),
       updated_at = now()`,
    [addresses],
  );
}

async function scanPool(client: Client, pool: PoolConfig, forceFull: boolean) {
  const oracleAddr = decodeAddress(await ethCall(pool.address, PRICE_ORACLE_SIG));
  const priceRaw = decodeUint(await ethCall(oracleAddr, GET_EXCHANGE_PRICE_SIG));
  const price = Number(priceRaw) / Number(WAD);
  const nextIdRaw = decodeUint(await ethCall(pool.address, NEXT_ID_SIG));
  const nextId = Number(nextIdRaw);
  const maxTokenId = Math.max(0, nextId - 1);

  const existingRows = await client.query<{ token_id: string; owner: string }>(
    `select token_id::text, lower(owner) as owner
     from public.fx_current_positions
     where lower(pool_address) = lower($1)`,
    [pool.address],
  );
  const existingIds = existingRows.rows.map((row) => Number(row.token_id)).filter(Number.isFinite);
  const existingOwnerById = new Map<number, string>();
  for (const row of existingRows.rows) {
    const tokenId = Number(row.token_id);
    if (Number.isFinite(tokenId) && /^0x[0-9a-f]{40}$/.test(row.owner)) existingOwnerById.set(tokenId, row.owner);
  }
  const maxExistingId = existingIds.length > 0 ? Math.max(...existingIds) : 0;

  const stateResult = await client.query<{ last_scanned_token_id: string; full_scan_cursor: string }>(
    `select last_scanned_token_id::text, full_scan_cursor::text
     from public.fx_current_position_scan_state
     where lower(pool_address) = lower($1)`,
    [pool.address],
  );
  const state = stateResult.rows[0];
  const priorLastScanned = Math.min(Number(state?.last_scanned_token_id ?? maxExistingId ?? 0), maxTokenId);
  const priorFullCursor = Math.min(Number(state?.full_scan_cursor ?? 0), maxTokenId);

  const newIds = rangeInclusive(Math.max(1, priorLastScanned + 1), maxTokenId);
  let fullSliceIds: number[] = [];
  let nextFullCursor = priorFullCursor;
  let completedFullScan = false;
  const sliceSize = fullScanSliceSize();
  if (forceFull) {
    fullSliceIds = rangeInclusive(1, maxTokenId);
    nextFullCursor = maxTokenId;
    completedFullScan = true;
  } else if (sliceSize > 0 && maxTokenId > 0) {
    const sliceStart = priorFullCursor >= maxTokenId ? 1 : priorFullCursor + 1;
    const sliceEnd = Math.min(maxTokenId, sliceStart + sliceSize - 1);
    fullSliceIds = rangeInclusive(sliceStart, sliceEnd);
    nextFullCursor = sliceEnd;
    completedFullScan = sliceEnd >= maxTokenId;
  }

  // Fast path: refresh every currently-open row, scan newly-minted token IDs,
  // and do a small rolling full-scan slice to catch rare missed opens/closures.
  const tokenIds = uniqSorted(existingIds.concat(newIds, fullSliceIds));
  console.error(`[sync-current] ${pool.name}: nextId=${nextId} existing=${existingIds.length} new=${newIds.length} fullSlice=${fullSliceIds.length} scanning=${tokenIds.length}`);

  const posCalls = tokenIds.map((tid) => ({
    id: `${pool.name}:pos:${tid}`,
    to: pool.address,
    data: GET_POSITION_SIG + word(tid),
  }));
  const posResults = await batchEthCall(posCalls);

  const nonzero: Array<{ tokenId: number; rawCollateral: bigint; rawDebt: bigint }> = [];
  const closedTokenIds: string[] = [];
  let failedPositionReads = 0;
  for (const tid of tokenIds) {
    const result = posResults.get(`${pool.name}:pos:${tid}`);
    if (!result || result === "0x") {
      failedPositionReads += 1;
      continue;
    }
    try {
      const [rawCollateral, rawDebt] = decodeUintPair(result);
      if (rawCollateral > 0n || rawDebt > 0n) {
        nonzero.push({ tokenId: tid, rawCollateral, rawDebt });
      } else {
        closedTokenIds.push(String(tid));
      }
    } catch {
      failedPositionReads += 1;
    }
  }

  if (closedTokenIds.length > 0) {
    await client.query(
      `delete from public.fx_current_positions
       where lower(pool_address) = lower($1)
         and token_id = any($2::numeric[])`,
      [pool.address, closedTokenIds],
    );
  }

  const exactDebtRatio = useContractDebtRatio();
  const debtRatioThreshold = exactDebtRatioThreshold();
  const exactDebtRatioTokenIds = new Set(
    nonzero
      .filter((n) => {
        if (exactDebtRatio) return true;
        const { collateralValueUsd, debtValueUsd } = computeValuation(pool.side, n.rawCollateral, n.rawDebt, price);
        return collateralValueUsd > 0 && debtValueUsd / collateralValueUsd >= debtRatioThreshold;
      })
      .map((n) => n.tokenId),
  );
  const ownerCalls = nonzero
    .filter((n) => !existingOwnerById.has(n.tokenId))
    .map((n) => ({ id: `${pool.name}:owner:${n.tokenId}`, to: pool.address, data: OWNER_OF_SIG + word(n.tokenId) }));
  const drCalls = nonzero
    .filter((n) => exactDebtRatioTokenIds.has(n.tokenId))
    .map((n) => ({ id: `${pool.name}:dr:${n.tokenId}`, to: pool.address, data: GET_DEBT_RATIO_SIG + word(n.tokenId) }));
  const [ownerResults, drResults] = await Promise.all([batchEthCall(ownerCalls), batchEthCall(drCalls)]);

  const upsertRows: PositionRow[] = [];
  const knownWallets = new Set<string>();
  for (const n of nonzero) {
    const existingOwner = existingOwnerById.get(n.tokenId);
    const ownerResult = existingOwner ? null : ownerResults.get(`${pool.name}:owner:${n.tokenId}`);
    if (!existingOwner && (!ownerResult || ownerResult === "0x")) continue;
    const owner = existingOwner ?? decodeAddress(ownerResult as string);
    if (!/^0x[0-9a-f]{40}$/.test(owner)) continue;

    const { collateralValueUsd, debtValueUsd, equityUsd } = computeValuation(pool.side, n.rawCollateral, n.rawDebt, price);
    const computedDebtRatio = collateralValueUsd > 0 ? debtValueUsd / collateralValueUsd : 0;
    const drResult = exactDebtRatio ? drResults.get(`${pool.name}:dr:${n.tokenId}`) : null;
    const debtRatio = drResult && drResult !== "0x" ? Number(decodeUint(drResult)) / Number(WAD) : computedDebtRatio;
    upsertRows.push({
      poolName: pool.name,
      poolAddress: pool.address.toLowerCase(),
      side: pool.side,
      collateral: pool.collateral,
      tokenId: n.tokenId,
      owner,
      rawCollateral: n.rawCollateral,
      rawDebt: n.rawDebt,
      oraclePrice: price,
      collateralValueUsd,
      debtValueUsd,
      equityUsd,
      debtRatio,
    });
    knownWallets.add(owner);
  }

  await upsertPositionRows(client, upsertRows);
  await seedKnownWallets(client, knownWallets);

  await client.query(
    `insert into public.fx_current_position_scan_state(
       pool_address, pool_name, last_scanned_token_id, full_scan_cursor, last_full_scan_at, updated_at
     ) values ($1, $2, $3::numeric, $4::numeric, ${completedFullScan ? "now()" : "null"}, now())
     on conflict (pool_address) do update set
       pool_name = excluded.pool_name,
       last_scanned_token_id = greatest(public.fx_current_position_scan_state.last_scanned_token_id, excluded.last_scanned_token_id),
       full_scan_cursor = excluded.full_scan_cursor,
       last_full_scan_at = coalesce(excluded.last_full_scan_at, public.fx_current_position_scan_state.last_full_scan_at),
       updated_at = now()`,
    [pool.address.toLowerCase(), pool.name, String(maxTokenId), String(nextFullCursor)],
  );

  return {
    pool: pool.name,
    nextId,
    scannedTokens: tokenIds.length,
    openPositionsSeen: nonzero.length,
    upserted: upsertRows.length,
    closedRemoved: closedTokenIds.length,
    failedPositionReads,
    knownWallets: knownWallets.size,
  };
}

export async function POST(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 500 });
  }

  const startedAt = Date.now();
  const url = new URL(request.url);
  const forceFull = url.searchParams.get("full") === "1" || url.searchParams.get("full") === "true" || process.env.FX_FORCE_FULL_CURRENT_SCAN === "true";
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();

  try {
    await ensureTables(client);
    const pools = [] as Awaited<ReturnType<typeof scanPool>>[];
    for (const pool of POOLS) {
      pools.push(await scanPool(client, pool, forceFull));
    }

    const totalsResult = await client.query<{ total_positions: string; wallets: string }>(
      `select count(*)::int as total_positions, count(distinct lower(owner))::int as wallets
       from public.fx_current_positions`,
    );
    const totalPositions = Number(totalsResult.rows[0]?.total_positions ?? 0);
    const walletsSeeded = Number(totalsResult.rows[0]?.wallets ?? 0);
    const minimumPositions = Number(process.env.MIN_CURRENT_POSITION_SYNC_ROWS || "100");
    if (totalPositions < minimumPositions) {
      return NextResponse.json(
        {
          ok: false,
          jobName: "sync-current-positions",
          error: `Current-position snapshot has only ${totalPositions} rows, below minimum ${minimumPositions}`,
          totalPositions,
          walletsSeeded,
          poolsProcessed: pools.length,
          pools,
        },
        { status: 502 },
      );
    }

    await client.query("insert into public.fx_current_position_syncs(source) values ($1)", [forceFull ? "live_rpc_api_full" : "live_rpc_api_incremental"]);

    return NextResponse.json({
      ok: true,
      jobName: "sync-current-positions",
      mode: forceFull ? "full" : "incremental",
      runtimeMs: Date.now() - startedAt,
      rpcBatchSize: rpcBatchSize(),
      rpcThrottleMs: rpcThrottleMs(),
      totalPositions,
      walletsSeeded,
      poolsProcessed: pools.length,
      pools,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, jobName: "sync-current-positions", runtimeMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}
