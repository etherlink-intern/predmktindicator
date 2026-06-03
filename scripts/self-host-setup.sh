#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/infra/self-host/.env.example"

cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

compose() {
  docker compose "$@"
}

require_cmd docker
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required (docker compose ...)." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created .env from infra/self-host/.env.example"
fi

if grep -q '^CRON_SECRET=$' "$ENV_FILE"; then
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 32)"
  else
    secret="$(date +%s | sha256sum | awk '{print $1}')"
  fi
  python3 - <<PY
from pathlib import Path
path = Path('$ENV_FILE')
text = path.read_text()
text = text.replace('CRON_SECRET=\n', 'CRON_SECRET=$secret\n')
path.write_text(text)
PY
  echo "Generated CRON_SECRET in .env"
fi

if grep -q 'change-me-long-random-password' "$ENV_FILE"; then
  echo "WARNING: .env still contains the default Postgres password. Edit POSTGRES_PASSWORD and DATABASE_URL before production use." >&2
fi

mkdir -p "$ROOT_DIR/var"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

compose pull postgres cron postgres-backup || true
compose build web
compose up -d postgres
compose up -d

echo
echo "Self-hosted stack setup completed."
echo "Next steps:"
echo "  1. Point your reverse proxy at http://127.0.0.1:${WEB_PORT:-3000} if exposing publicly."
echo "  2. Run: scripts/self-host-monitor.sh"
echo "  3. Run migrations when implemented: pnpm db:push"
echo "  4. Optional registry auto-updates: docker compose --profile updates up -d watchtower"
