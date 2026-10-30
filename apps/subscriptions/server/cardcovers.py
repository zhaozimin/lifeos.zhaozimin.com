# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖标准库 HTTPS、DNS 与 HTMLParser，依赖 schema.StoreError 统一报错
[OUTPUT]: 对外提供官方卡片页/图片地址解析、绑定公网 IP 的 TLS 下载、图片类型检查与本机内容寻址缓存
[POS]: server 的银行卡封面入口。只抓用户明确给出的 HTTPS 公网地址，拒绝内网/回环/重定向穿透与 SVG
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import hashlib
import ipaddress
import re
import socket
import ssl
import http.client
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

from schema import StoreError

MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_IMAGE_BYTES = 5 * 1024 * 1024
COVER_KEY = re.compile(r"^[a-f0-9]{24}\.(?:jpg|png|webp)$")
DEFAULT_COVER_DIR = Path(__file__).resolve().parent / "runtime" / "card-covers"


class _CoverMetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.candidates: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {str(key).lower(): str(value or "") for key, value in attrs}
        if tag.lower() == "meta":
            marker = (values.get("property") or values.get("name") or "").lower()
            if marker in {
                "og:image",
                "og:image:secure_url",
                "twitter:image",
                "twitter:image:src",
            }:
                content = values.get("content", "").strip()
                if content:
                    self.candidates.append(content)
        if tag.lower() == "link":
            rel = values.get("rel", "").lower().split()
            href = values.get("href", "").strip()
            if "image_src" in rel and href:
                self.candidates.append(href)


def extract_cover_url(html: str, page_url: str) -> str:
    parser = _CoverMetaParser()
    parser.feed(html)
    if not parser.candidates:
        raise StoreError("这个页面没有声明可用的卡面图片")
    return urljoin(page_url, parser.candidates[0])


def _public_target(raw_url: str) -> tuple[str, list]:
    value = str(raw_url or "").strip()
    if any(ord(char) < 33 or ord(char) == 127 for char in value):
        raise StoreError("卡面地址包含非法字符")
    parsed = urlparse(value)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise StoreError("只能读取 HTTPS 公网页面或图片")
    if parsed.username or parsed.password:
        raise StoreError("卡面地址不能带账号或密码")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except (socket.gaierror, ValueError) as exc:
        raise StoreError("找不到这个卡面地址") from exc
    if not addresses:
        raise StoreError("找不到这个卡面地址")
    for item in addresses:
        try:
            address = ipaddress.ip_address(item[4][0])
        except ValueError as exc:
            raise StoreError("卡面地址解析失败") from exc
        if not address.is_global or address.is_multicast or address.is_reserved:
            raise StoreError("卡面地址不能指向本机或内网")
    return value, addresses


def validate_public_https_url(raw_url: str) -> str:
    return _public_target(raw_url)[0]


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """直接连接已验证的 sockaddr；TLS 的 SNI、证书和 Host 仍使用原域名，不读取代理环境。"""
    def __init__(self, host: str, port: int, addresses: list):
        super().__init__(host, port, timeout=10, context=ssl.create_default_context())
        self.addresses = addresses

    def connect(self) -> None:
        last_error = None
        for family, socktype, proto, _, sockaddr in self.addresses:
            raw = socket.socket(family, socktype, proto)
            try:
                raw.settimeout(self.timeout)
                raw.connect(sockaddr)
                self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
                return
            except OSError as exc:
                raw.close()
                last_error = exc
        raise last_error or OSError("没有可用的公网连接")


def _read_url(raw_url: str) -> tuple[bytes, str, str]:
    current = raw_url
    for _ in range(6):
        safe_url, addresses = _public_target(current)
        parsed = urlparse(safe_url)
        connection = _PinnedHTTPSConnection(parsed.hostname, parsed.port or 443, addresses)
        try:
            target = parsed.path or "/"
            if parsed.params:
                target += ";" + parsed.params
            if parsed.query:
                target += "?" + parsed.query
            connection.request("GET", target, headers={
                "User-Agent": "SubOS/0.3 card-cover-fetcher",
                "Accept": "image/webp,image/png,image/jpeg,text/html;q=0.8",
                "Accept-Encoding": "identity",
            })
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                if not location:
                    raise StoreError("卡面跳转缺少地址")
                current = urljoin(safe_url, location)
                continue
            if response.status != 200:
                raise StoreError("卡面地址读取失败")
            content_type = response.headers.get_content_type().lower()
            limit = MAX_HTML_BYTES if "html" in content_type else MAX_IMAGE_BYTES
            length = response.getheader("Content-Length")
            if length and int(length) > limit:
                raise StoreError("卡面内容超过大小限制")
            data = response.read(limit + 1)
            if len(data) > limit:
                raise StoreError("卡面内容超过大小限制")
            return data, content_type, safe_url
        except (http.client.HTTPException, OSError, ValueError) as exc:
            raise StoreError("卡面地址读取失败") from exc
        finally:
            connection.close()
    raise StoreError("卡面跳转次数过多")


def image_extension(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def cache_cover(data: bytes, cover_dir: Path = DEFAULT_COVER_DIR) -> str:
    extension = image_extension(data)
    if extension is None:
        raise StoreError("卡面只支持 JPG、PNG 或 WebP，不接受 SVG")
    cover_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{hashlib.sha256(data).hexdigest()[:24]}.{extension}"
    target = cover_dir / filename
    if not target.exists():
        target.write_bytes(data)
    return filename


def cover_path(filename: str, cover_dir: Path = DEFAULT_COVER_DIR) -> Path:
    if not COVER_KEY.fullmatch(str(filename or "")):
        raise StoreError("卡面编号不合法", 400)
    return cover_dir / filename


def cover_content_type(filename: str) -> str:
    extension = filename.rsplit(".", 1)[-1]
    return {
        "jpg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
    }.get(extension, "application/octet-stream")


def resolve_card_cover(raw_url: str, cover_dir: Path = DEFAULT_COVER_DIR) -> dict[str, str]:
    source_url = validate_public_https_url(raw_url)
    data, content_type, final_url = _read_url(source_url)
    if image_extension(data) is None:
        if len(data) > MAX_HTML_BYTES or "html" not in content_type:
            raise StoreError("这个地址既不是卡面图片，也不是可解析的网页")
        html = data.decode("utf-8", errors="replace")
        image_url = extract_cover_url(html, final_url)
        data, _, _ = _read_url(image_url)
    filename = cache_cover(data, cover_dir)
    return {
        "cover_key": filename,
        "cover_src": f"/card-covers/{filename}",
        "cover_source_url": source_url,
    }
