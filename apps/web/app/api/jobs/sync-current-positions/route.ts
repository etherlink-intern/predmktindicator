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

const POOLS = [
  { name: "WstETHLongPool",  address: "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8", side: "long",  collateral: "wstETH" },
  { name: "WBTCLongPool",    address: "0xAB709e26Fa6B0A30c119D8c55B887DeD24952473", side: "long",  collateral: "WBTC" },
  { name: "WstETHShortPool", address: "0x25707b9e6690B52C60aE6744d711cf9C1dFC1876", side: "short", collateral: "wstETH" },
  { name: "WBTCShortPool",   address: "0xA0cC8162c523998856D59065fAa254F87D20A5b0", side: "short", collateral: "WBTC" },
];

function rpcUrl() {
  return process.env.ALCHEMY_RPC_URL || process.env.ETHEREUM_RPC_URL || "http://127.0.0.1:18545";
}

function word(value: bigint | number): string {
  return "0x" + BigInt(value).toString(16).padStart(64, "0");
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

async function ethCall(to: string, data: string, timeout = 30): Promise<string> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] });
  const res = await fetch(rpcUrl(), { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(timeout * 1000) });
  const json = await res.json() as { result?: string; error?: { message?: string } };
  if (!json.result) throw new Error(json.error?.message || "eth_call failed");
  return json.result;
}

async function batchEthCall(calls: Array<{ id: string; to: string; data: string }>, timeout = 60): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  for (let i = 0; i < calls.length; i += 20) {
    const chunk = calls.slice(i, i + 20);
    const payload = chunk.map((c) => ({ jsonrpc: "2.0", id: c.id, method: "eth_call", params: [{ to: c.to, data: c.data }, "latest"] }));
    const res = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout * 1000),
    });
    const batch = await res.json() as Array<{ id: string; result?: string; error?: { message?: string } }>;
    for (const item of batch) {
      results.set(item.id, item.result || null);
    }
    await new Promise((r) => setTimeout(r, 100));
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
  } else {
    const cv = collAmount;
    const dv = debtAmount / price;
    return { collateralValueUsd: cv, debtValueUsd: dv, equityUsd: cv - dv };
  }
}

export async function POST(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 500 });
  }

  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();

  try {
    let totalPositions = 0;
    const knownWallets = new Set<string>();

    // Ensure tables exist
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
    `);

    // Truncate and re-insert
    await client.query("truncate table public.fx_current_positions");

    for (const pool of POOLS) {
      // Get price oracle
      const oracleAddr = decodeAddress(await ethCall(pool.address, PRICE_ORACLE_SIG));
      const priceRaw = decodeUint(await ethCall(oracleAddr, GET_EXCHANGE_PRICE_SIG));
      const price = Number(priceRaw) / Number(WAD);

      // Get next position ID
      const nextIdRaw = decodeUint(await ethCall(pool.address, NEXT_ID_SIG));
      const nextId = Number(nextIdRaw);
      const tokenIds = Array.from({ length: nextId - 1 }, (_, i) => i + 1);

      // Batch get positions
      const posCalls = tokenIds.map((tid) => ({
        id: `${pool.name}:pos:${tid}`,
        to: pool.address,
        data: GET_POSITION_SIG + word(tid),
      }));
      const posResults = await batchEthCall(posCalls);

      // Filter nonzero
      const nonzero: Array<{ tokenId: number; rawCollateral: bigint; rawDebt: bigint }> = [];
      for (const tid of tokenIds) {
        const result = posResults.get(`${pool.name}:pos:${tid}`);
        if (!result || result === "0x") continue;
        try {
          const [rc, rd] = decodeUintPair(result);
          if (rc > 0n || rd > 0n) nonzero.push({ tokenId: tid, rawCollateral: rc, rawDebt: rd });
        } catch { continue; }
      }

      // Batch ownerOf and debtRatio
      const ownerCalls = nonzero.map((n) => ({ id: `${pool.name}:owner:${n.tokenId}`, to: pool.address, data: OWNER_OF_SIG + word(n.tokenId) }));
      const drCalls = nonzero.map((n) => ({ id: `${pool.name}:dr:${n.tokenId}`, to: pool.address, data: GET_DEBT_RATIO_SIG + word(n.tokenId) }));
      const [ownerResults, drResults] = await Promise.all([batchEthCall(ownerCalls), batchEthCall(drCalls)]);

      for (const n of nonzero) {
        const ownerResult = ownerResults.get(`${pool.name}:owner:${n.tokenId}`);
        if (!ownerResult || ownerResult === "0x") continue;
        const owner = decodeAddress(ownerResult);

        const drResult = drResults.get(`${pool.name}:dr:${n.tokenId}`);
        const debtRatio = drResult && drResult !== "0x" ? Number(decodeUint(drResult)) / Number(WAD) : 0;

        const { collateralValueUsd, debtValueUsd, equityUsd } = computeValuation(pool.side, n.rawCollateral, n.rawDebt, price);

        await client.query(
          `insert into public.fx_current_positions(pool_name, pool_address, side, collateral, token_id, owner, raw_collateral, raw_debt, oracle_price, collateral_value_usd, debt_value_usd, equity_usd, debt_ratio, updated_at)
           values ($1,$2,$3,$4,$5::numeric,$6,$7::numeric,$8::numeric,$9,$10,$11,$12,$13,now())
           on conflict (pool_address, token_id) do update set
             pool_name = excluded.pool_name, side = excluded.side, collateral = excluded.collateral, owner = excluded.owner,
             raw_collateral = excluded.raw_collateral, raw_debt = excluded.raw_debt, oracle_price = excluded.oracle_price,
             collateral_value_usd = excluded.collateral_value_usd, debt_value_usd = excluded.debt_value_usd,
             equity_usd = excluded.equity_usd, debt_ratio = excluded.debt_ratio, updated_at = now()`,
          [pool.name, pool.address.toLowerCase(), pool.side, pool.collateral, n.tokenId, owner,
           String(n.rawCollateral), String(n.rawDebt), price.toFixed(18),
           collateralValueUsd.toFixed(12), debtValueUsd.toFixed(12), equityUsd.toFixed(12), debtRatio.toFixed(18)]
        );
        totalPositions++;
        if (owner.startsWith("0x")) knownWallets.add(owner);
      }
    }

    // Record sync
    await client.query("insert into public.fx_current_position_syncs(source) values ($1)", ["live_rpc_api"]);

    // Seed known wallets table
    await client.query(`
      create table if not exists public.fx_known_wallets (
        address text primary key, first_seen_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(), source text not null default 'unknown',
        last_position_sync_at timestamptz, last_history_sync_at timestamptz,
        history_cursor_block bigint, history_status text not null default 'pending',
        realized_pnl_status text not null default 'not_indexed', updated_at timestamptz not null default now(),
        check (address ~ '^0x[0-9a-f]{40}$')
      );
    `);
    for (const addr of knownWallets) {
      await client.query(
        `insert into public.fx_known_wallets(address, source, last_position_sync_at)
         values ($1, 'current_positions_snapshot', now())
         on conflict (address) do update set last_seen_at = now(), source = excluded.source, last_position_sync_at = now(), updated_at = now()`,
        [addr]
      );
    }

    return NextResponse.json({
      ok: true,
      jobName: "sync-current-positions",
      totalPositions,
      walletsSeeded: knownWallets.size,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, jobName: "sync-current-positions", error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}
