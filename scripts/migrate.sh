#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a; source "$ROOT/infra/.env.shared"; set +a

echo "Applying migrations to $POSTGRES_URL ..."
npm run build -w @musicexamaid/shared >/dev/null
npm run build -w @musicexamaid/api >/dev/null
node "$ROOT/services/api/dist/store/postgres.js"
