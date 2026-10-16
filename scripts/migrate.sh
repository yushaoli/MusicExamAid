#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a; source "$ROOT/infra/.env.shared"; set +a

echo "Applying migrations to $POSTGRES_URL ..."
for sql_file in "$ROOT"/infra/migrations/*.sql; do
  echo "  -> $(basename "$sql_file")"
  if command -v psql >/dev/null 2>&1; then
    psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f "$sql_file"
  else
    docker run --rm -i --network host postgres:16-alpine psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 < "$sql_file"
  fi
done
echo "Migrations complete."
