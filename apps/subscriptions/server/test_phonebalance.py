# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 Store、冻结日期与临时 SQLite，电话卡和金额均为虚构
[OUTPUT]: 验证原电话卡余额、通用周期、旧迁移、并发幂等和事务回滚
[POS]: 电话卡计费回归；不连接运营商，不读取本机账本
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from unittest.mock import patch

from store import Store, StoreError


class PhoneBalanceTests(unittest.TestCase):
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

    def phone(self, **changes):
        return self.store.create_subscription({
            "name": "测试电话卡", "website": "phone.example.com", "category_id": "cat_phone",
            "amount_yuan": "30", "cycle": "monthly", "billing_mode": "balance", "next_renewal_on": "2026-01-31", **changes,
        })

    def balance(self, item, amount, today=None):
        return self.store.set_phone_balance(item["id"], {"balance_yuan": amount}, today or self.today)

    def top_up(self, item, amount, request_id="test-request", today=None):
        return self.store.top_up_phone_balance(item["id"], {"amount_yuan": amount, "request_id": request_id}, today or self.today)

    def test_unknown_balance_preserves_existing_subscription(self):
        item = self.phone(next_renewal_on="2025-01-31")
        result = Store(self.path).get_subscription(item["id"], date(2026, 6, 1))
        self.assertTrue(result["is_phone"])
        self.assertIsNone(result["phone_balance_fen"])
        self.assertEqual(result["status"], "active")
        self.assertEqual(result["next_renewal_on"], "2025-01-31")

    def test_first_balance_does_not_charge_unknown_history(self):
        item = self.phone(next_renewal_on="2025-09-30")
        result = self.balance(item, "50.25")
        self.assertEqual(result["phone_balance_yuan"], "50.25")
        self.assertEqual(result["next_renewal_on"], "2026-01-30")

    def test_monthly_charge_then_stop_on_next_unpaid_due_date(self):
        item = self.phone()
        self.balance(item, "50")
        first = self.store.get_subscription(item["id"], date(2026, 1, 31))
        self.assertEqual(first["phone_balance_fen"], 2000)
        self.assertEqual(first["next_renewal_on"], "2026-02-28")
        self.assertTrue(first["phone_balance_low"])
        self.assertEqual(first["status"], "active")
        again = Store(self.path).get_subscription(item["id"], date(2026, 1, 31))
        self.assertEqual(again["phone_balance_fen"], 2000)
        self.assertEqual(self.store.get_subscription(item["id"], date(2026, 2, 27))["status"], "active")
        stopped = self.store.get_subscription(item["id"], date(2026, 2, 28))
        self.assertEqual(stopped["status"], "paused")
        self.assertTrue(stopped["phone_balance_stopped"])
        self.assertEqual(stopped["paused_on"], "2026-02-28")
        self.assertEqual(stopped["phone_balance_fen"], 2000)
        self.assertEqual(self.store.summary(date(2026, 2, 28))["active_count"], 0)
        self.assertEqual(self.store.reminders(date(2026, 2, 28))["due"], [])

    def test_exact_balance_pays_full_month_before_stopping(self):
        item = self.phone()
        self.balance(item, "30")
        paid = self.store.get_subscription(item["id"], date(2026, 1, 31))
        self.assertEqual(paid["phone_balance_fen"], 0)
        self.assertEqual(paid["status"], "active")
        self.assertEqual(self.store.get_subscription(item["id"], date(2026, 2, 28))["status"], "paused")

    def test_leap_february_restores_month_end_anchor(self):
        item = self.phone(next_renewal_on="2028-01-31", amount_yuan="20")
        self.balance(item, "100")
        result = self.store.get_subscription(item["id"], date(2028, 3, 31))
        self.assertEqual(result["phone_balance_yuan"], "40.00")
        self.assertEqual(result["next_renewal_on"], "2028-04-30")
        self.assertEqual(result["renewal_anchor_day"], 31)

    def test_offline_catchup_and_topup_restart_from_today(self):
        item = self.phone()
        self.balance(item, "100")
        stopped = self.store.get_subscription(item["id"], date(2026, 6, 1))
        self.assertEqual(stopped["phone_balance_yuan"], "10.00")
        self.assertEqual(stopped["paused_on"], "2026-04-30")
        resumed = self.top_up(item, "50", today=date(2026, 6, 1))
        self.assertEqual(resumed["phone_balance_yuan"], "30.00")
        self.assertEqual(resumed["status"], "active")
        self.assertFalse(resumed["phone_balance_stopped"])
        self.assertEqual(resumed["next_renewal_on"], "2026-07-01")
        self.assertEqual(resumed["renewal_anchor_day"], 1)

    def test_small_topup_keeps_phone_stopped_until_enough(self):
        item = self.phone()
        self.balance(item, "0")
        self.store.settle_phone_balances(date(2026, 1, 31))
        result = self.top_up(item, "10", today=date(2026, 2, 10))
        self.assertEqual(result["status"], "paused")
        self.assertEqual(result["phone_balance_yuan"], "10.00")
        resumed = self.top_up(item, "20", "second", date(2026, 2, 11))
        self.assertEqual(resumed["status"], "active")
        self.assertEqual(resumed["phone_balance_fen"], 0)
        self.assertEqual(resumed["next_renewal_on"], "2026-03-11")

    def test_topup_does_not_resume_manual_pause_or_charge_frozen_days(self):
        item = self.phone()
        self.balance(item, "30")
        self.store.pause_subscription(item["id"], True, self.today)
        result = self.top_up(item, "50")
        self.assertEqual(result["status"], "paused")
        self.assertFalse(result["phone_balance_stopped"])
        resumed = self.store.resume_subscription(item["id"], date(2026, 2, 15))
        self.assertEqual(resumed["phone_balance_yuan"], "80.00")
        self.assertEqual(resumed["next_renewal_on"], "2026-03-03")

    def test_manual_restart_charges_one_month_and_requires_balance(self):
        item = self.phone()
        self.balance(item, "0")
        self.store.pause_subscription(item["id"], False, self.today)
        with self.assertRaisesRegex(StoreError, "余额不足"):
            self.store.resume_subscription(item["id"], self.today)
        self.top_up(item, "60")
        resumed = self.store.resume_subscription(item["id"], date(2026, 1, 16))
        self.assertEqual(resumed["phone_balance_yuan"], "30.00")
        self.assertEqual(resumed["next_renewal_on"], "2026-02-16")

    def test_topup_idempotency_survives_other_topups(self):
        item = self.phone()
        self.top_up(item, "50", "first")
        self.top_up(item, "100", "second")
        self.assertEqual(self.top_up(item, "50", "first")["phone_balance_yuan"], "150.00")
        with self.assertRaisesRegex(StoreError, "另一笔"):
            self.top_up(item, "51", "first")
        other = self.phone(name="第二张测试卡")
        with self.assertRaises(StoreError):
            self.top_up(other, "50", "first")

    def test_concurrent_topups_do_not_lose_or_duplicate_balance(self):
        item, other = self.phone(), Store(self.path)
        def add(index):
            store = self.store if index % 2 else other
            return store.top_up_phone_balance(item["id"], {"amount_yuan": "0.01", "request_id": f"parallel-{index // 2}"}, self.today)
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(add, range(40)))
        self.assertEqual(self.store.get_subscription(item["id"], self.today)["phone_balance_fen"], 20)

    def test_failed_response_rolls_back_balance_and_receipt(self):
        item = self.phone()
        self.balance(item, "10")
        with patch.object(self.store, "_hydrate_subscription", side_effect=RuntimeError("test failure")):
            with self.assertRaises(RuntimeError):
                self.top_up(item, "50")
        self.assertEqual(self.store.get_subscription(item["id"], self.today)["phone_balance_yuan"], "10.00")
        self.assertEqual(self.top_up(item, "50")["phone_balance_yuan"], "60.00")

    def test_invalid_values_rejected_and_all_categories_and_cycles_supported(self):
        item = self.phone()
        for amount in ("-1", "0.001", "NaN", True, None, "1000000000000.01"):
            with self.subTest(amount=amount), self.assertRaises(StoreError):
                self.balance(item, amount)
        for amount in ("0", "-1", "1.001"):
            with self.subTest(topup=amount), self.assertRaises(StoreError):
                self.top_up(item, amount)
        nonphone = self.phone(name="测试软件", category_id="cat_ai", website="software.example.com")
        self.assertEqual(self.balance(nonphone, "50")["balance_yuan"], "50.00")
        quarterly = self.phone(cycle="quarterly")
        self.assertEqual(self.balance(quarterly, "50")["balance_yuan"], "50.00")

    def test_generic_edit_cannot_overwrite_balance_or_skip_deduction(self):
        item = self.phone()
        self.balance(item, "60")
        updated = self.store.update_subscription(item["id"], {"notes": "测试备注", "phone_balance_fen": 0})
        self.assertEqual(updated["phone_balance_yuan"], "60.00")
        self.assertEqual(self.store.update_subscription(item["id"], {"cycle": "yearly"})["balance_yuan"], "60.00")
        with self.assertRaises(StoreError):
            self.store.confirm_renewal(item["id"], self.today)

    def test_projection_is_capped_by_available_balance(self):
        item = self.phone()
        self.balance(item, "70")
        self.assertEqual(self.store.get_subscription(item["id"], self.today)["upcoming_fen"], 6000)
        summary = self.store.summary(self.today)
        self.assertEqual(summary["projected_fen"], 6000)
        self.assertEqual(sum(row["fen"] for row in summary["curve"]), 6000)

    def test_zero_fee_advances_without_loop_or_balance_change(self):
        item = self.phone(amount_yuan="0")
        self.balance(item, "0")
        result = self.store.get_subscription(item["id"], date(2026, 6, 1))
        self.assertEqual(result["status"], "active")
        self.assertEqual(result["phone_balance_fen"], 0)
        self.assertEqual(result["next_renewal_on"], "2026-06-30")

    def test_delete_removes_topup_receipts(self):
        item = self.phone()
        self.top_up(item, "50")
        self.store.delete_subscription(item["id"])
        with self.store.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM phone_balance_topups").fetchone()[0], 0)

    def test_schema_9_and_10_migration_preserves_subscription_values(self):
        # 分别覆盖本机旧版本与此前源码版本；不使用当前 DDL 构造旧表。
        columns = """
            id TEXT PRIMARY KEY, name TEXT, website TEXT, amount_fen INTEGER,
            currency TEXT, cycle TEXT, cycle_days INTEGER, next_renewal_on TEXT,
            renewal_anchor_day INTEGER, auto_renew INTEGER, status TEXT,
            paused_on TEXT, paused_days_left INTEGER, payment_method_id TEXT,
            account_id TEXT, category_id TEXT, logo_url TEXT, remind_days INTEGER,
            notes TEXT, sort_order INTEGER, created_at TEXT, updated_at TEXT
        """
        for version in (9, 10):
            with self.subTest(version=version):
                legacy = Path(self.tmp.name) / f"legacy-{version}.sqlite3"
                values = [
                    "legacy-phone", "测试电话卡", "phone.example.com", 3050, "CNY", "monthly", None,
                    "2025-01-31", 31, 1, "active", "", None, None, None, "cat_phone", "", 7,
                    "保留测试备注", 20, "created", "updated",
                ]
                legacy_columns = columns
                if version == 9:
                    legacy_columns = columns.replace("renewal_anchor_day INTEGER,", "")
                    values.pop(8)
                with sqlite3.connect(legacy) as conn:
                    conn.execute(f"CREATE TABLE subscriptions ({legacy_columns})")
                    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                    conn.execute("INSERT INTO meta VALUES ('schema_version', ?)", (str(version),))
                    placeholders = ",".join("?" for _ in values)
                    conn.execute(f"INSERT INTO subscriptions VALUES ({placeholders})", values)
                    before = conn.execute("SELECT * FROM subscriptions").fetchone()
                migrated = Store(legacy)
                result = migrated.get_subscription("legacy-phone", self.today)
                self.assertIsNone(result["phone_balance_fen"])
                self.assertFalse(result["phone_balance_stopped"])
                with migrated.connect() as conn:
                    row = conn.execute("SELECT * FROM subscriptions").fetchone()
                    self.assertEqual(tuple(row)[:len(before)], before)
                    self.assertEqual(conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0], "12")
