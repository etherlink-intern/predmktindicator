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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
NEXT_ID = "0x067f4ddd"
GET_POSITION = "0xeb02c301"
OWNER_OF = "0x6352211e"
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
RPC = ENV.get("ALCHEMY_RPC_URL") or ENV.get("ETHEREUM_RPC_URL") or "http://127.0.0.1:18545"


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
    for index in range(0, len(calls), batch_size):
        chunk = calls[index : index + batch_size]
        payload = [
            {"jsonrpc": "2.0", "id": call_id, "method": "eth_call", "params": [{"to": to, "data": data}, "latest"]}
            for call_id, to, data in chunk
        ]
        result = rpc_post(payload, timeout=90)
        if isinstance(result, dict):
            result = [result]
        if not isinstance(result, list):
            raise RuntimeError(f"unexpected batch response: {result!r}")
        for item in result:
            output[str(item["id"])] = item
        time.sleep(0.2)
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
        next_id = int(eth_call(address, NEXT_ID), 16)
        token_ids = list(range(1, next_id))
        print(f"scanning {pool_name}: {len(token_ids)} candidate ids", flush=True)
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
        for token_id, raw_collateral, raw_debt in nonzero:
            response = rpc_post(
                {"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": address, "data": OWNER_OF + word(token_id)}, "latest"]}
            )
            owner = None if not isinstance(response, dict) or "error" in response else decode_owner(response.get("result"))
            if not owner:
                continue
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
                }
            )
            time.sleep(0.02)
        print(f"  nonzero={len(nonzero)} owner_confirmed={owner_confirmed} retried_positions={retried}", flush=True)

    with csv_path.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["pool_name", "pool_address", "side", "collateral", "token_id", "owner", "raw_collateral", "raw_debt"],
        )
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
  updated_at timestamptz not null default now(),
  primary key (pool_address, token_id)
);

truncate table public.fx_current_positions;
\copy public.fx_current_positions(pool_name, pool_address, side, collateral, token_id, owner, raw_collateral, raw_debt) from '/tmp/fx_current_positions.csv' with (format csv, header true)
insert into public.fx_current_position_syncs(source) values ('live_rpc_snapshot');

create index if not exists fx_current_positions_owner_idx on public.fx_current_positions(owner);
create index if not exists fx_current_positions_pool_idx on public.fx_current_positions(pool_name, side, collateral);

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
