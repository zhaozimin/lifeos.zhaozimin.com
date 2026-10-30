#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
[INPUT]: 跟踪、未跟踪、暂存及可选的可达历史，不读取忽略目录。
[OUTPUT]: 私有文件、生产样本、地址和凭据特征的路径级结果。
[POS]: Git分发守卫；保留品牌，不代替托管旧对象清除与人工复核。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import argparse
import ipaddress
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRETS = {
    "private-key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "supabase-secret": rb"\bsb_secret_[A-Za-z0-9_-]{16,}",
    "github-token": rb"\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})",
    "model-key": rb"\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{24,}",
    "personal-path": rb"/(?:Users|Volumes)/[^\s`<>\"']+",
    "production-project": rb"\b[a-z]{20}\.supabase\.co\b",
}
PRIVATE_EVIDENCE = re.compile(
    r"真实[^\n]{0,24}(?:支出|收入)[^\n]{0,24}\d"
    r"|(?:本机快照含|云端另有)\d+条"
    r"|(?:实测主数据库|VPS当前总内存)\s*\d"
    r"|(?:^|\n)\s*(?:-\s*)?(?:时间\d+条|流水\d+笔|账户\d+个"
    r"|原始档案\d+条|闭合时间[^\n]{0,12}\d+分钟"
    r"|\d+条身体记录|含\d+个周期|既有\d+条微信)"
)
DEPLOYMENT_EVIDENCE = re.compile(
    r"(?:daily/|subscriptions/)(?:lifeos|subos)-\d{8}T\d{6}Z\.tar\.age"
    r"|(?:Pages版本|生产版本)\s*<code>[0-9a-f]{7,40}</code>"
)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def private_file(name):
    path = Path(name)
    if path.parts[0] in {".private", "backups", "exports"}:
        return True
    if path.name.startswith((".env", ".dev.vars")) and not path.name.endswith(".example"):
        return True
    if name.endswith((".db", ".sqlite", ".sqlite3", ".sqlite-wal", ".sqlite-shm", ".sqlite3-wal", ".sqlite3-shm", ".db-wal", ".db-shm", ".dump", ".age", ".bundle", ".pem", ".key", ".p12", ".pfx", ".tar", ".tar.gz")):
        return True
    return name == "apps/subscriptions/edge/wrangler.toml"


def inspect(name, data):
    findings = []
    if private_file(name):
        findings.append("private-file")
    if b"\0" in data:
        return findings
    for rule, pattern in SECRETS.items():
        if re.search(pattern, data):
            findings.append(rule)
    # 自然语言规则只检查公开文档；合成夹具仍由凭据规则检查。
    if name.startswith("docs/") and Path(name).suffix in {".md", ".html"}:
        text = data.decode("utf-8", errors="replace")
        if PRIVATE_EVIDENCE.search(text):
            findings.append("private-production-evidence")
        if DEPLOYMENT_EVIDENCE.search(text):
            findings.append("private-deployment-evidence")
    # 测试可用公共DNS和隔离夹具；业务代码不应包含真实源站IP。
    if "test" not in name:
        for value in re.findall(rb"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])", data):
            try:
                if ipaddress.ip_address(value.decode()).is_global:
                    findings.append("public-origin-ip")
                    break
            except ValueError:
                pass
    return findings


def main():
    parser = argparse.ArgumentParser(description="检查候选文件、暂存版本与分发历史，不打印敏感正文")
    parser.add_argument("--history", action="store_true", help="同时检查全部可达提交的唯一文件对象")
    options = parser.parse_args()
    names = dict.fromkeys(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").decode().split("\0"))
    entries = [(name, (ROOT / name).read_bytes()) for name in names if name and (ROOT / name).is_file()]
    # 暂存版本可能与工作区不同；不能只检查磁盘上的修正版。
    for row in git("ls-files", "--stage", "-z").split(b"\0"):
        if not row:
            continue
        metadata, name = row.split(b"\t", 1)
        mode, oid, stage = metadata.split()
        if mode != b"160000":
            entries.append((name.decode(), git("cat-file", "blob", oid.decode())))
    if options.history:
        objects = {}
        for commit in git("rev-list", "--all").decode().splitlines():
            for row in git("ls-tree", "-rz", "--full-tree", commit).split(b"\0"):
                if not row:
                    continue
                metadata, name = row.split(b"\t", 1)
                mode, kind, oid = metadata.split()
                if kind == b"blob":
                    objects[(name.decode(), oid.decode())] = None
        entries.extend((name, git("cat-file", "blob", oid)) for name, oid in objects)
    failures = sorted({(name, rule) for name, data in entries for rule in inspect(name, data)})
    for name, rule in failures:
        print(f"{rule}: {name}", file=sys.stderr)
    print(f"已检查{len(entries)}个文件或历史对象；发现{len(failures)}项分发边界问题。")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
