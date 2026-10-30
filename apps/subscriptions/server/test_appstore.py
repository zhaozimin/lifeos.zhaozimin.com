# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 catalog 与 appstore 纯函数
[OUTPUT]: 对外提供商店方图地址升级、域名到 trackId 的回归
[POS]: server 的图标契约测试，不打苹果接口
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import unittest

from appstore import guess_track_id, upgrade_artwork
from catalog import logo_src


class AppStoreTests(unittest.TestCase):
    def test_upgrade_keeps_square_master(self) -> None:
        raw = (
            "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/af/5b/dc/"
            "af5bdcf7-7eb9-b981-88b3-1014de5b987a/AppIcon.png/100x100bb.jpg"
        )
        self.assertTrue(upgrade_artwork(raw).endswith("/512x512bb.jpg"))
        self.assertTrue(upgrade_artwork(raw, 1024).endswith("/1024x1024bb.jpg"))

    def test_known_hosts_use_local_icon_path(self) -> None:
        self.assertEqual(logo_src("https://chatgpt.com"), "/icons/6448311069.jpg")
        self.assertEqual(logo_src("https://www.10086.cn"), "/icons/583700738.jpg")
        self.assertEqual(logo_src("https://www.189.cn"), "/icons/513836029.jpg")

    def test_custom_url_wins(self) -> None:
        self.assertEqual(logo_src("https://chatgpt.com", "https://example.com/a.png"), "https://example.com/a.png")

    def test_placeholder_mill_loses_to_store_art(self) -> None:
        weak = (
            "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/"
            "v4/4f/e5/16/4fe516ac/Placeholder.mill/200x200bb-75.webp"
        )
        self.assertEqual(logo_src("https://music.apple.com/", weak), "/icons/1108187390.jpg")

    def test_parent_host_maps_aliyun(self) -> None:
        self.assertEqual(logo_src("https://account.aliyun.com/"), "/icons/981011420.jpg")

    def test_no_store_app_keeps_brand_mark(self) -> None:
        src = logo_src("https://www.midjourney.com")
        self.assertIn("midjourney.png", src)
        self.assertFalse(src.startswith("/icons/"))

    def test_guess_track_id_rejects_paths(self) -> None:
        self.assertEqual(guess_track_id("6448311069"), 6448311069)
        self.assertIsNone(guess_track_id("../secret"))
        self.assertIsNone(guess_track_id("abc.jpg"))


if __name__ == "__main__":
    unittest.main()
