# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖标准库HTTPS及环境变量或macOS Keychain，接收浏览器生成的低分辨率像素化 PNG 参考；依赖 cardcovers 做图片魔数校验与内容寻址缓存
[OUTPUT]: 对外提供 AI 卡面可用状态、OpenAI API Key 安全配置、脱敏参考校验、GPT Image 单图编辑与最终卡面缓存
[POS]: server 的 AI 卡面适配边界。原始银行卡照片不进入服务端，只允许32×20 的无元数据色块参考；生成结果不含可读账户信息，正确管理字段仍由本地 UI 覆盖
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import base64
import binascii
import getpass
import json
import os
import re
import struct
import subprocess
import sys
import uuid
import zlib
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from cardcovers import MAX_IMAGE_BYTES, cache_cover, image_extension
from schema import StoreError
from cards import CARD_NETWORKS, reject_sensitive_text

OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits"
OPENAI_KEYCHAIN_SERVICE = "SubOS OpenAI API"
DEFAULT_MODEL = "gpt-image-2"
DEFAULT_QUALITY = "low"
DEFAULT_SIZE = "1536x1024"
MAX_REFERENCE_BYTES = 512 * 1024
REFERENCE_SIZE = (32, 20)
MAX_OPENAI_RESPONSE_BYTES = 16 * 1024 * 1024
DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$")


def _keychain_account() -> str:
    return getpass.getuser()


def _keychain_security_path() -> str:
    return "/usr/bin/security"


