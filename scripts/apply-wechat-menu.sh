#!/usr/bin/env bash
# Publish MusicExamAid WeChat Service Account custom menu via Official Account API.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/infra/.env.shared}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ -z "${WECHAT_MP_APPID:-}" || -z "${WECHAT_MP_SECRET:-}" ]]; then
  echo "Usage: Set WECHAT_MP_APPID and WECHAT_MP_SECRET in infra/.env.shared before running." >&2
  exit 1
fi

TOKEN_JSON="$(curl -fsSL "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WECHAT_MP_APPID}&secret=${WECHAT_MP_SECRET}")"
ACCESS_TOKEN="$(node -e 'const d=JSON.parse(process.argv[1]); if(!d.access_token){console.error(d);process.exit(1);} console.log(d.access_token);' "${TOKEN_JSON}")"

MENU_JSON="$(node -e '
const { buildServiceAccountMenuConfig } = require("./packages/shared/dist/index.js");
console.log(JSON.stringify(buildServiceAccountMenuConfig(process.env.PUBLIC_BASE_URL || "https://mea.xgar.com.cn")));
')"

curl -fsSL -X POST "https://api.weixin.qq.com/cgi-bin/menu/create?access_token=${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${MENU_JSON}"
echo ""
