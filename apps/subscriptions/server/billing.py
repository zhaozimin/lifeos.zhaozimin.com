# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 clock 的周期与金额算术、schema 事务和银行卡状态
[OUTPUT]: 提供余额抵扣、信用卡续期与幂等充值；方式切换保留原支付绑定
[POS]: store 的双模式计费边界；保留旧余额列与回包别名，不接入实际付款
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import sqlite3
from datetime import date
from typing import Any, Optional

from catalog import infer_category_id
from clock import advance_until_future, fen_to_yuan, parse_iso_date, parse_yuan_to_fen, shift_cycle
from schema import StoreError, now_iso, today_local, write_transaction

MAX_BALANCE_FEN = 10**14
BILLING_MODES = ("balance", "auto_charge")


def is_phone_subscription(item: dict[str, Any]) -> bool:
    return item.get("category_id") == "cat_phone" or infer_category_id(
        str(item.get("name") or ""), str(item.get("website") or "")
    ) == "cat_phone"


def auto_charge_ready(item: dict[str, Any]) -> bool:
    return (item.get("payment_method_kind") in ("physical_card", "virtual_card")
            and item.get("payment_method_card_type") == "credit"
            and item.get("payment_method_status") == "active")


def billing_fields(item: dict[str, Any]) -> dict[str, Any]:
    phone = is_phone_subscription(item)
    balance = item.get("phone_balance_fen")
    amount = int(item["amount_fen"])
    managed = item["billing_mode"] == "balance"
    low = managed and balance is not None and balance < amount
    cycles = balance // amount if managed and balance is not None and amount else None
    return {
        "is_phone": phone,
        "balance_fen": balance,
        "balance_yuan": None if balance is None else fen_to_yuan(balance),
        "balance_stopped": bool(item.get("phone_balance_stopped")),
        "balance_low": low,
        "balance_cycles": cycles,
        "auto_charge_ready": auto_charge_ready(item),
        # 旧客户端仍能读取原余额字段，存储不复制第二份余额。
        "phone_balance_yuan": None if balance is None else fen_to_yuan(balance),
        "phone_balance_stopped": bool(item.get("phone_balance_stopped")),
        "phone_balance_low": low,
        "phone_balance_months": cycles,
    }


def parse_balance(value: Any, *, positive: bool = False) -> int:
    try:
        amount = parse_yuan_to_fen(value)
    except (ValueError, TypeError) as exc:
        raise StoreError(str(exc)) from exc
    if amount > MAX_BALANCE_FEN or (positive and amount == 0):
        raise StoreError("充值金额须大于 0 且不超过一万亿元" if positive else "余额不能超过一万亿元")
    return amount


