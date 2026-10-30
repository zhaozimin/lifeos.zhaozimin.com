# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 catalog 的内置分类与推断
[OUTPUT]: 提供原子写事务与 schema 12 双模式迁移；原余额列和充值编号保留
[POS]: server 的库表真源。store 只通过这里开连接
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from datetime import date, datetime
from pathlib import Path
from typing import Iterator
from uuid import uuid4

from catalog import BUILTIN_CATEGORIES, infer_category_id

SCHEMA_VERSION = 12
WRITE_LOCK = threading.RLock()
_WRITE_CONNECTION = ContextVar("subos_write_connection", default=None)

LIVE_DDL = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    identifier TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_methods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    account TEXT NOT NULL DEFAULT '',
    issuer TEXT NOT NULL DEFAULT '',
    card_type TEXT NOT NULL DEFAULT '',
    network TEXT NOT NULL DEFAULT '',
    last4 TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'CNY',
    expiry_month TEXT NOT NULL DEFAULT '',
    billing_day INTEGER,
    payment_due_day INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    cover_key TEXT NOT NULL DEFAULT '',
    cover_source_url TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    website TEXT NOT NULL,
    amount_fen INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CNY',
    cycle TEXT NOT NULL,
    cycle_days INTEGER,
    next_renewal_on TEXT NOT NULL,
    renewal_anchor_day INTEGER,
    auto_renew INTEGER NOT NULL DEFAULT 1,
    billing_mode TEXT NOT NULL DEFAULT 'auto_charge' CHECK (billing_mode IN ('balance', 'auto_charge')),
    status TEXT NOT NULL DEFAULT 'active',
    paused_on TEXT NOT NULL DEFAULT '',
    paused_days_left INTEGER,
    phone_balance_fen INTEGER CHECK (phone_balance_fen IS NULL OR phone_balance_fen BETWEEN 0 AND 100000000000000),
    phone_balance_stopped INTEGER NOT NULL DEFAULT 0,
    payment_method_id TEXT,
    account_id TEXT,
    category_id TEXT,
    logo_url TEXT NOT NULL DEFAULT '',
    remind_days INTEGER NOT NULL DEFAULT 7,
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);
CREATE TABLE IF NOT EXISTS phone_balance_topups (
    request_id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    amount_fen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reminder_claims (
    subscription_id TEXT NOT NULL,
    next_renewal_on TEXT NOT NULL,
    wave INTEGER NOT NULL,
    token TEXT NOT NULL,
    expires_at REAL NOT NULL,
    PRIMARY KEY (subscription_id, next_renewal_on, wave)
);
CREATE TABLE IF NOT EXISTS reminder_log (
    subscription_id TEXT NOT NULL,
    next_renewal_on TEXT NOT NULL,
    wave INTEGER NOT NULL,
    sent_on TEXT NOT NULL,
    PRIMARY KEY (subscription_id, next_renewal_on, wave)
);
"""


class StoreError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def today_local() -> date:
    return date.today()


@contextmanager
def open_db(db_path: Path) -> Iterator[sqlite3.Connection]:
    active = _WRITE_CONNECTION.get()
    if active is not None and active[0] == db_path.resolve():
        yield active[1]
        return
    conn = sqlite3.connect(str(db_path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL").fetchone()
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def write_transaction(method):
    """写入口先取得 SQLite 写事务，嵌套读取复用连接，派生结果成功后才提交。"""
    @wraps(method)
    def wrapped(self, *args, **kwargs):
        with WRITE_LOCK, self.connect() as conn:
            active = _WRITE_CONNECTION.get()
            if active is not None and active[1] is conn:
                return method(self, *args, **kwargs)
            conn.execute("BEGIN IMMEDIATE")
            token = _WRITE_CONNECTION.set((self.db_path.resolve(), conn))
            try:
                return method(self, *args, **kwargs)
            finally:
                _WRITE_CONNECTION.reset(token)
    return wrapped


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {
        str(item["name"])
        for item in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(LIVE_DDL)
    row = conn.execute(
        "SELECT value FROM meta WHERE key = 'schema_version'"
    ).fetchone()
    current = int(row["value"]) if row else 0
    columns = _table_columns(conn, "subscriptions")
    if "category_id" not in columns:
        conn.execute("ALTER TABLE subscriptions ADD COLUMN category_id TEXT")
    if "logo_url" not in columns:
        conn.execute(
            "ALTER TABLE subscriptions ADD COLUMN logo_url TEXT NOT NULL DEFAULT ''"
        )
    if "sort_order" not in columns:
        conn.execute(
            "ALTER TABLE subscriptions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
        )
        ranked = conn.execute(
            """
            SELECT id, IFNULL(category_id, '') AS cat
            FROM subscriptions
            ORDER BY IFNULL(category_id, ''), next_renewal_on ASC, name ASC
            """
        ).fetchall()
        counters: dict[str, int] = {}
        for item in ranked:
            cat = str(item["cat"])
            counters[cat] = counters.get(cat, 0) + 10
            conn.execute(
                "UPDATE subscriptions SET sort_order = ? WHERE id = ?",
                (counters[cat], item["id"]),
            )
    if "paused_on" not in columns:
        conn.execute(
            "ALTER TABLE subscriptions ADD COLUMN paused_on TEXT NOT NULL DEFAULT ''"
        )
    if "paused_days_left" not in columns:
        conn.execute("ALTER TABLE subscriptions ADD COLUMN paused_days_left INTEGER")
    if "phone_balance_fen" not in columns:
        conn.execute("ALTER TABLE subscriptions ADD COLUMN phone_balance_fen INTEGER CHECK (phone_balance_fen IS NULL OR phone_balance_fen BETWEEN 0 AND 100000000000000)")
    if "phone_balance_stopped" not in columns:
        conn.execute("ALTER TABLE subscriptions ADD COLUMN phone_balance_stopped INTEGER NOT NULL DEFAULT 0")
    if "renewal_anchor_day" not in columns:
        conn.execute("ALTER TABLE subscriptions ADD COLUMN renewal_anchor_day INTEGER")
        conn.execute("UPDATE subscriptions SET renewal_anchor_day = CAST(substr(next_renewal_on, 9, 2) AS INTEGER)")
    if "billing_mode" not in columns:
        conn.execute("ALTER TABLE subscriptions ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'auto_charge' CHECK (billing_mode IN ('balance', 'auto_charge'))")
        # 保留上一版电话卡的余额显示方式，不改余额、状态或扣款日。
        for item in conn.execute("SELECT id, name, website, category_id, phone_balance_fen FROM subscriptions").fetchall():
            if item["phone_balance_fen"] is not None or item["category_id"] == "cat_phone" or infer_category_id(item["name"], item["website"]) == "cat_phone":
                conn.execute("UPDATE subscriptions SET billing_mode = 'balance' WHERE id = ?", (item["id"],))
    pay_columns = _table_columns(conn, "payment_methods")
    if "account" not in pay_columns:
        conn.execute(
            "ALTER TABLE payment_methods ADD COLUMN account TEXT NOT NULL DEFAULT ''"
        )
        if "last4" in pay_columns:
            conn.execute(
                "UPDATE payment_methods SET account = last4 WHERE account = '' AND last4 != ''"
            )
    card_columns = {
        "kind": "TEXT NOT NULL DEFAULT 'other'",
        "issuer": "TEXT NOT NULL DEFAULT ''",
        "card_type": "TEXT NOT NULL DEFAULT ''",
        "network": "TEXT NOT NULL DEFAULT ''",
        "last4": "TEXT NOT NULL DEFAULT ''",
        "currency": "TEXT NOT NULL DEFAULT 'CNY'",
        "expiry_month": "TEXT NOT NULL DEFAULT ''",
        "billing_day": "INTEGER",
        "payment_due_day": "INTEGER",
        "status": "TEXT NOT NULL DEFAULT 'active'",
        "cover_key": "TEXT NOT NULL DEFAULT ''",
        "cover_source_url": "TEXT NOT NULL DEFAULT ''",
    }
    pay_columns = _table_columns(conn, "payment_methods")
    for column, ddl in card_columns.items():
        if column not in pay_columns:
            conn.execute(f"ALTER TABLE payment_methods ADD COLUMN {column} {ddl}")
    if current < 8:
        conn.execute(
            """
            UPDATE payment_methods SET kind = 'other'
            WHERE kind NOT IN ('other', 'physical_card', 'virtual_card')
            """
        )
        conn.execute(
            """
            UPDATE payment_methods SET status = 'active'
            WHERE status NOT IN ('active', 'frozen', 'closed')
            """
        )
    seeded = conn.execute(
        "SELECT value FROM meta WHERE key = 'catalog_seeded'"
    ).fetchone()
    existing = conn.execute("SELECT COUNT(*) AS n FROM categories").fetchone()
    if seeded is None:
        if int(existing["n"]) == 0:
            stamp = now_iso()
            for item in BUILTIN_CATEGORIES:
                conn.execute(
                    """
                    INSERT INTO categories (id, name, sort_order, builtin, created_at)
                    VALUES (?, ?, ?, 1, ?)
                    """,
                    (item["id"], item["name"], item["sort_order"], stamp),
                )
        conn.execute(
            "INSERT INTO meta(key, value) VALUES ('catalog_seeded', '1') "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
    conn.execute(
        """
        UPDATE subscriptions SET category_id = NULL
        WHERE category_id IS NOT NULL
          AND category_id != ''
          AND category_id NOT IN (SELECT id FROM categories)
        """
    )
    if current < 6:
        valid = {str(row["id"]) for row in conn.execute("SELECT id FROM categories")}
        orphans = conn.execute(
            "SELECT id, name, website FROM subscriptions WHERE category_id IS NULL OR category_id = ''"
        ).fetchall()
        for orphan in orphans:
            guessed = infer_category_id(orphan["name"], orphan["website"])
            cat = guessed if guessed in valid else None
            conn.execute(
                "UPDATE subscriptions SET category_id = ? WHERE id = ?",
                (cat, orphan["id"]),
            )
    collapse_duplicate_accounts(conn)
    if current < SCHEMA_VERSION:
        conn.execute(
            "INSERT INTO meta(key, value) VALUES ('schema_version', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(SCHEMA_VERSION),),
        )


def collapse_duplicate_accounts(conn: sqlite3.Connection) -> None:
    """同一标识只留最早那条，订阅改挂过去。不同标识不合并。"""
    rows = conn.execute(
        "SELECT id, identifier, created_at FROM accounts ORDER BY created_at ASC, id ASC"
    ).fetchall()
    keep: dict[str, str] = {}
    for row in rows:
        key = str(row["identifier"] or "").strip().lower()
        if not key:
            continue
        survivor = keep.get(key)
        if survivor is None:
            keep[key] = str(row["id"])
            continue
        extra = str(row["id"])
        conn.execute(
            "UPDATE subscriptions SET account_id = ? WHERE account_id = ?",
            (survivor, extra),
        )
        conn.execute("DELETE FROM accounts WHERE id = ?", (extra,))
