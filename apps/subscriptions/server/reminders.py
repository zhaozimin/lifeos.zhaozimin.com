# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 schema 原子事务与 clock 波次，借用 Store 水合列表
[OUTPUT]: 提供待提醒列表、五分钟领取租约、成功回执与失败释放
[POS]: server 的投递状态边界；打印文案不算送达，回执必须携带本次领取凭据
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import time
from datetime import date
from typing import Any, Optional
from uuid import uuid4
from clock import remind_wave
from schema import StoreError, today_local, write_transaction

LEASE_SECONDS = 300


class ReminderMixin:
    def reminders(self, today: Optional[date] = None) -> dict[str, Any]:
        today = today or today_local()
        items = self.list_subscriptions(today)
        watch = [
            it
            for it in items
            if it["status"] == "active" and it["urgency"] in ("soon", "today", "overdue")
        ]
        return {"items": watch, "due": self.due_reminder_waves(today, items)}

    def due_reminder_waves(
        self,
        today: Optional[date] = None,
        items: Optional[list[dict[str, Any]]] = None,
    ) -> list[dict[str, Any]]:
        today = today or today_local()
        pool = items if items is not None else self.list_subscriptions(today)
        due: list[dict[str, Any]] = []
        with self.connect() as conn:
            for it in pool:
                if it["status"] != "active":
                    continue
                wave = remind_wave(int(it["days_left"]))
                if wave is None:
                    continue
                seen = conn.execute(
                    """
                    SELECT 1 FROM reminder_log
                    WHERE subscription_id = ? AND next_renewal_on = ? AND wave = ?
                    """,
                    (it["id"], it["next_renewal_on"], wave),
                ).fetchone()
                if seen:
                    continue
                due.append(
                    {
                        "id": it["id"],
                        "name": it["name"],
                        "wave": wave,
                        "days_left": it["days_left"],
                        "amount_yuan": it["amount_yuan"],
                        "next_renewal_on": it["next_renewal_on"],
                        "website": it["website"],
                    }
                )
        return due

    @write_transaction
    def claim_reminders(self, today: Optional[date] = None) -> dict[str, Any]:
        pack = self.reminders(today)
        claimed = []
        now = time.time()
        with self.connect() as conn:
            for item in pack["due"]:
                key = (item["id"], item["next_renewal_on"], item["wave"])
                existing = conn.execute("SELECT expires_at FROM reminder_claims WHERE subscription_id = ? AND next_renewal_on = ? AND wave = ?", key).fetchone()
                if existing and existing["expires_at"] > now:
                    continue
                token = uuid4().hex
                conn.execute("INSERT OR REPLACE INTO reminder_claims VALUES (?, ?, ?, ?, ?)", (*key, token, now + LEASE_SECONDS))
                claimed.append({**item, "delivery_token": token})
        return {**pack, "due": claimed}

    @write_transaction
    def ack_reminders(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._finish_reminders(payload, delivered=True)

    @write_transaction
    def release_reminders(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._finish_reminders(payload, delivered=False)

    def _finish_reminders(self, payload: dict[str, Any], delivered: bool) -> dict[str, Any]:
        raw = payload.get("items")
        if not isinstance(raw, list):
            raise StoreError("回执必须是列表")
        accepted = 0
        with self.connect() as conn:
            for item in raw:
                if not isinstance(item, dict):
                    raise StoreError("回执条目必须是对象")
                key = (item.get("id"), item.get("next_renewal_on"), item.get("wave"))
                token = item.get("delivery_token")
                if not isinstance(token, str) or not token:
                    raise StoreError("回执缺少领取凭据；只在投递成功后确认")
                claim = conn.execute("SELECT token FROM reminder_claims WHERE subscription_id = ? AND next_renewal_on = ? AND wave = ?", key).fetchone()
                if not claim or claim["token"] != token:
                    continue
                if delivered:
                    cursor = conn.execute("INSERT OR IGNORE INTO reminder_log VALUES (?, ?, ?, ?)", (*key, today_local().isoformat()))
                    accepted += cursor.rowcount
                conn.execute("DELETE FROM reminder_claims WHERE subscription_id = ? AND next_renewal_on = ? AND wave = ?", key)
        return {"ok": True, "accepted": accepted}
