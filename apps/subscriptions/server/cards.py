# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 schema 的连接、写锁与编号，复用 payment_methods 作订阅的支付引用
[OUTPUT]: 对外提供实体卡/虚拟卡的列表、读写、严格安全校验与订阅占用数
[POS]: server 的银行卡资产边界。只存尾号和管理元数据，拒绝完整卡号、CVV/CVC、PIN 与密码
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any
from urllib.parse import urlparse

from schema import write_transaction, StoreError, new_id, now_iso

CARD_KINDS = frozenset({"physical_card", "virtual_card"})
CARD_TYPES = frozenset({"credit", "debit", "prepaid"})
CARD_STATUSES = frozenset({"active", "frozen", "closed"})
CARD_NETWORKS = frozenset({"unionpay", "visa", "mastercard", "amex", "jcb", "discover", "other"})
FORBIDDEN_FIELDS = frozenset(
    {"card_number", "full_card_number", "pan", "cvv", "cvc", "cid", "pin", "password"}
)
LONG_DIGIT_RUN = re.compile(r"\d{12,}")
SENSITIVE_WORDS = re.compile(r"\b(?:cvv|cvc|cid|pin|password|passwd)\b|卡密|支付密码|验证码", re.I)
USER_TEXT_FIELDS = ("name", "issuer", "note")
EXPIRY_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
COVER_KEY = re.compile(r"^[a-f0-9]{24}\.(?:jpg|png|webp)$")


