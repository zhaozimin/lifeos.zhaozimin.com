# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖标准库 SQLite 快照、文件系统与本机 ps；由运维脚本传入路径，不导入服务实例
[OUTPUT]: 提供一致备份组、保留来源的运行目录迁移、进程归属核验与停止
[POS]: server 的运维数据边界；快照成功并验证后才发布，目标已有不同账本时拒绝覆盖
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import time
from datetime import datetime
from contextlib import closing
from pathlib import Path
from uuid import uuid4

COVER_KEY = re.compile(r"[a-f0-9]{24}\.(?:jpg|png|webp)")


def snapshot_runtime(source: Path, destination: Path) -> None:
    """destination 是尚未发布的目录。数据库与它引用的不可变图片构成恢复单元。"""
    destination.mkdir(parents=True, exist_ok=True)
    database = source / "subos.sqlite3"
    if not database.is_file():
        raise ValueError("找不到账本 sqlite")
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as src:
        with closing(sqlite3.connect(str(destination / database.name))) as dst:
            src.backup(dst)
            if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("快照完整性校验失败")
            if dst.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise ValueError("快照包含断开的外键")
            columns = {row[1] for row in dst.execute("PRAGMA table_info(payment_methods)")}
            keys = dst.execute("SELECT DISTINCT cover_key FROM payment_methods WHERE cover_key != ''").fetchall() if "cover_key" in columns else []
    for (key,) in keys:
        if not isinstance(key, str) or not COVER_KEY.fullmatch(key):
            raise ValueError("账本包含非法卡面编号")
        cover = source / "card-covers" / key
        if cover.is_symlink() or not cover.is_file():
            raise ValueError(f"快照引用的卡面缺失：{key}")
        (destination / "card-covers").mkdir(exist_ok=True)
        shutil.copy2(cover, destination / "card-covers" / key)


def backup_runtime(source: Path, backups: Path, keep: int = 12) -> Path:
    backups.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".subos-backup-", dir=backups))
    target = backups / f"subos-{datetime.now():%Y%m%d-%H%M%S-%f}-{uuid4().hex[:8]}"
    try:
        snapshot_runtime(source, staging)
        (staging / "backup.json").write_text(json.dumps({"format": 1, "created_at": datetime.now().isoformat()}))
        staging.rename(target)
    except Exception:
        shutil.rmtree(staging)
        raise
    groups = sorted((p for p in backups.glob("subos-*") if p.is_dir() and not p.is_symlink() and (p / "backup.json").is_file()), reverse=True)
    for old in groups[keep:]:
        shutil.rmtree(old)
    return target


def migrate_runtime(source: Path, target: Path) -> Path | None:
    """调用方先停止写入。迁移完成保留原目录；异常不会删除任一账本。"""
    if source.resolve() == target.resolve():
        return None
    if source.is_symlink():
        raise ValueError("runtime 指向其他位置；请先核对账本来源，未改动软链")
    if target.is_symlink():
        raise ValueError("目标 runtime 是软链，拒绝覆盖")
    source_db = source / "subos.sqlite3"
    if source_db.exists() and target.exists() and any(target.iterdir()):
        raise ValueError("目标运行目录已有数据，拒绝合并或覆盖；两份账本均已保留")
    target.parent.mkdir(parents=True, exist_ok=True)
    if source_db.exists():
        staging = Path(tempfile.mkdtemp(prefix=".subos-migrate-", dir=target.parent))
        try:
            snapshot_runtime(source, staging)
            if target.exists():
                target.rmdir()
            staging.rename(target)
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise
    else:
        target.mkdir(exist_ok=True)
    retained = None
    if source.exists():
        retained = source.with_name(f"runtime-before-migration-{uuid4().hex[:12]}")
        source.rename(retained)
    try:
        source.symlink_to(target.resolve(), target_is_directory=True)
    except Exception:
        if retained:
            retained.rename(source)
        raise
    return retained


def process_identity(pid: int) -> tuple[str, str]:
    result = subprocess.run(["ps", "-ww", "-p", str(pid), "-o", "lstart=", "-o", "command="], capture_output=True, text=True)
    line = result.stdout.strip()
    if result.returncode or len(line) < 25:
        return "", ""
    return line[:24], line[24:].strip()


def owned_process(pid: int, entries: list[Path], started: str = "") -> bool:
    stamp, command = process_identity(pid)
    if not stamp or (started and stamp != started):
        return False
    # Python 入口必须是命令最后的独立参数；端口占用本身不证明归属。
    return any(command.endswith(" " + str(entry.absolute())) for entry in entries) and "python" in command.split(" ", 1)[0].lower()


def stop_owned(pid: int, entries: list[Path], started: str = "") -> bool:
    if not owned_process(pid, entries, started):
        return False
    stamp, _ = process_identity(pid)
    os.kill(pid, signal.SIGTERM)
    for _ in range(50):
        if not owned_process(pid, entries, stamp):
            return True
        time.sleep(0.1)
    raise ValueError(f"SubOS 进程 {pid} 尚未退出，未发送强制终止信号")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="action", required=True)
    for name in ("backup", "migrate"):
        command = commands.add_parser(name)
        command.add_argument("source", type=Path)
        command.add_argument("destination", type=Path)
    stop = commands.add_parser("stop")
    stop.add_argument("pid", type=int)
    stop.add_argument("entries", type=Path, nargs="+")
    args = parser.parse_args()
    try:
        if args.action == "backup":
            print(f"已备份  {backup_runtime(args.source, args.destination)}")
        elif args.action == "migrate":
            retained = migrate_runtime(args.source, args.destination)
            if retained:
                print(f"迁移前来源保留在  {retained}")
        elif not stop_owned(args.pid, args.entries):
            raise ValueError(f"进程 {args.pid} 不属于预期 SubOS，未终止")
    except (ValueError, OSError, sqlite3.Error) as exc:
        parser.exit(1, str(exc) + "\n")


if __name__ == "__main__":
    main()
