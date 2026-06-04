#!/usr/bin/env python3
"""Sync current f(x) position NFTs into the app Postgres database.

This local self-host job scans verified f(x) position-pool contracts with:
- getNextPositionId()
- getPosition(tokenId)
- ownerOf(tokenId)

It writes owner-confirmed nonzero positions to public.fx_current_positions.
Secrets are read from ignored .env and are never printed.
"""

from __future__ import annotations

import csv
import json
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from decimal import Decimal, getcontext
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
NEXT_ID = "0x067f4ddd"
GET_POSITION = "0xeb02c301"
OWNER_OF = "0x6352211e"
PRICE_ORACLE = "0x2630c12f"
GET_EXCHANGE_PRICE = "0xa51ff4a2"
GET_POSITION_DEBT_RATIO = "0x861b4cfe"
WAD = Decimal(10) ** 18
getcontext().prec = 80
POOLS = {
    "WstETHLongPool": ("0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8", "long", "wstETH"),
    "WBTCLongPool": ("0xAB709e26Fa6B0A30c119D8c55B887DeD24952473", "long", "WBTC"),
    "WstETHShortPool": ("0x25707b9e6690B52C60aE6744d711cf9C1dFC1876", "short", "wstETH"),
    "WBTCShortPool": ("0xA0cC8162c523998856D59065fAa254F87D20A5b0", "short", "WBTC"),
}


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if not ENV_PATH.exists():
        return env
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key] = value
    return env


ENV = load_env()
# This host runs the local rpc-router on 127.0.0.1:18545. Prefer it for this
# high-volume snapshot job so we do not stall on one remote provider endpoint.
RPC = (
    ENV.get("FX_CURRENT_POSITIONS_RPC_URL")
    or ENV.get("RPC_ROUTER_URL")
    or "http://127.0.0.1:18545"
    or ENV.get("ALCHEMY_RPC_URL")
    or ENV.get("ETHEREUM_RPC_URL")
)


def rpc_post(payload: object, timeout: int = 60) -> object:
    body = json.dumps(payload).encode()
    last: BaseException | None = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            last = exc
            time.sleep((5 if exc.code == 429 else 0.8) * (attempt + 1))
        except Exception as exc:  # noqa: BLE001 - retry transient RPC/network failures
            last = exc
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"RPC request failed after retries: {last}")


