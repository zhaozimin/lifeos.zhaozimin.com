# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 aicardart 的脱敏尺寸门、提示词、multipart 编码、Keychain 适配与内容寻址写入，依赖临时目录和 mock
[OUTPUT]: 对外提供 AI 卡面隐私边界、密钥不回显、请求结构与生成结果缓存的离线回归
[POS]: server 的 AI 卡面安全单元测试；不访问真实 OpenAI，不读取或改写本机钥匙串
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import base64
import json
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import MagicMock, patch

import aicardart
from schema import StoreError


def png_data_url(width: int = 32, height: int = 20) -> str:
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    pixels = (b"\0" + b"\x80\x90\xa0" * width) * height
    data = b"\x89PNG\r\n\x1a\n" + aicardart._png_chunk(b"IHDR", header)
    data += aicardart._png_chunk(b"IDAT", zlib.compress(pixels)) + aicardart._png_chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


class AiCardArtTests(unittest.TestCase):
    def test_accepts_only_small_png_privacy_reference(self) -> None:
        self.assertTrue(aicardart.decode_privacy_reference(png_data_url()).startswith(b"\x89PNG"))
        with self.assertRaises(StoreError):
            aicardart.decode_privacy_reference(png_data_url(1024, 640))

    def test_prompt_forbids_reconstructing_sensitive_text(self) -> None:
        prompt = aicardart.build_card_art_prompt(
            {"issuer": "Example\nBank", "product": "Gold", "network": "visa"}
        )
        self.assertIn("Never reconstruct hidden text", prompt)
        self.assertIn("Example Bank", prompt)
        self.assertNotIn("Example\nBank", prompt)

    def test_multipart_contains_reference_and_fixed_fields(self) -> None:
        body, boundary = aicardart._multipart_body(
            {"model": "gpt-image-2", "quality": "low"}, b"\x89PNG\r\n\x1a\nreference"
        )
        self.assertIn(f"--{boundary}".encode("ascii"), body)
        self.assertIn(b'name="image[]"', body)
        self.assertIn(b"gpt-image-2", body)

    @patch("aicardart.cache_cover", return_value="abc123abc123abc123abc123.webp")
    @patch("aicardart.urlopen")
    @patch("aicardart.openai_api_key", return_value="sk-test-key-not-real-123456")
    def test_generation_caches_only_openai_output(self, _key, open_url, cache) -> None:
        generated = b"RIFF\x08\x00\x00\x00WEBPgenerated"
        response = MagicMock()
        response.read.return_value = json.dumps(
            {"data": [{"b64_json": base64.b64encode(generated).decode("ascii")}]}
        ).encode("utf-8")
        open_url.return_value.__enter__.return_value = response
        with tempfile.TemporaryDirectory() as tmp:
            result = aicardart.generate_card_art(
                {
                    "reference_data_url": png_data_url(),
                    "issuer": "Example Bank",
                    "product": "Gold",
                    "network": "visa",
                },
                Path(tmp),
            )
        cache.assert_called_once_with(generated, Path(tmp))
        self.assertEqual(result["cover_source_url"], aicardart.OPENAI_IMAGE_EDIT_URL)
        request = open_url.call_args.args[0]
        self.assertNotIn("sk-test-key-not-real-123456", request.data.decode("latin1"))

    @patch("aicardart.ai_status", return_value={"available": True})
    @patch("aicardart.subprocess.run")
    def test_key_is_written_to_keychain_but_never_returned(self, run, _status) -> None:
        run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        with patch("aicardart.sys.platform", "darwin"), patch.object(Path, "exists", return_value=True):
            result = aicardart.save_openai_api_key("sk-test-key-not-real-123456")
        self.assertEqual(result, {"available": True})
        self.assertNotIn("sk-test-key", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
