# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖标准库 datetime，不读库、不读时钟之外的输入
[OUTPUT]: 提供日期与金额算术；余额式预测以可支付期数为上限，自动扣款式独立预测
[POS]: server 的日期算术唯一真源，store 与测试只调用这里
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

from datetime import date, timedelta
from calendar import monthrange
from typing import Optional

CYCLES = ("monthly", "quarterly", "yearly", "custom")
STATUSES = ("active", "paused", "cancelled", "expired")
URGENCIES = ("ok", "soon", "today", "overdue")

CYCLE_LABELS = {
    "monthly": "月",
    "quarterly": "季",
    "yearly": "年",
    "custom": "自定义",
}

def parse_iso_date(value: str) -> date:
    return date.fromisoformat(value)


def add_months(origin: date, months: int, anchor_day: Optional[int] = None) -> date:
    """按日历锚点进位：短月截到月底，后续月份恢复原定日。"""
    month_index = origin.month - 1 + months
    year = origin.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, min(anchor_day or origin.day, monthrange(year, month)[1]))


def shift_cycle(
    origin: date, cycle: str, cycle_days: Optional[int] = None, steps: int = 1,
    anchor_day: Optional[int] = None,
) -> date:
    if steps == 0:
        return origin
    months = {"monthly": 1, "quarterly": 3, "yearly": 12}.get(cycle)
    if months:
        return add_months(origin, steps * months, anchor_day)
    if cycle == "custom":
        days = int(cycle_days or 0)
        if days < 1:
            raise ValueError("自定义周期至少 1 天")
        return origin + timedelta(days=days * steps)
    raise ValueError(f"未知周期: {cycle}")


def add_cycle(origin: date, cycle: str, cycle_days: Optional[int] = None) -> date:
    return shift_cycle(origin, cycle, cycle_days, 1)


