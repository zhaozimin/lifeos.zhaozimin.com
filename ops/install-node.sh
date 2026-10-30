#!/usr/bin/env bash
# [INPUT]: Linux x86_64 正式系统、已有 lifeos 用户及 Node.js 官方发布包。
# [OUTPUT]: lifeos 私有 Node.js 22.23.4、npm 与 npx 命令。
# [POS]: ops 的 Node.js 安装入口；保留系统 PATH、SSH 与现有服务。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

set -euo pipefail
umask 077

version='22.23.4'
archive_name="node-v${version}-linux-x64.tar.xz"
archive_sha256='1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce'
lifeos_home='/home/lifeos'
runtime_dir="$lifeos_home/.local/share/node-v${version}-linux-x64"

fail() { printf '%s\n' "$1" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || fail '请以 root 执行。'
[[ "$(uname -s)" == 'Linux' && "$(uname -m)" == 'x86_64' ]] || fail '本脚本只适用于 Linux x86_64。'
[[ ! -d /run/live ]] || fail '请先从正式硬盘启动。'
[[ "$(getent passwd lifeos | cut -d: -f6)" == "$lifeos_home" ]] || fail 'lifeos 用户主目录不符合约定。'
lifeos_group="$(id -gn lifeos)"
install -d -o lifeos -g "$lifeos_group" -m 0755 "$lifeos_home/.local" "$lifeos_home/.local/bin" "$lifeos_home/.local/share"

# ============================================================
# 固定官方版本与摘要；已安装时直接验证，不替换其他命令。
# ============================================================
if [[ ! -x "$runtime_dir/bin/node" ]]; then
  [[ ! -e "$runtime_dir" ]] || fail '目标运行时目录已存在但不完整，请先核对。'
  archive_tmp="$(mktemp /tmp/lifeos-node.XXXXXXXX)"
  trap 'rm -f "$archive_tmp"' EXIT
  curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 180 \
    --retry 2 "https://nodejs.org/dist/v${version}/${archive_name}" -o "$archive_tmp"
  printf '%s  %s\n' "$archive_sha256" "$archive_tmp" | sha256sum --check --status \
    || fail 'Node.js 发布包校验失败。'
  tar -xJf "$archive_tmp" -C "$lifeos_home/.local/share" --no-same-owner
  chown -R "lifeos:$lifeos_group" "$runtime_dir"
fi

for command_name in node npm npx; do
  link_path="$lifeos_home/.local/bin/$command_name"
  target_path="$runtime_dir/bin/$command_name"
  if [[ -e "$link_path" || -L "$link_path" ]]; then
    [[ -L "$link_path" && "$(readlink "$link_path")" == "$target_path" ]] \
      || fail "已有 $command_name 不属于此次运行时，请先核对。"
  else
    ln -s "$target_path" "$link_path"
    chown -h "lifeos:$lifeos_group" "$link_path"
  fi
done

[[ "$("$runtime_dir/bin/node" --version)" == "v$version" ]] || fail 'Node.js 版本检查失败。'
runuser -l lifeos -c '/home/lifeos/.local/bin/node --version'
runuser -l lifeos -c '/home/lifeos/.local/bin/npm --version'
