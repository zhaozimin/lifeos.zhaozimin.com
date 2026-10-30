# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 Store、冻结日期与虚构信用卡，全部数据写入临时 SQLite
[OUTPUT]: 验证双模式、周期、切换保留旧支付绑定、信用卡冻结与余额迁移
[POS]: 通用计费回归；原电话卡并发幂等回归由 test_phonebalance 覆盖
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from store import Store, StoreError


class BillingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.today = date(2026, 1, 15)
        for target in ("store.today_local", "billing.today_local"):
            mock = patch(target, return_value=self.today)
            mock.start()
            self.addCleanup(mock.stop)
        self.path = Path(self.tmp.name) / "test.sqlite3"
        self.store = Store(self.path)

    def subscription(self, **changes):
        return self.store.create_subscription({
            "name": "测试软件订阅", "website": "software.example.com", "category_id": "cat_ai",
            "amount_yuan": "30", "cycle": "monthly", "billing_mode": "balance",
            "next_renewal_on": "2026-01-31", **changes,
        })

    def credit_card(self, **changes):
        return self.store.create_card({
            "name": "测试信用卡", "issuer": "测试银行", "kind": "virtual_card",
            "card_type": "credit", "network": "visa", "last4": "1234",
            "currency": "CNY", "status": "active", **changes,
        })

    def balance(self, item, value):
        return self.store.set_balance(item["id"], {"balance_yuan": value}, self.today)

    def test_all_categories_can_use_balance_and_phone_can_use_auto_charge(self):
        custom = self.store.create_category({"name": "测试自建分类"})
        for category in [item["id"] for item in self.store.list_categories()]:
            with self.subTest(category=category):
                item = self.subscription(category_id=category)
                self.assertEqual(self.balance(item, "100")["balance_fen"], 10000)
                self.assertEqual(item["category_id"], category)
        self.assertIn(custom["id"], [item["id"] for item in self.store.list_categories()])
        card = self.credit_card()
        item = self.subscription(category_id="cat_phone", billing_mode="auto_charge", payment_method_id=card["id"])
        self.assertTrue(item["auto_charge_ready"])
        self.assertIsNone(item["balance_fen"])
        with self.assertRaises(StoreError):
            self.balance(item, "100")

    def test_all_cycles_deduct_once_and_restart_from_recharge_day(self):
        cases = [
            ("monthly", None, "2026-02-28", "2027-02-05"),
            ("quarterly", None, "2026-04-30", "2027-04-05"),
            ("yearly", None, "2027-01-31", "2028-01-05"),
            ("custom", 10, "2026-02-10", "2027-01-15"),
        ]
        for cycle, days, expected, restart in cases:
            with self.subTest(cycle=cycle):
                item = self.subscription(cycle=cycle, cycle_days=days)
                self.balance(item, "40")
                paid = self.store.get_subscription(item["id"], date(2026, 1, 31))
                self.assertEqual(paid["balance_fen"], 1000)
                self.assertEqual(paid["next_renewal_on"], expected)
                self.assertEqual(self.store.get_subscription(item["id"], date(2026, 1, 31))["balance_fen"], 1000)
                stopped = self.store.get_subscription(item["id"], date.fromisoformat(expected))
                self.assertTrue(stopped["balance_stopped"])
                resumed = self.store.top_up_balance(item["id"], {"amount_yuan": "50", "request_id": cycle}, date(2027, 1, 5))
                self.assertEqual(resumed["next_renewal_on"], restart)
                self.assertEqual(resumed["balance_fen"], 3000)

    def test_credit_card_auto_charge_preserves_balance_and_month_end_anchor(self):
        card = self.credit_card()
        item = self.subscription()
        self.balance(item, "100")
        switched = self.store.update_subscription(item["id"], {"billing_mode": "auto_charge", "payment_method_id": card["id"]})
        self.assertEqual(switched["balance_fen"], 10000)
        settled = self.store.get_subscription(item["id"], date(2026, 2, 28))
        self.assertEqual(settled["next_renewal_on"], "2026-03-31")
        self.assertEqual(settled["balance_fen"], 10000)
        self.assertFalse(settled["balance_low"])
        self.assertEqual(self.store.get_subscription(item["id"], date(2026, 2, 28))["next_renewal_on"], "2026-03-31")
        restored = self.store.update_subscription(item["id"], {"billing_mode": "balance"})
        self.assertEqual(restored["balance_fen"], 10000)
        self.assertEqual(restored["next_renewal_on"], "2026-03-31")

    def test_auto_charge_all_cycles_and_disabled_renewal(self):
        card = self.credit_card()
        for cycle, days, expected in [("monthly", None, "2026-02-28"), ("quarterly", None, "2026-04-30"), ("yearly", None, "2027-01-31"), ("custom", 10, "2026-02-10")]:
            with self.subTest(cycle=cycle):
                item = self.subscription(billing_mode="auto_charge", payment_method_id=card["id"], cycle=cycle, cycle_days=days)
                self.assertEqual(self.store.get_subscription(item["id"], date(2026, 1, 31))["next_renewal_on"], expected)
        item = self.subscription(billing_mode="auto_charge", payment_method_id=card["id"], auto_renew=False)
        self.assertEqual(self.store.get_subscription(item["id"], date(2026, 3, 1))["next_renewal_on"], "2026-01-31")

    def test_missing_or_frozen_credit_card_does_not_advance(self):
        pending = self.subscription(billing_mode="auto_charge")
        self.assertFalse(pending["auto_charge_ready"])
        self.assertEqual(self.store.get_subscription(pending["id"], date(2026, 3, 1))["next_renewal_on"], "2026-01-31")
        card = self.credit_card()
        item = self.subscription(billing_mode="auto_charge", payment_method_id=card["id"])
        self.store.update_card(card["id"], {"status": "frozen"})
        result = self.store.get_subscription(item["id"], date(2026, 3, 1))
        self.assertFalse(result["auto_charge_ready"])
        self.assertEqual(result["next_renewal_on"], "2026-01-31")
        debit = self.credit_card(card_type="debit", last4="5678")
        with self.assertRaises(StoreError):
            self.subscription(billing_mode="auto_charge", payment_method_id=debit["id"])

    def test_switch_preserves_manual_pause_and_topup_receipt(self):
        item = self.subscription()
        request = {"amount_yuan": "100", "request_id": "before-switch"}
        self.store.top_up_balance(item["id"], request, self.today)
        paused = self.store.pause_subscription(item["id"], today=self.today)
        card = self.credit_card()
        switched = self.store.update_subscription(item["id"], {"billing_mode": "auto_charge", "payment_method_id": card["id"]})
        self.assertEqual(switched["status"], "paused")
        self.assertEqual(switched["paused_days_left"], paused["paused_days_left"])
        self.store.update_subscription(item["id"], {"billing_mode": "balance"})
        retry = self.store.top_up_balance(item["id"], request, self.today)
        self.assertEqual(retry["balance_fen"], 10000)
        self.assertEqual(retry["status"], "paused")

    def test_switch_after_low_balance_stop_preserves_status_and_balance(self):
        item = self.subscription()
        self.balance(item, "10")
        self.store.get_subscription(item["id"], date(2026, 1, 31))
        switched = self.store.update_subscription(item["id"], {"billing_mode": "auto_charge", "payment_method_id": self.credit_card()["id"]})
        self.assertEqual(switched["status"], "paused")
        self.assertFalse(switched["balance_stopped"])
        self.assertEqual(switched["balance_fen"], 1000)
        resumed = self.store.resume_subscription(item["id"], date(2026, 2, 5))
        self.assertEqual(resumed["next_renewal_on"], "2026-03-05")
        self.assertEqual(resumed["balance_fen"], 1000)

    def test_old_editor_cannot_rewind_a_settled_cycle(self):
        item = self.subscription()
        self.balance(item, "100")
        self.store.get_subscription(item["id"], date(2026, 1, 31))
        with self.assertRaises(StoreError) as failure:
            self.store.update_subscription(item["id"], {"next_renewal_on": "2026-01-31", "expected_next_renewal_on": "2026-01-31"})
        self.assertEqual(failure.exception.status, 409)
        self.assertEqual(self.store.get_subscription(item["id"], date(2026, 1, 31))["balance_fen"], 7000)

    def test_invalid_mode_rolls_back_and_auto_charge_forecast_ignores_saved_balance(self):
        item = self.subscription()
        self.balance(item, "10")
        with self.assertRaises(StoreError):
            self.store.update_subscription(item["id"], {"billing_mode": "invalid"})
        self.assertEqual(self.store.get_subscription(item["id"], self.today)["billing_mode"], "balance")
        switched = self.store.update_subscription(item["id"], {"billing_mode": "auto_charge", "payment_method_id": self.credit_card()["id"]})
        self.assertGreater(switched["upcoming_fen"], 1000)
        self.assertEqual(switched["balance_fen"], 1000)

    def test_switch_keeps_legacy_payment_binding_without_blocking_mode_change(self):
        payment = self.store.create_payment_method({"name": "原支付方式", "account": "本机测试标识"})
        item = self.subscription(payment_method_id=payment["id"])
        self.balance(item, "50")
        switched = self.store.update_subscription(item["id"], {"billing_mode": "auto_charge"})
        self.assertEqual(switched["billing_mode"], "auto_charge")
        self.assertEqual(switched["payment_method_id"], payment["id"])
        self.assertEqual(switched["balance_fen"], 5000)
        self.assertFalse(switched["auto_charge_ready"])
        self.assertEqual(self.store.get_subscription(item["id"], date(2026, 2, 1))["next_renewal_on"], "2026-01-31")
        restored = self.store.update_subscription(item["id"], {"billing_mode": "balance"})
        self.assertEqual(restored["balance_fen"], 5000)
        self.assertEqual(restored["payment_method_id"], payment["id"])

    def test_schema_11_migration_keeps_phone_mode_amounts_and_receipts(self):
        # 重建真实上一版的表形状，原字段与充值编号必须原样存在。
        legacy = Path(self.tmp.name) / "legacy.sqlite3"
        with sqlite3.connect(legacy) as conn:
            conn.executescript("""
                CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO meta VALUES ('schema_version','11');
                CREATE TABLE subscriptions(
                    id TEXT PRIMARY KEY, name TEXT, website TEXT, amount_fen INTEGER,
                    currency TEXT, cycle TEXT, cycle_days INTEGER, next_renewal_on TEXT,
                    renewal_anchor_day INTEGER, auto_renew INTEGER, status TEXT,
                    paused_on TEXT, paused_days_left INTEGER, phone_balance_fen INTEGER,
                    phone_balance_stopped INTEGER, payment_method_id TEXT, account_id TEXT,
                    category_id TEXT, logo_url TEXT, remind_days INTEGER, notes TEXT,
                    sort_order INTEGER, created_at TEXT, updated_at TEXT);
                CREATE TABLE phone_balance_topups(request_id TEXT PRIMARY KEY,
                    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
                    amount_fen INTEGER NOT NULL);
            """)
            for identity, category, balance, status, stopped in [("phone", "cat_phone", 1050, "paused", 1), ("unknown-phone", "cat_phone", None, "active", 0), ("software", "cat_ai", None, "active", 0)]:
                conn.execute("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    identity, "测试", "test.example.com", 3000, "CNY", "monthly", None,
                    "2026-01-31", 31, 1, status, "", 0, balance, stopped, None, None,
                    category, "", 7, "保留备注", 10, "created", "updated"))
            conn.execute("INSERT INTO phone_balance_topups VALUES ('old-receipt','phone',5000)")
            before = conn.execute("SELECT * FROM subscriptions ORDER BY id").fetchall()
        migrated = Store(legacy)
        with migrated.connect() as conn:
            after = conn.execute("SELECT * FROM subscriptions ORDER BY id").fetchall()
            self.assertEqual([tuple(row)[:-1] for row in after], before)
            self.assertEqual(dict(conn.execute("SELECT id,billing_mode FROM subscriptions")), {"phone": "balance", "unknown-phone": "balance", "software": "auto_charge"})
            self.assertEqual(tuple(conn.execute("SELECT * FROM phone_balance_topups").fetchone()), ("old-receipt", "phone", 5000))
            self.assertEqual(conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0], "12")


if __name__ == "__main__":
    unittest.main()
