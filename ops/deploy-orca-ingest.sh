#!/usr/bin/env bash
# [INPUT]: 仓库 apps/orca-sync/src/{vps-ingest,transport}.mjs 与 VPS /opt/lifeos-orca 目标目录。
# [OUTPUT]: 在 VPS 安装无端口 Orca SSH 接收器，复用既有 /etc/lifeos/ Supabase 凭据。
# [POS]: ops 的 VPS 部署入口；不开放任何公网端口，不修改 relay/whoop/subscriptions 现有服务。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -euo pipefail

DEST="${1:-/opt/lifeos-orca}"
SRC_DIR="$(cd "$(dirname "$0")/../apps/orca-sync/src" && pwd)"

install -d -m 0755 "$DEST"
install -m 0755 "$SRC_DIR/vps-ingest.mjs" "$DEST/ingest.mjs"
install -m 0644 "$SRC_DIR/transport.mjs" "$DEST/transport.mjs"

echo "已安装 Orca 接收器至 $DEST"
echo "确认 Node >= 22 且 /etc/lifeos/{orca,whoop,relay}.env 存在 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、OWNER_AUTH_ID（或 LIFEOS_OWNER_ID）。"
