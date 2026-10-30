#!/usr/bin/env bash
# [INPUT]: 已构建的 daily.js、生产配置与部署参数。
# [OUTPUT]: 校验后的日历服务；仅 --enable 才启用新定时器。
# [POS]: 主动推送的独立上线边界；不启动额外轮询器。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -euo pipefail
if [[ $EUID -ne 0 ]]; then exit 1; fi
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --enable ) ]]; then exit 2; fi
test -s /opt/lifeos/apps/relay/dist/src/daily.js
install -m 0644 /opt/lifeos/ops/lifeos-daily.service /etc/systemd/system/lifeos-daily.service
install -m 0644 /opt/lifeos/ops/lifeos-daily.timer /etc/systemd/system/lifeos-daily.timer
systemd-analyze verify /etc/systemd/system/lifeos-daily.service /etc/systemd/system/lifeos-daily.timer
systemctl daemon-reload
if [[ ${1:-} == --enable ]]; then
  systemctl enable --now lifeos-daily.timer
  systemctl is-active lifeos-daily.timer
else
  echo 'Daily timer installed; initial activation requires --enable.'
fi
