#!/usr/bin/env bash
# Deploy an exact Git commit to mainland ubtxiaomi. Human GO is required for --apply.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODE="${1:---dry-run}"
RELEASE_REF="${2:-HEAD}"
SHA=$(git -C "$ROOT" rev-parse "${RELEASE_REF}^{commit}")
DEPLOY_HOST="${DEPLOY_HOST:-ubtxiaomi}"

if [[ "$MODE" != "--apply" ]]; then
  echo "Dry run: deploy $SHA to $DEPLOY_HOST under /tmp/musicexamaid-deploy.lock (wait at most 60 seconds)."
  echo "The existing environment and model data stay on the mainland host."
  exit 0
fi

ARCHIVE=$(mktemp "${TMPDIR:-/tmp}/mea-release.XXXXXX")
trap 'rm -f "$ARCHIVE"' EXIT
git -C "$ROOT" archive --format=tar "$SHA" | gzip > "$ARCHIVE"

REMOTE_SCRIPT=$(cat <<'REMOTE'
set -euo pipefail
sha="$1"
stack=/opt/stacks/musicexamaid
release="$stack/releases/$sha"
previous_image=$(docker inspect --format '{{.Image}}' musicexamaid-api)
previous_revision=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' musicexamaid-api)
mkdir -p "$release"
tar -xz -C "$release"
# These are host-owned files. Never copy local secrets or model weights over them.
if [[ ! -e "$release/infra/.env.shared" ]]; then
  ln -s "$stack/infra/.env.shared" "$release/infra/.env.shared"
fi
if [[ ! -e "$release/services/api/data" ]]; then
  ln -s "$stack/services/api/data" "$release/services/api/data"
fi
cd "$release"
export MEA_RELEASE_SHA="$sha"
compose=(docker compose --project-name infra -f infra/docker-compose.prod.yml)
"${compose[@]}" build musicexamaid-api
"${compose[@]}" run --rm --no-deps -T musicexamaid-api node -e \
  "require('./services/api/dist/auth/family-session').assertProductionAuthConfig(); require('@musicexamaid/shared').encryptIdNumber('configuration-probe'); console.log('Production configuration valid');"
"${compose[@]}" run --rm --no-deps -T musicexamaid-api node services/api/dist/store/postgres.js
"${compose[@]}" up -d --no-build musicexamaid-api
healthy=0
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3100/health > /dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" != 1 ]]; then
  echo "New release failed health verification; restoring the previous image." >&2
  docker tag "$previous_image" "musicexamaid-api:rollback-$sha"
  MEA_RELEASE_SHA="rollback-$sha" "${compose[@]}" up -d --no-build musicexamaid-api
  exit 1
fi
# Prove that auth is active before declaring success. These requests cannot write.
status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/official-sync/partner-agents)
if [[ "$status" != 401 ]]; then
  echo "Auth verification failed ($status); restoring the previous image." >&2
  docker tag "$previous_image" "musicexamaid-api:rollback-$sha"
  MEA_RELEASE_SHA="rollback-$sha" "${compose[@]}" up -d --no-build musicexamaid-api
  exit 1
fi
printf 'Deployed %s (previous revision: %s)\n' "$sha" "$previous_revision"
curl -fsS 'http://127.0.0.1:3100/health?live=1'
REMOTE
)
# flock retains the same inode, waits for its holder, and releases on process exit.
printf -v QUOTED_SCRIPT '%q' "$REMOTE_SCRIPT"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$DEPLOY_HOST" \
  "flock -w 60 /tmp/musicexamaid-deploy.lock bash -c $QUOTED_SCRIPT -- $SHA" < "$ARCHIVE"
