# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 store 与临时 SQLite
[OUTPUT]: 对外提供续费确认、外键占用、三波提醒回执的回归
[POS]: server 的持久化测试，不启动 HTTP
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import tempfile
import unittest
from datetime import date
from pathlib import Path

from store import Store, StoreError


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "subos.sqlite3")
        self.today = date(2026, 8, 16)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_confirm_renewal_advances_past_today(self) -> None:
        item = self.store.create_subscription(
            {
                "name": "Plus",
                "website": "chatgpt.com",
                "amount_yuan": "140",
                "cycle": "monthly",
                "next_renewal_on": "2026-05-16",
            }
        )
        updated = self.store.confirm_renewal(item["id"], self.today)
        self.assertEqual(updated["next_renewal_on"], "2026-09-16")
        self.assertEqual(updated["days_left"], 31)

    def test_confirm_renewal_daily_card_crosses_half_year(self) -> None:
        item = self.store.create_subscription(
            {
                "name": "日卡",
                "website": "example.com",
                "amount_yuan": "1",
                "cycle": "custom",
                "cycle_days": 1,
                "next_renewal_on": "2026-01-01",
            }
        )
        updated = self.store.confirm_renewal(item["id"], self.today)
        self.assertEqual(updated["next_renewal_on"], "2026-08-17")

    def test_update_amount_yuan_overrides_old_fen(self) -> None:
        item = self.store.create_subscription(
            {
                "name": "Plus",
                "website": "chatgpt.com",
                "amount_yuan": "140",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
            }
        )
        updated = self.store.update_subscription(item["id"], {"amount_yuan": "200"})
        self.assertEqual(updated["amount_yuan"], "200.00")
        self.assertEqual(updated["amount_fen"], 20000)
        both = self.store.update_subscription(
            item["id"],
            {"amount_yuan": "88.5", "amount_fen": 14000},
        )
        self.assertEqual(both["amount_fen"], 8850)
        self.assertEqual(both["amount_yuan"], "88.50")

    def test_reorder_within_category(self) -> None:
        first = self.store.create_subscription(
            {
                "name": "A",
                "website": "a.com",
                "amount_yuan": "10",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
                "category_id": "cat_ai",
            }
        )
        second = self.store.create_subscription(
            {
                "name": "B",
                "website": "b.com",
                "amount_yuan": "20",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
                "category_id": "cat_ai",
            }
        )
        other = self.store.create_subscription(
            {
                "name": "C",
                "website": "c.com",
                "amount_yuan": "30",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
                "category_id": "cat_phone",
            }
        )
        self.store.reorder_subscriptions(
            {"category_id": "cat_ai", "ids": [second["id"], first["id"]]}
        )
        names = [
            item["name"]
            for item in self.store.list_subscriptions(self.today)
            if item["category_id"] == "cat_ai"
        ]
        self.assertEqual(names, ["B", "A"])
        with self.assertRaises(StoreError):
            self.store.reorder_subscriptions(
                {"category_id": "cat_ai", "ids": [second["id"], other["id"]]}
            )

    def test_reminder_waves_fire_once(self) -> None:
        item = self.store.create_subscription(
            {
                "name": "Plus",
                "website": "chatgpt.com",
                "amount_yuan": "140",
                "cycle": "monthly",
                "next_renewal_on": "2026-08-23",
            }
        )
        pack = self.store.reminders(self.today)
        self.assertEqual(len(pack["due"]), 1)
        self.assertEqual(pack["due"][0]["wave"], 7)
        self.assertEqual(pack["due"][0]["id"], item["id"])
        claimed = self.store.claim_reminders(self.today)
        self.store.ack_reminders({"items": claimed["due"]})
        again = self.store.reminders(self.today)
        self.assertEqual(again["due"], [])
        third = self.store.reminders(date(2026, 8, 20))
        self.assertEqual(len(third["due"]), 1)
        self.assertEqual(third["due"][0]["wave"], 3)
        silent = self.store.reminders(date(2026, 8, 19))
        self.assertEqual(silent["due"], [])

    def test_cannot_delete_payment_in_use(self) -> None:
        pay = self.store.create_payment_method({"name": "招行", "account": "3201"})
        self.store.create_subscription(
            {
                "name": "Plus",
                "website": "https://chatgpt.com",
                "amount_yuan": "140",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
                "payment_method_id": pay["id"],
            }
        )
        with self.assertRaises(StoreError) as ctx:
            self.store.delete_payment_method(pay["id"])
        self.assertEqual(ctx.exception.status, 409)

    def test_generic_payment_account_is_free_text(self) -> None:
        pay = self.store.create_payment_method(
            {"name": "Apple Pay", "account": "icloud@example.com"}
        )
        self.assertEqual(pay["account"], "icloud@example.com")
        self.assertEqual(pay["kind"], "other")
        with self.store.connect() as conn:
            cols = {row["name"] for row in conn.execute("PRAGMA table_info(payment_methods)")}
        self.assertIn("account", cols)
        self.assertIn("kind", cols)
        self.assertIn("last4", cols)

    def test_summary_only_counts_active(self) -> None:
        self.store.create_subscription(
            {
                "name": "A",
                "website": "a.com",
                "amount_yuan": "120",
                "cycle": "yearly",
                "next_renewal_on": "2026-09-01",
            }
        )
        cancelled = self.store.create_subscription(
            {
                "name": "B",
                "website": "b.com",
                "amount_yuan": "99",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
            }
        )
        self.store.update_subscription(cancelled["id"], {**cancelled, "status": "cancelled"})
        summary = self.store.summary(self.today)
        self.assertEqual(summary["active_count"], 1)
        self.assertEqual(summary["monthly_yuan"], "10.00")
        self.assertEqual(summary["yearly_yuan"], "120.00")
        self.assertEqual(summary["projected_yuan"], "120.00")

    def _monthly(self, name: str = "Plus", nxt: str = "2026-08-28") -> dict:
        return self.store.create_subscription(
            {
                "name": name,
                "website": f"{name.lower()}.com",
                "amount_yuan": "140",
                "cycle": "monthly",
                "next_renewal_on": nxt,
            }
        )

    def test_pause_keeps_record_and_freezes_clock(self) -> None:
        """暂停不是删除：记录还在，倒计时停在冻结的那几天上。"""
        item = self._monthly()
        paused = self.store.pause_subscription(item["id"], True, self.today)
        self.assertEqual(paused["status"], "paused")
        self.assertEqual(paused["paused_on"], "2026-08-16")
        self.assertEqual(paused["paused_days_left"], 12)
        self.assertFalse(paused["auto_renew"])
        # 冻结后天数不再随日历走，紧急度也不再喊
        later = self.store.get_subscription(item["id"], date(2027, 1, 1))
        self.assertEqual(later["days_left"], 12)
        self.assertEqual(later["urgency"], "ok")
        self.assertEqual(later["next_renewal_on"], "2026-08-28")

    def test_pause_mid_cycle_forfeits_remainder(self) -> None:
        """服务生效途中退订：剩余作废，冻结 0 天。"""
        item = self._monthly()
        paused = self.store.pause_subscription(item["id"], False, self.today)
        self.assertEqual(paused["paused_days_left"], 0)
        self.assertEqual(paused["days_left"], 0)
        self.assertEqual(paused["remain_ratio"], 0.0)

    def test_resume_gives_back_frozen_days(self) -> None:
        item = self._monthly()
        self.store.pause_subscription(item["id"], True, self.today)
        back = self.store.resume_subscription(item["id"], date(2027, 3, 1))
        self.assertEqual(back["status"], "active")
        self.assertEqual(back["next_renewal_on"], "2027-03-13")
        self.assertEqual(back["paused_days_left"], None)
        self.assertEqual(back["paused_on"], "")
        self.assertTrue(back["auto_renew"])

    def test_resume_after_mid_cycle_cancel_starts_new_period(self) -> None:
        item = self._monthly()
        self.store.pause_subscription(item["id"], False, self.today)
        back = self.store.resume_subscription(item["id"], date(2027, 3, 1))
        self.assertEqual(back["next_renewal_on"], "2027-04-01")

    def test_paused_leaves_summary_and_reminders_alone(self) -> None:
        """暂停的钱不算进月费，也不该再响 7/3/1。"""
        self._monthly("A", "2026-09-01")
        stopped = self._monthly("B", "2026-08-23")
        before = self.store.summary(self.today)
        self.assertEqual(before["active_count"], 2)
        self.assertEqual(len(self.store.due_reminder_waves(self.today)), 1)
        self.store.pause_subscription(stopped["id"], True, self.today)
        after = self.store.summary(self.today)
        self.assertEqual(after["active_count"], 1)
        self.assertEqual(after["paused_count"], 1)
        self.assertEqual(after["count"], 2)
        self.assertEqual(after["monthly_yuan"], "140.00")
        self.assertEqual(self.store.due_reminder_waves(self.today), [])

    def test_pause_rejects_non_active(self) -> None:
        item = self._monthly()
        self.store.pause_subscription(item["id"], True, self.today)
        with self.assertRaises(StoreError):
            self.store.pause_subscription(item["id"], True, self.today)
        with self.assertRaises(StoreError):
            self.store.confirm_renewal(item["id"], self.today)

    def test_resume_rejects_active(self) -> None:
        item = self._monthly()
        with self.assertRaises(StoreError):
            self.store.resume_subscription(item["id"], self.today)

    def test_status_switch_must_go_through_actions(self) -> None:
        """PUT 改不干净冻结天数，所以直接改状态要被挡回去。"""
        item = self._monthly()
        with self.assertRaises(StoreError):
            self.store.update_subscription(item["id"], {**item, "status": "paused"})
        paused = self.store.pause_subscription(item["id"], True, self.today)
        with self.assertRaises(StoreError):
            self.store.update_subscription(paused["id"], {**paused, "status": "active"})
        # 暂停期间改名改价照旧
        renamed = self.store.update_subscription(paused["id"], {**paused, "name": "Plus 2"})
        self.assertEqual(renamed["name"], "Plus 2")
        self.assertEqual(renamed["paused_days_left"], 12)

    def test_seed_demo_only_on_empty(self) -> None:
        created = self.store.seed_demo(self.today)
        self.assertEqual(len(created), 12)
        names = {item["name"]: item["category_id"] for item in created}
        self.assertEqual(names["ChatGPT Plus"], "cat_ai")
        self.assertEqual(names["中国移动"], "cat_phone")
        self.assertEqual(names["中国电信宽带"], "cat_network")
        self.assertEqual(sum(1 for item in created if item["category_id"] == "cat_ai"), 9)
        self.assertEqual(self.store.seed_demo(self.today), [])

    def test_seed_demo_skips_nonempty(self) -> None:
        other = Store(Path(self.tmp.name) / "seed.sqlite3")
        other.create_subscription(
            {
                "name": "真订阅",
                "website": "example.com",
                "amount_yuan": "10",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
            }
        )
        self.assertEqual(other.seed_demo(self.today), [])

    def test_create_infers_ai_category(self) -> None:
        item = self.store.create_subscription(
            {
                "name": "Plus",
                "website": "chatgpt.com",
                "amount_yuan": "20",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
            }
        )
        self.assertEqual(item["category_id"], "cat_ai")
        self.assertIn("/icons/6448311069", item["logo_src"])

    def test_can_delete_builtin_category(self) -> None:
        item = self.store.create_subscription(
            {
                "name": "Plus",
                "website": "chatgpt.com",
                "amount_yuan": "20",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
                "category_id": "cat_ai",
            }
        )
        self.store.delete_category("cat_ai")
        leftover = self.store.get_subscription(item["id"])
        self.assertIsNone(leftover["category_id"])
        again = Store(Path(self.tmp.name) / "subos.sqlite3")
        after = again.get_subscription(item["id"], self.today)
        self.assertIsNone(after["category_id"])

    def test_same_identifier_reuses_account(self) -> None:
        first = self.store.create_account(
            {"label": "工作", "identifier": "Me@X.com"}
        )
        second = self.store.create_account(
            {"label": "工作号", "identifier": "me@x.com"}
        )
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self.store.list_accounts()), 1)

    def test_merges_duplicate_accounts_on_open(self) -> None:
        one = self.store.create_account({"label": "A", "identifier": "a@x.com"})
        two = self.store.create_account({"label": "B", "identifier": "b@x.com"})
        with self.store.connect() as conn:
            conn.execute(
                "INSERT INTO accounts (id, label, identifier, note, created_at) "
                "VALUES ('acc_dup', 'A2', 'a@x.com', '', ?)",
                ("2026-08-01T00:00:00",),
            )
        self.store.create_subscription(
            {
                "name": "Plus",
                "website": "chatgpt.com",
                "amount_yuan": "20",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
                "account_id": "acc_dup",
            }
        )
        again = Store(Path(self.tmp.name) / "subos.sqlite3")
        same = [
            item
            for item in again.list_accounts()
            if str(item["identifier"]).lower() == "a@x.com"
        ]
        self.assertEqual(len(same), 1)
        self.assertEqual(len(again.list_accounts()), 2)
        item = next(
            row for row in again.list_subscriptions(self.today) if row["name"] == "Plus"
        )
        self.assertEqual(item["account_id"], same[0]["id"])

    def test_rejects_password_in_account(self) -> None:
        with self.assertRaises(StoreError):
            self.store.create_account(
                {"label": "工作", "identifier": "password=123"}
            )

    def test_update_category_rejects_duplicate_name(self) -> None:
        extra = self.store.create_category({"name": "保险"})
        with self.assertRaises(StoreError) as ctx:
            self.store.update_category(extra["id"], {"name": "AI"})
        self.assertIn("同名", str(ctx.exception))

    def test_update_amount_fen_only(self) -> None:
        item = self.store.create_subscription(
            {
                "name": "Plus",
                "website": "chatgpt.com",
                "amount_yuan": "140",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
            }
        )
        updated = self.store.update_subscription(item["id"], {"amount_fen": 2000})
        self.assertEqual(updated["amount_fen"], 2000)
        self.assertEqual(updated["amount_yuan"], "20.00")

    def test_deleted_custom_category_stays_uncategorized_after_reopen(self) -> None:
        work = self.store.create_category({"name": "工作"})
        item = self.store.create_subscription(
            {
                "name": "Plus",
                "website": "chatgpt.com",
                "amount_yuan": "20",
                "cycle": "monthly",
                "next_renewal_on": "2026-09-01",
                "category_id": work["id"],
            }
        )
        self.store.delete_category(work["id"])
        again = Store(Path(self.tmp.name) / "subos.sqlite3")
        leftover = again.get_subscription(item["id"], self.today)
        self.assertIsNone(leftover["category_id"])

    def test_cleared_categories_do_not_reseed(self) -> None:
        for row in self.store.list_categories():
            self.store.delete_category(row["id"])
        self.assertEqual(self.store.list_categories(), [])
        again = Store(Path(self.tmp.name) / "subos.sqlite3")
        self.assertEqual(again.list_categories(), [])

    def test_update_account_rejects_duplicate_identifier(self) -> None:
        self.store.create_account({"label": "甲", "identifier": "a@x.com"})
        other = self.store.create_account({"label": "乙", "identifier": "b@x.com"})
        with self.assertRaises(StoreError) as ctx:
            self.store.update_account(other["id"], {"identifier": "A@x.com"})
        self.assertIn("同一个账号", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
