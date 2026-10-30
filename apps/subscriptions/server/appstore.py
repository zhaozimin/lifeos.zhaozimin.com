# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 iTunes Lookup 公开接口，依赖本机 runtime/icons
[OUTPUT]: 按 trackId 把商店正方形原图落到本地，供 /icons/{id}.jpg 使用
[POS]: server 的图标仓库。catalog 只给 trackId；圆角和阴影在前端套，不烤进图
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import json
import re
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent
ICON_DIR = ROOT / "runtime" / "icons"
USER_AGENT = "SubOS/0.1 (local; itunes-lookup)"
ARTWORK_SIZE = 512
_LOCKS: dict[int, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def upgrade_artwork(url: str, size: int = ARTWORK_SIZE) -> str:
    """把 60/100/512 缩略图地址升到指定边长。苹果存的是方图，不是成品遮罩。"""
    return re.sub(r"/\d+x\d+[a-z]*\.(jpg|png|jpeg)$", f"/{size}x{size}bb.jpg", url, flags=re.I)


def _lock_for(track_id: int) -> threading.Lock:
    with _LOCKS_GUARD:
        lock = _LOCKS.get(track_id)
        if lock is None:
            lock = threading.Lock()
            _LOCKS[track_id] = lock
        return lock


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


def lookup_artwork(track_id: int, country: str = "") -> str:
    tried: list[str] = []
    for item in (country, "", "cn", "us"):
        if item in tried:
            continue
        tried.append(item)
        query = f"https://itunes.apple.com/lookup?id={int(track_id)}"
        if item:
            query += f"&country={item}"
        data = json.loads(_get(query).decode("utf-8"))
        results = data.get("results") or []
        if not results:
            continue
        raw = results[0].get("artworkUrl512") or results[0].get("artworkUrl100") or ""
        if raw:
            return upgrade_artwork(raw)
    raise FileNotFoundError(f"App Store 没有 {track_id}")


def icon_path(track_id: int) -> Path:
    return ICON_DIR / f"{int(track_id)}.jpg"


def ensure_icon(track_id: int, country: str = "") -> Path:
    """已有本地文件就直接用。缺失时 lookup 一次，再去 mzstatic 拉方图。"""
    dest = icon_path(track_id)
    if dest.exists() and dest.stat().st_size > 800:
        return dest
    with _lock_for(int(track_id)):
        if dest.exists() and dest.stat().st_size > 800:
            return dest
        ICON_DIR.mkdir(parents=True, exist_ok=True)
        url = lookup_artwork(int(track_id), country=country)
        payload = _get(url)
        tmp = dest.with_suffix(".part")
        tmp.write_bytes(payload)
        tmp.replace(dest)
        return dest


def warm_icons(track_ids: list[int]) -> None:
    for track_id in track_ids:
        try:
            ensure_icon(int(track_id))
        except (urllib.error.URLError, TimeoutError, FileNotFoundError, OSError, ValueError):
            continue


def guess_track_id(name: str) -> Optional[int]:
    """文件名只允许纯数字 trackId，防止静态路径逃逸。"""
    if re.fullmatch(r"\d+", name or ""):
        return int(name)
    return None
