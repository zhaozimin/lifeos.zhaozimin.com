# -*- coding: utf-8 -*-
"""
[INPUT]: 加载 skill/scripts/subosctl.py，HTTP 完全替换为虚构投递批次
[OUTPUT]: CLI 文案不提前回执、凭据防覆盖、外部成功后确认与取消语义回归
[POS]: Skill 与服务端间的契约测试，不访问真实账本或消息通道
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import argparse
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("subosctl_tests", Path(__file__).resolve().parents[1] / "skill/scripts/subosctl.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
DUE = {"id": "test", "name": "测试", "wave": 7, "amount_yuan": "10", "next_renewal_on": "2026-09-13", "delivery_token": "test-token"}


class CliTests(unittest.TestCase):
    def test_printing_never_acknowledges_delivery(self):
        with patch.object(cli, "_request", return_value={"due": [DUE]}) as request, redirect_stdout(io.StringIO()) as output:
            cli.cmd_remind(argparse.Namespace(receipt_file=""))
        request.assert_called_once_with("GET", "/v1/reminders")
        self.assertIn("测试", output.getvalue())
        self.assertNotIn("test-token", output.getvalue())

    def test_receipt_must_be_new_and_ack_is_separate(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "receipt.json"
            with patch.object(cli, "_request", return_value={"due": [DUE]}) as request, redirect_stdout(io.StringIO()):
                cli.cmd_remind(argparse.Namespace(receipt_file=str(path)))
                request.assert_called_once_with("POST", "/v1/reminders/claim", {})
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                with self.assertRaises(SystemExit):
                    cli.cmd_remind(argparse.Namespace(receipt_file=str(path)))
                self.assertEqual(request.call_count, 1)
            with patch.object(cli, "_request", return_value={"accepted": 1}) as request, redirect_stdout(io.StringIO()):
                cli.cmd_ack_reminders(argparse.Namespace(receipt_file=str(path)))
                request.assert_called_once_with("POST", "/v1/reminders/ack", json.loads(path.read_text()))

    def test_cancel_preserves_date_instead_of_freezing(self):
        with patch.object(cli, "_lock_one", return_value={"id": "test"}), patch.object(cli, "_request", return_value=DUE) as request, redirect_stdout(io.StringIO()):
            cli.cmd_cancel(argparse.Namespace())
        request.assert_called_once_with("PUT", "/v1/subscriptions/test", {"status": "cancelled", "auto_renew": False})
