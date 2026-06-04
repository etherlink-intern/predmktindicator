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
INDEXER_CONTAINER="fx-trader-profiles-envio-indexer"

echo "== Envio smoke container state =="
for container in "$POSTGRES_CONTAINER" fx-trader-profiles-envio-hasura "$INDEXER_CONTAINER"; do
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
  echo "FAIL - bounded smoke indexer should have completed with exit code 0" >&2
  exit 1
fi

echo
printf "== Hasura health (%s) ==\n" "$HASURA_URL"
curl -fsS --max-time 10 "$HASURA_URL/healthz" >/dev/null
echo "OK - Hasura healthz responded"

echo
printf "== Envio Postgres row counts ==\n"
read -r smoke_accounts smoke_transfers < <(
  docker exec "$POSTGRES_CONTAINER" psql -At -F ' ' -U "$ENVIO_DB_USER" -d "$ENVIO_DB" -v ON_ERROR_STOP=1 -c \
    'select (select count(*) from envio."SmokeAccount"), (select count(*) from envio."SmokeTransfer");'
)

echo "SmokeAccount rows: $smoke_accounts"
echo "SmokeTransfer rows: $smoke_transfers"

if [ "$smoke_accounts" != "3" ] || [ "$smoke_transfers" != "2" ]; then
  echo "FAIL - expected 3 SmokeAccount rows and 2 SmokeTransfer rows" >&2
  exit 1
fi

if [ -z "${HASURA_GRAPHQL_ADMIN_SECRET:-}" ]; then
  echo "WARN - HASURA_GRAPHQL_ADMIN_SECRET is not set; skipping GraphQL query"
  exit 0
fi

echo
printf "== Hasura GraphQL smoke query ==\n"
python3 - <<'PY'
import json
import os
import urllib.request

secret = os.environ["HASURA_GRAPHQL_ADMIN_SECRET"]
port = os.environ.get("HASURA_EXTERNAL_PORT", "8088")
query = {
    "query": """
    query EnvioSmokeVerification {
      SmokeTransfer(limit: 5, order_by: { id: asc }) { id value }
      SmokeAccount(limit: 5, order_by: { id: asc }) { id balance sentTransferCount receivedTransferCount }
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
transfers = payload["data"]["SmokeTransfer"]
accounts = payload["data"]["SmokeAccount"]
print(json.dumps({"SmokeTransfer": len(transfers), "SmokeAccount": len(accounts)}, indent=2))
if len(transfers) != 2 or len(accounts) != 3:
    raise SystemExit("unexpected GraphQL row count")
PY

echo

echo "Envio smoke verification completed successfully."
