# -*- coding: utf-8 -*-
"""
[INPUT]: 公开订阅编号及服务网站，禁止使用私人自定义图片。
[OUTPUT]: App Store或固定favicon供应方的品牌图，失败返回安全字标。
[POS]: 访客Logo边界；不公开原网址、账号、查询参数或卡面。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import html
import ipaddress
import re
import sqlite3
import urllib.request
import urllib.parse
from catalog import HOST_APPSTORE, _canonical_host, host_of
from appstore import ensure_icon
from visitor import public_id, public_label
from schema import StoreError

class BrandRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlparse(newurl)
        if parsed.scheme != "https" or not (parsed.hostname == "www.google.com" or (parsed.hostname or "").endswith(".gstatic.com")):
            raise ValueError("unexpected brand redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def brand_host(website):
    host = _canonical_host(host_of(website))
    if not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", host):
        return ""
    if host.endswith((".local", ".internal", ".localhost", ".lan")):
        return ""
    try:
        ipaddress.ip_address(host)
        return ""
    except ValueError:
        pass
    if host in HOST_APPSTORE:
        return host
    parts = host.split(".")
    size = 3 if ".".join(parts[-2:]) in {"com.cn", "co.uk", "co.jp", "co.za", "com.au"} else 2
    return ".".join(parts[-size:])

def visitor_icon(db_path, id):
    if not re.fullmatch(r"[a-f0-9]{24}", id):
        raise StoreError("公开图标不存在",404)
    with sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True) as db:
        row = next((r for r in db.execute("SELECT id,name,website FROM subscriptions LIMIT 500") if public_id(r[0]) == id), None)
    if row is None:
        raise StoreError("公开图标不存在",404)
    cache = db_path.resolve().parent / "visitor-icons"
    cache.mkdir(mode=0o700, exist_ok=True)
    cached = cache / (id + ".image")
    def kind(data):
        if data.startswith(b"\x89PNG\r\n\x1a\n"): return "image/png"
        if data.startswith(b"\xff\xd8\xff"): return "image/jpeg"
        if data.startswith((b"GIF87a", b"GIF89a")): return "image/gif"
        if data.startswith(b"\0\0\1\0"): return "image/x-icon"
        return None
    if cached.exists():
        data = cached.read_bytes()
        if kind(data): return data,kind(data)
    host = brand_host(row[2])
    try:
        if host in HOST_APPSTORE:
            data = ensure_icon(HOST_APPSTORE[host]).read_bytes()
        elif host:
            url = "https://www.google.com/s2/favicons?" + urllib.parse.urlencode({"domain": host, "sz": 128})
            with urllib.request.build_opener(BrandRedirect()).open(url,timeout=10) as response:
                data = response.read(512 * 1024 + 1)
        else:
            data = b""
        if len(data) <= 512 * 1024 and kind(data):
            cached.write_bytes(data)
            return data,kind(data)
    except Exception:
        pass
    letter = html.escape(public_label(row[1])[:1] or "?")
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="26" fill="#eee9df"/><text x="64" y="84" text-anchor="middle" font-size="72" fill="#4d4840">{letter}</text></svg>'.encode(),"image/svg+xml"
