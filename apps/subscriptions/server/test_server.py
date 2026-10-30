# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 subos_server 与临时 SQLite
[OUTPUT]: 验证双模式切换、通用余额与幂等充值、后台续期和本机 HTTP 边界
[POS]: server 的 HTTP 测试，不碰本机 18787
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from datetime import date, timedelta
from unittest.mock import patch
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

_BOOT = tempfile.TemporaryDirectory()
os.environ["SUBOS_DB"] = str(Path(_BOOT.name) / "boot.sqlite3")

import subos_server  # noqa: E402
from store import Store  # noqa: E402


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "subos.sqlite3")
        self._old = subos_server.STORE
        subos_server.STORE = self.store
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), subos_server.Handler)
        self.port = int(self.httpd.server_address[1])
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        subos_server.STORE = self._old
        self.tmp.cleanup()

    @classmethod
    def tearDownClass(cls) -> None:
        _BOOT.cleanup()

    def _json(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        raw = None if body is None else json.dumps(body)
        headers = {"Content-Type": "application/json"} if body is not None else {}
        conn.request(method, path, body=raw, headers=headers)
        resp = conn.getresponse()
        payload = resp.read().decode("utf-8")
        conn.close()
        return resp.status, json.loads(payload) if payload else {}

    def test_health(self) -> None:
        status, pack = self._json("GET", "/v1/health")
        self.assertEqual(status, 200)
        self.assertTrue(pack["ok"])

    def test_demo_route_is_gone(self) -> None:
        status, pack = self._json("POST", "/v1/demo", {})
        self.assertEqual(status, 404)
        self.assertIn("找不到", pack["error"])

    def test_reminders_shape(self) -> None:
        status, pack = self._json("GET", "/v1/reminders")
        self.assertEqual(status, 200)
        self.assertIn("items", pack)
        self.assertIn("due", pack)
        self.assertIsInstance(pack["due"], list)

    def test_cards_crud(self) -> None:
        status, card = self._json(
            "POST",
            "/v1/cards",
            {
                "name": "海外订阅",
                "kind": "virtual_card",
                "issuer": "Wise",
                "card_type": "debit",
                "network": "visa",
                "last4": "8842",
                "currency": "USD",
                "status": "active",
            },
        )
        self.assertEqual(status, 201)
        self.assertEqual(card["kind"], "virtual_card")
        status, pack = self._json("GET", "/v1/cards")
        self.assertEqual(status, 200)
        self.assertEqual(pack["items"][0]["last4"], "8842")
        status, updated = self._json("PUT", f"/v1/cards/{card['id']}", {"status": "frozen"})
        self.assertEqual(status, 200)
        self.assertEqual(updated["status"], "frozen")

    def test_card_cover_resolver_rejects_local_address(self) -> None:
        status, pack = self._json(
            "POST",
            "/v1/card-cover/resolve",
            {"source_url": "https://127.0.0.1/secret.png"},
        )
        self.assertEqual(status, 400)
        self.assertIn("本机或内网", pack["error"])

    def test_card_identify_only_forwards_eight_digits(self) -> None:
        candidate = {
            "issuer": "Example Bank",
            "issuer_website": "example.com",
            "network": "visa",
            "card_type": "credit",
            "product": "Signature",
            "country": "United States",
            "country_code": "US",
            "currency": "USD",
            "source": "binlist",
            "notice": "候选",
        }
        with patch.object(subos_server, "identify_card_iin", return_value=candidate) as identify:
            status, pack = self._json("POST", "/v1/card-identify", {"iin": "42424242"})
        self.assertEqual(status, 200)
        self.assertEqual(pack["issuer"], "Example Bank")
        identify.assert_called_once_with("42424242")

    def test_card_cover_search_is_ephemeral_read_route(self) -> None:
        result = {
            "items": [
                {
                    "id": "candidate123",
                    "title": "Example Gold",
                    "image_url": "https://cdn.example/gold.jpg",
                    "thumbnail_url": "https://cdn.example/gold-small.jpg",
                    "source_page_url": "https://bank.example/cards/gold",
                    "source_host": "bank.example",
                    "official": True,
                    "width": 1015,
                    "height": 640,
                }
            ],
            "provider": "brave",
            "provider_label": "Brave Images API",
            "query": "Example Bank Gold visa bank card",
            "notice": "请核对",
        }
        payload = {
            "issuer": "Example Bank",
            "product": "Gold",
            "network": "visa",
            "issuer_website": "bank.example",
        }
        with patch.object(subos_server, "search_card_art", return_value=result) as search:
            status, pack = self._json("POST", "/v1/card-cover/search", payload)
        self.assertEqual(status, 200)
        self.assertTrue(pack["items"][0]["official"])
        search.assert_called_once_with(payload)

    def test_ai_card_status_never_returns_a_key(self) -> None:
        result = {
            "available": True,
            "provider": "openai",
            "provider_label": "OpenAI Images API",
            "model": "gpt-image-2",
            "quality": "low",
            "privacy": "脱敏参考",
            "credential_store": "macOS 钥匙串",
        }
        with patch.object(subos_server, "ai_status", return_value=result):
            status, pack = self._json("GET", "/v1/card-cover/ai-status")
        self.assertEqual(status, 200)
        self.assertTrue(pack["available"])
        self.assertNotIn("api_key", pack)

    def test_ai_card_key_and_generation_routes_delegate(self) -> None:
        status_result = {"available": True, "model": "gpt-image-2"}
        cover = {
            "cover_key": "abc123abc123abc123abc123.webp",
            "cover_src": "/card-covers/abc123abc123abc123abc123.webp",
            "cover_source_url": "https://api.openai.com/v1/images/edits",
        }
        with patch.object(subos_server, "save_openai_api_key", return_value=status_result) as save_key:
            status, pack = self._json(
                "POST", "/v1/card-cover/ai-key", {"api_key": "sk-test-key-not-real-123456"}
            )
        self.assertEqual(status, 200)
        self.assertTrue(pack["available"])
        save_key.assert_called_once_with("sk-test-key-not-real-123456")

        payload = {"reference_data_url": "data:image/png;base64,abc", "issuer": "Bank"}
        with patch.object(subos_server, "generate_card_art", return_value=cover) as generate:
            status, pack = self._json("POST", "/v1/card-cover/ai-generate", payload)
        self.assertEqual(status, 201)
        self.assertEqual(pack["cover_key"], cover["cover_key"])
        generate.assert_called_once_with(payload, subos_server.COVER_DIR)

    def test_card_identify_rejects_full_pan(self) -> None:
        status, pack = self._json(
            "POST", "/v1/card-identify", {"iin": "4242424242424242"}
        )
        self.assertEqual(status, 400)
        self.assertIn("前 8 位", pack["error"])

    def test_rejects_non_loopback(self) -> None:
        with self.assertRaises(SystemExit):
            subos_server.assert_loopback("0.0.0.0")

    def test_rejects_dns_rebinding_host_and_external_origin(self) -> None:
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", "/v1/health", headers={"Host": "evil.example"})
        response = conn.getresponse()
        self.assertEqual(response.status, 403)
        response.read()
        conn.close()

        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request(
            "GET",
            "/v1/health",
            headers={"Host": f"127.0.0.1:{self.port}", "Origin": "https://evil.example"},
        )
        response = conn.getresponse()
        self.assertEqual(response.status, 403)
        response.read()
        conn.close()

    def test_only_same_origin_or_explicit_dev_origin_can_write(self) -> None:
        for origin, content_type, expected in [
            (f"http://127.0.0.1:{self.port}", "application/json", 201),
            ("http://localhost:54321", "application/json", 403),
            (f"http://127.0.0.1:{self.port}", "text/plain", 415),
            ("null", "application/json", 403),
        ]:
            with self.subTest(origin=origin, content_type=content_type):
                conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
                conn.request("POST", "/v1/subscriptions", body=json.dumps({
                    "name": "来源检查", "website": "example.com", "cycle": "monthly",
                    "amount_yuan": "10", "next_renewal_on": "2026-09-13",
                }), headers={"Origin": origin, "Content-Type": content_type})
                response = conn.getresponse()
                self.assertEqual(response.status, expected)
                response.read()
                conn.close()

    def test_bad_cycle_http_rejects_without_persisting(self) -> None:
        status, _ = self._json("POST", "/v1/subscriptions", {
            "name": "坏周期", "website": "example.com", "cycle": "custom", "cycle_days": 10000000,
            "amount_yuan": "10", "next_renewal_on": "2026-09-13",
        })
        self.assertEqual(status, 400)
        status, result = self._json("GET", "/v1/subscriptions")
        self.assertEqual(status, 200)
        self.assertEqual(result["items"], [])

    def test_unknown_v1_get_is_json_404(self) -> None:
        status, pack = self._json("GET", "/v1/does-not-exist")
        self.assertEqual(status, 404)
        self.assertIn("找不到", pack["error"])

    def test_phone_balance_and_topup_http(self) -> None:
        status, item = self._json("POST", "/v1/subscriptions", {
            "name": "测试电话卡", "website": "phone.example.com", "category_id": "cat_phone",
            "cycle": "monthly", "amount_yuan": "30", "billing_mode": "balance",
            "next_renewal_on": (date.today() + timedelta(days=10)).isoformat(),
        })
        self.assertEqual(status, 201)
        self.assertIsNone(item["phone_balance_fen"])
        base = f"/v1/subscriptions/{item['id']}"
        status, item = self._json("POST", base + "/balance", {"balance_yuan": "20.25"})
        self.assertEqual(status, 200)
        self.assertEqual(item["phone_balance_yuan"], "20.25")
        for _ in range(2):
            status, result = self._json("POST", base + "/top-up", {"amount_yuan": "50", "request_id": "http-retry"})
            self.assertEqual(status, 200)
            self.assertEqual(result["phone_balance_yuan"], "70.25")
        status, _ = self._json("POST", base + "/top-up", {"amount_yuan": "50"})
        self.assertEqual(status, 400)
        status, result = self._json("GET", base)
        self.assertEqual(result["phone_balance_yuan"], "70.25")

    def test_phone_balance_worker_settles_without_browser_reads(self) -> None:
        item = self.store.create_subscription({
            "name": "后台测试电话卡", "website": "phone.example.com", "category_id": "cat_phone",
            "cycle": "monthly", "amount_yuan": "30", "billing_mode": "balance", "next_renewal_on": date.today().isoformat(),
        })
        with self.store.connect() as conn:
            conn.execute("UPDATE subscriptions SET phone_balance_fen = 6000 WHERE id = ?", (item["id"],))
        stopped = threading.Event()
        settle = self.store.settle_billing
        def settle_once():
            settle()
            stopped.set()
        with patch.object(self.store, "settle_billing", side_effect=settle_once):
            subos_server.settle_billing_until(stopped)
        raw = self.store._raw_subscription(item["id"])
        self.assertEqual(raw["phone_balance_fen"], 3000)
        self.assertGreater(raw["next_renewal_on"], date.today().isoformat())

    def test_all_subscription_modes_via_http(self) -> None:
        status, item = self._json("POST", "/v1/subscriptions", {
            "name": "测试软件", "website": "software.example.com", "category_id": "cat_ai",
            "cycle": "yearly", "amount_yuan": "30", "billing_mode": "balance",
            "next_renewal_on": (date.today() + timedelta(days=10)).isoformat(),
        })
        self.assertEqual(status, 201)
        base = f"/v1/subscriptions/{item['id']}"
        self.assertEqual(self._json("POST", base + "/balance", {"balance_yuan": "10"})[1]["balance_fen"], 1000)
        card = self.store.create_card({"name": "测试信用卡", "kind": "virtual_card", "issuer": "测试银行", "card_type": "credit", "network": "visa", "last4": "1234", "currency": "CNY", "status": "active"})
        status, result = self._json("PUT", base, {"billing_mode": "auto_charge", "payment_method_id": card["id"]})
        self.assertEqual(status, 200)
        self.assertTrue(result["auto_charge_ready"])
        self.assertEqual(result["balance_fen"], 1000)
        self.assertEqual(self._json("POST", base + "/top-up", {"amount_yuan": "50", "request_id": "wrong-mode"})[0], 400)
        self.assertEqual(self._json("PUT", base, {"billing_mode": "invalid"})[0], 400)
        status, result = self._json("PUT", base, {"billing_mode": "balance"})
        self.assertEqual(status, 200)
        self.assertEqual(result["balance_fen"], 1000)

    def test_auto_charge_worker_advances_without_browser_reads(self) -> None:
        card = self.store.create_card({"name": "后台信用卡", "kind": "virtual_card", "issuer": "测试银行", "card_type": "credit", "network": "visa", "last4": "1234", "currency": "CNY", "status": "active"})
        item = self.store.create_subscription({
            "name": "后台自动扣款", "website": "test.example.com", "billing_mode": "auto_charge",
            "payment_method_id": card["id"], "cycle": "monthly", "amount_yuan": "30",
            "next_renewal_on": (date.today() + timedelta(days=1)).isoformat(),
        })
        with self.store.connect() as conn:
            conn.execute("UPDATE subscriptions SET next_renewal_on = ?, phone_balance_fen = 1000 WHERE id = ?", (date.today().isoformat(), item["id"]))
        stopped = threading.Event()
        settle = self.store.settle_billing
        def settle_once():
            settle()
            stopped.set()
        with patch.object(self.store, "settle_billing", side_effect=settle_once):
            subos_server.settle_billing_until(stopped)
        result = self.store._raw_subscription(item["id"])
        self.assertGreater(result["next_renewal_on"], date.today().isoformat())
        self.assertEqual(result["phone_balance_fen"], 1000)
