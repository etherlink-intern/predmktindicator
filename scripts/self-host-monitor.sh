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

APP_HEALTH_URL="${PUBLIC_APP_URL:-http://localhost:${WEB_PORT:-3000}}/api/health"
RPC_ROUTER_HEALTH_URL="http://${RPC_ROUTER_BIND_HOST:-127.0.0.1}:${RPC_ROUTER_PORT:-18545}/health"
HASURA_HEALTH_URL="http://127.0.0.1:${HASURA_EXTERNAL_PORT:-8088}/healthz"
failures=0

section() {
  printf '\n== %s ==\n' "$1"
}

check() {
  local label="$1"
  shift
  if "$@"; then
    echo "OK  - $label"
  else
    echo "FAIL - $label" >&2
    failures=$((failures + 1))
  fi
}

section "Docker Compose services"
docker compose ps

section "Container health"
for service in postgres rpc-router web cron postgres-backup; do
  cid="$(docker compose ps -q "$service" 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    echo "FAIL - $service is not created" >&2
    failures=$((failures + 1))
    continue
  fi
  state="$(docker inspect -f '{{.State.Status}}' "$cid")"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$cid")"
  echo "$service: state=$state health=$health"
  if [ "$state" != "running" ]; then
    failures=$((failures + 1))
  fi
  if [ "$health" = "unhealthy" ]; then
    failures=$((failures + 1))
  fi
done

for service in watchtower; do
  cid="$(docker compose ps -q "$service" 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    echo "SKIP - $service is not enabled (optional updates profile)"
    continue
  fi
  state="$(docker inspect -f '{{.State.Status}}' "$cid")"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$cid")"
  echo "$service: state=$state health=$health"
  if [ "$state" != "running" ] || [ "$health" = "unhealthy" ]; then
    failures=$((failures + 1))
  fi
done

section "Postgres"
check "Postgres responds to pg_isready" docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-fx_trader_profiles}" -d "${POSTGRES_DB:-fx_trader_profiles}"

section "App health"
if command -v curl >/dev/null 2>&1; then
  check "GET $APP_HEALTH_URL" curl -fsS --max-time 10 "$APP_HEALTH_URL"
else
  echo "WARN - curl is not installed; skipping app health request"
fi

section "RPC router health"
if command -v curl >/dev/null 2>&1; then
  check "GET $RPC_ROUTER_HEALTH_URL" curl -fsS --max-time 10 "$RPC_ROUTER_HEALTH_URL"
else
  echo "WARN - curl is not installed; skipping RPC router health request"
fi

section "Optional Envio local indexer"
for container in fx-trader-profiles-envio-postgres fx-trader-profiles-envio-hasura fx-trader-profiles-envio-indexer; do
  if ! docker inspect "$container" >/dev/null 2>&1; then
    echo "SKIP - $container is not created"
    continue
  fi
  state="$(docker inspect -f '{{.State.Status}}' "$container")"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container")"
  exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$container")"
  echo "$container: state=$state health=$health exit=$exit_code"
  if [ "$container" = "fx-trader-profiles-envio-indexer" ] && [ "$state" = "exited" ] && [ "$exit_code" = "0" ]; then
    echo "OK  - bounded Envio f(x) indexer completed successfully"
    continue
  fi
  if [ "$state" != "running" ] || [ "$health" = "unhealthy" ]; then
    failures=$((failures + 1))
  fi
done

if command -v curl >/dev/null 2>&1 && docker inspect fx-trader-profiles-envio-hasura >/dev/null 2>&1; then
  check "GET $HASURA_HEALTH_URL" curl -fsS --max-time 10 "$HASURA_HEALTH_URL"
fi

section "Resource snapshot"
docker stats --no-stream || true

echo
if [ "$failures" -gt 0 ]; then
  echo "Monitoring completed with $failures failure(s)." >&2
  exit 1
fi

echo "Monitoring completed successfully."
