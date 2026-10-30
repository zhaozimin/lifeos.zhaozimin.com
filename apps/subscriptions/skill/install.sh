#!/usr/bin/env bash
# [INPUT]: 依赖本目录 Skill 与 scripts/，以及 Hermes / Grok 的本机目录
# [OUTPUT]: 创建 Skill 软链并复制 Hermes cron 所需的两个脚本
# [POS]: Skill 安装边界；只输出 cron 安装命令，不负责创建定时任务
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
GROK_HOME="${GROK_HOME:-$HOME/.grok}"
SKILL_DST="$HERMES_HOME/skills/subos"
GROK_DST="$GROK_HOME/skills/subos"
SCRIPT_DST="$HERMES_HOME/scripts"

link_dir() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    rm -rf "$dst"
  fi
  ln -sfn "$src" "$dst"
}

link_dir "$ROOT" "$SKILL_DST"
link_dir "$ROOT" "$GROK_DST"
# Hermes cron 拒绝指向 scripts 目录外的软链，投递脚本必须实拷。
mkdir -p "$SCRIPT_DST"
rm -f "$SCRIPT_DST/subosctl.py" "$SCRIPT_DST/subos-remind.py"
cp "$ROOT/scripts/subosctl.py" "$SCRIPT_DST/subosctl.py"
cp "$ROOT/scripts/subos-remind.py" "$SCRIPT_DST/subos-remind.py"

echo "已安装  $SKILL_DST"
echo "Grok     $GROK_DST"
echo "投递脚本  $SCRIPT_DST/subos-remind.py"
echo
echo "挂上每天 09:00 微信提醒（可改）："
echo "  hermes cron create \"0 9 * * *\" --name \"SubOS 三波提醒\" --script subos-remind.py --no-agent --deliver weixin"
