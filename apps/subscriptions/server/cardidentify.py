# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 urllib 的固定 BINLIST HTTPS 查询，接收严格截断为 8 位的 IIN/BIN
[OUTPUT]: 对外提供银行卡组织的本地判定，以及发卡行、官网、卡种、产品与国家候选信息
[POS]: server 的瞬时银行卡识别边界。只处理前 8 位，不持久化、不接收完整 PAN，远端不可用时降级为本地卡组织结果
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from schema import StoreError

BINLIST_ENDPOINT = "https://lookup.binlist.net/{iin}"
MAX_RESPONSE_BYTES = 256 * 1024
IIN_PATTERN = re.compile(r"^\d{8}$")


def normalize_iin(value: Any) -> str:
    iin = str(value or "").strip()
    if not IIN_PATTERN.fullmatch(iin):
        raise StoreError("银行卡识别只接收前 8 位数字")
    return iin


def detect_network(iin: str) -> str:
    """按公开卡组织号段做本地兜底；联网结果优先。"""
    prefix2 = int(iin[:2])
    prefix3 = int(iin[:3])
    prefix4 = int(iin[:4])
    prefix6 = int(iin[:6])
    if iin.startswith("4"):
        return "visa"
    if 51 <= prefix2 <= 55 or 2221 <= prefix4 <= 2720:
        return "mastercard"
    if prefix2 in (34, 37):
        return "amex"
    if 3528 <= prefix4 <= 3589:
        return "jcb"
    if (
        iin.startswith("6011")
        or iin.startswith("65")
        or 644 <= prefix3 <= 649
        or 622126 <= prefix6 <= 622925
    ):
        return "discover"
    if iin.startswith("62"):
        return "unionpay"
    return "other"


def _network_from_provider(value: Any) -> str:
    key = str(value or "").strip().lower().replace(" ", "")
    return {
        "visa": "visa",
        "mastercard": "mastercard",
        "amex": "amex",
        "americanexpress": "amex",
        "unionpay": "unionpay",
        "chinaunionpay": "unionpay",
        "jcb": "jcb",
        "discover": "discover",
    }.get(key, "")


def _type_from_provider(value: Any) -> str:
    key = str(value or "").strip().lower()
    return {
        "credit": "credit",
        "debit": "debit",
        "prepaid": "prepaid",
    }.get(key, "")


def _clean_text(value: Any, limit: int = 120) -> str:
    return " ".join(str(value or "").split())[:limit]


def _fetch_binlist(iin: str) -> dict[str, Any]:
    request = Request(
        BINLIST_ENDPOINT.format(iin=iin),
        headers={
            "Accept": "application/json",
            "User-Agent": "SubOS/0.1 local-card-organizer",
        },
    )
    with urlopen(request, timeout=5) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("BIN 响应过大")
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("BIN 响应形状不合法")
    return data


def identify_card_iin(
    value: Any,
    fetcher: Callable[[str], dict[str, Any]] = _fetch_binlist,
) -> dict[str, Any]:
    iin = normalize_iin(value)
    local_network = detect_network(iin)
    base = {
        "issuer": "",
        "issuer_website": "",
        "network": local_network,
        "card_type": "",
        "product": "",
        "country": "",
        "country_code": "",
        "currency": "",
        "source": "local",
        "notice": "只根据前 8 位识别到卡组织；发卡行和产品请手动确认。",
    }
    try:
        data = fetcher(iin)
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError):
        return base

    bank = data.get("bank") if isinstance(data.get("bank"), dict) else {}
    country = data.get("country") if isinstance(data.get("country"), dict) else {}
    provider_network = _network_from_provider(data.get("scheme"))
    issuer = _clean_text(bank.get("name"))
    product = _clean_text(data.get("brand"))
    card_type = _type_from_provider(data.get("type"))
    return {
        "issuer": issuer,
        "issuer_website": _clean_text(bank.get("url"), 240),
        "network": provider_network or local_network,
        "card_type": card_type,
        "product": product,
        "country": _clean_text(country.get("name"), 80),
        "country_code": _clean_text(country.get("alpha2"), 2).upper(),
        "currency": _clean_text(country.get("currency"), 3).upper(),
        "source": "binlist",
        "notice": (
            "已从 BIN 数据库取得候选信息；卡产品与真实卡面仍需你确认。"
            if issuer or product
            else "BIN 数据库没有返回发卡行；已保留卡组织识别结果。"
        ),
    }
