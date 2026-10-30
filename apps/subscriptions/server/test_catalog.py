# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 catalog 的推断
[OUTPUT]: 对外提供本机常见运营商 / VPS 词表回归
[POS]: server 的目录测试
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import unittest

from catalog import infer_category_id


class CatalogTests(unittest.TestCase):
    def test_live_names(self) -> None:
        self.assertEqual(infer_category_id("广电-流量卡", "cbg.cn"), "cat_phone")
        self.assertEqual(infer_category_id("Tello", "https://tello.com"), "cat_phone")
        self.assertEqual(infer_category_id("MTN", "https://mtn.com"), "cat_phone")
        self.assertEqual(infer_category_id("VPS-搬瓦工", "https://bandwagonhost.com"), "cat_network")
        self.assertEqual(infer_category_id("DMIT-Premium", "https://dmit.io"), "cat_network")
        self.assertEqual(infer_category_id("Whoop Peak", "https://whoop.com"), "cat_tools")
