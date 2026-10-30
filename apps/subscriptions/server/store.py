# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 schema 事务、clock 日期、masters/cards 主数据与 billing 双模式续期
[OUTPUT]: 提供订阅读写、方式切换、余额与汇总；暂停恢复保留计费方式
[POS]: server 的订阅写路径。库表在 schema，分类/支付/账号在 masters
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path
from typing import Any, Iterator, Optional

from catalog import demo_specs, infer_category_id, logo_src
from cards import CardMixin
from clock import (
    CYCLES,
    STATUSES,
    advance_until_future,
    add_cycle,
    days_left,
    estimated_spent,
    fen_to_yuan,
    monthly_equivalent_fen,
    parse_iso_date,
    parse_yuan_to_fen,
    project_horizon_fen,
    project_monthly_charges,
    remain_ratio,
    resume_date,
    urgency,
    yearly_equivalent_fen,
)
from masters import MasterMixin
from billing import BILLING_MODES, BillingMixin, billing_fields
from reminders import ReminderMixin
from schema import (
    write_transaction,
    StoreError,
    ensure_schema,
    new_id,
    now_iso,
    open_db,
    today_local,
)

SUB_SELECT = """
SELECT
    s.*,
    p.name AS payment_method_name,
    p.account AS payment_method_account,
    p.kind AS payment_method_kind,
    p.card_type AS payment_method_card_type,
    p.status AS payment_method_status,
    a.label AS account_label,
    a.identifier AS account_identifier,
    c.name AS category_name,
    c.sort_order AS category_sort
FROM subscriptions s
LEFT JOIN payment_methods p ON p.id = s.payment_method_id
LEFT JOIN accounts a ON a.id = s.account_id
LEFT JOIN categories c ON c.id = s.category_id
"""