def _read_keychain_api_key() -> str:
    if sys.platform != "darwin" or not Path(_keychain_security_path()).exists():
        return ""
    try:
        result = subprocess.run(
            [
                _keychain_security_path(),
                "find-generic-password",
                "-s",
                OPENAI_KEYCHAIN_SERVICE,
                "-a",
                _keychain_account(),
                "-w",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def openai_api_key() -> str:
    return str(os.environ.get("OPENAI_API_KEY") or "").strip() or _read_keychain_api_key()


def save_openai_api_key(raw_key: Any) -> dict[str, Any]:
    key = str(raw_key or "").strip()
    if len(key) < 20 or not key.startswith("sk-") or any(char.isspace() for char in key):
        raise StoreError("OpenAI API Key 格式不正确")
    if sys.platform != "darwin" or not Path(_keychain_security_path()).exists():
        raise StoreError("当前系统不能写入 macOS 钥匙串，请改用 OPENAI_API_KEY 环境变量", 501)
    try:
        result = subprocess.run(
            [
                _keychain_security_path(),
                "add-generic-password",
                "-U",
                "-s",
                OPENAI_KEYCHAIN_SERVICE,
                "-a",
                _keychain_account(),
                "-w",
                key,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=8,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise StoreError("无法写入 macOS 钥匙串", 503) from exc
    if result.returncode != 0:
        raise StoreError("无法写入 macOS 钥匙串", 503)
    return ai_status()


def ai_status() -> dict[str, Any]:
    quality = str(os.environ.get("SUBOS_IMAGE_QUALITY") or DEFAULT_QUALITY).lower()
    if quality not in {"low", "medium", "high", "auto"}:
        quality = DEFAULT_QUALITY
    return {
        "available": bool(openai_api_key()),
        "provider": "openai",
        "provider_label": "OpenAI Images API",
        "model": str(os.environ.get("SUBOS_IMAGE_MODEL") or DEFAULT_MODEL),
        "quality": quality,
        "privacy": "原图仅在浏览器中处理；服务端只接收32×20 的无元数据色块参考。",
        "credential_store": "macOS 钥匙串或 OPENAI_API_KEY" if sys.platform == "darwin" else "VPS私有 OPENAI_API_KEY 配置",
    }


def _decode_base64_data_url(raw_value: Any, *, max_bytes: int) -> tuple[bytes, str]:
    value = str(raw_value or "").strip()
    match = DATA_URL.fullmatch(value)
    if match is None:
        raise StoreError("图片必须是 JPG、PNG 或 WebP 的 base64 数据")
    try:
        data = base64.b64decode(match.group(2), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise StoreError("图片数据损坏") from exc
    if not data or len(data) > max_bytes:
        raise StoreError("图片数据太大", 413)
    extension = image_extension(data)
    expected = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[match.group(1)]
    if extension != expected:
        raise StoreError("图片类型与内容不一致")
    return data, match.group(1)


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xffffffff)


def decode_privacy_reference(raw_value: Any) -> bytes:
    """只接受浏览器约定的 32×20 RGB/RGBA PNG，校验流并重编码，丢弃所有元数据。"""
    data, mime_type = _decode_base64_data_url(raw_value, max_bytes=MAX_REFERENCE_BYTES)
    if mime_type != "image/png":
        raise StoreError("脱敏参考必须是 PNG")
    pos, header, compressed, ended = 8, b"", bytearray(), False
    while pos + 12 <= len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        if pos + length + 12 > len(data):
            raise StoreError("PNG 数据损坏")
        crc = struct.unpack(">I", data[pos + 8 + length:pos + 12 + length])[0]
        if binascii.crc32(kind + body) & 0xffffffff != crc:
            raise StoreError("PNG 校验失败")
        if not header and kind != b"IHDR":
            raise StoreError("PNG 缺少图像头")
        if kind == b"IHDR":
            if header or len(body) != 13:
                raise StoreError("PNG 图像头损坏")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", body)
            if (width, height) != REFERENCE_SIZE:
                raise StoreError("只接收 32×20 色块参考，不接收原始卡片照片", 413)
            if depth != 8 or color not in (2, 6) or any((compression, filtering, interlace)):
                raise StoreError("脱敏参考需为非交错 RGB/RGBA PNG")
            header = body
        elif kind == b"IDAT":
            compressed.extend(body)
        elif kind == b"IEND":
            if body:
                raise StoreError("PNG 结束块损坏")
            ended = True
            break
        elif kind[0] & 32 == 0:
            raise StoreError("脱敏参考包含不支持的 PNG 数据块")
        pos += length + 12
    if not ended or not compressed:
        raise StoreError("PNG 数据不完整")
    stride = 1 + REFERENCE_SIZE[0] * (3 if header[9] == 2 else 4)
    expected = stride * REFERENCE_SIZE[1]
    try:
        decoder = zlib.decompressobj()
        pixels = decoder.decompress(bytes(compressed), expected + 1)
    except zlib.error as exc:
        raise StoreError("PNG 像素数据损坏") from exc
    if len(pixels) != expected or not decoder.eof or any(pixels[n] > 4 for n in range(0, expected, stride)):
        raise StoreError("PNG 像素长度或过滤器不合法")
    return data[:8] + _png_chunk(b"IHDR", header) + _png_chunk(b"IDAT", zlib.compress(pixels)) + _png_chunk(b"IEND", b"")


def _safe_prompt_label(value: Any, fallback: str) -> str:
    if value is None:
        return fallback
    if not isinstance(value, str) or len(value) > 80:
        raise StoreError("AI 卡面名称需为至多 80 字的文本")
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", value).strip()
    reject_sensitive_text(cleaned, outbound=True)
    return cleaned or fallback


def build_card_art_prompt(payload: dict[str, Any]) -> str:
    issuer = _safe_prompt_label(payload.get("issuer"), "the issuer")
    product = _safe_prompt_label(payload.get("product"), "this card product")
    network = _safe_prompt_label(payload.get("network"), "other")
    if network not in CARD_NETWORKS:
        raise StoreError("卡组织不在支持范围内")
    return f"""Use case: style-transfer.
Asset type: a privacy-safe digital bank-card face background for a personal wallet app.
Primary request: use the intentionally pixelated reference only for its color palette, broad geometry, material, and visual rhythm. Create an original, polished interpretation suggestive of {issuer} / {product} / {network}, without copying security features.
Composition: one flat, front-facing landscape card face filling the entire canvas; no perspective, hands, wallet, desk, scene, outer border, mockup frame, or empty margin. Reserve calm negative space for local interface labels.
Visual direction: premium real-world payment-card materials, restrained depth, precise lighting, subtle print texture, production-ready edge-to-edge artwork.
Text and identity rule: include no readable text, digits, card number, account name, date, security code, signature, barcode, QR code, magnetic stripe, watermark, bank logo, or payment-network logo. Do not invent or imitate anti-counterfeit security elements.
Reference rule: the input has already been reduced and pixelated for privacy. Never reconstruct hidden text or personal data. Preserve only non-sensitive visual design language."""


def _multipart_body(fields: dict[str, str], image: bytes) -> tuple[bytes, str]:
    boundary = f"----SubOS{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("ascii"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("ascii"),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )
    chunks.extend(
        [
            f"--{boundary}\r\n".encode("ascii"),
            b'Content-Disposition: form-data; name="image[]"; filename="privacy-reference.png"\r\n',
            b"Content-Type: image/png\r\n\r\n",
            image,
            b"\r\n",
            f"--{boundary}--\r\n".encode("ascii"),
        ]
    )
    return b"".join(chunks), boundary


def _openai_error_message(status: int, body: bytes) -> tuple[str, int]:
    code = ""
    try:
        payload = json.loads(body.decode("utf-8"))
        code = str((payload.get("error") or {}).get("code") or "")
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        pass
    if status == 401:
        return "OpenAI API Key 无效或已失效", 502
    if status == 429:
        return "AI 图像服务限流或账户余额不足，请稍后重试", 429
    if code == "moderation_blocked":
        return "这张脱敏参考未通过图像服务检查，请换一张照片或重拍", 400
    if 500 <= status:
        return "AI 图像服务暂时不可用，请稍后重试", 503
    return "AI 无法生成这张卡面，请换一张更清晰、光线更均匀的照片", 400


def generate_card_art(payload: dict[str, Any], cover_dir: Path) -> dict[str, str]:
    reference = decode_privacy_reference(payload.get("reference_data_url"))
    prompt = build_card_art_prompt(payload)
    api_key = openai_api_key()
    if not api_key:
        raise StoreError("AI 卡面尚未配置，请先在本页保存 OpenAI API Key", 503)
    status = ai_status()
    fields = {
        "model": status["model"],
        "prompt": prompt,
        "size": DEFAULT_SIZE,
        "quality": status["quality"],
        "output_format": "webp",
        "output_compression": "88",
    }
    body, boundary = _multipart_body(fields, reference)
    request = Request(
        OPENAI_IMAGE_EDIT_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
            "User-Agent": "SubOS/0.3 ai-card-art",
        },
    )
    try:
        with urlopen(request, timeout=150) as response:
            raw = response.read(MAX_OPENAI_RESPONSE_BYTES + 1)
    except HTTPError as exc:
        error_body = exc.read(256 * 1024)
        message, status_code = _openai_error_message(exc.code, error_body)
        raise StoreError(message, status_code) from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise StoreError("AI 图像服务连接失败，请稍后重试", 503) from exc
    if len(raw) > MAX_OPENAI_RESPONSE_BYTES:
        raise StoreError("AI 返回的图片过大", 502)
    try:
        response_payload = json.loads(raw.decode("utf-8"))
        encoded = str(response_payload["data"][0]["b64_json"])
        generated = base64.b64decode(encoded, validate=True)
    except (KeyError, IndexError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError, binascii.Error) as exc:
        raise StoreError("AI 图像服务返回了无法读取的结果", 502) from exc
    if not generated or len(generated) > MAX_IMAGE_BYTES:
        raise StoreError("AI 返回的卡面超过 5MB", 502)
    filename = cache_cover(generated, cover_dir)
    return {
        "cover_key": filename,
        "cover_src": f"/card-covers/{filename}",
        "cover_source_url": OPENAI_IMAGE_EDIT_URL,
    }
