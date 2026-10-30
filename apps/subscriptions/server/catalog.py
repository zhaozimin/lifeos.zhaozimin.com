# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖网址字符串，不读库
[OUTPUT]: 对外提供默认分类、App Store trackId、兜底品牌标。弱手填（预览图/favicon）让位给商店方图
演示账号使用保留域名，不复制真实账号。
[POS]: server 的目录常识，store 迁移与水合调用这里
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

from datetime import date, timedelta
from urllib.parse import urlparse

# 稳定 id，迁移与前端都认这批。用户可再加自定义分类。
BUILTIN_CATEGORIES = (
    {"id": "cat_ai", "name": "AI", "sort_order": 10},
    {"id": "cat_phone", "name": "话费", "sort_order": 20},
    {"id": "cat_network", "name": "网络", "sort_order": 30},
    {"id": "cat_cloud", "name": "云存储", "sort_order": 40},
    {"id": "cat_media", "name": "娱乐", "sort_order": 50},
    {"id": "cat_tools", "name": "效率", "sort_order": 60},
    {"id": "cat_other", "name": "其他", "sort_order": 90},
)

DEFAULT_CATEGORY_ID = "cat_other"

_AI = ("openai", "chatgpt", "cursor", "claude", "anthropic", "gemini", "grok", "x.ai", "midjourney", "notion.ai")
_PHONE = ("10086", "10010", "10000", "移动", "联通", "广电", "话费", "手机套餐", "流量卡", "tello", "mtn")
_NET = (
    "189.cn", "宽带", "电信", "联通宽带", "网络", "wifi", "光猫",
    "vps", "搬瓦工", "bandwagon", "dmit", "contabo", "webshare", "vircs",
    "住宅", "cloudflare", "阿里云", "aliyun.com",
)
_CLOUD = ("icloud", "dropbox", "drive.google", "onedrive", "aliyun", "oss", "云盘", "cloud")
_MEDIA = ("youtube", "netflix", "spotify", "bilibili", "iqiyi", "youku", "爱奇艺", "腾讯视频", "apple music", "clash of clans")
_TOOLS = ("notion.so", "github", "figma", "dropbox", "adobe", "microsoft 365", "whoop")


