# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 cardidentify 的纯识别函数与可注入 BIN 查询器
[OUTPUT]: 对外提供 8 位安全边界、卡组织号段、联网候选和离线降级回归
[POS]: server 的银行卡瞬时识别测试，不访问真实网络、不写 SQLite
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import unittest
from urllib.error import URLError

from cardidentify import detect_network, identify_card_iin, normalize_iin
from store import StoreError


class CardIdentifyTests(unittest.TestCase):
    def test_only_accepts_exactly_eight_digits(self) -> None:
        self.assertEqual(normalize_iin("42424242"), "42424242")
        for unsafe in ("424242", "4242424242424242", "4242 4242", "abc"):
            with self.subTest(unsafe=unsafe), self.assertRaises(StoreError):
                normalize_iin(unsafe)

    def test_detects_common_network_ranges_locally(self) -> None:
        cases = {
            "42424242": "visa",
            "55555555": "mastercard",
            "37828224": "amex",
            "35301113": "jcb",
            "60111111": "discover",
            "62123456": "unionpay",
        }
        for iin, network in cases.items():
            with self.subTest(iin=iin):
                self.assertEqual(detect_network(iin), network)

    def test_shapes_provider_result_without_returning_iin(self) -> None:
        result = identify_card_iin(
            "42424242",
            lambda _iin: {
                "scheme": "visa",
                "type": "credit",
                "brand": "Visa Signature",
                "bank": {"name": "Example Bank", "url": "example.com"},
                "country": {"name": "United States", "alpha2": "US", "currency": "USD"},
            },
        )
        self.assertEqual(result["issuer"], "Example Bank")
        self.assertEqual(result["card_type"], "credit")
        self.assertEqual(result["product"], "Visa Signature")
        self.assertEqual(result["currency"], "USD")
        self.assertEqual(result["issuer_website"], "example.com")
        self.assertNotIn("iin", result)

    def test_network_failure_keeps_local_result(self) -> None:
        def fail(_iin: str) -> dict:
            raise URLError("offline")

        result = identify_card_iin("42424242", fail)
        self.assertEqual(result["source"], "local")
        self.assertEqual(result["network"], "visa")
        self.assertEqual(result["issuer"], "")


if __name__ == "__main__":
    unittest.main()