def eth_call(to: str, data: str) -> str:
    result = rpc_post({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": to, "data": data}, "latest"]})
    if isinstance(result, dict) and "error" in result:
        raise RuntimeError(result["error"])
    if not isinstance(result, dict):
        raise RuntimeError(f"unexpected RPC response: {result!r}")
    return str(result.get("result"))


def batch_eth_call(calls: list[tuple[str, str, str]], batch_size: int = 20) -> dict[str, dict]:
    output: dict[str, dict] = {}

    def run_chunk(chunk: list[tuple[str, str, str]]) -> None:
        payload = [
            {"jsonrpc": "2.0", "id": call_id, "method": "eth_call", "params": [{"to": to, "data": data}, "latest"]}
            for call_id, to, data in chunk
        ]
        try:
            result = rpc_post(payload, timeout=90)
        except Exception as exc:  # noqa: BLE001 - split flaky provider batches before giving up
            if len(chunk) > 1:
                midpoint = len(chunk) // 2
                run_chunk(chunk[:midpoint])
                run_chunk(chunk[midpoint:])
                return
            call_id, _, _ = chunk[0]
            output[call_id] = {"id": call_id, "error": str(exc)}
            return
        if isinstance(result, dict):
            result = [result]
        if not isinstance(result, list):
            if len(chunk) > 1:
                midpoint = len(chunk) // 2
                run_chunk(chunk[:midpoint])
                run_chunk(chunk[midpoint:])
                return
            call_id, _, _ = chunk[0]
            output[call_id] = {"id": call_id, "error": f"unexpected batch response: {result!r}"}
            return
        for item in result:
            output[str(item["id"])] = item
        time.sleep(0.2)

    for index in range(0, len(calls), batch_size):
        run_chunk(calls[index : index + batch_size])
    return output


def word(value: int) -> str:
    return format(int(value), "064x")


def decode_uint_pair(result: str | None) -> tuple[int, int] | None:
    if not result or result == "0x" or len(result) < 130:
        return None
    hex_data = result[2:]
    return int(hex_data[:64], 16), int(hex_data[64:128], 16)


def decode_owner(result: str | None) -> str | None:
    if not result or result == "0x" or len(result) < 66:
        return None
    return "0x" + result[-40:].lower()


def decode_address(result: str | None) -> str | None:
    if not result or result == "0x" or len(result) < 66:
        return None
    return "0x" + result[-40:].lower()


def decode_uint(result: str | None) -> int | None:
    if not result or result == "0x":
        return None
    return int(result, 16)


def decimal_string(value: Decimal, places: int = 18) -> str:
    quant = Decimal(1).scaleb(-places)
    return format(value.quantize(quant), "f")


def get_pool_price(address: str) -> Decimal:
    oracle = decode_address(eth_call(address, PRICE_ORACLE))
    if not oracle:
        raise RuntimeError(f"could not decode price oracle for {address}")
    price = decode_uint(eth_call(oracle, GET_EXCHANGE_PRICE))
    if price is None or price == 0:
        raise RuntimeError(f"could not decode exchange price for {address} via {oracle}")
    return Decimal(price) / WAD


def position_valuation(side: str, raw_collateral: int, raw_debt: int, price: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    """Return current collateral value, debt value, and equity in USD-like units.

    Long pools use collateral-token/USD price, so collateral value is
    rawCollateral * price and debt is fxUSD. Short pools use inverse oracle
    price (collateral-token per USD); their collateral is fxUSD-like and debt
    is the underlying collateral token, so debt value is rawDebt / price.

    This is current mark-to-oracle equity, not realized historical PnL.
    """
    collateral_amount = Decimal(raw_collateral) / WAD
    debt_amount = Decimal(raw_debt) / WAD
    if side == "long":
        collateral_value = collateral_amount * price
        debt_value = debt_amount
    else:
        collateral_value = collateral_amount
        debt_value = debt_amount / price
    return collateral_value, debt_value, collateral_value - debt_value


def retry_position_call(address: str, token_id: int) -> tuple[int, int] | None:
    """Retry one getPosition call outside the batch path.

    Public RPC providers sometimes return per-item batch errors. A single-call
    retry avoids undercounting open positions when the batch layer is flaky,
    while genuinely missing/reverting IDs still get skipped.
    """
    for attempt in range(3):
        try:
            return decode_uint_pair(eth_call(address, GET_POSITION + word(token_id)))
        except Exception:  # noqa: BLE001 - reverts and transient RPC errors both land here
            time.sleep(0.25 * (attempt + 1))
    return None


def scan_positions(csv_path: Path) -> int:
    rows: list[dict[str, str]] = []
    for pool_name, (address, side, collateral) in POOLS.items():
        price = get_pool_price(address)
        next_id = int(eth_call(address, NEXT_ID), 16)
        token_ids = list(range(1, next_id))
        print(f"scanning {pool_name}: {len(token_ids)} candidate ids price={decimal_string(price, 12)}", flush=True)
        calls = [(f"{pool_name}:pos:{token_id}", address, GET_POSITION + word(token_id)) for token_id in token_ids]
        position_results = batch_eth_call(calls, batch_size=20)
        nonzero: list[tuple[int, int, int]] = []
        retried = 0
        for token_id in token_ids:
            item = position_results.get(f"{pool_name}:pos:{token_id}", {})
            decoded = None if "error" in item else decode_uint_pair(item.get("result"))
            if decoded is None:
                retried += 1
                decoded = retry_position_call(address, token_id)
                if decoded is None:
                    continue
            raw_collateral, raw_debt = decoded
            if raw_collateral != 0 or raw_debt != 0:
                nonzero.append((token_id, raw_collateral, raw_debt))
        owner_confirmed = 0
        owner_calls = [(f"{pool_name}:owner:{token_id}", address, OWNER_OF + word(token_id)) for token_id, _, _ in nonzero]
        debt_ratio_calls = [
            (f"{pool_name}:debt_ratio:{token_id}", address, GET_POSITION_DEBT_RATIO + word(token_id))
            for token_id, _, _ in nonzero
        ]
        owner_results = batch_eth_call(owner_calls, batch_size=50)
        debt_ratio_results = batch_eth_call(debt_ratio_calls, batch_size=50)

        for token_id, raw_collateral, raw_debt in nonzero:
            owner_item = owner_results.get(f"{pool_name}:owner:{token_id}", {})
            owner = None if "error" in owner_item else decode_owner(owner_item.get("result"))
            if not owner:
                continue
            debt_ratio_item = debt_ratio_results.get(f"{pool_name}:debt_ratio:{token_id}", {})
            debt_ratio_raw = None if "error" in debt_ratio_item else decode_uint(debt_ratio_item.get("result"))
            debt_ratio = Decimal(debt_ratio_raw or 0) / WAD
            collateral_value, debt_value, equity = position_valuation(side, raw_collateral, raw_debt, price)
            owner_confirmed += 1
            rows.append(
                {
                    "pool_name": pool_name,
                    "pool_address": address.lower(),
                    "side": side,
                    "collateral": collateral,
                    "token_id": str(token_id),
                    "owner": owner,
                    "raw_collateral": str(raw_collateral),
                    "raw_debt": str(raw_debt),
                    "oracle_price": decimal_string(price),
                    "collateral_value_usd": decimal_string(collateral_value, 12),
                    "debt_value_usd": decimal_string(debt_value, 12),
                    "equity_usd": decimal_string(equity, 12),
                    "debt_ratio": decimal_string(debt_ratio),
                }
            )
        print(f"  nonzero={len(nonzero)} owner_confirmed={owner_confirmed} retried_positions={retried}", flush=True)

    with csv_path.open("w", newline="") as handle:
        fieldnames = [
            "pool_name",
            "pool_address",
            "side",
            "collateral",
            "token_id",
            "owner",
            "raw_collateral",
            "raw_debt",
            "oracle_price",
            "collateral_value_usd",
            "debt_value_usd",
            "equity_usd",
            "debt_ratio",
        ]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def load_postgres(csv_path: Path) -> str:
    container = ENV.get("POSTGRES_CONTAINER", "fx-trader-profiles-postgres")
    user = ENV.get("POSTGRES_USER", "fx_trader_profiles")
    database = ENV.get("POSTGRES_DB", "fx_trader_profiles")

    subprocess.run(["docker", "cp", str(csv_path), f"{container}:/tmp/fx_current_positions.csv"], check=True)

    sql = r'''
create table if not exists public.fx_current_position_syncs (
  id bigserial primary key,
  generated_at timestamptz not null default now(),
  source text not null default 'live_rpc_snapshot'
);

create table if not exists public.fx_current_positions (
  pool_name text not null,
  pool_address text not null,
  side text not null check (side in ('long', 'short')),
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

alter table public.fx_current_positions add column if not exists oracle_price numeric(78,18);
alter table public.fx_current_positions add column if not exists collateral_value_usd numeric(78,18);
alter table public.fx_current_positions add column if not exists debt_value_usd numeric(78,18);
alter table public.fx_current_positions add column if not exists equity_usd numeric(78,18);
alter table public.fx_current_positions add column if not exists debt_ratio numeric(78,18);

truncate table public.fx_current_positions;
\copy public.fx_current_positions(pool_name, pool_address, side, collateral, token_id, owner, raw_collateral, raw_debt, oracle_price, collateral_value_usd, debt_value_usd, equity_usd, debt_ratio) from '/tmp/fx_current_positions.csv' with (format csv, header true)
insert into public.fx_current_position_syncs(source) values ('live_rpc_snapshot');

create index if not exists fx_current_positions_owner_idx on public.fx_current_positions(owner);
create index if not exists fx_current_positions_pool_idx on public.fx_current_positions(pool_name, side, collateral);

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

insert into public.fx_known_wallets(address, source, last_position_sync_at)
select distinct lower(owner), 'current_positions_snapshot', now()
from public.fx_current_positions
where owner is not null
  and lower(owner) <> '0x0000000000000000000000000000000000000000'
  and lower(owner) ~ '^0x[0-9a-f]{40}$'
on conflict (address) do update set
  last_seen_at = now(),
  source = excluded.source,
  last_position_sync_at = now(),
  updated_at = now();

select count(*) as open_positions, count(distinct owner) as unique_traders, count(distinct pool_address) as pools
from public.fx_current_positions;
'''
    command = [
        "docker",
        "exec",
        "-i",
        container,
        "sh",
        "-lc",
        "export PGPASSWORD=\"$POSTGRES_PASSWORD\"; exec psql -U \"$1\" -d \"$2\" -v ON_ERROR_STOP=1",
        "sh",
        user,
        database,
    ]
    result = subprocess.run(command, input=sql, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)
    return result.stdout


def main() -> None:
    with tempfile.NamedTemporaryFile(prefix="fx_current_positions_", suffix=".csv", delete=False) as tmp:
        csv_path = Path(tmp.name)
    try:
        count = scan_positions(csv_path)
        print(f"wrote {count} owner-confirmed open positions to {csv_path}")
        print(load_postgres(csv_path))
    finally:
        csv_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