def host_of(website: str) -> str:
    try:
        host = (urlparse(website).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


# 已用 iTunes Lookup 核对过的官方 App。圆角/阴影由前端套，这里只给 trackId。
HOST_APPSTORE = {
    "chatgpt.com": 6448311069,
    "openai.com": 6448311069,
    "claude.ai": 6473753684,
    "anthropic.com": 6473753684,
    "gemini.google.com": 6477489729,
    "github.com": 1477376905,
    "perplexity.ai": 1668000334,
    "notion.so": 1232780281,
    "x.ai": 6670324846,
    "cursor.com": 6767085653,
    "10086.cn": 583700738,
    "189.cn": 513836029,
    "music.apple.com": 1108187390,
    "supercell.com": 529479190,
    "aliyun.com": 981011420,
}

# 没有官方 iOS App 的服务：仍用品牌标兜底。Midjourney / iCloud+ 商店里没有对应条目。
_LOBE = "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@latest/light"
_SI = "https://cdn.simpleicons.org"
HOST_ICONS = {
    "midjourney.com": f"{_LOBE}/midjourney.png",
    "icloud.com": f"{_SI}/icloud",
    "apple.com": f"{_LOBE}/apple.png",
    "cloudflare.com": f"{_SI}/cloudflare",
}

_WEAK_CUSTOM = (
    "placeholder.mill",
    "google.com/s2/favicons",
)


def known_track_ids() -> list[int]:
    return sorted(set(HOST_APPSTORE.values()))


def _canonical_host(host: str) -> str:
    if host in HOST_APPSTORE or host in HOST_ICONS:
        return host
    parts = host.split(".")
    while len(parts) > 2:
        parts = parts[1:]
        candidate = ".".join(parts)
        if candidate in HOST_APPSTORE or candidate in HOST_ICONS:
            return candidate
    return host


def _weak_custom(url: str) -> bool:
    lowered = url.lower()
    return any(marker in lowered for marker in _WEAK_CUSTOM)


def logo_src(website: str, logo_url: str = "") -> str:
    """手填优先，但商店预览图和 Google favicon 不算手填。有商店条目走本地方图。"""
    custom = (logo_url or "").strip()
    host = _canonical_host(host_of(website))
    if custom and not _weak_custom(custom):
        return custom
    if host in HOST_APPSTORE:
        return f"/icons/{HOST_APPSTORE[host]}.jpg"
    if host in HOST_ICONS:
        return HOST_ICONS[host]
    if custom:
        return custom
    if not host:
        return ""
    return f"https://www.google.com/s2/favicons?domain={host}&sz=128"


def infer_category_id(name: str, website: str) -> str:
    blob = f"{name} {website}".lower()
    if any(key in blob for key in _AI):
        return "cat_ai"
    if any(key in blob for key in _PHONE):
        return "cat_phone"
    if any(key in blob for key in _NET):
        return "cat_network"
    if any(key in blob for key in _CLOUD):
        return "cat_cloud"
    if any(key in blob for key in _MEDIA):
        return "cat_media"
    if any(key in blob for key in _TOOLS):
        return "cat_tools"
    return DEFAULT_CATEGORY_ID


def demo_specs(today: date) -> list[dict]:
    """AI 九条铺满三排，其余分类各留一条。天数覆盖绿 / 黄 / 红 / 到期。"""

    def on(delta: int) -> str:
        return (today + timedelta(days=delta)).isoformat()

    return [
        {"name": "ChatGPT Plus", "website": "https://chatgpt.com", "amount_yuan": "140", "next_renewal_on": on(22), "category_id": "cat_ai", "email": "gpt@example.com"},
        {"name": "Claude Pro", "website": "https://claude.ai", "amount_yuan": "160", "next_renewal_on": on(20), "category_id": "cat_ai", "email": "claude@example.com"},
        {"name": "Gemini Advanced", "website": "https://gemini.google.com", "amount_yuan": "138", "next_renewal_on": on(18), "category_id": "cat_ai", "email": "gemini@example.com"},
        {"name": "Midjourney", "website": "https://www.midjourney.com", "amount_yuan": "80", "next_renewal_on": on(14), "category_id": "cat_ai", "email": "mj@example.com"},
        {"name": "GitHub Copilot", "website": "https://github.com/features/copilot", "amount_yuan": "70", "next_renewal_on": on(12), "category_id": "cat_ai", "email": "copilot@example.com"},
        {"name": "Perplexity Pro", "website": "https://www.perplexity.ai", "amount_yuan": "140", "next_renewal_on": on(9), "category_id": "cat_ai", "email": "pplx@example.com"},
        {"name": "Notion AI", "website": "https://www.notion.so", "amount_yuan": "80", "next_renewal_on": on(6), "category_id": "cat_ai", "email": "notion@example.com"},
        {"name": "Grok", "website": "https://x.ai", "amount_yuan": "70", "next_renewal_on": on(3), "category_id": "cat_ai", "email": "grok@example.com"},
        {"name": "Cursor Pro", "website": "https://cursor.com", "amount_yuan": "140", "next_renewal_on": on(-2), "category_id": "cat_ai", "email": "cursor@example.com"},
        {"name": "中国移动", "website": "https://www.10086.cn", "amount_yuan": "58", "next_renewal_on": on(5), "category_id": "cat_phone", "email": "mobile@example.com"},
        {"name": "中国电信宽带", "website": "https://www.189.cn", "amount_yuan": "129", "next_renewal_on": on(11), "category_id": "cat_network", "email": "net@example.com"},
        {"name": "iCloud+", "website": "https://www.icloud.com", "amount_yuan": "21", "next_renewal_on": on(14), "category_id": "cat_cloud", "email": "icloud@example.com"},
    ]
