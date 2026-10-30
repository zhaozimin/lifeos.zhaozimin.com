# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖固定 Brave Images / DuckDuckGo Images 端点，接收发卡行、产品、卡组织、官网与用户关键词
[OUTPUT]: 对外提供不落库的卡面图片候选、官网命中标记与搜索来源；只返回公网 HTTPS 图片和来源页
[POS]: server 的卡面发现边界。BIN 识别只负责缩小关键词，本模块不接收或推导完整 PAN；选中后的安全下载仍交给 cardcovers
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
from typing import Any, Callable
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from schema import StoreError

BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/images/search"
DUCKDUCKGO_HOME = "https://duckduckgo.com/"
DUCKDUCKGO_IMAGES = "https://duckduckgo.com/i.js"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_CANDIDATES = 8
PAN_LIKE = re.compile(r"(?:\d[\s-]?){8,}")
VQD_PATTERNS = (
    re.compile(r'vqd=["\']([\d-]+)["\']'),
    re.compile(r'vqd="([\d-]+)"'),
    re.compile(r"vqd='([\d-]+)'"),
)


def _clean_term(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())[:limit]
    if PAN_LIKE.search(text):
        raise StoreError("卡面搜索不接收银行卡号，只能使用发卡行、产品名或关键词")
    return text


def _https_url(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) > 2048:
        return ""
    parsed = urlparse(text)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        return ""
    if parsed.username or parsed.password:
        return ""
    host = parsed.hostname.lower().strip(".")
    if host == "localhost" or host.endswith((".localhost", ".local")):
        return ""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return text
    return "" if ip.is_private or ip.is_loopback or ip.is_reserved else text


def _website_host(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if "://" not in text:
        text = f"https://{text}"
    parsed = urlparse(text)
    host = (parsed.hostname or "").lower().strip(".")
    if not host or host == "localhost":
        return ""
    try:
        ipaddress.ip_address(host)
        return ""
    except ValueError:
        return host[4:] if host.startswith("www.") else host


def _read_url(url: str, headers: dict[str, str]) -> bytes:
    request = Request(url, headers=headers)
    with urlopen(request, timeout=8) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("卡面搜索响应过大")
    return raw


def _search_brave(query: str, api_key: str) -> list[dict[str, Any]]:
    url = f"{BRAVE_ENDPOINT}?{urlencode({'q': query, 'count': 20, 'safesearch': 'strict'})}"
    raw = _read_url(
        url,
        {
            "Accept": "application/json",
            "X-Subscription-Token": api_key,
            "User-Agent": "SubOS/0.1 local-card-organizer",
        },
    )
    data = json.loads(raw.decode("utf-8"))
    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list):
        raise ValueError("Brave Images 响应形状不合法")
    shaped: list[dict[str, Any]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        thumbnail = item.get("thumbnail")
        thumbnail_url = thumbnail.get("src") if isinstance(thumbnail, dict) else thumbnail
        properties = item.get("properties") if isinstance(item.get("properties"), dict) else {}
        shaped.append(
            {
                "image_url": properties.get("url") or item.get("url"),
                "thumbnail_url": thumbnail_url,
                "source_page_url": item.get("url"),
                "title": item.get("title"),
                "width": properties.get("width") or item.get("width"),
                "height": properties.get("height") or item.get("height"),
            }
        )
    return shaped


def _extract_vqd(html: str) -> str:
    for pattern in VQD_PATTERNS:
        match = pattern.search(html)
        if match:
            return match.group(1)
    raise ValueError("DuckDuckGo 没有返回图片搜索令牌")


def _search_duckduckgo(query: str) -> list[dict[str, Any]]:
    user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SubOS/0.1"
    home_url = f"{DUCKDUCKGO_HOME}?{urlencode({'q': query, 'iax': 'images', 'ia': 'images'})}"
    html = _read_url(home_url, {"User-Agent": user_agent}).decode("utf-8", "replace")
    token = _extract_vqd(html)
    image_url = f"{DUCKDUCKGO_IMAGES}?{urlencode({'l': 'us-en', 'o': 'json', 'q': query, 'vqd': token, 'f': ',,,', 'p': '1'})}"
    raw = _read_url(
        image_url,
        {
            "Accept": "application/json",
            "Referer": home_url,
            "User-Agent": user_agent,
        },
    )
    data = json.loads(raw.decode("utf-8"))
    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list):
        raise ValueError("DuckDuckGo Images 响应形状不合法")
    return [
        {
            "image_url": item.get("image"),
            "thumbnail_url": item.get("thumbnail"),
            "source_page_url": item.get("url"),
            "title": item.get("title"),
            "width": item.get("width"),
            "height": item.get("height"),
        }
        for item in results
        if isinstance(item, dict)
    ]


