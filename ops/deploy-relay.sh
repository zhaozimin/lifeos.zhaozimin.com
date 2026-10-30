#!/usr/bin/env bash
# [INPUT]: /opt/lifeos 源码、已安装 Node.js 与 root 私有配置。
# [OUTPUT]: 同步管家AGENTS.md，通过规则检查后启用relay。
# [POS]: VPS 部署入口；不迁移数据库，不触及现有服务和端口。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo '请以 root 执行部署。' >&2
  exit 1
fi
test -s /etc/lifeos/relay.env
test -s /var/lib/lifeos/wechat/credentials.json
install -d -m 0700 -o lifeos -g lifeos /var/lib/lifeos/parser-workspace /home/lifeos/.cache
chown -R lifeos:lifeos /opt/lifeos/apps
runuser -l lifeos -c 'cd /opt/lifeos/apps/relay && npm ci --ignore-scripts && npm run build && npm prune --omit=dev --ignore-scripts'
install -m 0600 -o lifeos -g lifeos /opt/lifeos/apps/relay/prompts/parse.md /var/lib/lifeos/parser-workspace/AGENTS.md
install -m 0644 /opt/lifeos/ops/lifeos-relay.service /etc/systemd/system/lifeos-relay.service
systemd-analyze verify /etc/systemd/system/lifeos-relay.service
systemctl daemon-reload
# ExecStartPre 执行 doctor；检查失败时不启动接收器。
systemctl enable lifeos-relay.service
systemctl restart lifeos-relay.service
systemctl is-active lifeos-relay.service
