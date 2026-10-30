# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖领域模块与 runtimeops，所有账本、卡号和网络均为隔离夹具
[OUTPUT]: 审计缺陷的失败路径回归：事务回滚、交错写入、快照迁移、卡片隐私、DNS 绑定与提醒租约
[POS]: server 的跨边界回归，补充正常 CRUD 测试无法证明的提交点与恢复能力
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import base64
import json
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import aicardart
import cardcovers
import runtimeops
from cards import normalize_card
from clock import advance_until_future, project_horizon_fen, project_monthly_charges, estimated_spent
from schema import StoreError
from store import Store
from test_aicardart import png_data_url

TODAY = date(2026, 9, 6)
CARD = dict(name="测试卡", issuer="Example Bank", kind="physical_card", card_type="credit", network="visa", last4="4242")
SUB = dict(name="测试订阅", website="example.com", amount_yuan="10", cycle="monthly", next_renewal_on="2026-09-13")
PUBLIC = [(2, 1, 6, "", ("93.184.216.34", 443))]
PRIVATE = [(2, 1, 6, "", ("127.0.0.1", 443))]


class LedgerRegressionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = Store(self.root / "source" / "subos.sqlite3")

    def tearDown(self):
        self.tmp.cleanup()

    def count(self):
        with self.store.connect() as conn:
            return conn.execute("SELECT count(*) FROM subscriptions").fetchone()[0]

    def test_bad_input_never_leaves_row(self):
        for days in (10000000, 0, -1, 1.5, True, {}, []):
            with self.subTest(days=days), self.assertRaises(StoreError):
                self.store.create_subscription({**SUB, "cycle": "custom", "cycle_days": days})
            self.assertEqual(self.count(), 0)
        with patch.object(self.store, "_hydrate_subscription", side_effect=RuntimeError("派生失败")):
            with self.assertRaises(RuntimeError):
                self.store.create_subscription(SUB)
        self.assertEqual(self.count(), 0)

    def test_existing_poison_can_be_repaired_or_deleted(self):
        item = self.store.create_subscription(SUB)
        with self.store.connect() as conn:
            conn.execute("UPDATE subscriptions SET cycle='custom', cycle_days=10000000")
        fixed = self.store.update_subscription(item["id"], {"cycle_days": 30})
        self.assertEqual(fixed["cycle_days"], 30)
        with self.store.connect() as conn:
            conn.execute("UPDATE subscriptions SET next_renewal_on='broken'")
        self.store.delete_subscription(item["id"])
        self.assertEqual(self.count(), 0)

    def test_hydration_error_rolls_back_update(self):
        item = self.store.create_subscription(SUB)
        with patch.object(self.store, "_hydrate_subscription", side_effect=RuntimeError("派生失败")):
            with self.assertRaises(RuntimeError):
                self.store.update_subscription(item["id"], {"name": "不应保存"})
        self.assertEqual(self.store.get_subscription(item["id"])["name"], SUB["name"])

    def test_edit_and_pause_are_serialized(self):
        item = self.store.create_subscription(SUB)
        entered, release, pause_started = threading.Event(), threading.Event(), threading.Event()
        original = self.store._normalize_subscription
        def normalize(*args, **kwargs):
            if threading.current_thread().name.startswith("edit"):
                entered.set()
                if not release.wait(3):
                    raise RuntimeError("测试未释放")
            return original(*args, **kwargs)
        def pause():
            pause_started.set()
            return self.store.pause_subscription(item["id"], today=TODAY)
        with patch.object(self.store, "_normalize_subscription", side_effect=normalize), ThreadPoolExecutor(1, thread_name_prefix="edit") as editing, ThreadPoolExecutor(1) as pausing:
            first = editing.submit(self.store.update_subscription, item["id"], {"name": "新名称"})
            self.assertTrue(entered.wait(2))
            second = pausing.submit(pause)
            self.assertTrue(pause_started.wait(2))
            self.assertFalse(second.done())
            release.set()
            first.result(timeout=3)
            second.result(timeout=3)
        current = self.store.get_subscription(item["id"], TODAY)
        self.assertEqual((current["name"], current["status"], current["paused_days_left"]), ("新名称", "paused", 7))

    def test_month_end_anchor_survives_repeated_renewal(self):
        item = self.store.create_subscription({**SUB, "next_renewal_on": "2026-01-31"})
        first = self.store.confirm_renewal(item["id"], date(2026, 1, 31))
        second = self.store.confirm_renewal(item["id"], date(2026, 2, 28))
        self.assertEqual(first["next_renewal_on"], "2026-02-28")
        self.assertEqual(second["next_renewal_on"], "2026-03-31")
        changed = self.store.update_subscription(item["id"], {"next_renewal_on": "2026-04-20"})
        self.assertEqual(changed["renewal_anchor_day"], 20)

    def test_long_overdue_daily_schedule_is_complete(self):
        item = {**SUB, "status": "active", "cycle": "custom", "cycle_days": 1, "amount_fen": 100, "next_renewal_on": "2020-01-01"}
        self.assertEqual(advance_until_future(date(2020, 1, 1), "custom", 1, TODAY), TODAY + timedelta(days=1))
        self.assertEqual(project_horizon_fen([item], TODAY), 36600)
        self.assertEqual(project_monthly_charges([item], TODAY)[0]["fen"], 2500)
        self.assertEqual(estimated_spent(date(9000, 1, 1), "custom", 1, TODAY, 100)[0], 365)

    def test_card_types_secrets_hash_and_closed_history(self):
        for field in ("name", "issuer", "note"):
            for value in (4242424242424242, {"x": "y"}, ["x"], "4242-4242-4242-4242"):
                with self.subTest(field=field, value=value), self.assertRaises(StoreError):
                    normalize_card({**CARD, field: value})
        key = "bbbbbbbbbbbbbbbbbbbbbbbb.png"
        old = self.store.create_card({**CARD, "status": "closed", "cover_key": key, "cover_source_url": "https://bank.example/123456789012345678901234.png"})
        self.store.create_card(CARD)
        result = self.store.update_card(old["id"], {"note": "shopping card"})
        self.assertEqual(result["note"], "shopping card")
        self.assertEqual(result["cover_key"], key)
        self.assertEqual(normalize_card({**CARD, "id": "card_123456789012"})["last4"], "4242")
        with self.assertRaises(StoreError):
            self.store.update_card(old["id"], {"status": "active"})

    def test_reminders_require_success_receipt_and_exclusive_lease(self):
        self.store.create_subscription(SUB)
        first = self.store.claim_reminders(TODAY)
        self.assertEqual(len(first["due"]), 1)
        self.assertEqual(self.store.claim_reminders(TODAY)["due"], [])
        with self.assertRaises(StoreError):
            self.store.ack_reminders({"items": [{"id": first["due"][0]["id"], "wave": 7}]})
        self.store.release_reminders({"items": first["due"]})
        second = self.store.claim_reminders(TODAY)
        self.assertNotEqual(first["due"][0]["delivery_token"], second["due"][0]["delivery_token"])
        self.assertEqual(self.store.ack_reminders({"items": first["due"]})["accepted"], 0)
        self.assertEqual(self.store.ack_reminders({"items": second["due"]})["accepted"], 1)
        self.assertEqual(self.store.reminders(TODAY)["due"], [])

    def test_expired_claim_retries_without_silent_ack(self):
        self.store.create_subscription(SUB)
        first = self.store.claim_reminders(TODAY)
        with self.store.connect() as conn:
            conn.execute("UPDATE reminder_claims SET expires_at = 0")
        second = self.store.claim_reminders(TODAY)
        self.assertEqual(len(second["due"]), 1)
        self.assertNotEqual(first["due"][0]["delivery_token"], second["due"][0]["delivery_token"])

    def test_snapshot_recovers_database_and_referenced_covers(self):
        item = self.store.create_subscription(SUB)
        key = "a" * 24 + ".png"
        covers = self.store.db_path.parent / "card-covers"
        covers.mkdir()
        (covers / key).write_bytes(b"test-image")
        self.store.create_card({**CARD, "cover_key": key})
        backup = runtimeops.backup_runtime(self.store.db_path.parent, self.root / "backups")
        recovered = Store(backup / "subos.sqlite3")
        self.assertEqual(recovered.get_subscription(item["id"])["name"], SUB["name"])
        self.assertEqual((backup / "card-covers" / key).read_bytes(), b"test-image")
        (covers / key).unlink()
        with self.assertRaises(ValueError):
            runtimeops.backup_runtime(self.store.db_path.parent, self.root / "backups")
        self.assertEqual(list((self.root / "backups").iterdir()), [backup])

    def test_snapshot_during_atomic_writes_never_mixes_states(self):
        with self.store.connect() as conn:
            conn.execute("CREATE TABLE pair(a, b)")
            conn.execute("INSERT INTO pair VALUES (0,0)")
        stop = threading.Event()
        def writer():
            conn = sqlite3.connect(str(self.store.db_path))
            try:
                for n in range(1000):
                    if stop.is_set(): break
                    conn.execute("UPDATE pair SET a=?, b=?", (n, n))
                    conn.commit()
            finally:
                conn.close()
        with ThreadPoolExecutor(1) as pool:
            task = pool.submit(writer)
            for n in range(3):
                out = self.root / f"snapshot{n}"
                runtimeops.snapshot_runtime(self.store.db_path.parent, out)
                with sqlite3.connect(str(out / "subos.sqlite3")) as conn:
                    a, b = conn.execute("SELECT a,b FROM pair").fetchone()
                self.assertEqual(a, b)
            stop.set()
            task.result(timeout=3)

    def test_migration_keeps_source_and_refuses_destination_conflict(self):
        self.store.create_subscription(SUB)
        source, target = self.store.db_path.parent, self.root / "installed"
        target.mkdir()
        (target / "subos.sqlite3").write_bytes(b"another ledger")
        with self.assertRaises(ValueError):
            runtimeops.migrate_runtime(source, target)
        self.assertEqual((target / "subos.sqlite3").read_bytes(), b"another ledger")
        self.assertFalse(source.is_symlink())
        (target / "subos.sqlite3").unlink()
        retained = runtimeops.migrate_runtime(source, target)
        self.assertTrue(source.is_symlink())
        self.assertTrue((retained / "subos.sqlite3").is_file())
        self.assertEqual(len(Store(target / "subos.sqlite3").list_subscriptions()), 1)
        self.assertIsNone(runtimeops.migrate_runtime(source, target))


