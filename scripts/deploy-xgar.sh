#!/usr/bin/env bash
# Deploy MusicExamAid API to ubtxiaomi (100.64.0.4:3100) and wire Caddy + WeCom relay on derp-sgr (47.130.165.104).
# Defaults to --dry-run unless --apply is passed (per COLLABORATION.md human deployment GO gate).
set -euo pipefail

MODE="dry-run"
if [[ "${1:-}" == "--apply" ]]; then
  MODE="apply"
fi

UBT_HOST="${UBT_HOST:-100.64.0.4}"
UBT_USER="${UBT_USER:-flintstone}"
UBT_STACK_DIR="/opt/stacks/musicexamaid"

SGR_HOST="${SGR_HOST:-47.130.165.104}"
SGR_USER="${SGR_USER:-ubuntu}"
SGR_CORE_DIR="/home/ubuntu/headscale-core"

echo "=== MusicExamAid xgar.com.cn Deployment (${MODE}) ==="
echo "1. Target API Node:   ${UBT_USER}@${UBT_HOST}:${UBT_STACK_DIR} (container port 3100 -> Postgres :55432, Redis :63790, MinIO :9010)"
echo "2. Target Edge Node:  ${SGR_USER}@${SGR_HOST}:${SGR_CORE_DIR}/caddy/Caddyfile (mea.xgar.com.cn -> 100.64.0.4:3100)"
echo "3. Target WeCom Env:  ${SGR_USER}@${SGR_HOST}:${SGR_CORE_DIR}/kuma-wecom-relay.env"

if [[ "${MODE}" != "apply" ]]; then
  echo ""
  echo "[DRY-RUN] No remote hosts were modified."
  echo "Run './scripts/deploy-xgar.sh --apply' after human deployment GO."
  exit 0
fi

echo "[1/3] Syncing repository & starting musicexamaid-api on ${UBT_HOST}..."
ssh "${UBT_USER}@${UBT_HOST}" "sudo mkdir -p ${UBT_STACK_DIR} && sudo chown -R ${UBT_USER}: ${UBT_STACK_DIR}"
rsync -az --exclude node_modules --exclude .git ./ "${UBT_USER}@${UBT_HOST}:${UBT_STACK_DIR}/"
ssh "${UBT_USER}@${UBT_HOST}" "cd ${UBT_STACK_DIR} && docker compose -f infra/docker-compose.prod.yml up -d --build"

echo "[2/3] Checking mea.xgar.com.cn vhost in ${SGR_HOST}:${SGR_CORE_DIR}/caddy/Caddyfile..."
ssh "${SGR_USER}@${SGR_HOST}" "grep -q 'mea.xgar.com.cn' ${SGR_CORE_DIR}/caddy/Caddyfile || cat >> ${SGR_CORE_DIR}/caddy/Caddyfile" < infra/Caddyfile.xgar.snippet
ssh "${SGR_USER}@${SGR_HOST}" "cd ${SGR_CORE_DIR} && docker compose restart caddy"

echo "[3/3] Verifying API health on ${UBT_HOST}:3100..."
curl -fsSL "http://${UBT_HOST}:3100/health?live=1"
echo ""
echo "=== Deployment Complete ==="
