#!/usr/bin/env python3
# [INPUT]: 临时Git仓库、合成凭据与合成生产样本。
# [OUTPUT]: 未跟踪、暂存、历史和文档分发边界的回归证据。
# [POS]: 发布守卫的隔离验收；不读取真实账本或连接云端。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import contextlib
import importlib.util
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("public_repo", Path(__file__).with_name("check-public-repo.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class PublicRepoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Synthetic")
        self.git("config", "user.email", "synthetic@example.com")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, stderr=subprocess.PIPE)

    def scan(self, *args):
        output = io.StringIO()
        with patch.object(checker, "ROOT", self.root), patch.object(sys, "argv", ["check-public-repo.py", *args]):
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                result = checker.main()
        return result, output.getvalue()

    def test_untracked_document_is_checked_without_printing_sample(self):
        (self.root / "docs").mkdir()
        (self.root / "docs/evidence.md").write_text("真实午饭支出为 CNY 1234 分。\n")
        result, output = self.scan()
        self.assertEqual(result, 1)
        self.assertIn("private-production-evidence: docs/evidence.md", output)
        self.assertNotIn("1234", output)

    def test_ignored_private_config_is_not_read(self):
        (self.root / ".gitignore").write_text(".env\n.private/\n")
        (self.root / ".env").write_text("PRIVATE_SYNTHETIC_VALUE=never-publish\n")
        self.assertEqual(self.scan()[0], 0)

    def test_staged_private_file_is_checked_after_working_copy_is_deleted(self):
        target = self.root / ".env"
        target.write_text("SYNTHETIC=never-publish\n")
        self.git("add", ".env")
        target.unlink()
        result, output = self.scan()
        self.assertEqual(result, 1)
        self.assertIn("private-file: .env", output)
        self.assertNotIn("never-publish", output)

    def test_staged_secret_is_checked_after_working_copy_is_fixed(self):
        target = self.root / "config.txt"
        target.write_text("sb_secret_" + "Z" * 24)
        self.git("add", "config.txt")
        target.write_text("SUPABASE_SERVICE_ROLE_KEY=\n")
        self.assertIn("supabase-secret: config.txt", self.scan()[1])

    def test_deleted_historical_private_file_is_checked(self):
        target = self.root / ".env"
        target.write_text("SYNTHETIC=never-publish\n")
        self.git("add", ".env")
        self.git("commit", "-qm", "synthetic private fixture")
        self.git("rm", "-q", ".env")
        self.git("commit", "-qm", "remove fixture")
        self.assertEqual(self.scan()[0], 0)
        self.assertIn("private-file: .env", self.scan("--history")[1])

    def test_product_examples_and_brand_links_remain_allowed(self):
        data = "示例：午饭12元。\nhttps://lifeos.zhaozimin.com\n".encode()
        self.assertEqual(checker.inspect("docs/example.md", data), [])


if __name__ == "__main__":
    unittest.main()
