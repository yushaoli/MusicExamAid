#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a; source "$ROOT/infra/.env.shared"; set +a
echo "DB -> $POSTGRES_URL"
docker run --rm --network host postgres:16-alpine sh -lc "apk add --no-cache postgresql-client >/dev/null; psql '$POSTGRES_URL' -c 'select 1;'"
echo "Redis -> $REDIS_URL"
docker run --rm --network host redis:7-alpine redis-cli -u "$REDIS_URL" ping
echo "S3 -> $S3_BUCKET"
docker run --rm --network host --entrypoint /bin/sh minio/mc -c "mc alias set local $S3_ENDPOINT $S3_ACCESS_KEY $S3_SECRET_KEY >/dev/null; mc ls local/$S3_BUCKET >/dev/null; echo OK"
