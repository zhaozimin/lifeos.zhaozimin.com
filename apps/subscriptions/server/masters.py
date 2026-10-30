# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 schema 的连接、锁与编号
[OUTPUT]: 提供分类、支付方式与账号读写；支付方式携带卡类型供自动扣款绑定
[POS]: store 的主数据侧。银行卡结构化写路径在 cards，订阅写路径在 store
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import sqlite3
from typing import Any

from schema import write_transaction, StoreError, new_id, now_iso


def shape_payment_method(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    account = str(item.get("account") or item.get("last4") or "").strip()
    return {
        "id": item["id"],
        "name": item["name"],
        "kind": item.get("kind") or "other",
        "card_type": item.get("card_type") or "",
        "account": account,
        "status": item.get("status") or "active",
        "note": item.get("note") or "",
    }


def normalize_payment_method(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise StoreError("支付方式名称不能为空")
    account = str(payload.get("account") or payload.get("last4") or "").strip()
    return {
        "name": name,
        "account": account,
        "note": str(payload.get("note") or "").strip(),
    }


def normalize_account(payload: dict[str, Any]) -> dict[str, Any]:
    label = str(payload.get("label") or "").strip()
    identifier = str(payload.get("identifier") or "").strip()
    if not label:
        raise StoreError("账号名称不能为空")
    if not identifier:
        raise StoreError("账号标识不能为空（邮箱或用户名，不要填密码）")
    lowered = identifier.lower()
    if any(word in lowered for word in ("password", "passwd", "密码")):
        raise StoreError("不要把密码写进来，只记邮箱或用户名")
    return {
        "label": label,
        "identifier": identifier,
        "note": str(payload.get("note") or "").strip(),
    }


class MasterMixin:
    def list_categories(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM categories ORDER BY sort_order ASC, name ASC"
            ).fetchall()
        return [dict(row) | {"builtin": bool(row["builtin"])} for row in rows]

    def get_category(self, cat_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM categories WHERE id = ?", (cat_id,)
            ).fetchone()
        if row is None:
            raise StoreError("找不到这个分类", 404)
        return dict(row) | {"builtin": bool(row["builtin"])}

    @write_transaction
    def create_category(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise StoreError("分类名称不能为空")
        cat_id = new_id("cat")
        with self.connect() as conn:
            dup = conn.execute(
                "SELECT id FROM categories WHERE name = ?", (name,)
            ).fetchone()
            if dup:
                raise StoreError("已经有同名分类")
            conn.execute(
                """
                INSERT INTO categories (id, name, sort_order, builtin, created_at)
                VALUES (?, ?, ?, 0, ?)
                """,
                (cat_id, name, int(payload.get("sort_order") or 80), now_iso()),
            )
        return self.get_category(cat_id)

    @write_transaction
    def update_category(self, cat_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        current = self.get_category(cat_id)
        name = str(payload.get("name") or current["name"]).strip()
        if not name:
            raise StoreError("分类名称不能为空")
        with self.connect() as conn:
            dup = conn.execute(
                "SELECT id FROM categories WHERE name = ? AND id != ?",
                (name, cat_id),
            ).fetchone()
            if dup:
                raise StoreError("已经有同名分类")
            conn.execute(
                "UPDATE categories SET name = ?, sort_order = ? WHERE id = ?",
                (name, int(payload.get("sort_order") or current["sort_order"]), cat_id),
            )
        return self.get_category(cat_id)

    @write_transaction
    def delete_category(self, cat_id: str) -> None:
        self.get_category(cat_id)
        with self.connect() as conn:
            conn.execute(
                "UPDATE subscriptions SET category_id = NULL WHERE category_id = ?",
                (cat_id,),
            )
            conn.execute("DELETE FROM categories WHERE id = ?", (cat_id,))

    def list_payment_methods(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM payment_methods ORDER BY created_at ASC"
            ).fetchall()
        return [shape_payment_method(row) for row in rows]

    def get_payment_method(self, pay_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM payment_methods WHERE id = ?", (pay_id,)
            ).fetchone()
        if row is None:
            raise StoreError("找不到这个支付方式", 404)
        return shape_payment_method(row)

    @write_transaction
    def create_payment_method(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = normalize_payment_method(payload)
        pay_id = new_id("pay")
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO payment_methods
                (id, name, kind, account, last4, note, created_at)
                VALUES (?, ?, 'other', ?, '', ?, ?)
                """,
                (pay_id, data["name"], data["account"], data["note"], now_iso()),
            )
        return self.get_payment_method(pay_id)

    @write_transaction
    def update_payment_method(self, pay_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        current = self.get_payment_method(pay_id)
        if current["kind"] != "other":
            raise StoreError("请在银行卡页编辑这张卡", 409)
        data = normalize_payment_method({**current, **payload})
        with self.connect() as conn:
            conn.execute(
                "UPDATE payment_methods SET name = ?, account = ?, note = ? WHERE id = ?",
                (data["name"], data["account"], data["note"], pay_id),
            )
        return self.get_payment_method(pay_id)

    @write_transaction
    def delete_payment_method(self, pay_id: str) -> None:
        self.get_payment_method(pay_id)
        with self.connect() as conn:
            used = conn.execute(
                "SELECT COUNT(*) AS n FROM subscriptions WHERE payment_method_id = ?",
                (pay_id,),
            ).fetchone()
            if int(used["n"]) > 0:
                raise StoreError("还有订阅在用这个支付方式，先改掉再删", 409)
            conn.execute("DELETE FROM payment_methods WHERE id = ?", (pay_id,))

    def list_accounts(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM accounts ORDER BY created_at ASC"
            ).fetchall()
        return [dict(row) for row in rows]

    def get_account(self, acc_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM accounts WHERE id = ?", (acc_id,)
            ).fetchone()
        if row is None:
            raise StoreError("找不到这个账号", 404)
        return dict(row)

    @write_transaction
    def create_account(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = normalize_account(payload)
        key = data["identifier"].strip().lower()
        with self.connect() as conn:
            rows = conn.execute("SELECT id, identifier FROM accounts").fetchall()
            for row in rows:
                if str(row["identifier"] or "").strip().lower() == key:
                    return self.get_account(str(row["id"]))
            acc_id = new_id("acc")
            conn.execute(
                """
                INSERT INTO accounts (id, label, identifier, note, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (acc_id, data["label"], data["identifier"], data["note"], now_iso()),
            )
        return self.get_account(acc_id)

    @write_transaction
    def update_account(self, acc_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        current = self.get_account(acc_id)
        data = normalize_account({**current, **payload})
        key = data["identifier"].strip().lower()
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, identifier FROM accounts WHERE id != ?", (acc_id,)
            ).fetchall()
            for row in rows:
                if str(row["identifier"] or "").strip().lower() == key:
                    raise StoreError("已经有同一个账号标识")
            conn.execute(
                "UPDATE accounts SET label = ?, identifier = ?, note = ? WHERE id = ?",
                (data["label"], data["identifier"], data["note"], acc_id),
            )
        return self.get_account(acc_id)

    @write_transaction
    def delete_account(self, acc_id: str) -> None:
        self.get_account(acc_id)
        with self.connect() as conn:
            used = conn.execute(
                "SELECT COUNT(*) AS n FROM subscriptions WHERE account_id = ?",
                (acc_id,),
            ).fetchone()
            if int(used["n"]) > 0:
                raise StoreError("还有订阅挂在这个账号上，先改掉再删", 409)
            conn.execute("DELETE FROM accounts WHERE id = ?", (acc_id,))