def _text(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise StoreError(f"{key} 必须是文本")
    if len(value) > (2000 if key in {"note", "cover_source_url"} else 200):
        raise StoreError(f"{key} 太长")
    return value.strip()


def _optional_day(payload: dict[str, Any], key: str) -> int | None:
    raw = payload.get(key)
    if raw is None or str(raw).strip() == "":
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise StoreError("账单日和还款日要填 1–31") from exc
    if value < 1 or value > 31:
        raise StoreError("账单日和还款日要填 1–31")
    return value


def _reject_secrets(payload: dict[str, Any]) -> None:
    for key in FORBIDDEN_FIELDS:
        if payload.get(key) not in (None, ""):
            raise StoreError("不保存完整卡号、CVV/CVC、PIN 或密码")
    for key in USER_TEXT_FIELDS:
        value = _text(payload, key)
        reject_sensitive_text(value)


def reject_sensitive_text(value: str, *, outbound: bool = False) -> None:
    """只检查用户文本；出站文本连 BIN 也拒绝，系统哈希不走启发式判断。"""
    compact = re.sub(r"[\s\-]+", "", value)
    pattern = re.compile(r"\d{8,}") if outbound else LONG_DIGIT_RUN
    if pattern.search(compact):
        raise StoreError("检测到可能的卡号或 BIN，请移除号码，只在尾号栏保留末 4 位")
    if SENSITIVE_WORDS.search(value):
        raise StoreError("不要填写安全码、PIN、卡密、密码或验证码")


def normalize_card(payload: dict[str, Any]) -> dict[str, Any]:
    _reject_secrets(payload)
    name = _text(payload, "name")
    issuer = _text(payload, "issuer")
    kind = _text(payload, "kind")
    card_type = _text(payload, "card_type")
    network = _text(payload, "network")
    last4 = _text(payload, "last4")
    currency = (_text(payload, "currency") or "CNY").upper()
    expiry_month = _text(payload, "expiry_month")
    status = _text(payload, "status") or "active"
    cover_key = _text(payload, "cover_key")
    cover_source_url = _text(payload, "cover_source_url")
    if not name:
        raise StoreError("银行卡名称不能为空")
    if not issuer:
        raise StoreError("发卡机构不能为空")
    if kind not in CARD_KINDS:
        raise StoreError("卡片形态只能是实体卡或虚拟卡")
    if card_type not in CARD_TYPES:
        raise StoreError("卡片类型只能是信用卡、借记卡或预付卡")
    if network not in CARD_NETWORKS:
        raise StoreError("卡组织不在支持范围内")
    if not re.fullmatch(r"\d{4}", last4):
        raise StoreError("只填卡号末 4 位")
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise StoreError("结算币种请用 3 位代码，例如 CNY 或 USD")
    if expiry_month and not EXPIRY_MONTH.fullmatch(expiry_month):
        raise StoreError("有效期请用 YYYY-MM")
    if cover_key and not COVER_KEY.fullmatch(cover_key):
        raise StoreError("卡面编号不合法")
    if cover_source_url:
        parsed_cover = urlparse(cover_source_url)
        if parsed_cover.scheme != "https" or not parsed_cover.hostname:
            raise StoreError("卡面来源必须是 HTTPS 公网地址")
    billing_day = _optional_day(payload, "billing_day")
    payment_due_day = _optional_day(payload, "payment_due_day")
    if card_type != "credit":
        billing_day = None
        payment_due_day = None
    return {
        "name": name,
        "kind": kind,
        "account": f"尾号 {last4}",
        "issuer": issuer,
        "card_type": card_type,
        "network": network,
        "last4": last4,
        "currency": currency,
        "expiry_month": expiry_month,
        "billing_day": billing_day,
        "payment_due_day": payment_due_day,
        "status": status if status in CARD_STATUSES else "",
        "cover_key": cover_key,
        "cover_source_url": cover_source_url,
        "note": _text(payload, "note"),
    }


def shape_card(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    return {
        "id": item["id"],
        "name": item["name"],
        "kind": item["kind"],
        "issuer": item["issuer"],
        "card_type": item["card_type"],
        "network": item["network"],
        "last4": item["last4"],
        "currency": item["currency"],
        "expiry_month": item["expiry_month"],
        "billing_day": item["billing_day"],
        "payment_due_day": item["payment_due_day"],
        "status": item["status"],
        "cover_key": item.get("cover_key") or "",
        "cover_src": f"/card-covers/{item['cover_key']}" if item.get("cover_key") else "",
        "cover_source_url": item.get("cover_source_url") or "",
        "note": item.get("note") or "",
        "subscription_count": int(item.get("subscription_count") or 0),
    }


class CardMixin:
    def list_cards(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT p.*, COUNT(s.id) AS subscription_count
                FROM payment_methods p
                LEFT JOIN subscriptions s ON s.payment_method_id = p.id
                WHERE p.kind IN ('physical_card', 'virtual_card')
                GROUP BY p.id
                ORDER BY
                    CASE p.status WHEN 'active' THEN 0 WHEN 'frozen' THEN 1 ELSE 2 END,
                    CASE p.kind WHEN 'physical_card' THEN 0 ELSE 1 END,
                    p.issuer ASC, p.name ASC
                """
            ).fetchall()
        return [shape_card(row) for row in rows]

    def get_card(self, card_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT p.*, COUNT(s.id) AS subscription_count
                FROM payment_methods p
                LEFT JOIN subscriptions s ON s.payment_method_id = p.id
                WHERE p.id = ? AND p.kind IN ('physical_card', 'virtual_card')
                GROUP BY p.id
                """,
                (card_id,),
            ).fetchone()
        if row is None:
            raise StoreError("找不到这张银行卡", 404)
        return shape_card(row)

    @write_transaction
    def create_card(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = normalize_card(payload)
        if not data["status"]:
            raise StoreError("卡片状态不合法")
        card_id = new_id("card")
        with self.connect() as conn:
            duplicate = conn.execute(
                """
                SELECT id FROM payment_methods
                WHERE kind IN ('physical_card', 'virtual_card')
                  AND issuer = ? AND last4 = ? AND status != 'closed'
                """,
                (data["issuer"], data["last4"]),
            ).fetchone()
            if duplicate and data["status"] != "closed":
                raise StoreError("这家机构已有一张相同尾号的未注销卡")
            conn.execute(
                """
                INSERT INTO payment_methods (
                    id, name, kind, account, issuer, card_type, network, last4,
                    currency, expiry_month, billing_day, payment_due_day,
                    status, cover_key, cover_source_url, note, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    card_id,
                    data["name"],
                    data["kind"],
                    data["account"],
                    data["issuer"],
                    data["card_type"],
                    data["network"],
                    data["last4"],
                    data["currency"],
                    data["expiry_month"],
                    data["billing_day"],
                    data["payment_due_day"],
                    data["status"],
                    data["cover_key"],
                    data["cover_source_url"],
                    data["note"],
                    now_iso(),
                ),
            )
        return self.get_card(card_id)

    @write_transaction
    def update_card(self, card_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        current = self.get_card(card_id)
        data = normalize_card({**current, **payload})
        if not data["status"]:
            raise StoreError("卡片状态不合法")
        with self.connect() as conn:
            duplicate = conn.execute(
                """
                SELECT id FROM payment_methods
                WHERE kind IN ('physical_card', 'virtual_card')
                  AND issuer = ? AND last4 = ? AND status != 'closed' AND id != ?
                """,
                (data["issuer"], data["last4"], card_id),
            ).fetchone()
            if duplicate and data["status"] != "closed":
                raise StoreError("这家机构已有一张相同尾号的未注销卡")
            conn.execute(
                """
                UPDATE payment_methods SET
                    name = ?, kind = ?, account = ?, issuer = ?, card_type = ?,
                    network = ?, last4 = ?, currency = ?, expiry_month = ?,
                    billing_day = ?, payment_due_day = ?, status = ?,
                    cover_key = ?, cover_source_url = ?, note = ?
                WHERE id = ?
                """,
                (
                    data["name"],
                    data["kind"],
                    data["account"],
                    data["issuer"],
                    data["card_type"],
                    data["network"],
                    data["last4"],
                    data["currency"],
                    data["expiry_month"],
                    data["billing_day"],
                    data["payment_due_day"],
                    data["status"],
                    data["cover_key"],
                    data["cover_source_url"],
                    data["note"],
                    card_id,
                ),
            )
        return self.get_card(card_id)
