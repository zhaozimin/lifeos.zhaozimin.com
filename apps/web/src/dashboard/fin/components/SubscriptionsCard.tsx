/**
 * [INPUT]: 依赖周期账目规则、financeAnalytics 订阅聚合与统一金额格式化。
 * [OUTPUT]: 对外提供 SubscriptionsCard，展示启用订阅的月度/年化支出与明细。
 * [POS]: finance 看板的周期支出派生视图；规则编辑留在设置流程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useMemo } from "react";
import { Repeat } from "lucide-react";
import type { RecurringRule } from "../types";
import { recurringTotals } from "../lib/financeAnalytics";
import { formatCurrency } from "../lib/format";

export function SubscriptionsCard({ rules }: { rules: RecurringRule[] }) {
  const totals = useMemo(() => recurringTotals(rules), [rules]);
  if (totals.subscriptions.length === 0) {
    return (
      <div className="empty-state">
        在「财务设置 → 周期账目」加一条月度支出规则后，这里会列出订阅清单。
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-md border border-border px-4 py-3">
        <div>
          <div className="text-caption">月度订阅支出 · 共 {totals.subscriptions.length} 项</div>
          <div className="text-[16px] font-semibold tabular-nums text-foreground">
            {formatCurrency(totals.monthlyExpense)} / 月
          </div>
        </div>
        <div className="text-right">
          <div className="text-caption">年化</div>
          <div className="text-[14px] font-semibold tabular-nums text-foreground">
            {formatCurrency(totals.yearlyExpense)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {totals.subscriptions.map((sub) => (
          <div
            key={sub.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[13px]"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Repeat size={13} />
              </span>
              <span className="truncate font-medium">{sub.name}</span>
            </div>
            <span className="font-medium tabular-nums text-foreground">{formatCurrency(sub.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