def _number(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return number if 0 < number < 100_000 else 0


def _same_site(host: str, official_host: str) -> bool:
    return bool(
        host
        and official_host
        and (host == official_host or host.endswith(f".{official_host}"))
    )


def rank_candidates(
    raw_items: list[dict[str, Any]],
    official_host: str,
    search_terms: list[str],
) -> list[dict[str, Any]]:
    """清洗、去重与排序；不替用户断言某张图就是精确卡面。"""
    unique: dict[str, tuple[int, dict[str, Any]]] = {}
    tokens = [token.lower() for term in search_terms for token in term.split() if len(token) > 1]
    for item in raw_items:
        image_url = _https_url(item.get("image_url"))
        if not image_url or image_url in unique:
            continue
        thumbnail_url = _https_url(item.get("thumbnail_url")) or image_url
        source_page_url = _https_url(item.get("source_page_url"))
        image_host = (urlparse(image_url).hostname or "").lower()
        source_host = (urlparse(source_page_url).hostname or image_host).lower()
        shown_host = source_host[4:] if source_host.startswith("www.") else source_host
        official = _same_site(shown_host, official_host) or _same_site(image_host, official_host)
        title = " ".join(str(item.get("title") or "银行卡卡面").split())[:180]
        width = _number(item.get("width"))
        height = _number(item.get("height"))
        haystack = f"{title} {source_host}".lower()
        score = 100 if official else 0
        score += min(24, sum(6 for token in tokens if token in haystack))
        if width and height:
            ratio_gap = abs((width / height) - 1.586)
            score += 24 if ratio_gap <= 0.16 else 12 if ratio_gap <= 0.36 else 0
            if width < 300 or height < 160:
                score -= 18
        if re.search(r"\b(card|credit|debit|visa|mastercard)\b|银行卡|信用卡|借记卡", haystack):
            score += 8
        if re.search(r"\b(logo|icon|wallpaper|banner)\b|图标|壁纸|海报", haystack):
            score -= 20
        candidate = {
            "id": hashlib.sha256(image_url.encode("utf-8")).hexdigest()[:12],
            "title": title,
            "image_url": image_url,
            "thumbnail_url": thumbnail_url,
            "source_page_url": source_page_url,
            "source_host": shown_host,
            "official": official,
            "width": width,
            "height": height,
        }
        unique[image_url] = (score, candidate)
    ranked = sorted(unique.values(), key=lambda pair: pair[0], reverse=True)
    return [candidate for _, candidate in ranked[:MAX_CANDIDATES]]


def search_card_art(
    payload: dict[str, Any],
    brave_search: Callable[[str, str], list[dict[str, Any]]] = _search_brave,
    duckduckgo_search: Callable[[str], list[dict[str, Any]]] = _search_duckduckgo,
) -> dict[str, Any]:
    issuer = _clean_term(payload.get("issuer"), 100)
    product = _clean_term(payload.get("product"), 140)
    network = _clean_term(payload.get("network"), 30)
    keywords = _clean_term(payload.get("keywords"), 140)
    issuer_website = _clean_term(payload.get("issuer_website"), 300)
    terms = [term for term in (issuer, product, network, keywords) if term]
    if not terms:
        raise StoreError("请先填写发卡行、卡片名称或卡面关键词")
    official_host = _website_host(issuer_website)
    query_terms = [*terms, "bank card"]
    if official_host:
        query_terms.insert(0, f"site:{official_host}")
    query = " ".join(dict.fromkeys(query_terms)).strip()
    brave_key = os.environ.get("SUBOS_BRAVE_SEARCH_API_KEY", "").strip()
    try:
        if brave_key:
            raw_items = brave_search(query, brave_key)
            provider = "brave"
            provider_label = "Brave Images API"
        else:
            raw_items = duckduckgo_search(query)
            provider = "duckduckgo"
            provider_label = "DuckDuckGo Images"
    except (OSError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        raise StoreError("卡面搜索暂时不可用，请稍后重试或粘贴官网卡片页", 502) from exc
    candidates = rank_candidates(raw_items, official_host, terms)
    return {
        "items": candidates,
        "provider": provider,
        "provider_label": provider_label,
        "query": query,
        "notice": (
            "候选图来自公开图片搜索；官网标记只表示来源域名匹配，仍需你核对卡面版本。"
            if candidates
            else "没有找到可靠候选；请补充卡片全名，或粘贴发卡行官网卡片页。"
        ),
    }
