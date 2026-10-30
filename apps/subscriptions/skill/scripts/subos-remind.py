# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖同目录或 Skill 目录里的 subosctl
[OUTPUT]: 今天有 7/3/1 天到期则打印文案，否则静音；没有外部投递回调，不写成功回执
[POS]: Hermes cron --no-agent 的投递脚本
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOME = Path.home()
CANDIDATES = (
    HOME / ".hermes/skills/subos/scripts",
    HOME / ".grok/skills/subos/scripts",
    HERE,
)
for folder in CANDIDATES:
    if (folder / "subosctl.py").is_file():
        sys.path.insert(0, str(folder))
        break
else:
    sys.exit("找不到 subosctl.py，先跑 ./skill/install.sh")

from subosctl import cmd_remind  # noqa: E402


class _Args:
    pass


if __name__ == "__main__":
    sys.exit(cmd_remind(_Args()))
