# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 store 与临时 SQLite
[OUTPUT]: 对外提供银行卡安全边界、实体/虚拟形态、本机封面引用、订阅占用的回归
[POS]: server 的银行卡持久化测试，不启动 HTTP
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from store import Store, StoreError


class CardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "subos.sqlite3")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _card(self, **overrides: object) -> dict:
        payload = {
            "name": "经典白",
            "kind": "physical_card",
            "issuer": "招商银行",
            "card_type": "credit",
            "network": "visa",
            "last4": "3201",
            "currency": "CNY",
            "expiry_month": "2029-08",
            "billing_day": 12,
            "payment_due_day": 30,
            "status": "active",
            "note": "日常订阅",
        }
        payload.update(overrides)
        return self.store.create_card(payload)

    def test_physical_card_is_also_a_payment_method(self) -> None:
        card = self._card()
        self.assertEqual(card["kind"], "physical_card")
        self.assertEqual(card["last4"], "3201")
        self.assertNotIn("account", card)
        method = next(item for item in self.store.list_payment_methods() if item["id"] == card["id"])
        self.assertEqual(method["account"], "尾号 3201")
        self.assertEqual(method["kind"], "physical_card")

    def test_virtual_card_can_be_frozen(self) -> None:
        card = self._card(
            name="海外订阅虚拟卡",
            kind="virtual_card",
            issuer="Wise",
            last4="8842",
            status="frozen",
        )
        self.assertEqual(card["kind"], "virtual_card")
        self.assertEqual(card["status"], "frozen")
        self.assertEqual(len(self.store.list_cards()), 1)

    def test_card_keeps_local_cover_reference(self) -> None:
        card = self._card(
            cover_key="aaaaaaaaaaaaaaaaaaaaaaaa.webp",
            cover_source_url="https://bank.example/cards/classic",
        )
        self.assertEqual(card["cover_src"], "/card-covers/aaaaaaaaaaaaaaaaaaaaaaaa.webp")
        self.assertEqual(card["cover_source_url"], "https://bank.example/cards/classic")

    def test_rejects_full_number_and_security_fields(self) -> None:
        with self.assertRaises(StoreError):
            self._card(last4="6225880132019988")
        with self.assertRaises(StoreError):
            self._card(cvv="123")
        with self.assertRaises(StoreError):
            self._card(note="PIN 是 1234")
        with self.assertRaises(StoreError):
            self._card(cover_key="../../secret.png")

    def test_rejects_duplicate_live_card(self) -> None:
        self._card()
        with self.assertRaises(StoreError):
            self._card(name="同尾号副本")

    def test_credit_days_are_cleared_for_debit_card(self) -> None:
        card = self._card(card_type="debit", billing_day=10, payment_due_day=20)
        self.assertIsNone(card["billing_day"])
        self.assertIsNone(card["payment_due_day"])

    def test_subscription_usage_blocks_card_deletion(self) -> None:
        card = self._card()
        self.store.create_subscription(
            {
                "name": "Plus",
                "website": "chatgpt.com",
                "amount_yuan": "140",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
                "payment_method_id": card["id"],
            }
        )
        linked = self.store.get_card(card["id"])
        self.assertEqual(linked["subscription_count"], 1)
        with self.assertRaises(StoreError):
            self.store.delete_payment_method(card["id"])

    def test_generic_editor_cannot_flatten_a_card(self) -> None:
        card = self._card()
        with self.assertRaises(StoreError) as ctx:
            self.store.update_payment_method(card["id"], {"name": "错误入口"})
        self.assertEqual(ctx.exception.status, 409)


if __name__ == "__main__":
    unittest.main()