class Store(BillingMixin, ReminderMixin, CardMixin, MasterMixin):
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            ensure_schema(conn)

    def connect(self) -> Iterator[sqlite3.Connection]:
        return open_db(self.db_path)

    def _hydrate_subscription(self, row: sqlite3.Row, today: date) -> dict[str, Any]:
        item = dict(row)
        item.update(billing_fields(item))
        nxt = parse_iso_date(item["next_renewal_on"])
        remaining = days_left(nxt, today)
        cycle_days = item["cycle_days"]
        amount_fen = int(item["amount_fen"])
        cycle = item["cycle"]
        monthly = monthly_equivalent_fen(amount_fen, cycle, cycle_days)
        yearly = yearly_equivalent_fen(amount_fen, cycle, cycle_days)
        spent_count, spent_fen = estimated_spent(
            nxt, cycle, cycle_days, today, amount_fen,
            anchor_day=item.get("renewal_anchor_day"),
        )
        upcoming_fen = project_horizon_fen(
            [item],
            today,
            12,
        )
        display_status = item["status"]
        if display_status == "cancelled" and remaining < 0:
            display_status = "expired"
        # 暂停即冻结时钟：对外报的是「恢复后还剩几天」，不是日历差。
        # 冻结期不参与紧急度，否则一条停了半年的订阅会天天喊过期。
        if item["status"] == "paused":
            remaining = int(item["paused_days_left"] or 0)
        item.update(
            {
                "amount_yuan": fen_to_yuan(amount_fen),
                "days_left": remaining,
                "urgency": "ok" if item["status"] == "paused" else urgency(remaining, 7),
                "monthly_fen": monthly,
                "monthly_yuan": fen_to_yuan(monthly),
                "yearly_fen": yearly,
                "yearly_yuan": fen_to_yuan(yearly),
                "spent_count": spent_count,
                "spent_fen": spent_fen,
                "spent_yuan": fen_to_yuan(spent_fen),
                "upcoming_fen": upcoming_fen,
                "upcoming_yuan": fen_to_yuan(upcoming_fen),
                "auto_renew": bool(item["auto_renew"]),
                "display_status": display_status,
                "logo_src": logo_src(item["website"], item.get("logo_url") or ""),
                "remain_ratio": remain_ratio(remaining, cycle, cycle_days),
            }
        )
        return item

    def list_subscriptions(self, today: Optional[date] = None) -> list[dict[str, Any]]:
        today = today or today_local()
        self.settle_billing(today)
        with self.connect() as conn:
            rows = conn.execute(SUB_SELECT).fetchall()
        items = [self._hydrate_subscription(row, today) for row in rows]
        items.sort(
            key=lambda it: (
                int(it.get("category_sort") or 999),
                int(it.get("sort_order") or 0),
                it["name"],
            )
        )
        return items

    def get_subscription(self, sub_id: str, today: Optional[date] = None) -> dict[str, Any]:
        today = today or today_local()
        self.settle_billing(today)
        with self.connect() as conn:
            row = conn.execute(SUB_SELECT + " WHERE s.id = ?", (sub_id,)).fetchone()
        if row is None:
            raise StoreError("找不到这条订阅", 404)
        return self._hydrate_subscription(row, today)

    def summary(self, today: Optional[date] = None) -> dict[str, Any]:
        today = today or today_local()
        items = self.list_subscriptions(today)
        active = [it for it in items if it["status"] == "active"]
        monthly = sum(int(it["monthly_fen"]) for it in active)
        yearly = sum(int(it["yearly_fen"]) for it in active)
        buckets: dict[str, dict[str, Any]] = {}
        for it in active:
            cat_id = it.get("category_id") or "uncat"
            bucket = buckets.setdefault(
                cat_id,
                {
                    "id": cat_id,
                    "name": it.get("category_name") or "未分类",
                    "sort_order": it.get("category_sort") or 99,
                    "active_count": 0,
                    "monthly_fen": 0,
                },
            )
            bucket["active_count"] += 1
            bucket["monthly_fen"] += int(it["monthly_fen"])
        by_category = sorted(buckets.values(), key=lambda row: (row["sort_order"], row["name"]))
        for bucket in by_category:
            bucket["monthly_yuan"] = fen_to_yuan(bucket["monthly_fen"])
        curve = project_monthly_charges(active, today, 12)
        this_month = curve[0] if curve else {"fen": 0, "yuan": "0.00"}
        projected = project_horizon_fen(active, today, 12)
        return {
            "today": today.isoformat(),
            "count": len(items),
            "active_count": len(active),
            "ended_count": sum(1 for it in items if it["status"] in ("cancelled", "expired")),
            "paused_count": sum(1 for it in items if it["status"] == "paused"),
            "soon_count": sum(1 for it in active if it["urgency"] in ("soon", "today")),
            "overdue_count": sum(1 for it in items if it["urgency"] == "overdue"),
            "monthly_fen": monthly,
            "monthly_yuan": fen_to_yuan(monthly),
            "yearly_fen": yearly,
            "yearly_yuan": fen_to_yuan(yearly),
            "projected_fen": projected,
            "projected_yuan": fen_to_yuan(projected),
            "by_category": by_category,
            "curve": curve,
            "this_month_fen": this_month["fen"],
            "this_month_yuan": this_month["yuan"],
        }

    def _validate_refs(self, conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
        pay_id = payload.get("payment_method_id") or None
        acc_id = payload.get("account_id") or None
        cat_id = payload.get("category_id") or None
        if pay_id:
            found = conn.execute(
                "SELECT id FROM payment_methods WHERE id = ?", (pay_id,)
            ).fetchone()
            if found is None:
                raise StoreError("支付方式不存在", 400)
        if acc_id:
            found = conn.execute(
                "SELECT id FROM accounts WHERE id = ?", (acc_id,)
            ).fetchone()
            if found is None:
                raise StoreError("账号不存在", 400)
        if cat_id:
            found = conn.execute(
                "SELECT id FROM categories WHERE id = ?", (cat_id,)
            ).fetchone()
            if found is None:
                cat_id = None
        payload["payment_method_id"] = pay_id
        payload["account_id"] = acc_id
        payload["category_id"] = cat_id

    def _normalize_subscription(
        self,
        payload: dict[str, Any],
        partial: bool = False,
        infer_missing_category: bool = True,
    ) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if not partial or "name" in payload:
            name = str(payload.get("name") or "").strip()
            if not name:
                raise StoreError("订阅名称不能为空")
            out["name"] = name
        if not partial or "website" in payload:
            out["website"] = normalize_website(payload.get("website"))
        if not partial or "amount_yuan" in payload or "amount_fen" in payload:
            yuan_raw = payload.get("amount_yuan")
            if yuan_raw is not None and str(yuan_raw).strip() != "":
                try:
                    amount_fen = parse_yuan_to_fen(yuan_raw)
                except ValueError as exc:
                    raise StoreError(str(exc)) from exc
            elif payload.get("amount_fen") is not None:
                try:
                    amount_fen = int(payload["amount_fen"])
                except (TypeError, ValueError) as exc:
                    raise StoreError("金额格式不对") from exc
            else:
                raise StoreError("金额不能为空")
            if amount_fen < 0 or amount_fen > 10**14:
                raise StoreError("金额需在 0 到一万亿元之间")
            out["amount_fen"] = amount_fen
        if not partial or "currency" in payload:
            currency = str(payload.get("currency") or "CNY").strip().upper()
            if currency != "CNY":
                raise StoreError("当前只支持人民币 CNY")
            out["currency"] = currency
        if not partial or "cycle" in payload:
            cycle = str(payload.get("cycle") or "").strip()
            if cycle not in CYCLES:
                raise StoreError("周期只能是每月、每季、每年或自定义")
            out["cycle"] = cycle
        if not partial or "cycle_days" in payload or "cycle" in out:
            cycle = out.get("cycle") or payload.get("cycle")
            raw_days = payload.get("cycle_days")
            if cycle == "custom":
                try:
                    days = int(raw_days)
                except (TypeError, ValueError) as exc:
                    raise StoreError("自定义周期要填天数") from exc
                if isinstance(raw_days, bool) or str(raw_days).strip() != str(days) or not 1 <= days <= 36600:
                    raise StoreError("自定义周期必须是 1–36600 的整数天数")
                out["cycle_days"] = days
            else:
                out["cycle_days"] = None
        if not partial or "next_renewal_on" in payload:
            try:
                nxt = parse_iso_date(str(payload.get("next_renewal_on") or ""))
            except ValueError as exc:
                raise StoreError("下次扣款日格式不对，请用 YYYY-MM-DD") from exc
            if not 1900 <= nxt.year <= 9000:
                raise StoreError("下次扣款日需在 1900–9000 年之间")
            out["next_renewal_on"] = nxt.isoformat()
        if not partial or "auto_renew" in payload:
            out["auto_renew"] = 1 if bool(payload.get("auto_renew", True)) else 0
        if not partial or "billing_mode" in payload:
            mode = payload.get("billing_mode", "auto_charge")
            if mode not in BILLING_MODES:
                raise StoreError("订阅方式只能是余额式或自动扣款")
            out["billing_mode"] = mode
        if not partial or "status" in payload:
            status = str(payload.get("status") or "active")
            if status not in STATUSES:
                raise StoreError("状态不合法")
            out["status"] = status
        if not partial or "payment_method_id" in payload:
            out["payment_method_id"] = payload.get("payment_method_id") or None
        if not partial or "account_id" in payload:
            out["account_id"] = payload.get("account_id") or None
        if not partial or "category_id" in payload:
            given = payload.get("category_id")
            if given:
                out["category_id"] = given
            elif infer_missing_category:
                out["category_id"] = infer_category_id(
                    str(out.get("name") or payload.get("name") or ""),
                    str(out.get("website") or payload.get("website") or ""),
                )
            else:
                out["category_id"] = None
        if not partial or "logo_url" in payload:
            out["logo_url"] = str(payload.get("logo_url") or "").strip()
        out["remind_days"] = 7
        if not partial or "notes" in payload:
            out["notes"] = str(payload.get("notes") or "").strip()
        if not partial:
            try:
                add_cycle(parse_iso_date(out["next_renewal_on"]), out["cycle"], out["cycle_days"])
            except (ValueError, OverflowError) as exc:
                raise StoreError("周期或扣款日超出可计算范围") from exc
        return out

    @write_transaction
    def create_subscription(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = self._normalize_subscription(payload, partial=False)
        sub_id = new_id("sub")
        stamp = now_iso()
        with self.connect() as conn:
            self._validate_refs(conn, data)
            self._validate_billing_method(conn, data, payload)
            sort_order = self._next_sort_order(conn, data.get("category_id"))
            conn.execute(
                """
                INSERT INTO subscriptions (
                    id, name, website, amount_fen, currency, cycle, cycle_days,
                    next_renewal_on, auto_renew, status, payment_method_id,
                    account_id, category_id, logo_url, remind_days, notes,
                    sort_order, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sub_id,
                    data["name"],
                    data["website"],
                    data["amount_fen"],
                    data["currency"],
                    data["cycle"],
                    data["cycle_days"],
                    data["next_renewal_on"],
                    data["auto_renew"],
                    data["status"],
                    data["payment_method_id"],
                    data["account_id"],
                    data["category_id"],
                    data["logo_url"],
                    data["remind_days"],
                    data["notes"],
                    sort_order,
                    stamp,
                    stamp,
                ),
            )
            conn.execute("UPDATE subscriptions SET renewal_anchor_day = ?, billing_mode = ? WHERE id = ?",
                         (parse_iso_date(data["next_renewal_on"]).day, data["billing_mode"], sub_id))
        return self.get_subscription(sub_id)

    @write_transaction
    def update_subscription(self, sub_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.settle_billing()
        current = self._raw_subscription(sub_id)
        if "expected_next_renewal_on" in payload and payload["expected_next_renewal_on"] != current["next_renewal_on"]:
            raise StoreError("订阅已续期，请取消编辑后重新打开再修改", 409)
        merged = {**current, **payload}
        if "amount_yuan" in payload and "amount_fen" not in payload:
            merged.pop("amount_fen", None)
        if "amount_fen" in payload and "amount_yuan" not in payload:
            merged.pop("amount_yuan", None)
        data = self._normalize_subscription(
            merged, partial=False, infer_missing_category=False
        )
        # 暂停/恢复要连带冻结天数一起改，PUT 改不干净，只认动作端点。
        if data["status"] == "paused" and current["status"] != "paused":
            raise StoreError("暂停请用暂停按钮，不要直接改状态")
        if current["status"] == "paused" and data["status"] != "paused":
            raise StoreError("恢复请用恢复按钮，不要直接改状态")
        with self.connect() as conn:
            self._validate_refs(conn, data)
            self._validate_billing_method(conn, data, payload, current)
            sort_order = int(current.get("sort_order") or 0)
            old_cat = current.get("category_id") or ""
            new_cat = data.get("category_id") or ""
            if old_cat != new_cat:
                sort_order = self._next_sort_order(conn, new_cat)
            conn.execute(
                """
                UPDATE subscriptions SET
                    name = ?, website = ?, amount_fen = ?, currency = ?,
                    cycle = ?, cycle_days = ?, next_renewal_on = ?,
                    auto_renew = ?, status = ?, payment_method_id = ?,
                    account_id = ?, category_id = ?, logo_url = ?,
                    remind_days = ?, notes = ?, sort_order = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    data["name"],
                    data["website"],
                    data["amount_fen"],
                    data["currency"],
                    data["cycle"],
                    data["cycle_days"],
                    data["next_renewal_on"],
                    data["auto_renew"],
                    data["status"],
                    data["payment_method_id"],
                    data["account_id"],
                    data["category_id"],
                    data["logo_url"],
                    data["remind_days"],
                    data["notes"],
                    sort_order,
                    now_iso(),
                    sub_id,
                ),
            )
            if data["next_renewal_on"] != current["next_renewal_on"] or data["cycle"] != current["cycle"]:
                conn.execute("UPDATE subscriptions SET renewal_anchor_day = ? WHERE id = ?",
                             (parse_iso_date(data["next_renewal_on"]).day, sub_id))
            conn.execute("UPDATE subscriptions SET billing_mode = ? WHERE id = ?", (data["billing_mode"], sub_id))
            if data["billing_mode"] != current["billing_mode"]:
                conn.execute("UPDATE subscriptions SET phone_balance_stopped = 0 WHERE id = ?", (sub_id,))
                if data["billing_mode"] == "balance" and parse_iso_date(data["next_renewal_on"]) < today_local():
                    due = advance_until_future(parse_iso_date(data["next_renewal_on"]), data["cycle"], data["cycle_days"], today_local(), current.get("renewal_anchor_day"))
                    conn.execute("UPDATE subscriptions SET next_renewal_on = ? WHERE id = ?", (due.isoformat(), sub_id))
        return self.get_subscription(sub_id)

    def _next_sort_order(self, conn: sqlite3.Connection, category_id: Optional[str]) -> int:
        row = conn.execute(
            """
            SELECT MAX(sort_order) AS m FROM subscriptions
            WHERE IFNULL(category_id, '') = ?
            """,
            (category_id or "",),
        ).fetchone()
        return int(row["m"] or 0) + 10

    @write_transaction
    def reorder_subscriptions(self, payload: dict[str, Any]) -> dict[str, Any]:
        category_id = str(payload.get("category_id") or "")
        ids = payload.get("ids")
        if not isinstance(ids, list) or not ids:
            raise StoreError("没有要排序的订阅")
        clean: list[str] = []
        for item in ids:
            sid = str(item or "").strip()
            if not sid:
                raise StoreError("排序名单里有空编号")
            if sid in clean:
                raise StoreError("排序名单里有重复订阅")
            clean.append(sid)
        placeholders = ",".join("?" * len(clean))
        with self.connect() as conn:
            rows = conn.execute(
                f"SELECT id, IFNULL(category_id, '') AS cat FROM subscriptions WHERE id IN ({placeholders})",
                clean,
            ).fetchall()
            found = {str(row["id"]): str(row["cat"]) for row in rows}
            if len(found) != len(clean):
                raise StoreError("有订阅不存在", 400)
            for sid in clean:
                if found[sid] != category_id:
                    raise StoreError("只能在同一分类里排序", 400)
            stamp = now_iso()
            for index, sid in enumerate(clean):
                conn.execute(
                    "UPDATE subscriptions SET sort_order = ?, updated_at = ? WHERE id = ?",
                    ((index + 1) * 10, stamp, sid),
                )
        return {"ok": True, "ids": clean}

    def _raw_subscription(self, sub_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM subscriptions WHERE id = ?", (sub_id,)).fetchone()
        if row is None:
            raise StoreError("找不到这条订阅", 404)
        return dict(row)

    @write_transaction
    def delete_subscription(self, sub_id: str) -> None:
        self._raw_subscription(sub_id)
        with self.connect() as conn:
            conn.execute("DELETE FROM reminder_claims WHERE subscription_id = ?", (sub_id,))
            conn.execute("DELETE FROM reminder_log WHERE subscription_id = ?", (sub_id,))
            conn.execute("DELETE FROM subscriptions WHERE id = ?", (sub_id,))

    @write_transaction
    def confirm_renewal(self, sub_id: str, today: Optional[date] = None) -> dict[str, Any]:
        today = today or today_local()
        current = self.get_subscription(sub_id, today)
        if current["status"] != "active":
            raise StoreError("只有生效中的订阅才能确认续费")
        if current["billing_mode"] == "balance" and current["phone_balance_fen"] is not None:
            raise StoreError("此订阅已启用余额抵扣，无需手动确认续费")
        if current["billing_mode"] == "auto_charge" and current["auto_charge_ready"] and current["auto_renew"]:
            raise StoreError("此订阅按周期自动续期，无需手动确认续费")
        try:
            nxt = advance_until_future(
                parse_iso_date(current["next_renewal_on"]),
                current["cycle"],
                current["cycle_days"],
                today,
                anchor_day=current.get("renewal_anchor_day"),
            )
        except (ValueError, OverflowError) as exc:
            raise StoreError(str(exc)) from exc
        with self.connect() as conn:
            conn.execute(
                "UPDATE subscriptions SET next_renewal_on = ?, updated_at = ? WHERE id = ?",
                (nxt.isoformat(), now_iso(), sub_id),
            )
        return self.get_subscription(sub_id, today)

    @write_transaction
    def pause_subscription(
        self,
        sub_id: str,
        keep_remaining: bool = True,
        today: Optional[date] = None,
    ) -> dict[str, Any]:
        """
        暂停：留着记录，冻住时钟。keep_remaining 决定这一期怎么收尾——
        True 是「立即冻结」，把还剩的天数存起来，恢复时原样还回来；
        False 是「立即停用」，服务生效途中就退订，剩余作废，恢复时按重订一期算。
        """
        today = today or today_local()
        current = self.get_subscription(sub_id, today)
        if current["status"] == "paused":
            raise StoreError("这条订阅已经暂停了")
        if current["status"] != "active":
            raise StoreError("只有生效中的订阅才能暂停")
        frozen = max(0, int(current["days_left"])) if keep_remaining else 0
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE subscriptions SET
                    status = 'paused', auto_renew = 0, phone_balance_stopped = 0,
                    paused_on = ?, paused_days_left = ?, updated_at = ?
                WHERE id = ?
                """,
                (today.isoformat(), frozen, now_iso(), sub_id),
            )
            # 恢复后账单日会挪，旧波次记录再对不上，清掉让三波重新数。
            conn.execute("DELETE FROM reminder_claims WHERE subscription_id = ?", (sub_id,))
            conn.execute("DELETE FROM reminder_log WHERE subscription_id = ?", (sub_id,))
        return self.get_subscription(sub_id, today)

    @write_transaction
    def resume_subscription(
        self, sub_id: str, today: Optional[date] = None
    ) -> dict[str, Any]:
        """恢复：把冻结的天数还回来，重新起钟。日期算术在 clock。"""
        today = today or today_local()
        current = self.get_subscription(sub_id, today)
        if current["status"] != "paused":
            raise StoreError("只有已暂停的订阅才能恢复")
        if current["billing_mode"] == "balance" and current["phone_balance_fen"] is not None and not current.get("paused_days_left"):
            with self.connect() as conn:
                self._restart_balance(conn, current, today)
            return self.get_subscription(sub_id, today)
        try:
            nxt = resume_date(
                today,
                current.get("paused_days_left"),
                current["cycle"],
                current["cycle_days"],
            )
        except ValueError as exc:
            raise StoreError(str(exc)) from exc
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE subscriptions SET
                    status = 'active', auto_renew = 1, next_renewal_on = ?,
                    paused_on = '', paused_days_left = NULL, phone_balance_stopped = 0, updated_at = ?
                WHERE id = ?
                """,
                (nxt.isoformat(), now_iso(), sub_id),
            )
            conn.execute("UPDATE subscriptions SET renewal_anchor_day = ? WHERE id = ?", (nxt.day, sub_id))
            conn.execute("DELETE FROM reminder_claims WHERE subscription_id = ?", (sub_id,))
            conn.execute("DELETE FROM reminder_log WHERE subscription_id = ?", (sub_id,))
        return self.get_subscription(sub_id, today)

    @write_transaction
    def seed_demo(self, today: Optional[date] = None) -> list[dict[str, Any]]:
        today = today or today_local()
        if self.list_subscriptions(today):
            return []
        methods = self.list_payment_methods()
        pay = next((item for item in methods if item["name"] == "招商银行"), None)
        if pay is None:
            pay = self.create_payment_method({"name": "招商银行", "account": "3201"})
        existing_names = {item["name"] for item in self.list_subscriptions(today)}
        created: list[dict[str, Any]] = []
        for spec in demo_specs(today):
            if spec["name"] in existing_names:
                continue
            account = self.create_account(
                {"label": spec["name"], "identifier": spec["email"]}
            )
            created.append(
                self.create_subscription(
                    {
                        "name": spec["name"],
                        "website": spec["website"],
                        "amount_yuan": spec["amount_yuan"],
                        "cycle": "monthly",
                        "next_renewal_on": spec["next_renewal_on"],
                        "payment_method_id": pay["id"],
                        "account_id": account["id"],
                        "category_id": spec["category_id"],
                        "notes": "示例",
                    }
                )
            )
        return created


def normalize_website(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        raise StoreError("网站不能为空")
    if " " in text:
        raise StoreError("网站里不要有空格")
    if not text.startswith(("http://", "https://")):
        text = "https://" + text
    return text