class BillingMixin:
    def _require_balance(self, item: dict[str, Any]) -> None:
        if item["billing_mode"] != "balance":
            raise StoreError("请先在设置中切换为余额式订阅")

    def _validate_billing_method(self, conn: sqlite3.Connection, data: dict[str, Any],
                                 payload: dict[str, Any], current: Optional[dict[str, Any]] = None) -> None:
        if data["billing_mode"] != "auto_charge" or not data["payment_method_id"] or "billing_mode" not in payload:
            return
        # 原支付绑定保留；不符合信用卡条件时，切换后等待重新配置。
        if current and current["payment_method_id"] == data["payment_method_id"]:
            return
        row = conn.execute("SELECT kind, card_type, status FROM payment_methods WHERE id = ?", (data["payment_method_id"],)).fetchone()
        if row is None or row["kind"] not in ("physical_card", "virtual_card") or row["card_type"] != "credit" or row["status"] != "active":
            raise StoreError("自动扣款请选择正常状态的信用卡")

    @write_transaction
    def settle_billing(self, today: Optional[date] = None) -> None:
        """按已保存的方式续期；未知余额和未绑定信用卡均不自动推进。"""
        today = today or today_local()
        with self.connect() as conn:
            rows = conn.execute(
                """SELECT s.*, p.kind AS payment_method_kind,
                   p.card_type AS payment_method_card_type, p.status AS payment_method_status
                   FROM subscriptions s LEFT JOIN payment_methods p ON p.id = s.payment_method_id
                   WHERE s.status = 'active' AND s.auto_renew = 1 AND s.next_renewal_on <= ?""",
                (today.isoformat(),),
            ).fetchall()
            for row in rows:
                item = dict(row)
                due = parse_iso_date(item["next_renewal_on"])
                anchor = item["renewal_anchor_day"] or due.day
                cycle, cycle_days = item["cycle"], item["cycle_days"]
                if item["billing_mode"] == "auto_charge":
                    if auto_charge_ready(item):
                        due = advance_until_future(due, cycle, cycle_days, today, anchor)
                        conn.execute("UPDATE subscriptions SET next_renewal_on = ?, updated_at = ? WHERE id = ?",
                                     (due.isoformat(), now_iso(), item["id"]))
                    continue
                if item["phone_balance_fen"] is None:
                    continue
                balance, fee = int(item["phone_balance_fen"]), int(item["amount_fen"])
                stopped = False
                if fee == 0:
                    due = advance_until_future(due, cycle, cycle_days, today, anchor)
                else:
                    while due <= today:
                        if balance < fee:
                            stopped = True
                            break
                        balance -= fee
                        due = shift_cycle(due, cycle, cycle_days, anchor_day=anchor)
                conn.execute(
                    """UPDATE subscriptions SET phone_balance_fen = ?, next_renewal_on = ?,
                       phone_balance_stopped = ?, status = ?, paused_on = ?,
                       paused_days_left = ?, updated_at = ? WHERE id = ?""",
                    (balance, due.isoformat(), int(stopped), "paused" if stopped else "active",
                     due.isoformat() if stopped else "", 0 if stopped else None, now_iso(), item["id"]),
                )

    def _restart_balance(self, conn: sqlite3.Connection, item: dict[str, Any], today: date) -> None:
        """重新购买一期；余额扣款与周期开始同事务提交。"""
        fee, balance = int(item["amount_fen"]), int(item["phone_balance_fen"])
        if balance < fee:
            raise StoreError("余额不足一期订阅费，请先充值")
        nxt = shift_cycle(today, item["cycle"], item["cycle_days"], anchor_day=today.day)
        conn.execute(
            """UPDATE subscriptions SET phone_balance_fen = ?, phone_balance_stopped = 0,
               status = 'active', auto_renew = 1, next_renewal_on = ?, renewal_anchor_day = ?,
               paused_on = '', paused_days_left = NULL, updated_at = ? WHERE id = ?""",
            (balance - fee, nxt.isoformat(), today.day, now_iso(), item["id"]),
        )
        conn.execute("DELETE FROM reminder_claims WHERE subscription_id = ?", (item["id"],))
        conn.execute("DELETE FROM reminder_log WHERE subscription_id = ?", (item["id"],))

    def _save_balance(self, conn: sqlite3.Connection, item: dict[str, Any], balance: int, today: date) -> None:
        self._require_balance(item)
        # 首次录入的是当前余额，不用它追扣启用前的未知历史。
        if item["phone_balance_fen"] is None and parse_iso_date(item["next_renewal_on"]) < today:
            due = advance_until_future(parse_iso_date(item["next_renewal_on"]), item["cycle"], item["cycle_days"],
                                       today, item.get("renewal_anchor_day"))
            conn.execute("UPDATE subscriptions SET next_renewal_on = ? WHERE id = ?",
                         (due.isoformat(), item["id"]))
        conn.execute("UPDATE subscriptions SET phone_balance_fen = ?, updated_at = ? WHERE id = ?",
                     (balance, now_iso(), item["id"]))
        if item["phone_balance_stopped"] and item["status"] == "paused" and item["auto_renew"] and balance >= item["amount_fen"]:
            self._restart_balance(conn, {**item, "phone_balance_fen": balance}, today)

    @write_transaction
    def set_balance(self, sub_id: str, payload: dict[str, Any], today: Optional[date] = None) -> dict[str, Any]:
        today = today or today_local()
        balance = parse_balance(payload.get("balance_yuan"))
        self.settle_billing(today)
        item = self._raw_subscription(sub_id)
        with self.connect() as conn:
            self._save_balance(conn, item, balance, today)
        return self.get_subscription(sub_id, today)

    @write_transaction
    def top_up_balance(self, sub_id: str, payload: dict[str, Any], today: Optional[date] = None) -> dict[str, Any]:
        today = today or today_local()
        amount = parse_balance(payload.get("amount_yuan"), positive=True)
        request_id = payload.get("request_id")
        if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 128:
            raise StoreError("充值请求缺少有效编号")
        self.settle_billing(today)
        item = self._raw_subscription(sub_id)
        self._require_balance(item)
        with self.connect() as conn:
            receipt = conn.execute("SELECT * FROM phone_balance_topups WHERE request_id = ?", (request_id,)).fetchone()
            if receipt:
                if receipt["subscription_id"] != sub_id or receipt["amount_fen"] != amount:
                    raise StoreError("充值请求编号已用于另一笔充值", 409)
                return self.get_subscription(sub_id, today)
            balance = int(item["phone_balance_fen"] or 0) + amount
            if balance > MAX_BALANCE_FEN:
                raise StoreError("充值后的余额不能超过一万亿元")
            self._save_balance(conn, item, balance, today)
            conn.execute("INSERT INTO phone_balance_topups VALUES (?, ?, ?)", (request_id, sub_id, amount))
        return self.get_subscription(sub_id, today)

    # Python 调用方和旧脚本保留原入口；HTTP 地址无需迁移。
    set_phone_balance = set_balance
    top_up_phone_balance = top_up_balance
    settle_phone_balances = settle_billing