def _cycle_index(origin: date, cycle: str, cycle_days: Optional[int], target: date,
                 anchor_day: Optional[int] = None) -> int:
    """返回首个不早于 target 的期数。直接跳过年月差，不逐日追赶旧账单。"""
    if cycle == "custom":
        days = int(cycle_days or 0)
        if days < 1:
            raise ValueError("自定义周期至少 1 天")
        return -(-(target - origin).days // days)
    months = {"monthly": 1, "quarterly": 3, "yearly": 12}.get(cycle)
    if months is None:
        raise ValueError(f"未知周期: {cycle}")
    index = ((target.year - origin.year) * 12 + target.month - origin.month) // months
    if shift_cycle(origin, cycle, cycle_days, index, anchor_day) < target:
        index += 1
    return index


def estimated_spent(
    next_renewal: date, cycle: str, cycle_days: Optional[int], today: date,
    amount_fen: int, horizon_months: int = 12, anchor_day: Optional[int] = None,
) -> tuple[int, int]:
    """回推近一年、早于今天且不晚于当前账单日的期数；不是已付款流水。"""
    if amount_fen < 0:
        raise ValueError("金额不能为负")
    start = _cycle_index(next_renewal, cycle, cycle_days,
                         add_months(today, -horizon_months), anchor_day)
    end = min(1, _cycle_index(next_renewal, cycle, cycle_days, today, anchor_day))
    count = max(0, end - start)
    return count, count * amount_fen


def advance_until_future(origin: date, cycle: str, cycle_days: Optional[int], today: date,
                         anchor_day: Optional[int] = None) -> date:
    """确认续费至少进一期，跳到今天之后，保留月末锚点。"""
    index = max(1, _cycle_index(origin, cycle, cycle_days, today + timedelta(days=1), anchor_day))
    return shift_cycle(origin, cycle, cycle_days, index, anchor_day)


def resume_date(
    today: date, frozen_days: Optional[int], cycle: str, cycle_days: Optional[int] = None
) -> date:
    """
    恢复订阅：暂停时冻结了几天就还几天，从今天重新数。
    冻结为 0（中途退订，剩余作废）或已过期时暂停的，按重新订一期算，从今天起走一个完整周期。
    """
    days = int(frozen_days or 0)
    if days > 0:
        return today + timedelta(days=days)
    return add_cycle(today, cycle, cycle_days)


def period_days(cycle: str, cycle_days: Optional[int] = None) -> int:
    if cycle == "monthly":
        return 30
    if cycle == "quarterly":
        return 91
    if cycle == "yearly":
        return 365
    days = int(cycle_days or 0)
    return days if days >= 1 else 30


def remain_ratio(remaining: int, cycle: str, cycle_days: Optional[int] = None) -> float:
    """本周期还剩多少圈。≤0 为到期，圆是空的。"""
    if remaining <= 0:
        return 0.0
    span = period_days(cycle, cycle_days)
    return min(1.0, remaining / span)


def days_left(next_renewal: date, today: date) -> int:
    return (next_renewal - today).days


REMIND_WAVES = (7, 3, 1)


def remind_wave(days_left: int) -> Optional[int]:
    """今天该响哪一波。只在正好 7 / 3 / 1 天时开火，错过不补发。"""
    if days_left in REMIND_WAVES:
        return days_left
    return None


def urgency(remaining: int, remind_days: int = 7) -> str:
    if remaining < 0:
        return "overdue"
    if remaining == 0:
        return "today"
    if remaining <= 7:
        return "soon"
    return "ok"


def monthly_equivalent_fen(amount_fen: int, cycle: str, cycle_days: Optional[int] = None) -> int:
    if amount_fen < 0:
        raise ValueError("金额不能为负")
    if cycle == "monthly":
        return amount_fen
    if cycle == "quarterly":
        return amount_fen // 3
    if cycle == "yearly":
        return amount_fen // 12
    if cycle == "custom":
        days = int(cycle_days or 0)
        if days < 1:
            raise ValueError("自定义周期至少 1 天")
        return (amount_fen * 30) // days
    raise ValueError(f"未知周期: {cycle}")


def yearly_equivalent_fen(amount_fen: int, cycle: str, cycle_days: Optional[int] = None) -> int:
    if amount_fen < 0:
        raise ValueError("金额不能为负")
    if cycle == "yearly":
        return amount_fen
    if cycle == "monthly":
        return amount_fen * 12
    if cycle == "quarterly":
        return amount_fen * 4
    if cycle == "custom":
        days = int(cycle_days or 0)
        if days < 1:
            raise ValueError("自定义周期至少 1 天")
        return (amount_fen * 365) // days
    raise ValueError(f"未知周期: {cycle}")


def parse_yuan_to_fen(text: object) -> int:
    raw = str(text).strip().replace(",", "")
    if not raw:
        raise ValueError("金额不能为空")
    if raw.startswith("-"):
        raise ValueError("金额不能为负")
    if raw.count(".") > 1:
        raise ValueError("金额格式不对")
    if "." in raw:
        whole, frac = raw.split(".", 1)
        if not whole:
            whole = "0"
        if not whole.isdigit() or not frac.isdigit():
            raise ValueError("金额格式不对")
        if len(frac) > 2:
            raise ValueError("金额最多两位小数")
        frac = (frac + "00")[:2]
        return int(whole) * 100 + int(frac)
    if not raw.isdigit():
        raise ValueError("金额格式不对")
    return int(raw) * 100


def _projected_dates(item: dict, today: date, horizon: int):
    """桶图与总额共用事件序列：旧账单本月计一次，再预测未来期次。"""
    balance = item.get("phone_balance_fen")
    managed = item.get("billing_mode") == "balance" and balance is not None
    limit = None
    if managed:
        if not item.get("auto_renew", True):
            return
        fee = int(item["amount_fen"])
        limit = balance // fee if fee else None
    emitted = 0
    origin = parse_iso_date(str(item["next_renewal_on"]))
    cycle, cycle_days = item["cycle"], item.get("cycle_days")
    anchor = item.get("renewal_anchor_day")
    end = add_months(today, horizon)
    index = 0
    if origin < today:
        if limit is not None and emitted >= limit:
            return
        yield today
        emitted += 1
        index = _cycle_index(origin, cycle, cycle_days, today + timedelta(days=1), anchor)
    last = _cycle_index(origin, cycle, cycle_days, end, anchor)
    for step in range(index, last + 1):
        if limit is not None and emitted >= limit:
            break
        due = shift_cycle(origin, cycle, cycle_days, step, anchor)
        if due > end or (due == end and origin == today):
            break
        yield due
        emitted += 1


def project_monthly_charges(items: list[dict], today: date, horizon: int = 12) -> list[dict]:
    """把相同预测事件归入 horizon 个日历月，末尾不足整月的部分只在滚动总额中展示。"""
    start = date(today.year, today.month, 1)
    buckets = [{"month": add_months(start, n).strftime("%Y-%m"), "fen": 0}
               for n in range(horizon)]
    index = {row["month"]: row for row in buckets}
    for item in items:
        if item.get("status") == "active":
            for due in _projected_dates(item, today, horizon):
                bucket = index.get(due.strftime("%Y-%m"))
                if bucket is not None:
                    bucket["fen"] += int(item["amount_fen"])
    for row in buckets:
        row["yuan"] = fen_to_yuan(row["fen"])
    return buckets


def project_horizon_fen(items: list[dict], today: date, horizon: int = 12) -> int:
    """滚动 horizon 个月；今天与周年同为账单日时，只计今天一端。"""
    return sum(int(item["amount_fen"]) for item in items if item.get("status") == "active"
               for _ in _projected_dates(item, today, horizon))


def fen_to_yuan(fen: int) -> str:
    sign = "-" if fen < 0 else ""
    value = abs(int(fen))
    return f"{sign}{value // 100}.{value % 100:02d}"
