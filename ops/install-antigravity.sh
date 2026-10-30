#!/usr/bin/env bash
# [INPUT]: Linux 正式系统、root 权限及官方 HTTPS 下载源。
# [OUTPUT]: lifeos 专用用户、私有登录目录、独立运行目录与 agy。
# [POS]: ops 的安装入口；不启动业务，不改 SSH、防火墙或现有服务。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

set -euo pipefail
umask 077

# ============================================================
# 已审阅的官方安装脚本；上游变化时先审阅再更新摘要。
# ============================================================
installer_url='https://antigravity.google/cli/install.sh'
installer_sha256='62966c07365423bd4dc209355060744058fb30d60f5323e2d360e39de64e5042'
lifeos_user='lifeos'
lifeos_home='/home/lifeos'
lifeos_state='/var/lib/lifeos'
binary_path="$lifeos_home/.local/bin/agy"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

[[ "$EUID" -eq 0 ]] || fail '请以 root 身份运行安装脚本。'
[[ "$(uname -s)" == 'Linux' ]] || fail '本脚本只用于 Linux VPS。'
if [[ -d /run/live ]] || grep -Eq '(^|[[:space:]])boot=live([[:space:]]|$)' /proc/cmdline; then
  fail '当前处于 Live 系统，请先从正式硬盘启动。'
fi
[[ "$(findmnt -n -o FSTYPE /)" != 'overlay' ]] || fail '根目录使用 overlay，请先核对启动环境。'
for dependency in curl sha256sum runuser timeout useradd install getent; do
  command -v "$dependency" >/dev/null || fail "缺少依赖：$dependency"
done

# ============================================================
# 只创建项目专用账号；已有账号必须符合相同的归属约定。
# ============================================================
if ! id "$lifeos_user" >/dev/null 2>&1; then
  [[ ! -e "$lifeos_home" ]] || fail '目标主目录已存在，请先核对目录归属。'
  useradd --create-home --user-group --shell /bin/bash "$lifeos_user"
fi
account_home="$(getent passwd "$lifeos_user" | cut -d: -f6)"
[[ "$account_home" == "$lifeos_home" ]] || fail '已有 lifeos 账号的主目录不符合约定。'
[[ "$(id -u "$lifeos_user")" -ge 1000 ]] || fail 'lifeos 必须是普通专用用户。'
[[ ! -L "$lifeos_home" ]] || fail '专用用户主目录不能是符号链接。'
[[ "$(stat -c %U "$lifeos_home")" == "$lifeos_user" ]] || fail '主目录所有者不符合约定。'
lifeos_group="$(id -gn "$lifeos_user")"
install -d -o "$lifeos_user" -g "$lifeos_group" -m 0750 "$lifeos_home"
install -d -o "$lifeos_user" -g "$lifeos_group" -m 0755 "$lifeos_home/.local" "$lifeos_home/.local/bin"
install -d -o "$lifeos_user" -g "$lifeos_group" -m 0700 "$lifeos_home/.cache" "$lifeos_home/.cache/lifeos-install"
install -d -o "$lifeos_user" -g "$lifeos_group" -m 0700 "$lifeos_home/.gemini" "$lifeos_home/.gemini/antigravity-cli"
[[ ! -L "$lifeos_state" ]] || fail '运行目录不能是符号链接。'
if [[ -e "$lifeos_state" ]]; then
  [[ "$(stat -c %U "$lifeos_state")" == "$lifeos_user" ]] || fail '运行目录已存在且归属不同，请先核对。'
fi
install -d -o "$lifeos_user" -g "$lifeos_group" -m 0700 "$lifeos_state" "$lifeos_state/parser-workspace"

# ============================================================
# 校验引导脚本；发布包的 SHA512 由官方脚本继续校验。
# ============================================================
if [[ ! -x "$binary_path" ]]; then
  installer_tmp="$(mktemp /tmp/lifeos-antigravity.XXXXXXXX)"
  trap 'rm -f "$installer_tmp"' EXIT
  curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 60 \
    --retry 2 "$installer_url" -o "$installer_tmp"
  printf '%s  %s\n' "$installer_sha256" "$installer_tmp" | sha256sum --check --status \
    || fail '官方安装脚本已变化；请审阅新版本后更新摘要。'
  bash -n "$installer_tmp"
  reviewed_installer="$lifeos_home/.cache/lifeos-install/install-antigravity-official.sh"
  install -o "$lifeos_user" -g "$lifeos_group" -m 0600 "$installer_tmp" "$reviewed_installer"
  timeout --kill-after=10s 300s runuser -u "$lifeos_user" -- bash "$reviewed_installer"
fi

[[ -x "$binary_path" ]] || fail '安装后未找到 agy 可执行文件。'
[[ "$(stat -c %U "$binary_path")" == "$lifeos_user" ]] || fail 'agy 所有者不符合约定。'
runuser -u "$lifeos_user" -- "$binary_path" --version
printf '安装路径：%s\n' "$binary_path"
printf '%s\n' '下一步：以 lifeos 身份启动 agy，完成本人 Google 授权。'