class OutboundRegressionTests(unittest.TestCase):
    def test_ai_rejects_sensitive_text_before_key_or_network(self):
        with patch("aicardart.openai_api_key") as key, patch("aicardart.urlopen") as network:
            for value in (4242424242424242, "4242 4242 4242 4242", "12345678", "CVV 123", "PIN: 1234"):
                with self.subTest(value=value), self.assertRaises(StoreError):
                    aicardart.generate_card_art({"reference_data_url": png_data_url(), "product": value}, Path("unused"))
            key.assert_not_called()
            network.assert_not_called()
        with self.assertRaises(StoreError):
            aicardart.build_card_art_prompt({"network": "not-a-network"})

    def test_png_metadata_and_trailing_data_are_not_forwarded(self):
        data = base64.b64decode(png_data_url().split(",")[1])
        metadata = aicardart._png_chunk(b"tEXt", b"secret\0test-metadata")
        raw = data[:-12] + metadata + data[-12:] + b"test-trailer"
        cleaned = aicardart.decode_privacy_reference("data:image/png;base64," + base64.b64encode(raw).decode())
        self.assertNotIn(b"test-metadata", cleaned)
        self.assertNotIn(b"test-trailer", cleaned)
        broken = bytearray(data)
        broken[40] ^= 1
        with self.assertRaises(StoreError):
            aicardart.decode_privacy_reference("data:image/png;base64," + base64.b64encode(broken).decode())

    def test_dns_resolution_is_bound_to_connect_and_tls_hostname(self):
        with patch("cardcovers.socket.getaddrinfo", side_effect=[PUBLIC, PRIVATE]) as dns, patch("cardcovers.socket.socket") as socket_factory:
            raw = socket_factory.return_value
            url, addresses = cardcovers._public_target("https://bank.example/card")
            connection = cardcovers._PinnedHTTPSConnection("bank.example", 443, addresses)
            with patch.object(connection._context, "wrap_socket", return_value=MagicMock()) as tls:
                connection.connect()
                raw.connect.assert_called_once_with(("93.184.216.34", 443))
                tls.assert_called_once_with(raw, server_hostname="bank.example")
            dns.assert_called_once()
            connection.close()

    def test_redirect_revalidates_before_second_connection(self):
        with patch("cardcovers.socket.getaddrinfo", side_effect=[PUBLIC, PRIVATE]), patch("cardcovers._PinnedHTTPSConnection") as connect:
            response = connect.return_value.getresponse.return_value
            response.status = 302
            response.getheader.return_value = "https://internal.example/card"
            with self.assertRaises(StoreError):
                cardcovers._read_url("https://bank.example/card")
            self.assertEqual(connect.call_count, 1)

    def test_process_guard_against_real_isolated_children(self):
        with tempfile.TemporaryDirectory() as tmp:
            entry = Path(tmp) / "subos_server.py"
            entry.write_text("import time; time.sleep(30)")
            own = subprocess.Popen([sys.executable, str(entry)])
            foreign = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
            try:
                self.assertFalse(runtimeops.stop_owned(foreign.pid, [entry]))
                self.assertIsNone(foreign.poll())
                self.assertTrue(runtimeops.stop_owned(own.pid, [entry]))
                own.wait(timeout=2)
            finally:
                for child in (own, foreign):
                    if child.poll() is None:
                        child.terminate()
                    child.wait(timeout=2)

    def test_unknown_process_is_never_killed(self):
        entry = Path("/project/server/subos_server.py")
        with patch("runtimeops.process_identity", return_value=("stamp", "python3 /other/server.py")), patch("runtimeops.os.kill") as kill:
            self.assertFalse(runtimeops.stop_owned(123, [entry]))
            kill.assert_not_called()
        with patch("runtimeops.process_identity", return_value=("new stamp", f"python3 {entry}")):
            self.assertFalse(runtimeops.owned_process(123, [entry], "old stamp"))
            self.assertTrue(runtimeops.owned_process(123, [entry]))


if __name__ == "__main__":
    unittest.main()
