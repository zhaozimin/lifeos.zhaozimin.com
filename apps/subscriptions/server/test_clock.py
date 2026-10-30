# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 clock 与标准库 unittest
[OUTPUT]: 对外提供周期进位、月折合、紧急度的回归
[POS]: server 的日期算术测试，不碰 SQLite
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import unittest
from datetime import date

from clock import (
    add_cycle,
    add_months,
    advance_until_future,
    days_left,
    estimated_spent,
    fen_to_yuan,
    monthly_equivalent_fen,
    parse_yuan_to_fen,
    project_horizon_fen,
    project_monthly_charges,
    resume_date,
    remain_ratio,
    remind_wave,
    shift_cycle,
    urgency,
    yearly_equivalent_fen,
)


class ClockTests(unittest.TestCase):
    def test_month_end_overflow(self) -> None:
        self.assertEqual(add_months(date(2026, 1, 31), 1), date(2026, 2, 28))
        self.assertEqual(add_months(date(2028, 1, 31), 1), date(2028, 2, 29))

    def test_add_cycle(self) -> None:
        origin = date(2026, 8, 16)
        self.assertEqual(add_cycle(origin, "monthly"), date(2026, 9, 16))
        self.assertEqual(add_cycle(origin, "quarterly"), date(2026, 11, 16))
        self.assertEqual(add_cycle(origin, "yearly"), date(2027, 8, 16))
        self.assertEqual(add_cycle(origin, "custom", 30), date(2026, 9, 15))

    def test_advance_skips_missed_periods(self) -> None:
        today = date(2026, 8, 16)
        nxt = advance_until_future(date(2026, 5, 16), "monthly", None, today)
        self.assertEqual(nxt, date(2026, 9, 16))

    def test_urgency(self) -> None:
        self.assertEqual(urgency(-2, 7), "overdue")
        self.assertEqual(urgency(0, 7), "today")
        self.assertEqual(urgency(3, 7), "soon")
        self.assertEqual(urgency(8, 7), "ok")
        self.assertEqual(remind_wave(7), 7)
        self.assertEqual(remind_wave(3), 3)
        self.assertEqual(remind_wave(1), 1)
        self.assertIsNone(remind_wave(2))
        self.assertIsNone(remind_wave(0))
        self.assertEqual(remain_ratio(-1, "monthly"), 0)
        self.assertEqual(remain_ratio(15, "monthly"), 0.5)

    def test_days_left(self) -> None:
        self.assertEqual(days_left(date(2026, 8, 18), date(2026, 8, 16)), 2)
        self.assertEqual(days_left(date(2026, 8, 14), date(2026, 8, 16)), -2)

    def test_money(self) -> None:
        self.assertEqual(parse_yuan_to_fen("140"), 14000)
        self.assertEqual(parse_yuan_to_fen("21.5"), 2150)
        self.assertEqual(parse_yuan_to_fen("0.09"), 9)
        self.assertEqual(fen_to_yuan(2150), "21.50")
        self.assertEqual(monthly_equivalent_fen(24000, "yearly"), 2000)
        self.assertEqual(monthly_equivalent_fen(9000, "quarterly"), 3000)
        self.assertEqual(monthly_equivalent_fen(3000, "custom", 30), 3000)
        self.assertEqual(yearly_equivalent_fen(8000, "yearly"), 8000)
        self.assertEqual(yearly_equivalent_fen(14000, "monthly"), 168000)

    def test_project_monthly_charges(self) -> None:
        today = date(2026, 8, 16)
        curve = project_monthly_charges(
            [
                {
                    "status": "active",
                    "amount_fen": 10000,
                    "cycle": "monthly",
                    "cycle_days": None,
                    "next_renewal_on": "2026-08-20",
                },
                {
                    "status": "active",
                    "amount_fen": 24000,
                    "cycle": "yearly",
                    "cycle_days": None,
                    "next_renewal_on": "2026-12-01",
                },
            ],
            today,
            12,
        )
        self.assertEqual(len(curve), 12)
        self.assertEqual(curve[0]["month"], "2026-08")
        self.assertEqual(curve[0]["fen"], 10000)
        self.assertEqual(curve[4]["month"], "2026-12")
        self.assertEqual(curve[4]["fen"], 34000)

    def test_shift_cycle_back(self) -> None:
        self.assertEqual(shift_cycle(date(2026, 8, 16), "monthly", None, -1), date(2026, 7, 16))

    def test_estimated_spent_monthly_year(self) -> None:
        count, fen = estimated_spent(
            date(2026, 8, 20), "monthly", None, date(2026, 8, 16), 14000
        )
        self.assertEqual(count, 12)
        self.assertEqual(fen, 168000)

    def test_project_horizon_counts_twelve_monthly(self) -> None:
        today = date(2026, 8, 16)
        fen = project_horizon_fen(
            [
                {
                    "status": "active",
                    "amount_fen": 10000,
                    "cycle": "monthly",
                    "cycle_days": None,
                    "next_renewal_on": "2026-09-16",
                }
            ],
            today,
            12,
        )
        self.assertEqual(fen, 120000)

    def test_project_horizon_yearly_next_anniversary(self) -> None:
        today = date(2026, 8, 16)
        fen = project_horizon_fen(
            [
                {
                    "status": "active",
                    "amount_fen": 24000,
                    "cycle": "yearly",
                    "cycle_days": None,
                    "next_renewal_on": "2027-08-01",
                }
            ],
            today,
            12,
        )
        self.assertEqual(fen, 24000)

    def test_estimated_spent_skips_today(self) -> None:
        count, fen = estimated_spent(
            date(2026, 8, 16), "monthly", None, date(2026, 8, 16), 14000
        )
        self.assertEqual(count, 12)
        self.assertEqual(fen, 168000)

    def test_estimated_spent_next_month_is_twelve(self) -> None:
        count, fen = estimated_spent(
            date(2026, 9, 16), "monthly", None, date(2026, 8, 16), 10000
        )
        self.assertEqual(count, 12)
        self.assertEqual(fen, 120000)

    def test_estimated_spent_yearly(self) -> None:
        count, fen = estimated_spent(
            date(2026, 12, 1), "yearly", None, date(2026, 8, 16), 24000
        )
        self.assertEqual(count, 1)
        self.assertEqual(fen, 24000)


    def test_resume_returns_frozen_days(self) -> None:
        """暂停时冻了 12 天，恢复当天就还这 12 天，不管停了多久。"""
        self.assertEqual(
            resume_date(date(2027, 3, 1), 12, "monthly"), date(2027, 3, 13)
        )

    def test_resume_without_remainder_starts_fresh_cycle(self) -> None:
        """中途退订（冻结 0 天）或停在过期上的，恢复按重订一期算。"""
        self.assertEqual(resume_date(date(2026, 8, 16), 0, "monthly"), date(2026, 9, 16))
        self.assertEqual(resume_date(date(2026, 8, 16), None, "yearly"), date(2027, 8, 16))
        self.assertEqual(
            resume_date(date(2026, 8, 16), 0, "custom", 7), date(2026, 8, 23)
        )

    def test_resume_frozen_days_ignores_cycle(self) -> None:
        """还的是天数，不是周期。年付停时剩 3 天，恢复后也只剩 3 天。"""
        self.assertEqual(
            resume_date(date(2026, 8, 16), 3, "yearly"), date(2026, 8, 19)
        )

if __name__ == "__main__":
    unittest.main()
