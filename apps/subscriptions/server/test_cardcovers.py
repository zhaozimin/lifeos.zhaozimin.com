# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 cardcovers 的纯解析、地址校验与内容寻址写入，依赖临时目录
[OUTPUT]: 对外提供 OG 卡面提取、内网拒绝、JPG/PNG/WebP 白名单和缓存编号的回归
[POS]: server 的卡面安全单元测试。不访问真实外网
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cardcovers import (
    cache_cover,
    cover_path,
    extract_cover_url,
    image_extension,
    resolve_card_cover,
    validate_public_https_url,
)
from schema import StoreError


class CardCoverTests(unittest.TestCase):
    def test_extracts_relative_og_image(self) -> None:
        html = '<meta property="og:image" content="/assets/card.webp">'
        self.assertEqual(
            extract_cover_url(html, "https://bank.example/cards/gold"),
            "https://bank.example/assets/card.webp",
        )

    def test_rejects_private_and_non_https_urls(self) -> None:
        with self.assertRaises(StoreError):
            validate_public_https_url("http://example.com/card")
        with self.assertRaises(StoreError):
            validate_public_https_url("https://127.0.0.1/card")
        with self.assertRaises(StoreError):
            validate_public_https_url("https://user:secret@example.com/card")

    @patch("cardcovers.socket.getaddrinfo")
    def test_accepts_public_https_url(self, lookup) -> None:
        lookup.return_value = [(2, 1, 6, "", ("93.184.216.34", 443))]
        self.assertEqual(
            validate_public_https_url("https://bank.example/card"),
            "https://bank.example/card",
        )

    def test_image_magic_and_content_addressed_cache(self) -> None:
        png = b"\x89PNG\r\n\x1a\n" + b"cover"
        self.assertEqual(image_extension(png), "png")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            key = cache_cover(png, root)
            self.assertRegex(key, r"^[a-f0-9]{24}\.png$")
            self.assertEqual(cover_path(key, root).read_bytes(), png)

    def test_rejects_svg_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(StoreError):
                cache_cover(b"<svg></svg>", Path(tmp))

    @patch("cardcovers.validate_public_https_url")
    @patch("cardcovers._read_url")
    def test_resolves_html_then_caches_declared_image(self, read_url, validate) -> None:
        validate.side_effect = lambda value: value
        html = b'<meta property="og:image" content="https://cdn.example/card.png">'
        png = b"\x89PNG\r\n\x1a\n" + b"card"
        read_url.side_effect = [
            (html, "text/html", "https://bank.example/cards/gold"),
            (png, "image/png", "https://cdn.example/card.png"),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            result = resolve_card_cover(
                "https://bank.example/cards/gold",
                Path(tmp),
            )
            self.assertRegex(result["cover_key"], r"^[a-f0-9]{24}\.png$")
            self.assertEqual(result["cover_source_url"], "https://bank.example/cards/gold")
            self.assertTrue((Path(tmp) / result["cover_key"]).exists())


if __name__ == "__main__":
    unittest.main()
