/**
 * [INPUT]: 依赖月度预算状态投影与 finance 统一金额格式化。
 * [OUTPUT]: 对外提供 BudgetProgressCard，展示总预算/支出/余额与可点击分类进度。
 * [POS]: finance 看板的预算派生视图；不取数、不修改预算，只渲染服务端聚合结果。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { BudgetStatusItem } from "../types";
import { formatCurrency, privateValue } from "../lib/format";

export function BudgetProgressCard({
  items,
  totalBudget,
  totalSpent,
  totalRemaining,
  month,
  onItemClick,
}: {
  items: BudgetStatusItem[];
  totalBudget: number;
  totalSpent: number;
  totalRemaining: number;
  month: string;
  onItemClick?: (item: BudgetStatusItem) => void;
}) {
  if (!items.length) {
    return (
      <div className="empty-state">
        在「财务设置 → 类别管理」给支出分类设置月度预算后，这里会出现进度卡。
      </div>
    );
  }

  const overallPercent = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg bg-zzm-fill px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-caption">{month} 总预算</span>
          <span className="text-[16px] font-semibold leading-6 tabular-nums text-foreground">
            {formatCurrency(totalSpent)} / {formatCurrency(totalBudget)}
          </span>
        </div>
        <span className={`text-[12.5px] leading-5 tabular-nums ${totalRemaining >= 0 ? "text-muted-foreground" : "font-semibold text-zzm-accent-ink"}`}>
          {totalRemaining >= 0 ? "剩余" : "超支"} {formatCurrency(Math.abs(totalRemaining))} · {privateValue(overallPercent.toFixed(1)+"%")}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <BudgetRow key={item.categoryId} item={item} onClick={onItemClick} />
        ))}
      </div>
    </div>
  );
}

// 进度条：4px 细轨 + .09 灰底。常态墨色；接近上限用提醒色；超支用朱色——那是需要处理的地方
function BudgetRow({
  item,
  onClick,
}: {
  item: BudgetStatusItem;
  onClick?: (item: BudgetStatusItem) => void;
}) {
  const percent = Math.min(100, Math.max(0, item.percentUsed));
  const over = item.percentUsed > 100;
  const near = !over && item.percentUsed > 80;
  const fill = over ? "bg-zzm-accent" : near ? "bg-warning" : "bg-foreground";
  const emphasis = over ? "font-semibold text-zzm-accent-ink" : near ? "text-warning" : "text-muted-foreground";

  const Wrapper: React.ElementType = onClick ? "button" : "div";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick ? () => onClick(item) : undefined}
      className={`rounded-lg border border-border p-4 text-left transition-colors duration-150 ${onClick ? "cursor-pointer hover:border-[var(--zzm-line-hover)]" : ""}`}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />
          <span className="truncate text-[13.5px] font-semibold leading-5 text-foreground">{item.name}</span>
        </div>
        <span className={`text-[12px] leading-4 tabular-nums ${emphasis}`}>{privateValue(item.percentUsed.toFixed(1)+"%")}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-[2px] bg-[var(--zzm-hairline-2)]">
        <div className={`h-full rounded-[2px] ${fill}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3 text-[12px] leading-4">
        <span className="tabular-nums text-muted-foreground">
          已花 {formatCurrency(item.spent)} / {formatCurrency(item.budget)}
        </span>
        <span className={`tabular-nums ${emphasis}`}>
          {item.remaining >= 0 ? `剩余 ${formatCurrency(item.remaining)}` : `超支 ${formatCurrency(-item.remaining)}`}
        </span>
      </div>
    </Wrapper>
  );
}
