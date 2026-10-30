#!/usr/bin/env bash
# [INPUT]: 已安装工具、只读 pgpass、公钥和限桶备份配置。
# [OUTPUT]: 首次备份成功后启用的每日定时器。
# [POS]: 备份上线入口；失败不启用定时器，不改 relay 或 x-ui。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -euo pipefail
[[ $EUID -eq 0 ]]
test -s /etc/lifeos-backup/backup.env
test -s /etc/lifeos-backup/pgpass
test -s /etc/lifeos-backup/recipients.txt
install -d -m 0755 /usr/local/lib/lifeos-backup
install -m 0644 /opt/lifeos/ops/backup.py /usr/local/lib/lifeos-backup/backup.py
install -m 0644 /opt/lifeos/ops/lifeos-backup.service /etc/systemd/system/lifeos-backup.service
install -m 0644 /opt/lifeos/ops/lifeos-backup.timer /etc/systemd/system/lifeos-backup.timer
systemd-analyze verify /etc/systemd/system/lifeos-backup.service /etc/systemd/system/lifeos-backup.timer
systemctl daemon-reload
systemctl start lifeos-backup.service
systemctl enable --now lifeos-backup.timer
systemctl list-timers lifeos-backup.timer --no-pager
