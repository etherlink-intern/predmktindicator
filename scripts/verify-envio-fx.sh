#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

HASURA_URL="http://127.0.0.1:${HASURA_EXTERNAL_PORT:-8088}"
ENVIO_DB="${ENVIO_PG_DATABASE:-envio-dev}"
ENVIO_DB_USER="${ENVIO_PG_USER:-postgres}"
POSTGRES_CONTAINER="fx-trader-profiles-envio-postgres"
HASURA_CONTAINER="fx-trader-profiles-envio-hasura"
INDEXER_CONTAINER="fx-trader-profiles-envio-indexer"

required_fx_contracts=1
required_fx_events=6
required_position_transfers=6

echo "== Envio f(x) container state =="
for container in "$POSTGRES_CONTAINER" "$HASURA_CONTAINER" "$INDEXER_CONTAINER"; do
  if ! docker inspect "$container" >/dev/null 2>&1; then
    echo "FAIL - $container is not created" >&2
    exit 1
  fi
  state="$(docker inspect -f '{{.State.Status}}' "$container")"
  exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$container")"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container")"
  echo "$container: state=$state health=$health exit=$exit_code"
done

indexer_state="$(docker inspect -f '{{.State.Status}}' "$INDEXER_CONTAINER")"
indexer_exit="$(docker inspect -f '{{.State.ExitCode}}' "$INDEXER_CONTAINER")"
if [ "$indexer_state" != "exited" ] || [ "$indexer_exit" != "0" ]; then
  echo "FAIL - bounded f(x) indexer should have completed with exit code 0" >&2
  exit 1
fi

echo
printf "== Hasura health (%s) ==\n" "$HASURA_URL"
curl -fsS --max-time 10 "$HASURA_URL/healthz" >/dev/null
echo "OK - Hasura healthz responded"

echo
printf "== Envio Postgres f(x) row counts ==\n"
read -r fx_contracts fx_events fx_position_transfers < <(
  docker exec "$POSTGRES_CONTAINER" psql -At -F ' ' -U "$ENVIO_DB_USER" -d "$ENVIO_DB" -v ON_ERROR_STOP=1 -c \
    'select (select count(*) from envio."FxContract"), (select count(*) from envio."FxEvent"), (select count(*) from envio."FxPositionTransfer");'
)

echo "FxContract rows: $fx_contracts"
echo "FxEvent rows: $fx_events"
echo "FxPositionTransfer rows: $fx_position_transfers"

if [ "$fx_contracts" -lt "$required_fx_contracts" ] || [ "$fx_events" -lt "$required_fx_events" ] || [ "$fx_position_transfers" -lt "$required_position_transfers" ]; then
  echo "FAIL - expected at least $required_fx_contracts FxContract rows, $required_fx_events FxEvent rows, and $required_position_transfers FxPositionTransfer row" >&2
  exit 1
fi

if [ -z "${HASURA_GRAPHQL_ADMIN_SECRET:-}" ]; then
  echo "WARN - HASURA_GRAPHQL_ADMIN_SECRET is not set; skipping GraphQL query"
  exit 0
fi

echo
printf "== Hasura GraphQL f(x) query ==\n"
python3 - <<'PY'
import json
import os
import urllib.request

secret = os.environ["HASURA_GRAPHQL_ADMIN_SECRET"]
port = os.environ.get("HASURA_EXTERNAL_PORT", "8088")
query = {
    "query": """
    query EnvioFxVerification {
      FxContract(limit: 10, order_by: { id: asc }) { id name category observedEventCount }
      FxEvent(limit: 20, order_by: [{ blockNumber: asc }, { logIndex: asc }]) {
        id
        eventName
        blockNumber
        transactionHash
        contract { id name }
      }
      FxPositionTransfer(limit: 10, order_by: { id: asc }) { id tokenId from to }
    }
    """
}
req = urllib.request.Request(
    f"http://127.0.0.1:{port}/v1/graphql",
    data=json.dumps(query).encode(),
    headers={"content-type": "application/json", "x-hasura-admin-secret": secret},
)
with urllib.request.urlopen(req, timeout=10) as response:
    payload = json.load(response)
if "errors" in payload:
    raise SystemExit(json.dumps(payload, indent=2))
contracts = payload["data"]["FxContract"]
events = payload["data"]["FxEvent"]
transfers = payload["data"]["FxPositionTransfer"]
print(json.dumps({
    "FxContract": len(contracts),
    "FxEvent": len(events),
    "FxPositionTransfer": len(transfers),
    "contracts": contracts,
    "firstEvents": events[:3],
}, indent=2))
if len(contracts) < 1 or len(events) < 6 or len(transfers) < 6:
    raise SystemExit("unexpected GraphQL row count")
PY

echo

echo "Envio f(x) verification completed successfully."
